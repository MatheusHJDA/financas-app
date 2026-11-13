from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, select

from finance_api.bills.schemas import (
    BillInstanceOut,
    BillInstancePage,
    BillPayRequest,
    RecurringBillCreate,
    RecurringBillOut,
    RecurringBillPage,
    RecurringBillUpdate,
)
from finance_api.bills.service import (
    due_date_for,
    ensure_bill_instances,
    ensure_upcoming_bill_instances,
    first_of_month,
    today_sp,
)
from finance_api.core.audit import record_audit
from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser, Owner, ensure_can_write
from finance_api.db.models import (
    Account,
    BillInstance,
    Category,
    RecurringBill,
    Transaction,
)
from finance_api.transactions.service import TxData, create_transaction, ensure_can_move

router = APIRouter(tags=["bills"])

User = Annotated[CurrentUser, Depends(get_current_user)]
Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]

_NOT_FOUND = "Conta não encontrada."


def _snap(bill: RecurringBill) -> dict:
    return RecurringBillOut.model_validate(bill).model_dump(mode="json")


def _inst_snap(inst: BillInstance) -> dict:
    return {
        "id": inst.id,
        "recurring_bill_id": inst.recurring_bill_id,
        "month": inst.month.isoformat(),
        "due_date": inst.due_date.isoformat(),
        "amount_cents": inst.amount_cents,
        "status": inst.status,
        "paid_transaction_id": inst.paid_transaction_id,
    }


def _check_refs(
    db: DbSession, account_id: int | None, category_id: int | None, user: CurrentUser
) -> None:
    if account_id is not None:
        account = db.get(Account, account_id)
        if account is None:
            raise HTTPException(422, "Conta bancária inexistente.")
        # pagar a conta fixa debita esta conta: só quem pode movimentá-la a associa (D6)
        ensure_can_move(user, account)
    if category_id is not None and db.get(Category, category_id) is None:
        raise HTTPException(422, "Categoria inexistente.")


def _check_months(start: date, end: date | None) -> None:
    if end is not None and end < start:
        raise HTTPException(422, "end_month não pode ser anterior a start_month.")


def _instance_out(inst: BillInstance, bill: RecurringBill) -> BillInstanceOut:
    return BillInstanceOut(
        id=inst.id,
        recurring_bill_id=inst.recurring_bill_id,
        name=bill.name,
        owner=Owner(bill.owner),
        month=inst.month,
        due_date=inst.due_date,
        amount_cents=inst.amount_cents,
        status=inst.status,
        paid_transaction_id=inst.paid_transaction_id,
    )


@router.get("/recurring-bills", response_model=RecurringBillPage)
def list_recurring_bills(
    db: DbSession, user: User, limit: Limit = 50, offset: Offset = 0
) -> RecurringBillPage:
    total = db.scalar(select(func.count()).select_from(RecurringBill)) or 0
    rows = db.scalars(
        select(RecurringBill).order_by(RecurringBill.id).limit(limit).offset(offset)
    ).all()
    return RecurringBillPage(items=[RecurringBillOut.model_validate(r) for r in rows], total=total)


@router.post("/recurring-bills", response_model=RecurringBillOut, status_code=201)
def create_recurring_bill(body: RecurringBillCreate, db: DbSession, user: User) -> RecurringBillOut:
    ensure_can_write(user, body.owner)
    start = first_of_month(body.start_month)
    end = first_of_month(body.end_month) if body.end_month else None
    _check_months(start, end)
    _check_refs(db, body.account_id, body.category_id, user)
    bill = RecurringBill(
        **body.model_dump(exclude={"start_month", "end_month", "owner"}),
        owner=body.owner.value,
        start_month=start,
        end_month=end,
    )
    db.add(bill)
    db.flush()
    record_audit(
        db,
        user_id=user.id,
        entity="recurring_bills",
        entity_id=bill.id,
        action="create",
        after=_snap(bill),
    )
    ensure_bill_instances(db, today_sp())  # a conta já aparece no mês corrente
    db.commit()
    return RecurringBillOut.model_validate(bill)


@router.patch("/recurring-bills/{id}", response_model=RecurringBillOut)
def update_recurring_bill(
    id: int, body: RecurringBillUpdate, db: DbSession, user: User
) -> RecurringBillOut:
    bill = db.get(RecurringBill, id)
    if bill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, _NOT_FOUND)
    ensure_can_write(user, Owner(bill.owner))
    before = _snap(bill)
    data = body.model_dump(exclude_unset=True)
    if "owner" in data:
        if data["owner"] is None:
            raise HTTPException(422, "owner não pode ser nulo.")
        ensure_can_write(user, Owner(data["owner"]))
        data["owner"] = Owner(data["owner"]).value
    for key in ("name", "amount_cents", "due_day", "start_month"):
        if key in data and data[key] is None:
            raise HTTPException(422, f"{key} não pode ser nulo.")
    if data.get("start_month"):
        data["start_month"] = first_of_month(data["start_month"])
    if data.get("end_month"):
        data["end_month"] = first_of_month(data["end_month"])
    _check_months(data.get("start_month", bill.start_month), data.get("end_month", bill.end_month))
    _check_refs(db, data.get("account_id"), data.get("category_id"), user)
    for key, value in data.items():
        setattr(bill, key, value)
    db.flush()

    # Instâncias ainda abertas acompanham a conta: somem fora do período e (do mês atual em
    # diante) recebem novo valor/vencimento. Instâncias pagas nunca mudam.
    current = first_of_month(today_sp())
    out_of_range = BillInstance.month < bill.start_month
    if bill.end_month is not None:
        out_of_range = out_of_range | (BillInstance.month > bill.end_month)
    db.execute(
        delete(BillInstance).where(
            BillInstance.recurring_bill_id == bill.id,
            BillInstance.status == "open",
            out_of_range,
        )
    )
    for inst in db.scalars(
        select(BillInstance).where(
            BillInstance.recurring_bill_id == bill.id,
            BillInstance.status == "open",
            BillInstance.month >= current,
        )
    ):
        inst.amount_cents = bill.amount_cents
        inst.due_date = due_date_for(inst.month, bill.due_day)
    record_audit(
        db,
        user_id=user.id,
        entity="recurring_bills",
        entity_id=bill.id,
        action="update",
        before=before,
        after=_snap(bill),
    )
    ensure_bill_instances(db, current)
    db.commit()
    return RecurringBillOut.model_validate(bill)


