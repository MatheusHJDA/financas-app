"""Configurações editáveis pelo admin (tabela `settings`, chave -> valor JSON).

Base do lead (Onda 3), congelada: U9 grava pelo PUT /admin/settings; U7 lê para o agendador.
Só as chaves de `DEFAULTS` existem; chave desconhecida no PUT -> 422.
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from finance_api.db.models import Setting

DAILY_TIME = "notify.daily_time"  # "HH:MM" no fuso America/Sao_Paulo (D8)
BILL_TIME = "notify.bill_time"  # "HH:MM" do aviso de vencimento (D9)
BILL_DAYS_BEFORE = "notify.bill_days_before"  # int 0..10; também avisa no dia (D15)

DEFAULTS: dict[str, Any] = {
    DAILY_TIME: "21:00",
    BILL_TIME: "09:00",
    BILL_DAYS_BEFORE: 2,
}


def get_all(db: Session) -> dict[str, Any]:
    """Padrões sobrepostos pelo que está gravado (só chaves conhecidas)."""
    values = dict(DEFAULTS)
    for row in db.scalars(select(Setting).where(Setting.key.in_(DEFAULTS.keys()))):
        values[row.key] = row.value_json
    return values


def get(db: Session, key: str) -> Any:
    if key not in DEFAULTS:
        raise KeyError(key)
    row = db.get(Setting, key)
    return DEFAULTS[key] if row is None else row.value_json
