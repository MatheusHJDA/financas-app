from datetime import date, timedelta

from sqlalchemy import select

from finance_api.bills.service import first_of_month, today_sp
from finance_api.db.models import AuditLog, BillInstance, Transaction


class _As:
    """Cliente que reaplica o usuário a cada chamada (client_as compartilha o app)."""

    def __init__(self, client_as, user):
        self._client_as, self._user = client_as, user

    def __getattr__(self, name):
        return getattr(self._client_as(self._user), name)


def _audit(db, entity: str, action: str) -> list[AuditLog]:
    return list(
        db.scalars(select(AuditLog).where(AuditLog.entity == entity, AuditLog.action == action))
    )


def _payload(**kw):
    data = {
        "owner": "AMBOS",
        "name": "Luz",
        "amount_cents": 20000,
        "due_day": 15,
        "start_month": today_sp().replace(day=1).isoformat(),
    }
    data.update(kw)
    return data


def test_criar_conta_gera_instancia_do_mes_e_audita(db, users, client_as):
    client = client_as(users["matheus"])
    resp = client.post("/api/recurring-bills", json=_payload())
    assert resp.status_code == 201
    bill_id = resp.json()["id"]
    insts = client.get("/api/bill-instances").json()
    assert insts["total"] == 1
    item = insts["items"][0]
    assert item["recurring_bill_id"] == bill_id
    assert item["name"] == "Luz" and item["owner"] == "AMBOS"
    assert item["month"] == first_of_month(today_sp()).isoformat()
    assert len(_audit(db, "recurring_bills", "create")) == 1


def test_start_month_e_normalizado_para_dia_1(db, users, client_as):
    resp = client_as(users["matheus"]).post(
        "/api/recurring-bills", json=_payload(start_month="2026-03-17")
    )
    assert resp.json()["start_month"] == "2026-03-01"


def test_listagem_de_contas_recorrentes_paginada(users, client_as, make_bill):
    for n in range(3):
        make_bill(name=f"C{n}")
    page = client_as(users["ruth"]).get("/api/recurring-bills?limit=2&offset=1").json()
    assert page["total"] == 3 and [i["name"] for i in page["items"]] == ["C1", "C2"]


def test_permissoes_ruth_nao_edita_item_do_matheus(db, users, client_as, make_bill):
    mine = make_bill(owner="MATHEUS")
    shared = make_bill(owner="AMBOS", name="Compartilhada")
    ruth = _As(client_as, users["ruth"])
    assert ruth.patch(f"/api/recurring-bills/{mine.id}", json={"name": "x"}).status_code == 403
    assert ruth.delete(f"/api/recurring-bills/{mine.id}").status_code == 403
    assert ruth.post("/api/recurring-bills", json=_payload(owner="MATHEUS")).status_code == 403
    # AMBOS: os dois editam; tentar passar para o dono errado é barrado.
    assert ruth.patch(f"/api/recurring-bills/{shared.id}", json={"name": "Nova"}).status_code == 200
    matheus = _As(client_as, users["matheus"])
    assert (
        matheus.patch(f"/api/recurring-bills/{shared.id}", json={"name": "Outra"}).status_code
        == 200
    )
    assert (
        ruth.patch(f"/api/recurring-bills/{shared.id}", json={"owner": "MATHEUS"}).status_code
        == 403
    )
    # Admin edita o que for da Ruth.
    theirs = make_bill(owner="RUTH", name="Da Ruth")
    assert matheus.delete(f"/api/recurring-bills/{theirs.id}").status_code == 204


def test_editar_atualiza_instancia_aberta_e_nao_a_paga(db, users, client_as, make_bill, account):
    bill = make_bill(start_month=date_m(today_sp(), -2), account_id=account.id)
    client = client_as(users["matheus"])
    client.post("/api/recurring-bills", json=_payload(name="gatilho"))  # gera o mês corrente
    inst = db.scalar(select(BillInstance).where(BillInstance.recurring_bill_id == bill.id))
    resp = client.patch(f"/api/recurring-bills/{bill.id}", json={"amount_cents": 25000})
    assert resp.status_code == 200
    db.refresh(inst)
    assert inst.amount_cents == 25000
    assert client.post(f"/api/bill-instances/{inst.id}/pay").status_code == 200
    client.patch(f"/api/recurring-bills/{bill.id}", json={"amount_cents": 30000})
    db.refresh(inst)
    assert inst.amount_cents == 25000  # paga não muda
    assert len(_audit(db, "recurring_bills", "update")) == 2


def test_excluir_remove_instancias_e_audita(db, users, client_as, make_bill):
    bill = make_bill()
    client = client_as(users["matheus"])
    client.post("/api/recurring-bills", json=_payload(name="gatilho"))
    assert client.delete(f"/api/recurring-bills/{bill.id}").status_code == 204
    assert client.delete(f"/api/recurring-bills/{bill.id}").status_code == 404
    assert client.patch(f"/api/recurring-bills/{bill.id}", json={"name": "x"}).status_code == 404
    assert len(_audit(db, "recurring_bills", "delete")) == 1


def test_validacoes(users, client_as):
    client = client_as(users["matheus"])
    assert client.post("/api/recurring-bills", json=_payload(due_day=32)).status_code == 422
    assert client.post("/api/recurring-bills", json=_payload(amount_cents=0)).status_code == 422
    assert client.post("/api/recurring-bills", json=_payload(account_id=999999)).status_code == 422
    resp = client.post("/api/recurring-bills", json=_payload(end_month="2020-01-01"))
    assert resp.status_code == 422


