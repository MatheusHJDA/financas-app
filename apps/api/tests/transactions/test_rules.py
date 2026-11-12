"""Regras de negócio: cartão, transferência, duplicidade, aviso do plano, validações."""

import datetime as dt

from finance_api.accounts.service import compute_balances
from finance_api.transactions.dedupe import (
    compute_dedupe_hash,
    find_possible_duplicates,
    normalize_description,
)

DUP = "X-Possible-Duplicate-Of"
WARN = "X-Plan-Rule-Warning"


def _body(account, **kw):
    body = {
        "kind": "expense",
        "amount_cents": 4590,
        "date": "2026-03-10",
        "description": "Supermercado BH",
        "account_id": account.id,
        "owner": "MATHEUS",
    }
    body.update(kw)
    return body


def test_card_purchase_raises_invoice_and_leaves_checking_untouched(
    client_as, users, db, make_account
):
    checking = make_account("Corrente", initial=100000)
    card = make_account("Nubank cartão", type="credit_card")
    r = client_as(users["matheus"]).post("/api/transactions", json=_body(card, amount_cents=25000))
    assert r.status_code == 201
    balances = compute_balances(db)
    assert balances[checking.id] == 100000
    assert balances[card.id] == -25000  # fatura de R$ 250,00


def test_paying_invoice_is_transfer_checking_to_card(client_as, users, db, make_account):
    checking = make_account("Corrente", initial=100000)
    card = make_account("Nubank cartão", type="credit_card")
    client = client_as(users["matheus"])
    client.post("/api/transactions", json=_body(card, amount_cents=25000))
    pay = client.post(
        "/api/transactions",
        json=_body(
            checking,
            kind="transfer",
            amount_cents=25000,
            to_account_id=card.id,
            description="Pagamento fatura",
        ),
    )
    assert pay.status_code == 201
    balances = compute_balances(db)
    assert balances[checking.id] == 75000
    assert balances[card.id] == 0


def test_transfer_is_one_row_and_never_income_or_expense(client_as, users, make_account):
    a = make_account("A", initial=10000)
    b = make_account("B", initial=0)
    client = client_as(users["matheus"])
    r = client.post(
        "/api/transactions",
        json=_body(a, kind="transfer", amount_cents=3000, to_account_id=b.id, description="Pix"),
    )
    assert r.status_code == 201
    assert r.json()["to_account_id"] == b.id
    assert client.get("/api/transactions").json()["total"] == 1
    assert client.get("/api/transactions", params={"kind": "income"}).json()["total"] == 0
    assert client.get("/api/transactions", params={"kind": "expense"}).json()["total"] == 0
    assert client.get("/api/accounts").json()["items"][0]["current_balance_cents"] == 7000
    assert client.get("/api/accounts").json()["items"][1]["current_balance_cents"] == 3000


def test_transfer_validation(client_as, users, make_account, make_category):
    a = make_account("A")
    b = make_account("B")
    cat = make_category()
    client = client_as(users["matheus"])
    base = _body(a, kind="transfer", to_account_id=b.id)
    assert client.post("/api/transactions", json={**base, "to_account_id": None}).status_code == 422
    assert client.post("/api/transactions", json={**base, "to_account_id": a.id}).status_code == 422
    assert client.post("/api/transactions", json={**base, "to_account_id": 9999}).status_code == 422
    # categoria numa transferência é descartada (não é receita nem despesa)
    ok = client.post("/api/transactions", json={**base, "category_id": cat.id})
    assert ok.status_code == 201
    assert ok.json()["category_id"] is None


def test_create_validation(client_as, users, make_account):
    a = make_account()
    b = make_account("B")
    client = client_as(users["matheus"])
    assert client.post("/api/transactions", json=_body(a, amount_cents=0)).status_code == 422
    assert client.post("/api/transactions", json=_body(a, amount_cents=10.5)).status_code == 422
    assert client.post("/api/transactions", json=_body(a, description="   ")).status_code == 422
    assert client.post("/api/transactions", json=_body(a, account_id=9999)).status_code == 422
    assert client.post("/api/transactions", json=_body(a, category_id=9999)).status_code == 422
    assert client.post("/api/transactions", json=_body(a, to_account_id=b.id)).status_code == 422
    assert client.post("/api/transactions", json=_body(a, date="não-é-data")).status_code == 422


