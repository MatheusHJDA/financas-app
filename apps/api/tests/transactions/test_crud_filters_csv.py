"""CRUD, permissões, auditoria, filtros, paginação e exportação CSV."""

import datetime as dt

from sqlalchemy import select

from finance_api.db.models import AuditLog, Transaction


def _audits(db):
    return list(
        db.scalars(select(AuditLog).where(AuditLog.entity == "transactions").order_by(AuditLog.id))
    )


# --- permissões e auditoria ---------------------------------------------------------------


def test_ruth_cannot_edit_or_delete_matheus_transaction(
    client_as, users, db, make_account, make_tx
):
    tx = make_tx(make_account(), owner="MATHEUS")
    client = client_as(users["ruth"])
    assert client.patch(f"/api/transactions/{tx.id}", json={"description": "x"}).status_code == 403
    assert client.delete(f"/api/transactions/{tx.id}").status_code == 403
    assert db.get(Transaction, tx.id).description == "Lançamento"
    assert _audits(db) == []


def test_ruth_cannot_create_for_matheus(client_as, users, make_account):
    body = {
        "kind": "expense",
        "amount_cents": 100,
        "date": "2026-03-10",
        "description": "x",
        "account_id": make_account().id,
        "owner": "MATHEUS",
    }
    assert client_as(users["ruth"]).post("/api/transactions", json=body).status_code == 403


def test_ruth_edits_and_deletes_ambos_transaction(client_as, users, db, make_account, make_tx):
    tx = make_tx(make_account(owner="AMBOS"), owner="AMBOS", amount=1000)
    client = client_as(users["ruth"])
    r = client.patch(f"/api/transactions/{tx.id}", json={"amount_cents": 2500})
    assert r.status_code == 200
    assert r.json()["amount_cents"] == 2500
    assert client.delete(f"/api/transactions/{tx.id}").status_code == 204
    assert [a.action for a in _audits(db)] == ["update", "delete"]


def _tx_body(account_id, **extra):
    body = {
        "kind": "expense",
        "amount_cents": 100,
        "date": "2026-03-10",
        "description": "x",
        "account_id": account_id,
        "owner": "RUTH",
    }
    return body | extra


def test_ruth_cannot_move_money_in_matheus_account(client_as, users, db, make_account):
    """D6: o dono do lançamento não basta; mexer no saldo exige poder escrever na conta."""
    matheus_acc = make_account("Conta Matheus", owner="MATHEUS")
    ruth_acc = make_account("Conta Ruth", owner="RUTH")
    client = client_as(users["ruth"])
    for body in (
        _tx_body(matheus_acc.id),
        _tx_body(matheus_acc.id, owner="AMBOS"),
        _tx_body(matheus_acc.id, kind="income"),
        _tx_body(matheus_acc.id, kind="transfer", to_account_id=ruth_acc.id),
    ):
        assert client.post("/api/transactions", json=body).status_code == 403, body
    assert db.scalars(select(Transaction)).all() == []
    assert _audits(db) == []


def test_ruth_can_transfer_into_matheus_account(client_as, users, make_account):
    matheus_acc = make_account("Conta Matheus", owner="MATHEUS")
    ruth_acc = make_account("Conta Ruth", owner="RUTH")
    body = _tx_body(ruth_acc.id, kind="transfer", to_account_id=matheus_acc.id)
    assert client_as(users["ruth"]).post("/api/transactions", json=body).status_code == 201


def test_ruth_cannot_move_her_transaction_to_matheus_account(
    client_as, users, db, make_account, make_tx
):
    matheus_acc = make_account("Conta Matheus", owner="MATHEUS")
    tx = make_tx(make_account("Conta Ruth", owner="RUTH"), owner="RUTH")
    client = client_as(users["ruth"])
    r = client.patch(f"/api/transactions/{tx.id}", json={"account_id": matheus_acc.id})
    assert r.status_code == 403
    assert db.get(Transaction, tx.id).account_id != matheus_acc.id


def test_ruth_cannot_touch_her_transaction_sitting_in_matheus_account(
    client_as, users, db, make_account, make_tx
):
    """Lançamento RUTH gravado (pelo admin) na conta do Matheus: Ruth não edita nem exclui."""
    tx = make_tx(make_account("Conta Matheus", owner="MATHEUS"), owner="RUTH")
    client = client_as(users["ruth"])
    assert client.patch(f"/api/transactions/{tx.id}", json={"amount_cents": 5}).status_code == 403
    assert client.delete(f"/api/transactions/{tx.id}").status_code == 403
    assert db.get(Transaction, tx.id) is not None


def test_unauthenticated_gets_401(client_as, make_account, make_tx):
    tx = make_tx(make_account())
    client = client_as(None)
    assert client.get("/api/transactions").status_code == 401
    assert client.get(f"/api/transactions/{tx.id}").status_code == 401
    assert client.get("/api/transactions/export.csv").status_code == 401
    assert client.post("/api/transactions", json=_tx_body(tx.account_id)).status_code == 401
    assert client.delete(f"/api/transactions/{tx.id}").status_code == 401


