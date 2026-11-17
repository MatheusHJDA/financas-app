"""Carga do empréstimo real do Nubank (spec 2026-11-17-emprestimo-parcelas).

`python -m finance_api.seed.loan_nubank`          -> dry-run: só imprime o que faria.
`python -m finance_api.seed.loan_nubank --apply`  -> grava (faça `./tasks.ps1 backup` antes).

Recadastra a dívida id=1 com as 13 parcelas das capturas do Nubank de 17/11/2026. Recusa
recadastrar se alguma parcela já foi paga (`set_schedule`).
"""

import sys
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from finance_api.core.permissions import CurrentUser, Owner
from finance_api.db.models import Account, Category, Debt, User
from finance_api.db.session import get_sessionmaker
from finance_api.debts.installments import InstallmentSpec, set_schedule

DEBT_ID = 1
DEBT_NAME = "Empréstimo Nubank"
ACCOUNT_NAME = "Nubank (Matheus)"
CATEGORY_NAME = "Dívidas/Empréstimo"
PRINCIPAL_CENTS = 2265965
MONTHLY_RATE = Decimal("0.0345")
INSTALLMENTS = 13
FACE_CENTS = 141757
LAST_FACE_CENTS = 141758  # o centavo que falta para os 18.428,42 do Nubank
PAID_BEFORE_APP_CENTS = 818799
DUES = [
    date(2026, 12, 18),
    date(2027, 1, 18),
    date(2027, 2, 18),
    date(2027, 3, 18),
    date(2027, 4, 19),
    date(2027, 5, 18),
    date(2027, 6, 18),
    date(2027, 7, 19),
    date(2027, 8, 18),
    date(2027, 9, 20),
    date(2027, 10, 18),
    date(2027, 11, 18),
    date(2027, 12, 20),
]


def specs() -> list[InstallmentSpec]:
    return [
        InstallmentSpec(
            number=i,
            due_date=due,
            face_cents=LAST_FACE_CENTS if i == len(DUES) else FACE_CENTS,
        )
        for i, due in enumerate(DUES, start=1)
    ]


def _brl(cents: int) -> str:
    reais, resto = divmod(cents, 100)
    return f"R$ {reais:,}".replace(",", ".") + f",{resto:02d}"


def run(db: Session, *, apply: bool, debt_id: int = DEBT_ID) -> list[str]:
    """Devolve as linhas do relatório; só grava (sem commit) com `apply=True`."""
    debt = db.get(Debt, debt_id)
    if debt is None:
        raise LookupError(f"Dívida id={debt_id} não encontrada.")
    account = db.scalar(select(Account).where(Account.name == ACCOUNT_NAME))
    if account is None:
        raise LookupError(f"Conta '{ACCOUNT_NAME}' não encontrada.")
    category = db.scalar(select(Category).where(Category.name == CATEGORY_NAME))
    if category is None:
        raise LookupError(f"Categoria '{CATEGORY_NAME}' não encontrada.")
    admin = db.scalar(select(User).where(User.role == "admin").order_by(User.id))
    if admin is None:
        raise LookupError("Nenhum usuário admin para a auditoria.")

    plan = specs()
    total = sum(s.face_cents for s in plan)
    lines = [
        f"Dívida {debt.id}: '{debt.name}' -> '{DEBT_NAME}'",
        f"  principal {_brl(debt.principal_cents)} -> {_brl(PRINCIPAL_CENTS)}",
        f"  taxa {debt.monthly_rate} -> {MONTHLY_RATE} a.m.",
        f"  parcelas {debt.installments} x {_brl(debt.installment_cents)}"
        f" -> {INSTALLMENTS} x {_brl(FACE_CENTS)}",
        f"  pago antes do app: {_brl(PAID_BEFORE_APP_CENTS)}",
        f"  conta: {account.name} (id {account.id}); categoria: {category.name} (id {category.id})",
        f"  {len(plan)} parcelas, total {_brl(total)}; "
        f"1ª {plan[0].due_date:%d/%m/%Y}, última {plan[-1].due_date:%d/%m/%Y}",
    ]
    if not apply:
        lines.append("DRY-RUN: nada foi alterado. Use --apply para gravar.")
        return lines

    user = CurrentUser(id=admin.id, name=admin.name, role="admin", owner=Owner.MATHEUS)
    debt.name = DEBT_NAME
    debt.principal_cents = PRINCIPAL_CENTS
    debt.monthly_rate = MONTHLY_RATE
    debt.installments = INSTALLMENTS
    debt.installment_cents = FACE_CENTS
    set_schedule(db, user, debt, plan, PAID_BEFORE_APP_CENTS, account.id, category.id)
    lines.append("APLICADO.")
    return lines


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    apply = "--apply" in args
    try:
        with get_sessionmaker()() as db:
            lines = run(db, apply=apply)
            if apply:
                db.commit()
            else:
                db.rollback()
    except (LookupError, ValueError) as exc:
        print(f"loan_nubank: {exc}", file=sys.stderr)
        return 1
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
