"""Canais de notificação. `WebPushChannel` é o único ativo; `WhatsAppChannel` é um stub."""

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Protocol

from finance_api.core.config import Settings
from finance_api.db.models import PushSubscription

logger = logging.getLogger(__name__)

# Respostas do serviço de push que significam "esta inscrição não existe mais".
GONE_STATUSES = frozenset({404, 410})
SEND_TIMEOUT_SECONDS = 10.0
MAX_ERROR_LENGTH = 300


@dataclass(frozen=True)
class SendResult:
    ok: bool
    gone: bool = False  # inscrição expirada/removida no serviço de push: apagar
    error: str | None = None  # texto curto, sem segredos


class NotificationChannel(Protocol):
    name: str

    def send(self, subscription: PushSubscription, payload: dict[str, str]) -> SendResult:
        """Envia `payload` ({title, body, url}) para uma inscrição. Não levanta exceção."""
        ...


def _safe_error(exc: Exception) -> str:
    """Descrição curta do erro sem endpoint, chaves nem tokens."""
    text = f"{type(exc).__name__}: {exc}"
    text = re.sub(r"https?://\S+", "[url]", text)
    return text[:MAX_ERROR_LENGTH]


class WebPushChannel:
    name = "webpush"

    def __init__(self, public_key: str, private_key: str, subject: str) -> None:
        self._public_key = public_key
        self._private_key = private_key
        self._subject = subject

    @classmethod
    def from_settings(cls, settings: Settings) -> "WebPushChannel":
        return cls(settings.vapid_public_key, settings.vapid_private_key, settings.vapid_subject)

    @property
    def configured(self) -> bool:
        return bool(self._public_key and self._private_key)

    def send(self, subscription: PushSubscription, payload: dict[str, str]) -> SendResult:
        if not self.configured:
            return SendResult(ok=False, error="VAPID não configurado no servidor")
        # Import tardio: pywebpush/cryptography são pesados e inúteis sem chaves.
        from pywebpush import WebPushException, webpush

        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": dict(subscription.keys_json),
                },
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=self._private_key,
                vapid_claims={"sub": self._subject},  # o pywebpush altera o dict: um por envio
                timeout=SEND_TIMEOUT_SECONDS,
                ttl=60 * 60 * 12,
            )
        except WebPushException as exc:
            response: Any = getattr(exc, "response", None)
            status = getattr(response, "status_code", None)
            if status in GONE_STATUSES:
                return SendResult(ok=False, gone=True, error=f"HTTP {status}")
            return SendResult(ok=False, error=f"HTTP {status}" if status else _safe_error(exc))
        except Exception as exc:  # rede, chave inválida etc.: nunca derruba o agendador
            logger.warning("Falha no envio de push: %s", _safe_error(exc))
            return SendResult(ok=False, error=_safe_error(exc))
        return SendResult(ok=True)


class WhatsAppChannel:
    """Reservado para o número dedicado futuro. Desativado: não envia nada."""

    name = "whatsapp"
    enabled = False

    def send(self, subscription: PushSubscription, payload: dict[str, str]) -> SendResult:
        return SendResult(ok=False, error="Canal WhatsApp desativado")


def get_channel() -> NotificationChannel:
    """Canal de produção (dependência do FastAPI; testes sobrescrevem por um canal simulado)."""
    from finance_api.core.config import get_settings

    return WebPushChannel.from_settings(get_settings())