def test_member_cannot_hand_transaction_to_other_owner(client_as, users, make_account, make_tx):
    tx = make_tx(make_account(), owner="RUTH")
    r = client_as(users["ruth"]).patch(f"/api/transactions/{tx.id}", json={"owner": "MATHEUS"})
    assert r.status_code == 403


def test_admin_edits_and_deletes_anything(client_as, users, make_account, make_tx):
    tx = make_tx(make_account(), owner="RUTH")
    client = client_as(users["matheus"])
    assert client.patch(f"/api/transactions/{tx.id}", json={"description": "ok"}).status_code == 200
    assert client.delete(f"/api/transactions/{tx.id}").status_code == 204
    assert client.get(f"/api/transactions/{tx.id}").status_code == 404


def test_everyone_reads_everything(client_as, users, make_account, make_tx):
    tx = make_tx(make_account(), owner="MATHEUS")
    client = client_as(users["ruth"])
    assert client.get(f"/api/transactions/{tx.id}").status_code == 200
    assert client.get("/api/transactions").json()["total"] == 1


def test_audit_trail_for_create_update_delete(client_as, users, db, make_account):
    account = make_account(owner="AMBOS")
    client = client_as(users["ruth"])
    body = {
        "kind": "expense",
        "amount_cents": 1000,
        "date": "2026-03-10",
        "description": "Luz",
        "account_id": account.id,
        "owner": "RUTH",
    }
    tx_id = client.post("/api/transactions", json=body).json()["id"]
    client.patch(f"/api/transactions/{tx_id}", json={"amount_cents": 1200})
    client.delete(f"/api/transactions/{tx_id}")
    create, update, delete = _audits(db)
    assert (create.action, update.action, delete.action) == ("create", "update", "delete")
    assert all(
        a.user_id == users["ruth"].id and a.entity_id == str(tx_id)
        for a in (create, update, delete)
    )
    assert create.before_json is None and create.after_json["amount_cents"] == 1000
    assert update.before_json["amount_cents"] == 1000
    assert update.after_json["amount_cents"] == 1200
    assert delete.before_json["amount_cents"] == 1200 and delete.after_json is None
    assert create.after_json["date"] == "2026-03-10"


def test_patch_recomputes_hash_validates_and_converts_transfer(
    client_as, users, db, make_account, make_tx
):
    a = make_account()
    b = make_account("B")
    transfer = make_tx(a, "transfer", 500, to_account=b, description="Pix")
    client = client_as(users["matheus"])
    # transferência → despesa: a conta de destino é limpa sozinha
    r = client.patch(f"/api/transactions/{transfer.id}", json={"kind": "expense"})
    assert r.status_code == 200
    assert r.json()["to_account_id"] is None
    # despesa → transferência sem destino é inválido
    r = client.patch(f"/api/transactions/{transfer.id}", json={"kind": "transfer"})
    assert r.status_code == 422
    assert (
        client.patch(f"/api/transactions/{transfer.id}", json={"amount_cents": None}).status_code
        == 422
    )
    assert client.patch("/api/transactions/9999", json={"description": "x"}).status_code == 404


def test_patch_signals_duplicates(client_as, users, make_account):
    account = make_account()
    client = client_as(users["matheus"])
    body = {
        "kind": "expense",
        "amount_cents": 999,
        "date": "2026-03-10",
        "description": "Padaria",
        "account_id": account.id,
        "owner": "MATHEUS",
    }
    first = client.post("/api/transactions", json=body).json()["id"]
    second = client.post("/api/transactions", json={**body, "date": "2026-03-20"}).json()["id"]
    r = client.patch(f"/api/transactions/{second}", json={"date": "2026-03-11"})
    assert r.headers["X-Possible-Duplicate-Of"] == str(first)


# --- filtros e paginação ------------------------------------------------------------------


def _seed(make_account, make_category, make_tx):
    ruth_acc = make_account("Conta Ruth", owner="RUTH")
    math_acc = make_account("Conta Matheus", owner="MATHEUS")
    food = make_category("Alimentação")
    uber = make_category("Uber", kind="income")
    t1 = make_tx(
        ruth_acc,
        "expense",
        1000,
        dt.date(2026, 3, 1),
        "Padaria Pão Quente",
        category=food,
        owner="RUTH",
    )
    t2 = make_tx(
        math_acc,
        "income",
        5000,
        dt.date(2026, 3, 5),
        "Corridas Uber",
        category=uber,
        owner="MATHEUS",
    )
    t3 = make_tx(
        math_acc,
        "expense",
        2000,
        dt.date(2026, 3, 9),
        "100% Leite_Fresco",
        category=food,
        owner="AMBOS",
    )
    t4 = make_tx(
        math_acc,
        "transfer",
        700,
        dt.date(2026, 3, 12),
        "Pix para Ruth",
        to_account=ruth_acc,
        owner="AMBOS",
    )
    return ruth_acc, math_acc, food, uber, t1, t2, t3, t4


