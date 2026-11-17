"""Envio e regras de aviso (diário às 21h e vencimentos). Funções puras sobre `db`/`now`/canal.

`run_tick` é chamado a cada minuto pelo agendador; é idempotente (consulta `notification_log`),
então rodar duas vezes no mesmo minuto — ou voltar de uma queda no mesmo dia — não repete aviso.
"""

import logging
import re
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from finance_api.auth.identity import OWNER_BY_USER_NAME
from finance_api.bills.service import ensure_upcoming_bill_instances
from finance_api.core import app_settings
from finance_api.core.permissions import Owner
from finance_api.db.models import (
    BillInstance,
    Goal,
    NotificationLog,
    PushSubscription,
    RecurringBill,
    User,
)
from finance_api.goals.service import compute_progress
from finance_api.notifications.channels import NotificationChannel, SendResult

logger = logging.getLogger(__name__)

TZ = ZoneInfo("America/Sao_Paulo")
MAX_FAILED_ATTEMPTS = 3  # falhas registradas para o mesmo aviso antes de desistir
TYPE_MAX_LENGTH = 40

Payload = dict[str, str]


def format_brl(cents: int) -> str:
    """Centavos inteiros → "R$ 1.234,56" (sem float)."""
    sign = "-" if cents < 0 else ""
    reais, centavos = divmod(abs(cents), 100)
    return f"{sign}R$ {reais:,}".replace(",", ".") + f",{centavos:02d}"


def _log_type(value: str) -> str:
    return value[:TYPE_MAX_LENGTH]


# --- Envio -------------------------------------------------------------------------------------


def _send_safely(
    channel: NotificationChannel, subscription: PushSubscription, payload: Payload
) -> SendResult:
    try:
        return channel.send(subscription, payload)
    except Exception as exc:  # um canal com defeito não pode derrubar o agendador
        logger.warning("Canal %s falhou: %s", getattr(channel, "name", "?"), type(exc).__name__)
        return SendResult(ok=False, error=f"{type(exc).__name__} no canal")


def deliver(
    db: Session,
    channel: NotificationChannel,
    user_id: int,
    notification_type: str,
    payload: Payload,
    now: datetime,
) -> int:
    """Envia a todos os aparelhos do usuário, grava `notification_log` e trata a resposta.

    404/410 apaga a inscrição; sucesso grava `last_ok_at`. Devolve quantos envios deram certo.
    """
    subscriptions = list(
        db.scalars(
            select(PushSubscription)
            .where(PushSubscription.user_id == user_id)
            .order_by(PushSubscription.id)
        )
    )
    sent = 0
    for subscription in subscriptions:
        result = _send_safely(channel, subscription, payload)
        error = result.error
        if result.gone:
            error = f"{error or 'inscrição expirada'}; inscrição removida"
        db.add(
            NotificationLog(
                user_id=user_id,
                channel=channel.name,
                type=_log_type(notification_type),
                sent_at=now,
                status="sent" if result.ok else "failed",
                error=None if result.ok else error,
            )
        )
        if result.ok:
            subscription.last_ok_at = now
            sent += 1
        elif result.gone:
            db.delete(subscription)
    db.commit()
    return sent


def _already_handled(db: Session, user_id: int, notification_type: str) -> bool:
    """Já enviado com sucesso (ou falhou demais) para este usuário? Então não repete."""
    # falhas contadas por tentativa (tick), não por aparelho: 3 aparelhos falhando no
    # mesmo minuto são uma tentativa só
    rows = db.execute(
        select(NotificationLog.status, func.count(func.distinct(NotificationLog.sent_at)))
        .where(
            NotificationLog.user_id == user_id,
            NotificationLog.type == _log_type(notification_type),
        )
        .group_by(NotificationLog.status)
    ).all()
    counts = {status: count for status, count in rows}
    return counts.get("sent", 0) > 0 or counts.get("failed", 0) >= MAX_FAILED_ATTEMPTS


# --- Configurações lidas a cada tick ------------------------------------------------------------

_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _parse_time(value: Any, default: str) -> time:
    match = _HHMM.match(value) if isinstance(value, str) else None
    if match is None:
        logger.warning("Horário inválido nas configurações; usando %s", default)
        match = _HHMM.match(default)
    assert match is not None
    return time(int(match.group(1)), int(match.group(2)))


