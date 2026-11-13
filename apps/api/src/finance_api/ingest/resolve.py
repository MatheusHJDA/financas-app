"""Dicas da IA → ids do app, e sinais de cada rascunho (ORQUESTRACAO.md 6.2, regras de negócio).

`resolve_transaction` é pura (recebe as contas e categorias já carregadas): conta por nome ou
`last4` (sem acento, sem caixa), categoria por nome, dono pela dica ou pelo de quem enviou.
Transferência só quando origem **e** destino são contas do app; senão vira despesa/receita com
aviso. `draft_signals` consulta o banco: possível duplicata, aviso da regra do plano e conta a
pagar parecida.
"""

import datetime as dt
import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from finance_api.ai.schemas import ExtractedTransaction
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Account, BillInstance, Category, RecurringBill
from finance_api.ingest.schemas import ProposedTransaction
from finance_api.transactions.dedupe import find_possible_duplicates, normalize_description
from finance_api.transactions.service import TxData, plan_rule_warning

LOW_CONFIDENCE = 0.7
FIELD_ORDER = (
    "kind",
    "amount_cents",
    "date",
    "description",
    "account_id",
    "to_account_id",
    "category_id",
    "owner",
)
MAX_DESCRIPTION = 500
BILL_AMOUNT_TOLERANCE_PCT = 5
BILL_DAYS_WINDOW = 20

# Palavras que aparecem em quase todo nome/dica de conta e não ajudam a distinguir.
_STOPWORDS = frozenset(
    {"conta", "de", "do", "da", "dos", "das", "e", "o", "a", "cartao", "credito", "debito"}
)
_DIGITS = re.compile(r"\d+")


@dataclass
class Resolution:
    proposal: ProposedTransaction
    confidence: float
    low_confidence_fields: list[str]
    warnings: list[str] = field(default_factory=list)
    account: Account | None = None
    category: Category | None = None


@dataclass
class Signals:
    duplicate_of_transaction_id: int | None = None
    plan_rule_warning: str | None = None
    suggested_bill_instance_id: int | None = None


# --- Contas e categorias ----------------------------------------------------------------------


def _padded(text: str) -> str:
    return f" {text} "


def _account_score(hint_norm: str, hint_last4s: set[str], account: Account) -> int:
    if account.last4 and account.last4 in hint_last4s:
        return 100
    name = normalize_description(account.name)
    if not name:
        return 0
    if name == hint_norm:
        return 90
    if _padded(name) in _padded(hint_norm):  # "pix para matheus" contém "matheus"
        return 70
    if _padded(hint_norm) in _padded(name):  # "nubank" está em "nubank ruth"
        return 60
    shared = (set(hint_norm.split()) & set(name.split())) - _STOPWORDS
    return 10 * len(shared)


def match_account(
    hint: str | None,
    accounts: Sequence[Account],
    *,
    prefer_owner: str | None = None,
    prefer_card: bool = False,
    exclude_id: int | None = None,
) -> Account | None:
    """Conta da dica; empate desfeito por tipo cartão (se for cartão) e pelo dono; senão `None`."""
    if not hint or not hint.strip():
        return None
    hint_norm = normalize_description(hint)
    last4s = {run[-4:] for run in _DIGITS.findall(hint) if len(run) >= 4}
    scored = [
        (_account_score(hint_norm, last4s, a), a)
        for a in accounts
        if a.id != exclude_id and a.active is not False
    ]
    best = max((s for s, _ in scored), default=0)
    if best <= 0:
        return None
    candidates = [a for s, a in scored if s == best]
    if len(candidates) > 1 and prefer_card:
        cards = [a for a in candidates if a.type == "credit_card"]
        candidates = cards or candidates
    if len(candidates) > 1 and prefer_owner:
        owned = [a for a in candidates if str(a.owner) == prefer_owner]
        candidates = owned or candidates
    return candidates[0] if len(candidates) == 1 else None


def match_category(hint: str | None, categories: Sequence[Category], kind: str) -> Category | None:
    """Categoria do mesmo tipo (receita/despesa) pelo nome; ambígua → `None`."""
    if not hint or not hint.strip() or kind not in ("income", "expense"):
        return None
    hint_norm = normalize_description(hint)
    same_kind = [c for c in categories if str(c.kind) == kind]
    exact = [c for c in same_kind if normalize_description(c.name) == hint_norm]
    if len(exact) == 1:
        return exact[0]
    if exact:
        return None
    partial = [
        c
        for c in same_kind
        if normalize_description(c.name)
        and (
            _padded(normalize_description(c.name)) in _padded(hint_norm)
            or _padded(hint_norm) in _padded(normalize_description(c.name))
        )
    ]
    return partial[0] if len(partial) == 1 else None


# --- Rascunho ---------------------------------------------------------------------------------


