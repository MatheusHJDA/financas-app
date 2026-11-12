import datetime as dt

from sqlalchemy import select

from finance_api.accounts.service import compute_balances
from finance_api.db.models import AuditLog

NEW_ACCOUNT = {
    "owner": "RUTH",
    "name": "Nubank Ruth",
    "type": "checking",
    "institution": "Nubank",
    "last4": "1234",
    "initial_balance_cents": 150000,
    "initial_balance_date": "2026-01-01",
}


def _audits(db, entity="accounts"):
    return list(db.scalars(select(AuditLog).where(AuditLog.entity == entity).order_by(AuditLog.id)))


def test_create_account_sets_creator_balance_and_audit(client_as, users, db):
    r = client_as(users["ruth"]).post("/api/accounts", json=NEW_ACCOUNT)
    assert r.status_code == 201
    body = r.json()
    assert body["created_by"] == users["ruth"].id
    assert body["current_balance_cents"] == 150000
    assert body["active"] is True
    (audit,) = _audits(db)
    assert audit.action == "create"
    assert audit.user_id == users["ruth"].id
    assert audit.entity_id == str(body["id"])
    assert audit.after_json["name"] == "Nubank Ruth"
    assert "current_balance_cents" not in audit.after_json


def test_member_cannot_create_account_for_other_owner_but_can_for_ambos(client_as, users):
    client = client_as(users["ruth"])
    assert client.post("/api/accounts", json={**NEW_ACCOUNT, "owner": "MATHEUS"}).status_code == 403
    assert client.post("/api/accounts", json={**NEW_ACCOUNT, "owner": "AMBOS"}).status_code == 201


def test_admin_can_create_account_for_anyone(client_as, users):
    r = client_as(users["matheus"]).post("/api/accounts", json=NEW_ACCOUNT)
    assert r.status_code == 201
    assert r.json()["owner"] == "RUTH"


def test_unauthenticated_gets_401(client_as):
    assert client_as(None).get("/api/accounts").status_code == 401


def test_validation_errors_are_422(client_as, users):
    client = client_as(users["ruth"])
    assert client.post("/api/accounts", json={**NEW_ACCOUNT, "closing_day": 32}).status_code == 422
    assert client.post("/api/accounts", json={**NEW_ACCOUNT, "last4": "12345"}).status_code == 422
    assert client.post("/api/accounts", json={**NEW_ACCOUNT, "type": "bitcoin"}).status_code == 422
    # dinheiro nunca é float
    bad = {**NEW_ACCOUNT, "initial_balance_cents": 10.5}
    assert client.post("/api/accounts", json=bad).status_code == 422


def test_balance_adds_income_subtracts_expense_and_moves_transfers(db, make_account, make_tx):
    checking = make_account("Corrente", initial=100000)
    savings = make_account("Poupança", type="savings", initial=20000)
    make_tx(checking, "income", 50000)
    make_tx(checking, "expense", 20000)
    make_tx(checking, "transfer", 10000, to_account=savings)
    make_tx(savings, "income", 1000)
    balances = compute_balances(db)
    # 100000 + 50000 − 20000 − 10000
    assert balances[checking.id] == 120000
    # 20000 + 10000 (entrada da transferência) + 1000
    assert balances[savings.id] == 31000


def test_balance_ignores_transactions_before_initial_balance_date(db, make_account, make_tx):
    account = make_account(initial=100000, initial_date=dt.date(2026, 3, 1))
    make_tx(account, "expense", 30000, date=dt.date(2026, 2, 28))  # antes: já está no saldo inicial
    make_tx(account, "expense", 5000, date=dt.date(2026, 3, 1))  # no dia: conta
    make_tx(account, "income", 2000, date=dt.date(2026, 3, 15))
    assert compute_balances(db)[account.id] == 97000


def test_transfer_leg_respects_destination_initial_balance_date(db, make_account, make_tx):
    origin = make_account("Origem", initial=50000, initial_date=dt.date(2026, 1, 1))
    dest = make_account("Destino", initial=0, initial_date=dt.date(2026, 4, 1))
    make_tx(origin, "transfer", 10000, date=dt.date(2026, 3, 1), to_account=dest)
    balances = compute_balances(db)
    assert balances[origin.id] == 40000
    assert balances[dest.id] == 0  # a entrada é anterior ao saldo inicial do destino