def test_created_by_is_current_user_and_source_manual(client_as, users, make_account):
    account = make_account(owner="AMBOS")
    r = client_as(users["ruth"]).post("/api/transactions", json=_body(account, owner="RUTH"))
    assert r.json()["created_by"] == users["ruth"].id
    assert r.json()["source"] == "manual"
    assert r.json()["status"] == "confirmed"


def test_possible_duplicate_is_flagged_but_never_blocks(client_as, users, make_account):
    account = make_account()
    client = client_as(users["matheus"])
    first = client.post("/api/transactions", json=_body(account))
    assert DUP not in first.headers

    # mesma conta/valor/descrição (acento e caixa diferentes), um dia depois
    second = client.post(
        "/api/transactions",
        json=_body(account, date="2026-03-11", description="  SUPERMERCADO  bh "),
    )
    assert second.status_code == 201
    assert second.headers[DUP] == str(first.json()["id"])
    assert client.get("/api/transactions").json()["total"] == 2


def test_duplicate_window_is_one_day_and_requires_same_account_and_amount(
    client_as, users, make_account
):
    account = make_account()
    other = make_account("Outra")
    client = client_as(users["matheus"])
    client.post("/api/transactions", json=_body(account))
    assert (
        DUP not in client.post("/api/transactions", json=_body(account, date="2026-03-12")).headers
    )
    assert DUP in client.post("/api/transactions", json=_body(account, date="2026-03-09")).headers
    assert DUP not in client.post("/api/transactions", json=_body(other)).headers
    assert (
        DUP not in client.post("/api/transactions", json=_body(account, amount_cents=4591)).headers
    )
    assert (
        DUP
        not in client.post("/api/transactions", json=_body(account, description="Padaria")).headers
    )


def test_find_possible_duplicates_pure_function(db, make_account, make_tx):
    account = make_account()
    tx = make_tx(account, amount=1234, date=dt.date(2026, 5, 10), description="Café São João")
    tx.dedupe_hash = compute_dedupe_hash(account.id, 1234, "Café São João")
    db.flush()

    def find(**kw):
        args = {
            "account_id": account.id,
            "amount_cents": 1234,
            "description": "cafe sao joao!",
            "on_date": dt.date(2026, 5, 11),
        }
        return find_possible_duplicates(db, **{**args, **kw})

    assert [t.id for t in find()] == [tx.id]
    assert [t.id for t in find(on_date=dt.date(2026, 5, 9))] == [tx.id]
    assert find(on_date=dt.date(2026, 5, 12)) == []
    assert find(amount_cents=1235) == []
    assert find(exclude_id=tx.id) == []


def test_normalize_description_and_hash():
    assert normalize_description("  Açaí & Cia.  LTDA ") == "acai cia ltda"
    assert compute_dedupe_hash(1, 100, "Pão") == compute_dedupe_hash(1, 100, "pao ")
    assert compute_dedupe_hash(1, 100, "pão") != compute_dedupe_hash(2, 100, "pão")
    assert len(compute_dedupe_hash(1, 100, "x")) == 64


def test_plan_rule_warning_only_for_card_expense_outside_allowed_categories(
    client_as, users, make_account, make_category
):
    card = make_account("Cartão", type="credit_card")
    checking = make_account("Corrente")
    allowed = make_category("Assinaturas", card_ok=True)
    other = make_category("Lazer")
    client = client_as(users["matheus"])

    r = client.post("/api/transactions", json=_body(card, category_id=other.id))
    assert r.status_code == 201  # alerta, nunca bloqueio
    assert "regra do plano" in r.headers[WARN].lower()
    assert WARN in client.post("/api/transactions", json=_body(card)).headers  # sem categoria
    assert (
        WARN
        not in client.post("/api/transactions", json=_body(card, category_id=allowed.id)).headers
    )
    assert WARN not in client.post("/api/transactions", json=_body(checking)).headers
    income = _body(card, kind="income", description="Estorno")
    assert WARN not in client.post("/api/transactions", json=income).headers
