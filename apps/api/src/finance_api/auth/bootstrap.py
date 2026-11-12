"""Carga inicial dos usuários: `uv run python -m finance_api.auth.bootstrap`."""

import logging

from finance_api.auth.service import ensure_initial_users
from finance_api.core.config import get_settings
from finance_api.db.session import get_sessionmaker


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    with get_sessionmaker()() as db:
        created = ensure_initial_users(db, get_settings())
    print(f"Usuários criados: {', '.join(created) if created else 'nenhum'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