@router.delete("/recurring-bills/{id}", status_code=204)
def delete_recurring_bill(id: int, db: DbSession, user: User) -> Response:
    bill = db.get(RecurringBill, id)
    if bill is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, _NOT_FOUND)
    ensure_can_write(user, Owner(bill.owner))
    paid = db.scalar(
        select(func.count())
        .select_from(BillInstance)
        .where(BillInstance.recurring_bill_id == bill.id, BillInstance.status == "paid")
    )
    if paid:
        # Apagar levaria junto o histórico de pagamentos (e o vínculo dos lançamentos).
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Esta conta fixa já tem pagamentos registrados. Para parar de cobrá-la, "
            "defina o mês final (end_month) em vez de excluir.",
        )
    before = _snap(bill)
    # Só há instâncias em aberto: vão junto.
    db.execute(delete(BillInstance).where(BillInstance.recurring_bill_id == bill.id))
    db.delete(bill)
    record_audit(
        db,
        user_id=user.id,
        entity="recurring_bills",
        entity_id=id,
        action="delete",
        before=before,
    )
    db.commit()
    return Response(status_code=204)


@router.get("/bill-instances", response_model=BillInstancePage)
def list_bill_instances(
    db: DbSession,
    user: User,
    status_: Annotated[str | None, Query(alias="status", pattern="^(open|paid)$")] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> BillInstancePage:
    """Filtros de data valem para o vencimento (due_date). Vencida = open e due_date < hoje."""
    if ensure_upcoming_bill_instances(db):
        db.commit()
    conditions = []
    if status_ is not None:
        conditions.append(BillInstance.status == status_)
    if date_from is not None:
        conditions.append(BillInstance.due_date >= date_from)
    if date_to is not None:
        conditions.append(BillInstance.due_date <= date_to)
    total = db.scalar(select(func.count()).select_from(BillInstance).where(*conditions)) or 0
    rows = db.execute(
        select(BillInstance, RecurringBill)
        .join(RecurringBill, RecurringBill.id == BillInstance.recurring_bill_id)
        .where(*conditions)
        .order_by(BillInstance.due_date, BillInstance.id)
        .limit(limit)
        .offset(offset)
    ).all()
    return BillInstancePage(items=[_instance_out(i, b) for i, b in rows], total=total)


@router.post("/bill-instances/{id}/pay", response_model=BillInstanceOut)
def pay_bill_instance(
    id: int, db: DbSession, user: User, body: BillPayRequest | None = None
) -> BillInstanceOut:
    inst = db.get(BillInstance, id)
    if inst is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Instância não encontrada.")
    bill = db.get(RecurringBill, inst.recurring_bill_id)
    assert bill is not None  # FK RESTRICT
    ensure_can_write(user, Owner(bill.owner))
    if inst.status == "paid":
        raise HTTPException(status.HTTP_409_CONFLICT, "Esta conta já foi paga.")
    before = _inst_snap(inst)

    tx_id = body.transaction_id if body else None
    if tx_id is not None:
        tx = db.get(Transaction, tx_id)
        if tx is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Lançamento não encontrado.")
        if tx.kind != "expense":
            raise HTTPException(422, "Só uma despesa pode pagar uma conta.")
        # vincular mexe no lançamento: exige poder alterá-lo (D6/D12)
        ensure_can_write(user, Owner(tx.owner))
        already = db.scalar(
            select(BillInstance.id).where(
                BillInstance.paid_transaction_id == tx.id, BillInstance.id != inst.id
            )
        )
        if already is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Lançamento já vinculado a outra conta.")
        tx.bill_instance_id = inst.id
    else:
        if bill.account_id is None:
            raise HTTPException(
                422,
                "A conta não tem conta bancária associada; informe transaction_id.",
            )
        # Mesmo caminho de qualquer lançamento: dono, conta de origem (D6), validação,
        # dedupe e auditoria.
        tx = create_transaction(
            db,
            user,
            TxData(
                kind="expense",
                amount_cents=inst.amount_cents,
                date=today_sp(),
                description=bill.name,
                account_id=bill.account_id,
                to_account_id=None,
                category_id=bill.category_id,
                owner=bill.owner,
            ),
            bill_instance_id=inst.id,
        ).transaction

    inst.paid_transaction_id = tx.id
    inst.status = "paid"
    db.flush()
    record_audit(
        db,
        user_id=user.id,
        entity="bill_instances",
        entity_id=inst.id,
        action="update",
        before=before,
        after=_inst_snap(inst),
    )
    db.commit()
    return _instance_out(inst, bill)