def _parse_days(value: Any, default: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 10:
        return default
    return value


# --- Regras ------------------------------------------------------------------------------------


def _user_owner(user: User) -> Owner | None:
    return OWNER_BY_USER_NAME.get(user.name)


def _visible(bill_owner: str, user_owner: Owner) -> bool:
    return bill_owner == Owner.AMBOS or bill_owner == user_owner


def _open_bills_due(db: Session, dates: set[date]) -> list[tuple[BillInstance, RecurringBill]]:
    rows = db.execute(
        select(BillInstance, RecurringBill)
        .join(RecurringBill, RecurringBill.id == BillInstance.recurring_bill_id)
        .where(BillInstance.status == "open", BillInstance.due_date.in_(dates))
        .order_by(BillInstance.due_date, BillInstance.id)
    ).all()
    return [(instance, bill) for instance, bill in rows]


def _daily_goals(db: Session) -> list[Goal]:
    return list(
        db.scalars(
            select(Goal)
            .where(Goal.type == "income_period", Goal.period == "daily", Goal.active.is_(True))
            .order_by(Goal.id)
        )
    )


def _goal_line(db: Session, goal: Goal, today: date) -> str:
    progress = compute_progress(db, goal, today)
    return (
        f"{goal.name} hoje: {format_brl(progress['current_cents'])}"
        f" de {format_brl(progress['target_cents'])} — quanto rodou?"
    )


def _daily_body(
    due_today: list[tuple[BillInstance, RecurringBill]], goal_lines: list[str] | None = None
) -> str:
    parts = ["Hora de enviar as movimentações de hoje"]
    if due_today:
        items = ", ".join(f"{bill.name} ({format_brl(i.amount_cents)})" for i, bill in due_today)
        label = "Vence hoje" if len(due_today) == 1 else "Vencem hoje"
        parts[0] = f"{parts[0]}. {label}: {items}"
    parts.extend(goal_lines or [])
    return ". ".join(parts)


def _run_daily(
    db: Session, now: datetime, channel: NotificationChannel, users: list[User], send_at: time
) -> int:
    local = now.astimezone(TZ)
    if local.time() < send_at:
        return 0
    today = local.date()
    notification_type = f"daily:{today.isoformat()}"
    due_today = _open_bills_due(db, {today})
    goals = _daily_goals(db)
    sent = 0
    for user in users:
        owner = _user_owner(user)
        if owner is None or _already_handled(db, user.id, notification_type):
            continue
        mine = [(i, bill) for i, bill in due_today if _visible(bill.owner, owner)]
        my_goals = [g for g in goals if _visible(g.owner, owner)]
        url = f"/lancar?meta={my_goals[0].id}" if my_goals else "/"
        body = _daily_body(mine, [_goal_line(db, g, today) for g in my_goals])
        payload = {"title": "Finanças", "body": body, "url": url}
        sent += deliver(db, channel, user.id, notification_type, payload, now)
    return sent


def _bill_payload(bill: RecurringBill, instance: BillInstance, days: int) -> Payload:
    amount = format_brl(instance.amount_cents)
    if days <= 0:
        when, title = "vence hoje", "Conta vence hoje"
    elif days == 1:
        when, title = "vence amanhã", "Conta vence amanhã"
    else:
        when, title = f"vence em {days} dias", f"Conta vence em {days} dias"
    return {"title": title, "body": f"{bill.name} ({amount}) {when}", "url": "/geral"}


def _run_bills(
    db: Session,
    now: datetime,
    channel: NotificationChannel,
    users: list[User],
    send_at: time,
    days_before: int,
) -> int:
    local = now.astimezone(TZ)
    if local.time() < send_at:
        return 0
    today = local.date()
    sent = 0
    for instance, bill in _open_bills_due(db, {today, today + timedelta(days=days_before)}):
        days = (instance.due_date - today).days
        notification_type = f"bill:{instance.id}:d-{days}"
        for user in users:
            owner = _user_owner(user)
            if owner is None or not _visible(bill.owner, owner):
                continue
            if _already_handled(db, user.id, notification_type):
                continue
            sent += deliver(
                db, channel, user.id, notification_type, _bill_payload(bill, instance, days), now
            )
    return sent


def run_tick(db: Session, now: datetime, channel: NotificationChannel) -> int:
    """Um passo do agendador: envia o que está no horário (ou atrasado no mesmo dia).

    `now` precisa ter fuso. Horários e antecedência vêm de `app_settings` a cada chamada.
    Devolve quantos envios deram certo.
    """
    if now.tzinfo is None:
        raise ValueError("now precisa ter fuso horário")
    config = app_settings.get_all(db)
    daily_time = _parse_time(
        config[app_settings.DAILY_TIME], app_settings.DEFAULTS[app_settings.DAILY_TIME]
    )
    bill_time = _parse_time(
        config[app_settings.BILL_TIME], app_settings.DEFAULTS[app_settings.BILL_TIME]
    )
    days_before = _parse_days(
        config[app_settings.BILL_DAYS_BEFORE], app_settings.DEFAULTS[app_settings.BILL_DAYS_BEFORE]
    )
    if ensure_upcoming_bill_instances(db, now.astimezone(TZ).date()):
        db.commit()  # virada do mês: as contas fixas do mês ganham instância (e aviso)
    users = list(db.scalars(select(User).order_by(User.id)))
    sent = _run_daily(db, now, channel, users, daily_time)
    sent += _run_bills(db, now, channel, users, bill_time, days_before)
    return sent
