"""Dicas → ids (puro, sem banco) e sinais do rascunho (com banco)."""

import datetime as dt

import pytest
from sqlalchemy.orm import Session

from finance_api.ai.schemas import ExtractedTransaction
from finance_api.core.permissions import CurrentUser, Owner
from finance_api.db.models import Account, BillInstance, Category, RecurringBill, Transaction
from finance_api.ingest.resolve import (
    draft_signals,
    match_account,
    match_category,
    resolve_transaction,
)
from finance_api.transactions.dedupe import compute_dedupe_hash
from finance_api.transactions.service import PLAN_RULE_WARNING

RUTH = CurrentUser(id=2, name="Ruth", role="member", owner=Owner.RUTH)


def _account(id_: int, name: str, owner: str = "MATHEUS", type_: str = "checking", last4=None):
    return Account(id=id_, name=name, owner=owner, type=type_, last4=last4, active=True)


ACCOUNTS = [
    _account(1, "Sonia"),
    _account(2, "Matheus"),
    _account(3, "Nubank Ruth", owner="RUTH", last4="4321"),
    _account(4, "Cartão Nubank Ruth", owner="RUTH", type_="credit_card", last4="8899"),
    _account(5, "Nubank Matheus", owner="MATHEUS"),
]
CATEGORIES = [
    Category(id=10, name="Mercado", kind="expense", is_recurring_card_allowed=False),
    Category(id=11, name="Farmácia", kind="expense", is_recurring_card_allowed=False),
    Category(id=12, name="Salário", kind="income", is_recurring_card_allowed=False),
]


def _item(**changes) -> ExtractedTransaction:
    values = {
        "kind": "expense",
        "amount_cents": 4590,
        "date": dt.date(2026, 11, 10),
        "description": "Supermercado BH",
        "account_hint": "Nubank Ruth",
        "to_account_hint": None,
        "category_hint": "Mercado",
        "owner_hint": None,
        "is_credit_card": False,
        "confidence": 0.9,
        "notes": None,
    }
    values.update(changes)
    return ExtractedTransaction(**values)


# --- Puro -------------------------------------------------------------------------------------


def test_sonia_to_matheus_is_transfer() -> None:
    item = _item(
        kind="transfer",
        description="Pix Sonia para Matheus",
        account_hint="Sonia",
        to_account_hint="Matheus",
        category_hint=None,
    )
    resolution = resolve_transaction(item, ACCOUNTS, CATEGORIES, RUTH)
    proposal = resolution.proposal
    assert (proposal.kind, proposal.account_id, proposal.to_account_id) == ("transfer", 1, 2)
    assert proposal.category_id is None
    assert resolution.low_confidence_fields == []
    assert resolution.warnings == []


def test_expense_between_two_app_accounts_becomes_transfer() -> None:
    item = _item(kind="expense", account_hint="sônia", to_account_hint="MATHEUS")
    proposal = resolve_transaction(item, ACCOUNTS, CATEGORIES, RUTH).proposal
    assert (proposal.kind, proposal.account_id, proposal.to_account_id) == ("transfer", 1, 2)
    assert proposal.category_id is None


def test_transfer_to_outside_account_becomes_expense_with_warning() -> None:
    item = _item(kind="transfer", account_hint="Sonia", to_account_hint="Banco do Fulano")
    resolution = resolve_transaction(item, ACCOUNTS, CATEGORIES, RUTH)
    assert resolution.proposal.kind == "expense"
    assert resolution.proposal.account_id == 1
    assert resolution.proposal.to_account_id is None
    assert "kind" in resolution.low_confidence_fields
    assert "despesa" in resolution.warnings[0]


def test_transfer_from_outside_becomes_income_on_destination() -> None:
    item = _item(
        kind="transfer",
        account_hint="Banco do Fulano",
        to_account_hint="Matheus",
        category_hint=None,
    )
    resolution = resolve_transaction(item, ACCOUNTS, CATEGORIES, RUTH)
    assert (resolution.proposal.kind, resolution.proposal.account_id) == ("income", 2)
    assert "receita" in resolution.warnings[0]


def test_account_by_last4_and_accent_case_insensitive_name() -> None:
    assert match_account("Cartão final 8899", ACCOUNTS).id == 4
    assert match_account("****4321", ACCOUNTS).id == 3
    assert match_account("NUBANK ruth", ACCOUNTS).id == 3
    assert match_account("Cartao Nubank Ruth", ACCOUNTS).id == 4
    assert match_account("Banco Inexistente", ACCOUNTS) is None
    assert match_account(None, ACCOUNTS) is None


def test_ambiguous_account_uses_owner_and_card_then_gives_up() -> None:
    # "Nubank" casa com três contas; o dono desempata entre as de mesmo tipo.
    assert match_account("Nubank", ACCOUNTS, prefer_owner="MATHEUS").id == 5
    assert match_account("Nubank", ACCOUNTS, prefer_owner="RUTH", prefer_card=True).id == 4
    assert match_account("Nubank", ACCOUNTS, prefer_owner="AMBOS") is None


def test_category_by_name_and_kind() -> None:
    assert match_category("farmacia", CATEGORIES, "expense").id == 11
    assert match_category("Mercado do bairro", CATEGORIES, "expense").id == 10
    assert match_category("Salário", CATEGORIES, "expense") is None  # tipo errado
    assert match_category("Salario", CATEGORIES, "income").id == 12
    assert match_category("Viagem", CATEGORIES, "expense") is None


