"""Regressões da revisão U12 (contas a pagar e dinheiro)."""

from datetime import date

from sqlalchemy import select

from finance_api.bills.service import ensure_upcoming_bill_instances, first_of_month, today_sp
from finance_api.db.models import Account, BillInstance, Transaction


def _account(db, users, owner: str, name: str) -> Account:
    row = Account(
        owner=owner,
        created_by=users["matheus"].id,
        name=name,
        type="checking",
        initial_balance_cents=0,
        initial_balance_date=date(2026, 1, 1),
    )
    db.add(row)
    db.flush()
    return row


def _instances(db, bill) -> list[BillInstance]:
    return list(
        db.scalars(
            select(BillInstance)
            .where(BillInstance.recurring_bill_id == bill.id)
            .order_by(BillInstance.month)
        )
    )


# --- virada do mês -------------------------------------------------------------------------


def test_virada_do_mes_gera_instancias_do_mes_e_do_seguinte(db, make_bill):
    bill = make_bill(start_month=date(2026, 1, 1))
    assert _instances(db, bill) == []  # cadastrada "antes": nenhuma instância ainda
    assert ensure_upcoming_bill_instances(db, date(2026, 12, 1)) == 2
    assert [i.month for i in _instances(db, bill)] == [date(2026, 12, 1), date(2027, 1, 1)]
    assert ensure_upcoming_bill_instances(db, date(2026, 12, 20)) == 0  # idempotente


def test_listagem_e_overview_garantem_as_contas_do_mes(db, users, client_as, make_bill):
    bill = make_bill(start_month=date(2026, 1, 1))
    client_as(users["ruth"]).get("/api/overview")
    months = [i.month for i in _instances(db, bill)]
    assert first_of_month(today_sp()) in months
    assert len(months) == 2


def test_agendador_gera_as_contas_na_virada(db, users, make_bill):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from finance_api.notifications.service import run_tick

    class _SemCanal:
        name = "fake"

        def send(self, subscription, payload):  # nenhum aparelho inscrito neste teste
            raise AssertionError("não deveria enviar")

    bill = make_bill(start_month=date(2026, 1, 1))
    run_tick(db, datetime(2026, 12, 1, 0, 1, tzinfo=ZoneInfo("America/Sao_Paulo")), _SemCanal())
    assert [i.month for i in _instances(db, bill)] == [date(2026, 12, 1), date(2027, 1, 1)]


# --- permissões ao pagar -------------------------------------------------------------------


def test_ruth_nao_associa_conta_fixa_a_conta_do_matheus(db, users, client_as):
    conta_matheus = _account(db, users, "MATHEUS", "Corrente Matheus")
    resp = client_as(users["ruth"]).post(
        "/api/recurring-bills",
        json={
            "owner": "RUTH",
            "name": "Academia",
            "amount_cents": 500000,
            "due_day": 10,
            "start_month": "2026-01-01",
            "account_id": conta_matheus.id,
        },
    )
    assert resp.status_code == 403


def test_ruth_nao_paga_conta_ambos_debitando_conta_do_matheus(db, users, client_as, make_bill):
    conta_matheus = _account(db, users, "MATHEUS", "Corrente Matheus")
    bill = make_bill(owner="AMBOS", account_id=conta_matheus.id)
    ensure_upcoming_bill_instances(db)
    inst = _instances(db, bill)[0]
    resp = client_as(users["ruth"]).post(f"/api/bill-instances/{inst.id}/pay")
    assert resp.status_code == 403
    db.refresh(inst)
    assert inst.status == "open"
    assert db.scalars(select(Transaction)).all() == []


