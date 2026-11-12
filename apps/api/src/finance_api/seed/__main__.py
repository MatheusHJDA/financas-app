import os
import sys
from pathlib import Path

from finance_api.db.session import get_sessionmaker
from finance_api.seed.loader import DEFAULT_SEED_PATH, load_seed


def main() -> int:
    path = Path(os.environ.get("SEED_FILE") or DEFAULT_SEED_PATH)
    if not path.is_file():
        print(f"seed: arquivo não encontrado: {path} (defina SEED_FILE)", file=sys.stderr)
        return 1
    with get_sessionmaker()() as db:
        counts = load_seed(db, path)
        db.commit()
    for section, (created, skipped) in counts.items():
        print(f"seed: {section}: {created} criados, {skipped} já existiam")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
