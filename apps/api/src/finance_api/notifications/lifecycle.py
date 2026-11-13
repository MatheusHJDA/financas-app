"""Ganchos de ciclo de vida do agendador (assinaturas congeladas; U7 implementa o corpo).

`main.py` chama `startup()` / `shutdown()` no lifespan do app. `scheduler_ok()` alimenta
`GET /admin/system` (U9). Em testes o agendador não sobe (`create_app(start_scheduler=False)`).
"""

import logging
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler

from finance_api.db.session import get_sessionmaker
from finance_api.notifications.channels import get_channel
from finance_api.notifications.service import TZ, run_tick

logger = logging.getLogger(__name__)

JOB_ID = "notifications-tick"
_scheduler: BackgroundScheduler | None = None


def tick() -> None:
    """Job de cada minuto: abre a própria sessão de banco e roda as regras de aviso."""
    try:
        with get_sessionmaker()() as db:
            run_tick(db, datetime.now(TZ), get_channel())
    except Exception:  # o job nunca pode morrer; o próximo minuto tenta de novo
        logger.exception("Falha no tick de notificações")


def startup() -> None:
    """Sobe o agendador (diário e vencimentos)."""
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        return
    scheduler = BackgroundScheduler(timezone=TZ)
    scheduler.add_job(
        tick,
        "interval",
        minutes=1,
        id=JOB_ID,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=60,
        next_run_time=datetime.now(TZ),  # já no início: recupera aviso atrasado do mesmo dia
    )
    scheduler.start()
    _scheduler = scheduler


def shutdown() -> None:
    """Para o agendador sem esperar jobs em andamento."""
    global _scheduler
    if _scheduler is not None:
        if _scheduler.running:
            _scheduler.shutdown(wait=False)
        _scheduler = None


def scheduler_ok() -> bool:
    """True se o agendador está rodando."""
    return _scheduler is not None and _scheduler.running
