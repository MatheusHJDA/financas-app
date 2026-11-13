"""Contexto mínimo enviado à IA (ORQUESTRACAO.md 6.2, passo 3).

Só: data de hoje (America/Sao_Paulo), nome de quem enviou, contas ativas (nome, tipo, dono,
últimos 4 dígitos), categorias (nome, tipo) e as regras de classificação. Nada de PIN, token,
saldo, sessão ou dados de outros sistemas: os modelos abaixo têm `extra="forbid"` e são montados
campo a campo, nunca a partir do objeto do banco inteiro.
"""

import datetime as dt
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Account, Category

TZ = ZoneInfo("America/Sao_Paulo")

RULES: tuple[str, ...] = (
    "Valores sempre em centavos inteiros e positivos (R$ 45,90 -> 4590); o sinal vem de 'kind'.",
    "Datas no formato AAAA-MM-DD. Sem data no documento ou na mensagem, use a data de hoje.",
    "Transferência interna: origem E destino são contas da lista (ex.: Pix da conta 'Sonia' "
    "para a conta 'Matheus') -> kind 'transfer', com account_hint = origem e to_account_hint = "
    "destino. Se um dos lados não for conta da lista, é 'expense' (saída) ou 'income' (entrada).",
    "Cartão de crédito: compra no cartão é 'expense' na conta do cartão (is_credit_card = true). "
    "Pagamento de fatura é 'transfer' da conta bancária para a conta do cartão.",
    "Use account_hint/to_account_hint com o nome ou os 4 últimos dígitos de uma conta da lista; "
    "category_hint com o nome de uma categoria da lista; null quando não souber.",
    "owner_hint: RUTH, MATHEUS ou AMBOS só quando o documento indicar; senão null.",
    "Extrato ou fatura: um item em 'transactions' por linha de movimentação. Ignore saldos, "
    "totais, limites e linhas repetidas.",
    "confidence de 0 a 1 por lançamento; explique a classificação em 'notes' (curto).",
    "Documento sem lançamentos: 'transactions' vazio, document_type 'other' e um aviso em "
    "'warnings'.",
)


class AccountRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    type: str
    owner: str
    last4: str | None


class CategoryRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    kind: str


class AiContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    today: dt.date
    sender: str
    accounts: list[AccountRef]
    categories: list[CategoryRef]
    rules: list[str]


def today_sp() -> dt.date:
    return dt.datetime.now(TZ).date()


def build_context(db: Session, user: CurrentUser, *, today: dt.date | None = None) -> AiContext:
    accounts = db.execute(
        select(Account.name, Account.type, Account.owner, Account.last4)
        .where(Account.active.is_(True))
        .order_by(Account.owner, Account.name, Account.id)
    )
    categories = db.execute(
        select(Category.name, Category.kind).order_by(Category.kind, Category.name, Category.id)
    )
    return AiContext(
        today=today or today_sp(),
        sender=user.name,
        accounts=[
            AccountRef(name=r.name, type=str(r.type), owner=str(r.owner), last4=r.last4)
            for r in accounts
        ],
        categories=[CategoryRef(name=r.name, kind=str(r.kind)) for r in categories],
        rules=list(RULES),
    )