def test_ruth_nao_usa_lancamento_do_matheus_para_pagar(db, users, client_as, make_bill):
    conta_matheus = _account(db, users, "MATHEUS", "Corrente Matheus")
    bill = make_bill(owner="RUTH")
    ensure_upcoming_bill_instances(db)
    inst = _instances(db, bill)[0]
    tx = Transaction(
        kind="expense",
        amount_cents=18000,
        date=today_sp(),
        description="Pago pelo Matheus",
        account_id=conta_matheus.id,
        owner="MATHEUS",
        created_by=users["matheus"].id,
        source="manual",
    )
    db.add(tx)
    db.flush()
    resp = client_as(users["ruth"]).post(
        f"/api/bill-instances/{inst.id}/pay", json={"transaction_id": tx.id}
    )
    assert resp.status_code == 403
    db.refresh(tx)
    assert tx.bill_instance_id is None


def test_pagar_sem_corpo_passa_pelo_fluxo_normal_de_lancamento(db, users, client_as, make_bill):
    conta = _account(db, users, "AMBOS", "Conjunta")
    bill = make_bill(owner="AMBOS", account_id=conta.id)
    ensure_upcoming_bill_instances(db)
    inst = _instances(db, bill)[0]
    resp = client_as(users["ruth"]).post(f"/api/bill-instances/{inst.id}/pay")
    assert resp.status_code == 200
    tx = db.get(Transaction, resp.json()["paid_transaction_id"])
    assert tx.bill_instance_id == inst.id
    assert tx.dedupe_hash is not None  # agora a duplicidade é detectável
    assert tx.created_by == users["ruth"].id


# --- desfazer pagamento ---------------------------------------------------------------------


def _paid(db, users, client_as, make_bill):
    conta = _account(db, users, "AMBOS", "Conjunta")
    bill = make_bill(owner="AMBOS", account_id=conta.id)
    ensure_upcoming_bill_instances(db)
    inst = _instances(db, bill)[0]
    client = client_as(users["matheus"])
    tx_id = client.post(f"/api/bill-instances/{inst.id}/pay").json()["paid_transaction_id"]
    return client, bill, inst, tx_id


def test_excluir_lancamento_que_pagou_reabre_a_conta(db, users, client_as, make_bill):
    client, _, inst, tx_id = _paid(db, users, client_as, make_bill)
    assert client.delete(f"/api/transactions/{tx_id}").status_code == 204
    db.refresh(inst)
    assert inst.status == "open" and inst.paid_transaction_id is None
    # e dá para pagar de novo
    assert client.post(f"/api/bill-instances/{inst.id}/pay").status_code == 200


def test_lancamento_que_deixa_de_ser_despesa_reabre_a_conta(db, users, client_as, make_bill):
    client, _, inst, tx_id = _paid(db, users, client_as, make_bill)
    resp = client.patch(f"/api/transactions/{tx_id}", json={"kind": "income"})
    assert resp.status_code == 200
    db.refresh(inst)
    assert inst.status == "open"
    assert db.get(Transaction, tx_id).bill_instance_id is None


def test_editar_valor_da_despesa_mantem_a_conta_paga(db, users, client_as, make_bill):
    client, _, inst, tx_id = _paid(db, users, client_as, make_bill)
    assert (
        client.patch(f"/api/transactions/{tx_id}", json={"amount_cents": 19000}).status_code == 200
    )
    db.refresh(inst)
    assert inst.status == "paid" and inst.paid_transaction_id == tx_id


# --- excluir conta fixa ----------------------------------------------------------------------


def test_excluir_conta_fixa_com_pagamento_da_409_e_preserva_historico(
    db, users, client_as, make_bill
):
    client, bill, inst, tx_id = _paid(db, users, client_as, make_bill)
    resp = client.delete(f"/api/recurring-bills/{bill.id}")
    assert resp.status_code == 409
    assert "end_month" in resp.json()["detail"]
    db.refresh(inst)
    assert inst.status == "paid"
    assert db.get(Transaction, tx_id).bill_instance_id == inst.id


def test_excluir_conta_fixa_so_com_instancias_abertas(db, users, client_as, make_bill):
    bill = make_bill()
    ensure_upcoming_bill_instances(db)
    assert client_as(users["matheus"]).delete(f"/api/recurring-bills/{bill.id}").status_code == 204
    assert _instances(db, bill) == []
