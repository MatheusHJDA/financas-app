"""Comando no servidor: `python -m finance_api.auth.release <Nome> [--desbloquear]`.

Sem a opção, gera um código de liberação (24 h). Com `--desbloquear`, destrava a conta
(caminho de volta do admin travado, que não tem quem o destrave pela Administração).
"""

import argparse
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from finance_api.auth import codes, limits, service
from finance_api.core.audit import record_audit
from finance_api.core.config import get_settings
from finance_api.db.session import get_sessionmaker


def _run(db: Session, name: str, unlock: bool) -> int:
    user = service.find_user_by_name(db, name)
    if user is None:
        print(f"Usuário não encontrado: {name}")
        return 1
    if unlock:
        limits.release_account(db, user)
        record_audit(
            db,
            user_id=None,
            entity="users",
            entity_id=user.id,
            action="update",
            before={"locked": True},
            after={"locked": False},
        )
        db.commit()
        print(f"Conta de {user.name} desbloqueada.")
        return 0
    code, expires_at = codes.issue_release_code(db, user, actor_id=None, now=service.utcnow())
    db.commit()
    local = expires_at.astimezone(ZoneInfo(get_settings().tz))
    print(f"Código de liberação para {user.name}: {code} (vale até {local:%d/%m/%Y %H:%M})")
    return 0


def main(argv: list[str] | None = None, *, db: Session | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m finance_api.auth.release")
    parser.add_argument("nome")
    parser.add_argument("--desbloquear", action="store_true")
    args = parser.parse_args(argv)
    if db is not None:
        return _run(db, args.nome, args.desbloquear)
    with get_sessionmaker()() as session:
        return _run(session, args.nome, args.desbloquear)


if __name__ == "__main__":
    raise SystemExit(main())
