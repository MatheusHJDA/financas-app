from sqlalchemy import func, select
from sqlalchemy.orm import Session

from finance_api.core.audit import record_audit
from finance_api.core.permissions import CurrentUser
from finance_api.db.models import AuditLog, User


def test_users_fixture_and_audit(db: Session, users: dict[str, CurrentUser]) -> None:
    ruth = users["ruth"]
    record_audit(
        db,
        user_id=ruth.id,
        entity="users",
        entity_id=ruth.id,
        action="update",
        before={"name": "Ruth"},
        after={"name": "Ruth S."},
    )
    db.commit()  # vira savepoint; o teste inteiro é desfeito no fim
    row = db.scalars(select(AuditLog).where(AuditLog.user_id == ruth.id)).one()
    assert row.entity_id == str(ruth.id)
    assert row.after_json == {"name": "Ruth S."}


def test_each_test_starts_clean(db: Session) -> None:
    assert db.scalar(select(func.count()).select_from(User)) == 0
    assert db.scalar(select(func.count()).select_from(AuditLog)) == 0


def test_client_as_overrides_current_user(client_as, users) -> None:  # type: ignore[no-untyped-def]
    # Sem rotas protegidas ainda; garante só que o app sobe com o banco de teste.
    assert client_as(users["matheus"]).get("/api/health").status_code == 200
