"""Parcelas de empréstimo: cadastro, pagamento/adiantamento, liberação e repartição.

Único lugar que mexe junto nas parcelas (`debt_installments`), nas instâncias de conta fixa
delas (`bill_instances`) e no saldo da dívida (`debts.current_balance_cents`). As funções não
fazem commit; quem chama confirma.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from finance_api.bills.service import first_of_month
from finance_api.core.audit import record_audit
from finance_api.core.permissions import CurrentUser, Owner, ensure_can_write
from finance_api.db.models import BillInstance, Debt, DebtInstallment, RecurringBill, Transaction
from finance_api.debts.present_value import present_value_cents


@dataclass
class InstallmentSpec:
    number: int
    due_date: date
    face_cents: int


@dataclass
class InstallmentView:
    id: int
    number: int
    due_date: date
    face_cents: int
    today_cents: int | None  # valor hoje (só das abertas)
    savings_cents: int | None  # cheio − hoje (só das abertas)
    status: str
    paid_cents: int | None
    paid_on: date | None
    bill_instance_id: int


@dataclass
class LoanSummary:
    remaining_cents: int
    paid_cents: int
    payoff_today_cents: int
    items: list[InstallmentView]


def _installments(db: Session, debt_id: int) -> list[DebtInstallment]:
    return list(
        db.scalars(
            select(DebtInstallment)
            .where(DebtInstallment.debt_id == debt_id)
            .order_by(DebtInstallment.number)
        )
    )


def _status_for(due: date, paid_on: date) -> str:
    """Pago antes do mês do vencimento = adiantada; no mês ou depois = paga."""
    return "prepaid" if first_of_month(due) > first_of_month(paid_on) else "paid"


def _inst_snap(p: DebtInstallment) -> dict[str, Any]:
    return {
        "status": p.status,
        "paid_cents": p.paid_cents,
        "paid_on": p.paid_on.isoformat() if p.paid_on else None,
        "transaction_id": p.transaction_id,
    }


def _audit_installment(
    db: Session, user: CurrentUser, p: DebtInstallment, before: dict[str, Any]
) -> None:
    record_audit(
        db,
        user_id=user.id,
        entity="debt_installments",
        entity_id=p.id,
        action="update",
        before=before,
        after=_inst_snap(p),
    )


def split_amount(total_cents: int, weights: list[int]) -> list[int]:
    """Reparte `total_cents` proporcionalmente aos pesos; soma exata, o resto vai na última."""
    weight_sum = sum(weights)
    if not weights or weight_sum <= 0:
        raise ValueError("Pesos inválidos para repartir o valor.")
    parts = [total_cents * w // weight_sum for w in weights[:-1]]
    parts.append(total_cents - sum(parts))
    return parts


def sync_balance(db: Session, debt: Debt) -> None:
    """Saldo devedor = soma do valor cheio das parcelas em aberto."""
    db.flush()
    total = db.scalar(
        select(func.coalesce(func.sum(DebtInstallment.face_cents), 0)).where(
            DebtInstallment.debt_id == debt.id, DebtInstallment.status == "open"
        )
    )
    debt.current_balance_cents = int(total)  # SUM de bigint volta numeric (Decimal)
    db.flush()


def set_schedule(
    db: Session,
    user: CurrentUser,
    debt: Debt,
    specs: list[InstallmentSpec],
    paid_before_app_cents: int,
    account_id: int | None,
    category_id: int | None,
) -> None:
    """Cadastra (ou recadastra, se nada foi pago) as parcelas, a conta fixa e suas instâncias."""
    ensure_can_write(user, Owner(debt.owner))
    if not specs:
        raise ValueError("Informe ao menos uma parcela.")
    if len({s.number for s in specs}) != len(specs):
        raise ValueError("Número de parcela repetido.")
    if len({first_of_month(s.due_date) for s in specs}) != len(specs):
        raise ValueError("Duas parcelas no mesmo mês.")
    if any(s.face_cents <= 0 for s in specs):
        raise ValueError("Valor da parcela deve ser positivo.")
    if paid_before_app_cents < 0:
        raise ValueError("Total pago antes do app não pode ser negativo.")
    existing = _installments(db, debt.id)
    if any(p.status != "open" for p in existing):
        raise ValueError("Já há parcela paga; não é possível recadastrar.")

    ordered = sorted(specs, key=lambda s: s.number)
    first, last = ordered[0], ordered[-1]
    bill = db.scalar(select(RecurringBill).where(RecurringBill.debt_id == debt.id))
    if existing:
        db.execute(delete(DebtInstallment).where(DebtInstallment.debt_id == debt.id))
    if bill is not None:
        db.execute(delete(BillInstance).where(BillInstance.recurring_bill_id == bill.id))
        action = "update"
    else:
        bill = RecurringBill(debt_id=debt.id)
        db.add(bill)
        action = "create"
    bill.name = debt.name
    bill.owner = debt.owner
    bill.amount_cents = first.face_cents
    bill.due_day = first.due_date.day
    bill.start_month = first_of_month(first.due_date)
    bill.end_month = first_of_month(last.due_date)
    bill.account_id = account_id
    bill.category_id = category_id
    db.flush()

    for s in ordered:
        inst = BillInstance(
            recurring_bill_id=bill.id,
            month=first_of_month(s.due_date),
            due_date=s.due_date,
            amount_cents=s.face_cents,
            status="open",
        )
        db.add(inst)
        db.flush()
        db.add(
            DebtInstallment(
                debt_id=debt.id,
                number=s.number,
                due_date=s.due_date,
                face_cents=s.face_cents,
                status="open",
                bill_instance_id=inst.id,
            )
        )
    before_debt = {
        "paid_before_app_cents": debt.paid_before_app_cents,
        "current_balance_cents": debt.current_balance_cents,
    }
    debt.paid_before_app_cents = paid_before_app_cents
    sync_balance(db, debt)
    record_audit(
        db,
        user_id=user.id,
        entity="recurring_bills",
        entity_id=bill.id,
        action=action,
        after={"debt_id": debt.id, "name": bill.name, "installments": len(ordered)},
    )
    record_audit(
        db,
        user_id=user.id,
        entity="debts",
        entity_id=debt.id,
        action="update",
        before=before_debt,
        after={
            "paid_before_app_cents": debt.paid_before_app_cents,
            "current_balance_cents": debt.current_balance_cents,
        },
    )


def _description(debt: Debt, numbers: list[int]) -> str:
    ordinals = ", ".join(f"{n}ª" for n in numbers)
    if len(numbers) == 1:
        return f"{debt.name} — parcela {ordinals}"
    return f"{debt.name} — adiantamento parcelas {ordinals}"


def pay_installments(
    db: Session,
    user: CurrentUser,
    debt: Debt,
    installment_ids: list[int],
    amount_cents: int,
    account_id: int,
    paid_on: date,
) -> Transaction:
    """Paga/adianta parcelas com uma única despesa no valor real cobrado."""
    # Import tardio: transactions.service importa este módulo (liberar/repartir).
    from finance_api.transactions.service import TxData, create_transaction

    if not installment_ids:
        raise HTTPException(422, "Escolha ao menos uma parcela.")
    if amount_cents <= 0:
        raise HTTPException(422, "O valor pago deve ser positivo.")
    ids = set(installment_ids)
    parcels = list(
        db.scalars(
            select(DebtInstallment)
            .where(DebtInstallment.id.in_(ids))
            .order_by(DebtInstallment.number)
            .with_for_update()
        )
    )
    if len(parcels) != len(ids) or any(p.debt_id != debt.id for p in parcels):
        raise HTTPException(422, "Parcela não encontrada nesta dívida.")
    if any(p.status != "open" for p in parcels):
        raise HTTPException(status.HTTP_409_CONFLICT, "Parcela já paga.")
    bill = db.scalar(select(RecurringBill).where(RecurringBill.debt_id == debt.id))
    if bill is None:
        raise HTTPException(422, "A dívida não tem parcelas cadastradas.")

    tx = create_transaction(
        db,
        user,
        TxData(
            kind="expense",
            amount_cents=amount_cents,
            date=paid_on,
            description=_description(debt, [p.number for p in parcels]),
            account_id=account_id,
            to_account_id=None,
            category_id=bill.category_id,
            owner=debt.owner,
        ),
    ).transaction

    weights = [
        present_value_cents(p.face_cents, p.due_date, paid_on, debt.monthly_rate) for p in parcels
    ]
    for p, part in zip(parcels, split_amount(amount_cents, weights), strict=True):
        before = _inst_snap(p)
        p.status = _status_for(p.due_date, paid_on)
        p.paid_cents = part
        p.paid_on = paid_on
        p.transaction_id = tx.id
        inst = db.get(BillInstance, p.bill_instance_id)
        assert inst is not None  # FK RESTRICT
        inst_before = {"status": inst.status, "paid_transaction_id": inst.paid_transaction_id}
        inst.status = p.status
        inst.paid_transaction_id = tx.id
        db.flush()
        _audit_installment(db, user, p, before)
        record_audit(
            db,
            user_id=user.id,
            entity="bill_instances",
            entity_id=inst.id,
            action="update",
            before=inst_before,
            after={"status": inst.status, "paid_transaction_id": tx.id},
        )
    sync_balance(db, debt)
    return tx


def release_installments(db: Session, user: CurrentUser, tx: Transaction) -> bool:
    """Reabre as parcelas (e instâncias) pagas por `tx`. Devolve False se não havia nenhuma."""
    parcels = list(
        db.scalars(select(DebtInstallment).where(DebtInstallment.transaction_id == tx.id))
    )
    if not parcels:
        return False
    for p in parcels:
        before = _inst_snap(p)
        p.status = "open"
        p.paid_cents = None
        p.paid_on = None
        p.transaction_id = None
        inst = db.get(BillInstance, p.bill_instance_id)
        assert inst is not None  # FK RESTRICT
        inst_before = {"status": inst.status, "paid_transaction_id": inst.paid_transaction_id}
        inst.status = "open"
        inst.paid_transaction_id = None
        db.flush()
        _audit_installment(db, user, p, before)
        record_audit(
            db,
            user_id=user.id,
            entity="bill_instances",
            entity_id=inst.id,
            action="update",
            before=inst_before,
            after={"status": "open", "paid_transaction_id": None},
        )
    for debt_id in {p.debt_id for p in parcels}:
        debt = db.get(Debt, debt_id)
        assert debt is not None
        sync_balance(db, debt)
    return True


def resplit_installments(db: Session, tx: Transaction) -> None:
    """Após editar valor/data do lançamento: reparte `paid_cents` e refaz `paid_on`/status.

    Pesos = valor hoje de cada parcela na data do lançamento. Auditado pela edição do lançamento.
    """
    parcels = list(
        db.scalars(
            select(DebtInstallment)
            .where(DebtInstallment.transaction_id == tx.id)
            .order_by(DebtInstallment.number)
        )
    )
    if not parcels:
        return
    debt = db.get(Debt, parcels[0].debt_id)
    assert debt is not None
    weights = [
        present_value_cents(p.face_cents, p.due_date, tx.date, debt.monthly_rate) for p in parcels
    ]
    for p, part in zip(parcels, split_amount(tx.amount_cents, weights), strict=True):
        p.paid_cents = part
        p.paid_on = tx.date
        p.status = _status_for(p.due_date, tx.date)
        inst = db.get(BillInstance, p.bill_instance_id)
        assert inst is not None
        inst.status = p.status
    db.flush()


def loan_summary(db: Session, debt: Debt, today: date) -> LoanSummary:
    """Topo e lista do empréstimo: restante, total pago, quitar hoje e cada parcela."""
    items: list[InstallmentView] = []
    remaining = paid = payoff = 0
    for p in _installments(db, debt.id):
        today_cents = savings = None
        if p.status == "open":
            today_cents = present_value_cents(p.face_cents, p.due_date, today, debt.monthly_rate)
            savings = p.face_cents - today_cents
            remaining += p.face_cents
            payoff += today_cents
        else:
            paid += p.paid_cents or 0
        items.append(
            InstallmentView(
                id=p.id,
                number=p.number,
                due_date=p.due_date,
                face_cents=p.face_cents,
                today_cents=today_cents,
                savings_cents=savings,
                status=p.status,
                paid_cents=p.paid_cents,
                paid_on=p.paid_on,
                bill_instance_id=p.bill_instance_id,
            )
        )
    return LoanSummary(
        remaining_cents=remaining,
        paid_cents=debt.paid_before_app_cents + paid,
        payoff_today_cents=payoff,
        items=items,
    )