def _instance(db, bill, due, status="open", month=None):
    row = BillInstance(
        recurring_bill_id=bill.id,
        month=month or due.replace(day=1),
        due_date=due,
        amount_cents=bill.amount_cents,
        status=status,
    )
    db.add(row)
    db.flush()
    return row


def test_instancias_vencidas_sao_abertas_com_vencimento_antes_de_hoje(
    db, users, client_as, make_bill
):
    today = today_sp()
    bill = make_bill()
    vencida = _instance(db, bill, today - timedelta(days=3), month=date_m(today, -1))
    hoje = _instance(db, bill, today)
    futura = _instance(db, bill, today + timedelta(days=5), month=date_m(today, 1))
    paga_antiga = _instance(
        db, bill, today - timedelta(days=40), status="paid", month=date_m(today, -2)
    )
    client = client_as(users["ruth"])
    # vencidas: status=open e date_to = ontem
    resp = client.get(
        "/api/bill-instances",
        params={"status": "open", "date_to": (today - timedelta(days=1)).isoformat()},
    ).json()
    assert [i["id"] for i in resp["items"]] == [vencida.id]
    assert vencida.id != paga_antiga.id
    todas = client.get("/api/bill-instances").json()
    assert [i["id"] for i in todas["items"]] == [paga_antiga.id, vencida.id, hoje.id, futura.id]
    pagas = client.get("/api/bill-instances", params={"status": "paid"}).json()
    assert pagas["total"] == 1
    assert client.get("/api/bill-instances", params={"status": "foo"}).status_code == 422


def date_m(today, offset):
    year, month0 = divmod(today.year * 12 + today.month - 1 + offset, 12)
    return date(year, month0 + 1, 1)


def test_pagar_cria_lancamento_e_vincula(db, users, client_as, make_bill, account, category):
    bill = make_bill(owner="MATHEUS", account_id=account.id, category_id=category.id)
    inst = _instance(db, bill, today_sp())
    resp = client_as(users["matheus"]).post(f"/api/bill-instances/{inst.id}/pay")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "paid" and body["paid_transaction_id"] is not None
    tx = db.get(Transaction, body["paid_transaction_id"])
    assert tx.kind == "expense" and tx.amount_cents == 18000
    assert tx.account_id == account.id and tx.category_id == category.id
    assert tx.bill_instance_id == inst.id and tx.owner == "MATHEUS"
    assert tx.created_by == users["matheus"].id
    assert len(_audit(db, "bill_instances", "update")) == 1
    assert len(_audit(db, "transactions", "create")) == 1
    # pagar de novo → 409
    again = client_as(users["matheus"]).post(f"/api/bill-instances/{inst.id}/pay")
    assert again.status_code == 409


def test_pagar_vinculando_lancamento_existente(db, users, client_as, make_bill, account):
    bill = make_bill()
    inst = _instance(db, bill, today_sp())
    tx = Transaction(
        kind="expense",
        amount_cents=18000,
        date=today_sp(),
        description="Condomínio pago",
        account_id=account.id,
        owner="AMBOS",
        created_by=users["ruth"].id,
        source="manual",
    )
    db.add(tx)
    db.flush()
    resp = client_as(users["ruth"]).post(
        f"/api/bill-instances/{inst.id}/pay", json={"transaction_id": tx.id}
    )
    assert resp.status_code == 200 and resp.json()["paid_transaction_id"] == tx.id
    db.refresh(tx)
    assert tx.bill_instance_id == inst.id
    assert _audit(db, "transactions", "create") == []  # nada novo foi criado


def test_pagar_com_lancamento_que_nao_e_despesa_da_422(db, users, client_as, make_bill, account):
    bill = make_bill()
    inst = _instance(db, bill, today_sp())
    tx = Transaction(
        kind="income",
        amount_cents=18000,
        date=today_sp(),
        description="Salário",
        account_id=account.id,
        owner="AMBOS",
        created_by=users["ruth"].id,
        source="manual",
    )
    db.add(tx)
    db.flush()
    resp = client_as(users["ruth"]).post(
        f"/api/bill-instances/{inst.id}/pay", json={"transaction_id": tx.id}
    )
    assert resp.status_code == 422
    db.refresh(tx)
    assert tx.bill_instance_id is None
    assert db.get(BillInstance, inst.id).status == "open"


def test_pagar_erros(db, users, client_as, make_bill):
    bill = make_bill()  # sem conta bancária
    inst = _instance(db, bill, today_sp())
    client = client_as(users["matheus"])
    assert client.post("/api/bill-instances/999999/pay").status_code == 404
    assert client.post(f"/api/bill-instances/{inst.id}/pay").status_code == 422
    resp = client.post(f"/api/bill-instances/{inst.id}/pay", json={"transaction_id": 999999})
    assert resp.status_code == 404
    assert db.get(BillInstance, inst.id).status == "open"


def test_ruth_nao_paga_conta_do_matheus(db, users, client_as, make_bill, account):
    bill = make_bill(owner="MATHEUS", account_id=account.id)
    inst = _instance(db, bill, today_sp())
    assert client_as(users["ruth"]).post(f"/api/bill-instances/{inst.id}/pay").status_code == 403
    assert db.get(BillInstance, inst.id).status == "open"
