"""Apoio dos testes de notificações: canal simulado (nada de rede) e dados de exemplo."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI

from finance_api.db.models import BillInstance, PushSubscription, RecurringBill
from finance_api.notifications.channels import SendResult, get_channel

SP = ZoneInfo("America/Sao_Paulo")


def at(day: str, hhmm: str) -> datetime:
    """Instante simulado em America/Sao_Paulo: at("2026-11-13", "21:00")."""
    return datetime.fromisoformat(f"{day}T{hhmm}:00").replace(tzinfo=SP)


class FakeChannel:
    """Registra envios; `results` escolhe a resposta por endpoint (padrão: sucesso)."""

    name = "fake"

    def __init__(self) -> None:
        self.sent: list[tuple[int, dict[str, str]]] = []  # (user_id, payload)
        self.results: dict[str, SendResult] = {}
        self.raises: Exception | None = None

    def send(self, subscription: PushSubscription, payload: dict[str, str]) -> SendResult:
        if self.raises is not None:
            raise self.raises
        result = self.results.get(subscription.endpoint, SendResult(ok=True))
        if result.ok:
            self.sent.append((subscription.user_id, payload))
        return result

    def users(self) -> list[int]:
        return [user_id for user_id, _ in self.sent]


@pytest.fixture
def channel() -> FakeChannel:
    return FakeChannel()


@pytest.fixture
def use_channel(app: FastAPI, channel: FakeChannel) -> FakeChannel:
    app.dependency_overrides[get_channel] = lambda: channel
    return channel


@pytest.fixture
def subscribe(db):
    """subscribe(user, "a") → inscrição do usuário com endpoint https://push.test/a."""

    def _subscribe(user, tag: str = "a") -> PushSubscription:
        sub = PushSubscription(
            user_id=user.id,
            endpoint=f"https://push.test/{tag}-{user.id}",
            keys_json={"p256dh": "chave", "auth": "auth"},
            device_label="Android",
        )
        db.add(sub)
        db.flush()
        return sub

    return _subscribe


@pytest.fixture
def make_bill(db):
    """make_bill("RUTH", "Luz", date(2026, 11, 15), 15000) → BillInstance em aberto."""

    def _make(owner: str, name: str, due: date, amount_cents: int, status: str = "open"):
        bill = RecurringBill(
            owner=owner,
            name=name,
            amount_cents=amount_cents,
            due_day=due.day,
            start_month=due.replace(day=1),
        )
        db.add(bill)
        db.flush()
        instance = BillInstance(
            recurring_bill_id=bill.id,
            month=due.replace(day=1),
            due_date=due,
            amount_cents=amount_cents,
            status=status,
        )
        db.add(instance)
        db.flush()
        return instance

    return _make
