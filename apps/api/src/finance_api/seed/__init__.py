"""Carga inicial idempotente (ORQUESTRACAO.md, seção 11). Uso: `python -m finance_api.seed`."""

from finance_api.seed.loader import DEFAULT_SEED_PATH, load_seed

__all__ = ["DEFAULT_SEED_PATH", "load_seed"]