def test_api_returns_computed_balance_in_list_and_detail(client_as, users, make_account, make_tx):
    account = make_account(initial=1000)
    make_tx(account, "income", 500)
    client = client_as(users["ruth"])
    assert client.get(f"/api/accounts/{account.id}").json()["current_balance_cents"] == 1500
    page = client.get("/api/accounts").json()
    assert page["total"] == 1
    assert page["items"][0]["current_balance_cents"] == 1500


def test_list_pagination(client_as, users, make_account):
    for i in range(3):
        make_account(f"Conta {i}")
    client = client_as(users["ruth"])
    page = client.get("/api/accounts", params={"limit": 2, "offset": 2}).json()
    assert page["total"] == 3
    assert [a["name"] for a in page["items"]] == ["Conta 2"]
    assert client.get("/api/accounts", params={"limit": 0}).status_code == 422


def test_get_missing_account_is_404(client_as, users):
    assert client_as(users["ruth"]).get("/api/accounts/999999").status_code == 404


def test_ruth_cannot_edit_matheus_account(client_as, users, make_account, db):
    account = make_account(owner="MATHEUS")
    r = client_as(users["ruth"]).patch(f"/api/accounts/{account.id}", json={"name": "Hack"})
    assert r.status_code == 403
    assert client_as(users["ruth"]).delete(f"/api/accounts/{account.id}").status_code == 403
    assert _audits(db) == []


def test_ruth_edits_ambos_account_and_audit_has_before_and_after(
    client_as, users, make_account, db
):
    account = make_account("Conjunta", owner="AMBOS")
    r = client_as(users["ruth"]).patch(f"/api/accounts/{account.id}", json={"name": "Casa"})
    assert r.status_code == 200
    assert r.json()["name"] == "Casa"
    (audit,) = _audits(db)
    assert audit.action == "update"
    assert audit.before_json["name"] == "Conjunta"
    assert audit.after_json["name"] == "Casa"


def test_admin_edits_any_account(client_as, users, make_account):
    account = make_account(owner="RUTH")
    r = client_as(users["matheus"]).patch(f"/api/accounts/{account.id}", json={"active": False})
    assert r.status_code == 200
    assert r.json()["active"] is False


def test_member_cannot_hand_account_to_other_owner(client_as, users, make_account):
    account = make_account(owner="RUTH")
    r = client_as(users["ruth"]).patch(f"/api/accounts/{account.id}", json={"owner": "MATHEUS"})
    assert r.status_code == 403


def test_patch_rejects_null_for_required_fields_but_allows_clearing_optional(
    client_as, users, make_account
):
    account = make_account(owner="RUTH", institution="Itaú")
    client = client_as(users["ruth"])
    assert client.patch(f"/api/accounts/{account.id}", json={"name": None}).status_code == 422
    r = client.patch(f"/api/accounts/{account.id}", json={"institution": None})
    assert r.status_code == 200
    assert r.json()["institution"] is None


def test_delete_account_with_transactions_is_409(client_as, users, make_account, make_tx):
    account = make_account(owner="RUTH")
    other = make_account("Destino", owner="RUTH")
    make_tx(other, "transfer", 100, to_account=account)  # só como destino também bloqueia
    r = client_as(users["ruth"]).delete(f"/api/accounts/{account.id}")
    assert r.status_code == 409


def test_delete_unused_account_is_204_with_audit(client_as, users, make_account, db):
    account = make_account(owner="RUTH")
    r = client_as(users["ruth"]).delete(f"/api/accounts/{account.id}")
    assert r.status_code == 204
    assert client_as(users["ruth"]).get(f"/api/accounts/{account.id}").status_code == 404
    (audit,) = _audits(db)
    assert audit.action == "delete"
    assert audit.before_json["name"] == "Conta"


def test_blank_name_is_422_and_name_is_trimmed(client_as, users):
    client = client_as(users["ruth"])
    assert client.post("/api/accounts", json=NEW_ACCOUNT | {"name": "   "}).status_code == 422
    r = client.post("/api/accounts", json=NEW_ACCOUNT | {"name": "  Nubank  "})
    assert r.json()["name"] == "Nubank"
    assert client.patch(f"/api/accounts/{r.json()['id']}", json={"name": " "}).status_code == 422