def _ids(r):
    assert r.status_code == 200
    return [t["id"] for t in r.json()["items"]]


def test_filters(client_as, users, make_account, make_category, make_tx):
    ruth_acc, math_acc, food, uber, t1, t2, t3, t4 = _seed(make_account, make_category, make_tx)
    client = client_as(users["ruth"])

    def get(**params):
        return _ids(client.get("/api/transactions", params=params))

    assert get() == [t4.id, t3.id, t2.id, t1.id]  # mais recentes primeiro
    assert get(owner="RUTH") == [t1.id]
    assert get(owner="MATHEUS") == [t2.id]
    assert get(owner="AMBOS") == [t4.id, t3.id]
    assert get(account_id=ruth_acc.id) == [t4.id, t1.id]  # inclui transferência recebida
    assert get(category_id=food.id) == [t3.id, t1.id]
    assert get(kind="income") == [t2.id]
    assert get(kind="transfer") == [t4.id]
    assert get(date_from="2026-03-05", date_to="2026-03-09") == [t3.id, t2.id]
    assert get(q="uber") == [t2.id]
    assert get(q="PADARIA pão") == [t1.id]
    assert get(q="100%") == [t3.id]  # % não vira curinga
    assert get(q="Leite_") == [t3.id]
    assert get(q="%") == [t3.id]
    assert get(owner="AMBOS", kind="expense", q="leite") == [t3.id]
    assert client.get("/api/transactions", params={"owner": "OUTRO"}).status_code == 422


def test_pagination_returns_items_and_total(client_as, users, make_account, make_tx):
    account = make_account()
    txs = [make_tx(account, date=dt.date(2026, 3, d)) for d in range(1, 6)]
    client = client_as(users["ruth"])
    page = client.get("/api/transactions", params={"limit": 2, "offset": 1}).json()
    assert page["total"] == 5
    assert [t["id"] for t in page["items"]] == [txs[3].id, txs[2].id]
    assert client.get("/api/transactions", params={"limit": 201}).status_code == 422


# --- CSV ----------------------------------------------------------------------------------


def test_csv_export_is_excel_br_friendly(client_as, users, make_account, make_category, make_tx):
    ruth_acc, math_acc, food, uber, *_ = _seed(make_account, make_category, make_tx)
    make_tx(
        math_acc,
        "expense",
        123456,
        dt.date(2026, 4, 2),
        "Açaí e café",
        category=food,
        owner="MATHEUS",
    )
    r = client_as(users["ruth"]).get("/api/transactions/export.csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    assert r.content[:3] == b"\xef\xbb\xbf"  # BOM UTF-8
    lines = r.content.decode("utf-8-sig").split("\r\n")
    assert lines[0] == "Data;Tipo;Descrição;Valor (R$);Conta;Conta destino;Categoria;Dono;Origem"
    assert (
        lines[1]
        == "02/04/2026;Despesa;Açaí e café;1234,56;Conta Matheus;;Alimentação;MATHEUS;manual"
    )
    assert (
        "12/03/2026;Transferência;Pix para Ruth;7,00;Conta Matheus;Conta Ruth;;AMBOS;manual"
        in lines
    )
    assert "05/03/2026;Receita;Corridas Uber;50,00;Conta Matheus;;Uber;MATHEUS;manual" in lines


def test_csv_respects_filters_limit_and_blocks_formula_injection(
    client_as, users, make_account, make_tx
):
    account = make_account()
    make_tx(account, description='=HYPERLINK("http://x")', date=dt.date(2026, 3, 2), owner="RUTH")
    make_tx(account, description="Normal", date=dt.date(2026, 3, 1), owner="MATHEUS")
    client = client_as(users["ruth"])
    only_ruth = client.get("/api/transactions/export.csv", params={"owner": "RUTH"})
    rows = only_ruth.content.decode("utf-8-sig").strip().split("\r\n")
    assert len(rows) == 2
    assert "\"'=HYPERLINK" in rows[1]  # apóstrofo neutraliza a fórmula (campo vem entre aspas)
    assert ";=HYPERLINK" not in rows[1]
    limited = client.get("/api/transactions/export.csv", params={"limit": 1, "offset": 1})
    assert limited.content.decode("utf-8-sig").strip().split("\r\n")[1].split(";")[2] == "Normal"


def test_csv_blocks_formula_after_leading_spaces(client_as, users, make_account, make_tx):
    account = make_account()
    make_tx(account, description=' =HYPERLINK("http://x")', date=dt.date(2026, 3, 2))
    make_tx(account, description="| cmd", date=dt.date(2026, 3, 1))
    r = client_as(users["ruth"]).get("/api/transactions/export.csv")
    rows = r.content.decode("utf-8-sig").strip().split("\r\n")
    assert "' =HYPERLINK" in rows[1]
    assert ";'| cmd;" in rows[2]