def resolve_transaction(
    item: ExtractedTransaction,
    accounts: Sequence[Account],
    categories: Sequence[Category],
    sender: CurrentUser,
) -> Resolution:
    owner = item.owner_hint or sender.owner.value
    description = " ".join(item.description.split())[:MAX_DESCRIPTION] or "Lançamento"
    label = f'"{description}"'
    warnings: list[str] = []

    source = match_account(
        item.account_hint, accounts, prefer_owner=owner, prefer_card=item.is_credit_card
    )
    target = None
    if item.to_account_hint:
        target = match_account(
            item.to_account_hint,
            accounts,
            prefer_owner=None,
            exclude_id=source.id if source else None,
        )

    kind = item.kind
    account = source
    if source is not None and target is not None:
        kind = "transfer"  # origem e destino são contas do app
    elif item.kind == "transfer":
        if target is not None:  # dinheiro entrou numa conta do app, vindo de fora
            kind, account = "income", target
            warnings.append(f"{label}: a origem não é conta do app; ficou como receita.")
        else:
            kind = "expense"
            if source is not None:
                warnings.append(f"{label}: o destino não é conta do app; ficou como despesa.")
            else:
                warnings.append(
                    f"{label}: não identifiquei as contas da transferência; ficou como despesa."
                )
        target = None
    else:
        target = None

    category = None if kind == "transfer" else match_category(item.category_hint, categories, kind)

    proposal = ProposedTransaction(
        kind=kind,
        amount_cents=item.amount_cents,
        date=item.date,
        description=description,
        account_id=account.id if account else None,
        to_account_id=target.id if (kind == "transfer" and target) else None,
        category_id=category.id if category else None,
        owner=owner,
    )

    low: set[str] = set()
    if kind != item.kind:
        low.add("kind")
    if proposal.account_id is None:
        low.add("account_id")
    if kind != "transfer" and proposal.category_id is None:
        low.add("category_id")
    if item.confidence < LOW_CONFIDENCE:
        low.update({"kind", "amount_cents", "date", "description"})
        if item.account_hint:
            low.add("account_id")
        if kind == "transfer":
            low.add("to_account_id")
        if item.category_hint and kind != "transfer":
            low.add("category_id")
        if item.owner_hint:
            low.add("owner")

    return Resolution(
        proposal=proposal,
        confidence=item.confidence,
        low_confidence_fields=[name for name in FIELD_ORDER if name in low],
        warnings=warnings,
        account=account,
        category=category,
    )


def _name_tokens(text: str) -> set[str]:
    return {t for t in normalize_description(text).split() if len(t) >= 3} - _STOPWORDS


def suggest_bill_instance(db: Session, proposal: ProposedTransaction) -> int | None:
    """Conta a pagar `open` com valor ±5%, vencimento a ±20 dias e nome parecido."""
    if proposal.kind != "expense":
        return None
    window = dt.timedelta(days=BILL_DAYS_WINDOW)
    rows = db.execute(
        select(BillInstance, RecurringBill.name)
        .join(RecurringBill, RecurringBill.id == BillInstance.recurring_bill_id)
        .where(
            BillInstance.status == "open",
            BillInstance.due_date >= proposal.date - window,
            BillInstance.due_date <= proposal.date + window,
        )
    ).all()
    description_norm = normalize_description(proposal.description)
    description_tokens = _name_tokens(proposal.description)
    best: tuple[int, int, int] | None = None
    for instance, bill_name in rows:
        diff = abs(instance.amount_cents - proposal.amount_cents)
        if diff * 100 > BILL_AMOUNT_TOLERANCE_PCT * instance.amount_cents:
            continue
        bill_norm = normalize_description(bill_name)
        similar = bool(bill_norm) and (
            _padded(bill_norm) in _padded(description_norm)
            or bool(_name_tokens(bill_name) & description_tokens)
        )
        if not similar:
            continue
        key = (diff, abs((instance.due_date - proposal.date).days), instance.id)
        if best is None or key < best:
            best = key
    return best[2] if best else None


def draft_signals(db: Session, resolution: Resolution) -> Signals:
    proposal = resolution.proposal
    signals = Signals(suggested_bill_instance_id=suggest_bill_instance(db, proposal))
    if resolution.account is None:
        return signals
    duplicates = find_possible_duplicates(
        db,
        account_id=resolution.account.id,
        amount_cents=proposal.amount_cents,
        description=proposal.description,
        on_date=proposal.date,
    )
    if duplicates:
        signals.duplicate_of_transaction_id = duplicates[0].id
    signals.plan_rule_warning = plan_rule_warning(
        TxData(
            kind=proposal.kind,
            amount_cents=proposal.amount_cents,
            date=proposal.date,
            description=proposal.description,
            account_id=resolution.account.id,
            to_account_id=proposal.to_account_id,
            category_id=proposal.category_id,
            owner=proposal.owner.value if proposal.owner else "",
        ),
        resolution.account,
        resolution.category,
    )
    return signals
