"""Contexto mínimo: só data, quem enviou, contas, categorias e regras. Nenhum segredo."""

import datetime as dt

from sqlalchemy.orm import Session

from finance_api.ai.client import build_input
from finance_api.ai.context import AiContext, build_context, today_sp
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Account, Category, User, UserSession

SECRET_PIN_HASH = "$argon2id$v=19$segredo-de-teste-pin"
SECRET_TOKEN_HASH = "f" * 64


def _seed(db: Session, users: dict[str, CurrentUser]) -> None:
    user = db.get(User, users["ruth"].id)
    assert user is not None
    user.pin_hash = SECRET_PIN_HASH
    db.add(
        UserSession(
            token_hash=SECRET_TOKEN_HASH,
            user_id=user.id,
            device_label="iPhone de teste",
            expires_at=dt.datetime(2030, 1, 1, tzinfo=dt.UTC),
        )
    )
    db.add_all(
        [
            Account(
                owner="RUTH",
                created_by=user.id,
                name="Nubank Ruth",
                type="checking",
                institution="Banco Exemplo",
                last4="4321",
                initial_balance_cents=987654321,
                initial_balance_date=dt.date(2026, 1, 1),
            ),
            Account(
                owner="MATHEUS",
                created_by=user.id,
                name="Conta Antiga",
                type="savings",
                initial_balance_cents=0,
                initial_balance_date=dt.date(2026, 1, 1),
                active=False,
            ),
            Category(name="Mercado", kind="expense"),
            Category(name="Salário", kind="income"),
        ]
    )
    db.flush()


def test_context_has_only_the_minimum(db: Session, users: dict[str, CurrentUser]) -> None:
    _seed(db, users)
    context = build_context(db, users["ruth"], today=dt.date(2026, 11, 12))

    assert context.today == dt.date(2026, 11, 12)
    assert context.sender == "Ruth"
    assert [a.model_dump() for a in context.accounts] == [
        {"name": "Nubank Ruth", "type": "checking", "owner": "RUTH", "last4": "4321"}
    ]  # inativa fica fora
    assert {(c.name, c.kind) for c in context.categories} == {
        ("Mercado", "expense"),
        ("Salário", "income"),
    }
    assert any("transfer" in rule for rule in context.rules)
    assert any("centavos" in rule for rule in context.rules)
    assert set(AiContext.model_fields) == {"today", "sender", "accounts", "categories", "rules"}


def test_serialized_context_and_request_have_no_secrets(
    db: Session, users: dict[str, CurrentUser]
) -> None:
    _seed(db, users)
    context = build_context(db, users["ruth"], today=dt.date(2026, 11, 12))
    serialized = context.model_dump_json() + str(build_input(context, "gastei 10", []))
    lowered = serialized.lower()

    for forbidden in (
        SECRET_PIN_HASH,
        SECRET_TOKEN_HASH,
        "pin_hash",
        "token_hash",
        "987654321",  # saldo inicial
        "balance",
        "saldo inicial",
        "@",  # e-mail
        "iphone de teste",  # dados de sessão
        "session",
        "banco exemplo",  # instituição não faz parte do contexto mínimo
    ):
        assert forbidden.lower() not in lowered, forbidden


def test_today_is_sao_paulo_date() -> None:
    assert today_sp() == dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).date()