def test_owner_from_hint_or_sender() -> None:
    assert resolve_transaction(_item(), ACCOUNTS, CATEGORIES, RUTH).proposal.owner == Owner.RUTH
    hinted = resolve_transaction(_item(owner_hint="AMBOS"), ACCOUNTS, CATEGORIES, RUTH)
    assert hinted.proposal.owner == Owner.AMBOS


def test_unresolved_fields_are_low_confidence() -> None:
    item = _item(account_hint="Banco Inexistente", category_hint="Viagem")
    resolution = resolve_transaction(item, ACCOUNTS, CATEGORIES, RUTH)
    assert resolution.proposal.account_id is None
    assert resolution.low_confidence_fields == ["account_id", "category_id"]


def test_low_confidence_marks_every_guessed_field() -> None:
    item = _item(confidence=0.5, owner_hint="RUTH")
    resolution = resolve_transaction(item, ACCOUNTS, CATEGORIES, RUTH)
    assert resolution.low_confidence_fields == [
        "kind",
        "amount_cents",
        "date",
        "description",
        "account_id",
        "category_id",
        "owner",
    ]


def test_description_is_trimmed_and_never_empty() -> None:
    blank = resolve_transaction(_item(description="   "), ACCOUNTS, CATEGORIES, RUTH)
    assert blank.proposal.description == "Lançamento"
    long = resolve_transaction(_item(description="x " * 400), ACCOUNTS, CATEGORIES, RUTH)
    assert len(long.proposal.description) == 500


# --- Com banco --------------------------------------------------------------------------------


@pytest.fixture
def ruth(users: dict[str, CurrentUser]) -> CurrentUser:
    return users["ruth"]


def _resolve_in(world, ruth: CurrentUser, **changes):
    accounts = [world.nubank_ruth, world.cartao_ruth, world.sonia, world.matheus, world.dinheiro]
    return resolve_transaction(_item(**changes), accounts, list(world.categories.values()), ruth)


def test_card_expense_has_plan_rule_warning(db: Session, world, ruth) -> None:
    resolution = _resolve_in(
        world, ruth, account_hint="final 8899", is_credit_card=True, category_hint="Mercado"
    )
    assert resolution.proposal.account_id == world.cartao_ruth.id
    assert draft_signals(db, resolution).plan_rule_warning == PLAN_RULE_WARNING

    allowed = _resolve_in(
        world, ruth, account_hint="final 8899", is_credit_card=True, category_hint="Streaming"
    )
    assert draft_signals(db, allowed).plan_rule_warning is None
    debit = _resolve_in(world, ruth)
    assert draft_signals(db, debit).plan_rule_warning is None


def test_possible_duplicate_points_to_existing(db: Session, world, ruth, users) -> None:
    existing = Transaction(
        kind="expense",
        amount_cents=4590,
        date=dt.date(2026, 11, 11),  # ±1 dia
        description="supermercado bh!",
        account_id=world.nubank_ruth.id,
        owner="RUTH",
        created_by=users["ruth"].id,
        status="confirmed",
        source="manual",
    )
    existing.dedupe_hash = compute_dedupe_hash(world.nubank_ruth.id, 4590, "supermercado bh!")
    db.add(existing)
    db.flush()

    signals = draft_signals(db, _resolve_in(world, ruth))
    assert signals.duplicate_of_transaction_id == existing.id
    other_amount = draft_signals(db, _resolve_in(world, ruth, amount_cents=4591))
    assert other_amount.duplicate_of_transaction_id is None


def _bill(db: Session, name: str, amount: int, due: dt.date, status: str = "open") -> BillInstance:
    bill = RecurringBill(
        owner="AMBOS",
        name=name,
        amount_cents=amount,
        due_day=due.day,
        start_month=due.replace(day=1),
    )
    db.add(bill)
    db.flush()
    instance = BillInstance(
        recurring_bill_id=bill.id,
        month=due.replace(day=1),
        due_date=due,
        amount_cents=amount,
        status=status,
    )
    db.add(instance)
    db.flush()
    return instance


def test_suggests_open_bill_with_close_amount_date_and_name(db: Session, world, ruth) -> None:
    luz = _bill(db, "Luz CEMIG", 18900, dt.date(2026, 11, 20))
    _bill(db, "Luz CEMIG antiga", 18750, dt.date(2026, 10, 20), status="paid")
    _bill(db, "Internet", 18750, dt.date(2026, 11, 15))  # nome diferente
    _bill(db, "Luz casa da praia", 30000, dt.date(2026, 11, 15))  # valor longe
    _bill(db, "Luz CEMIG", 18750, dt.date(2027, 1, 20))  # data longe

    resolution = _resolve_in(
        world,
        ruth,
        description="Conta de luz CEMIG",
        amount_cents=18750,
        date=dt.date(2026, 11, 11),
        category_hint="Luz",
    )
    assert draft_signals(db, resolution).suggested_bill_instance_id == luz.id

    income = _resolve_in(world, ruth, kind="income", description="Luz CEMIG", amount_cents=18750)
    assert draft_signals(db, income).suggested_bill_instance_id is None
