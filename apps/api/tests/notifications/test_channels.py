"""Canais: WebPushChannel sem rede (pywebpush substituído) e WhatsAppChannel desativado."""

import sys
import types

import pytest

from finance_api.db.models import PushSubscription
from finance_api.notifications import lifecycle
from finance_api.notifications.channels import WebPushChannel, WhatsAppChannel

SECRET = "CHAVE-PRIVADA-SECRETA"


def _sub():
    return PushSubscription(
        id=1,
        user_id=1,
        endpoint="https://push.test/endpoint-secreto",
        keys_json={"p256dh": "p", "auth": "a"},
    )


class _Response:
    def __init__(self, status_code):
        self.status_code = status_code


@pytest.fixture
def fake_pywebpush(monkeypatch):
    """Troca o módulo pywebpush: nada de rede. `calls` guarda os argumentos de cada envio."""
    module = types.ModuleType("pywebpush")

    class WebPushException(Exception):
        def __init__(self, message, response=None):
            super().__init__(message)
            self.response = response

    module.calls = []
    module.error = None

    def webpush(**kwargs):
        module.calls.append(kwargs)
        if module.error is not None:
            raise module.error

    module.WebPushException = WebPushException
    module.webpush = webpush
    monkeypatch.setitem(sys.modules, "pywebpush", module)
    return module


def test_sem_chaves_vapid_nao_envia_e_registra_falha_clara(fake_pywebpush):
    channel = WebPushChannel("", "", "mailto:a@b.test")
    result = channel.send(_sub(), {"title": "t", "body": "b", "url": "/"})
    assert not result.ok and not result.gone
    assert result.error == "VAPID não configurado no servidor"
    assert fake_pywebpush.calls == []


def test_envio_usa_vapid_e_payload_json(fake_pywebpush):
    channel = WebPushChannel("PUB", SECRET, "mailto:casal@exemplo.test")
    payload = {"title": "Finanças", "body": "Olá", "url": "/"}
    assert channel.send(_sub(), payload).ok
    [call] = fake_pywebpush.calls
    assert call["subscription_info"] == {
        "endpoint": "https://push.test/endpoint-secreto",
        "keys": {"p256dh": "p", "auth": "a"},
    }
    assert call["vapid_private_key"] == SECRET
    assert call["vapid_claims"]["sub"] == "mailto:casal@exemplo.test"
    import json

    assert json.loads(call["data"]) == payload


@pytest.mark.parametrize("status", [404, 410])
def test_404_e_410_marcam_inscricao_como_extinta(fake_pywebpush, status):
    fake_pywebpush.error = fake_pywebpush.WebPushException("gone", _Response(status))
    result = WebPushChannel("PUB", SECRET, "mailto:a@b.test").send(_sub(), {})
    assert result.gone and not result.ok and result.error == f"HTTP {status}"


def test_outro_status_nao_apaga(fake_pywebpush):
    fake_pywebpush.error = fake_pywebpush.WebPushException("x", _Response(500))
    result = WebPushChannel("PUB", SECRET, "mailto:a@b.test").send(_sub(), {})
    assert not result.gone and result.error == "HTTP 500"


def test_erro_inesperado_nao_vaza_endpoint_nem_chave(fake_pywebpush):
    fake_pywebpush.error = RuntimeError("falha em https://push.test/endpoint-secreto")
    result = WebPushChannel("PUB", SECRET, "mailto:a@b.test").send(_sub(), {})
    assert not result.ok and not result.gone
    assert "endpoint-secreto" not in result.error and SECRET not in result.error


def test_whatsapp_esta_desativado_e_nao_envia():
    channel = WhatsAppChannel()
    result = channel.send(_sub(), {"title": "t"})
    assert not channel.enabled and not result.ok and not result.gone


def test_agendador_sobe_e_para(monkeypatch):
    monkeypatch.setattr(lifecycle, "tick", lambda: None)
    assert lifecycle.scheduler_ok() is False
    lifecycle.startup()
    try:
        assert lifecycle.scheduler_ok() is True
        lifecycle.startup()  # idempotente
        assert lifecycle.scheduler_ok() is True
        assert [job.id for job in lifecycle._scheduler.get_jobs()] == [lifecycle.JOB_ID]
    finally:
        lifecycle.shutdown()
    assert lifecycle.scheduler_ok() is False
