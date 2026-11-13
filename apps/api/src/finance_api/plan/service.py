"""Leitura e gravação das premissas (tabela `settings`, chave "plan.assumptions"). U10."""

from sqlalchemy.orm import Session

from finance_api.core.audit import record_audit
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import Setting
from finance_api.plan.defaults import default_assumptions
from finance_api.plan.schemas import PlanAssumptionsIn

SETTING_KEY = "plan.assumptions"
AUDIT_ENTITY = "plan"
AUDIT_ENTITY_ID = "assumptions"


def load_assumptions(db: Session) -> PlanAssumptionsIn:
    """Premissas gravadas ou, se nada foi gravado, os padrões da planilha."""
    row = db.get(Setting, SETTING_KEY)
    if row is None:
        return default_assumptions()
    return PlanAssumptionsIn.model_validate(row.value_json)


def save_assumptions(db: Session, user: CurrentUser, new: PlanAssumptionsIn) -> None:
    """Substitui as premissas e grava auditoria na mesma transação (antes do commit)."""
    before = load_assumptions(db).model_dump(mode="json")
    after = new.model_dump(mode="json")
    row = db.get(Setting, SETTING_KEY)
    if row is None:
        db.add(Setting(key=SETTING_KEY, value_json=after))
    else:
        row.value_json = after
    record_audit(
        db,
        user_id=user.id,
        entity=AUDIT_ENTITY,
        entity_id=AUDIT_ENTITY_ID,
        action="update",
        before=before,
        after=after,
    )
    db.commit()
