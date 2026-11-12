"""Gravação do log de auditoria (interface congelada na Onda 1).

Toda criação/edição/exclusão de registro chama `record_audit` na mesma sessão da mudança,
antes do commit, para que a auditoria e a mudança sejam gravadas juntas (ORQUESTRACAO.md 6.1).
U1 é dono da leitura/listagem da auditoria; U2/U4 só chamam esta função.
"""

from typing import Any, Literal

from sqlalchemy.orm import Session

from finance_api.db.models import AuditLog

AuditAction = Literal["create", "update", "delete"]


def record_audit(
    db: Session,
    *,
    user_id: int | None,
    entity: str,
    entity_id: int | str,
    action: AuditAction,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> AuditLog:
    """Adiciona uma linha em `audit_log` (não faz commit).

    `entity` é o nome da tabela (ex.: "transactions"). `before`/`after` devem ser
    serializáveis em JSON (datas como ISO 8601, dinheiro em centavos inteiros).
    Nunca inclua `pin_hash`, tokens ou outros segredos.
    """
    entry = AuditLog(
        user_id=user_id,
        entity=entity,
        entity_id=str(entity_id),
        action=action,
        before_json=before,
        after_json=after,
    )
    db.add(entry)
    return entry
