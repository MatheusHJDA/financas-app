from sqlalchemy import select

from finance_api.core.config import get_settings
from finance_api.db.models import AuditLog, NotificationLog, PushSubscription
from finance_api.notifications.channels import SendResult

ENDPOINT = "https://push.example.test/abc123"
KEYS = {"p256dh": "chave-publica-do-aparelho", "auth": "segredo-de-autenticacao"}


def _body(**kw):
    data = {"endpoint": ENDPOINT, "keys": KEYS, "device_label": "iPhone"}
    data.update(kw)
    return data


def _audits(db, action):
    return list(
        db.scalars(
            select(AuditLog).where(
                AuditLog.entity == "push_subscriptions", AuditLog.action == action
            )
        )
    )


# --- chave pública --------------------------------------------------------------------------


def test_vapid_public_key_exige_login(client_as):
    assert client_as(None).get("/api/push/vapid-public-key").status_code == 401


def test_vapid_public_key_vazia_sem_chaves(users, client_as, monkeypatch):
    monkeypatch.setattr(get_settings(), "vapid_public_key", "")
    monkeypatch.setattr(get_settings(), "vapid_private_key", "")
    resp = client_as(users["ruth"]).get("/api/push/vapid-public-key")
    assert resp.status_code == 200 and resp.json() == {"public_key": ""}


def test_vapid_public_key_vazia_se_falta_a_privada(users, client_as, monkeypatch):
    monkeypatch.setattr(get_settings(), "vapid_public_key", "PUBLICA")
    monkeypatch.setattr(get_settings(), "vapid_private_key", "")
    assert client_as(users["ruth"]).get("/api/push/vapid-public-key").json() == {"public_key": ""}


def test_vapid_public_key_devolve_a_publica_configurada(users, client_as, monkeypatch):
    monkeypatch.setattr(get_settings(), "vapid_public_key", "PUBLICA")
    monkeypatch.setattr(get_settings(), "vapid_private_key", "PRIVADA")
    resp = client_as(users["ruth"]).get("/api/push/vapid-public-key")
    assert resp.json() == {"public_key": "PUBLICA"}
    assert "PRIVADA" not in resp.text


# --- inscrições -----------------------------------------------------------------------------


def test_cria_lista_e_remove_a_propria_inscricao(db, users, client_as):
    client = client_as(users["ruth"])
    resp = client.post("/api/push/subscriptions", json=_body())
    assert resp.status_code == 201
    sub = resp.json()
    assert sub["user_id"] == users["ruth"].id and sub["endpoint"] == ENDPOINT
    assert sub["device_label"] == "iPhone" and sub["last_ok_at"] is None and sub["created_at"]
    assert "keys" not in sub and "auth" not in resp.text

    assert [s["id"] for s in client.get("/api/push/subscriptions").json()] == [sub["id"]]
    assert client.delete(f"/api/push/subscriptions/{sub['id']}").status_code == 204
    assert client.get("/api/push/subscriptions").json() == []
    assert len(_audits(db, "create")) == 1 and len(_audits(db, "delete")) == 1


def test_listagem_so_mostra_as_proprias(users, client_as):
    client_as(users["ruth"]).post("/api/push/subscriptions", json=_body())
    client_as(users["matheus"]).post(
        "/api/push/subscriptions", json=_body(endpoint="https://push.example.test/outro")
    )
    ruth = client_as(users["ruth"]).get("/api/push/subscriptions").json()
    assert [s["endpoint"] for s in ruth] == [ENDPOINT]


def test_mesmo_endpoint_atualiza_em_vez_de_duplicar(db, users, client_as):
    first = client_as(users["ruth"]).post("/api/push/subscriptions", json=_body()).json()
    new_keys = {"p256dh": "nova", "auth": "novo-auth"}
    resp = client_as(users["matheus"]).post(
        "/api/push/subscriptions", json=_body(keys=new_keys, device_label="Android")
    )
    assert resp.status_code == 201
    again = resp.json()
    assert again["id"] == first["id"]
    assert again["user_id"] == users["matheus"].id and again["device_label"] == "Android"
    rows = list(db.scalars(select(PushSubscription)))
    assert len(rows) == 1 and rows[0].keys_json == new_keys
    assert len(_audits(db, "update")) == 1


def test_auditoria_nao_guarda_segredos(db, users, client_as):
    client_as(users["ruth"]).post("/api/push/subscriptions", json=_body())
    client_as(users["ruth"]).post("/api/push/subscriptions", json=_body())
    dump = " ".join(str(a.before_json) + str(a.after_json) for a in db.scalars(select(AuditLog)))
    for secret in (KEYS["auth"], KEYS["p256dh"], ENDPOINT):
        assert secret not in dump


def test_inscricao_invalida_422(users, client_as):
    client = client_as(users["ruth"])
    assert client.post("/api/push/subscriptions", json={"endpoint": ENDPOINT}).status_code == 422
    http = _body(endpoint="http://interno.local/x")
    assert client.post("/api/push/subscriptions", json=http).status_code == 422
    sem_auth = _body(keys={"p256dh": "x"})
    assert client.post("/api/push/subscriptions", json=sem_auth).status_code == 422


def test_inscricao_alheia_404_sem_revelar(db, users, client_as):
    sub = client_as(users["matheus"]).post("/api/push/subscriptions", json=_body()).json()
    alheia = client_as(users["ruth"]).delete(f"/api/push/subscriptions/{sub['id']}")
    inexistente = client_as(users["ruth"]).delete("/api/push/subscriptions/999999")
    assert alheia.status_code == 404 and inexistente.status_code == 404
    assert alheia.json() == inexistente.json()
    assert db.get(PushSubscription, sub["id"]) is not None


def test_admin_remove_inscricao_de_outra_pessoa(db, users, client_as):
    sub = client_as(users["ruth"]).post("/api/push/subscriptions", json=_body()).json()
    assert (
        client_as(users["matheus"]).delete(f"/api/push/subscriptions/{sub['id']}").status_code
        == 204
    )
    assert db.get(PushSubscription, sub["id"]) is None


def test_rotas_push_exigem_login(client_as):
    client = client_as(None)
    assert client.get("/api/push/subscriptions").status_code == 401
    assert client.post("/api/push/subscriptions", json=_body()).status_code == 401
    assert client.delete("/api/push/subscriptions/1").status_code == 401


# --- admin ----------------------------------------------------------------------------------


def test_admin_lista_todas_as_inscricoes_e_ruth_leva_403(users, client_as):
    client_as(users["ruth"]).post("/api/push/subscriptions", json=_body())
    client_as(users["matheus"]).post(
        "/api/push/subscriptions", json=_body(endpoint="https://push.example.test/outro")
    )
    assert client_as(users["ruth"]).get("/api/admin/push-subscriptions").status_code == 403
    resp = client_as(users["matheus"]).get("/api/admin/push-subscriptions")
    assert resp.status_code == 200
    assert {s["user_id"] for s in resp.json()} == {users["ruth"].id, users["matheus"].id}


def test_admin_envia_teste_a_todos_os_aparelhos_do_usuario(
    db, users, client_as, use_channel, subscribe
):
    subscribe(users["ruth"], "a")
    subscribe(users["ruth"], "b")
    subscribe(users["matheus"], "c")
    resp = client_as(users["matheus"]).post(
        "/api/admin/notifications/test", json={"user_id": users["ruth"].id}
    )
    assert resp.status_code == 200 and resp.json() == {"sent": 2}
    assert use_channel.users() == [users["ruth"].id] * 2
    assert use_channel.sent[0][1]["title"] == "Notificação de teste"
    logs = list(db.scalars(select(NotificationLog)))
    assert [(row.type, row.status) for row in logs] == [("test", "sent")] * 2


def test_admin_teste_sem_aparelho_devolve_zero_e_apaga_inscricao_morta(
    db, users, client_as, use_channel, subscribe
):
    client = client_as(users["matheus"])
    assert client.post("/api/admin/notifications/test", json={"user_id": 999999}).json() == {
        "sent": 0
    }
    sub = subscribe(users["ruth"])
    use_channel.results[sub.endpoint] = SendResult(ok=False, gone=True, error="HTTP 410")
    resp = client.post("/api/admin/notifications/test", json={"user_id": users["ruth"].id})
    assert resp.json() == {"sent": 0}
    assert db.get(PushSubscription, sub.id) is None


def test_ruth_nao_envia_teste(users, client_as, use_channel, subscribe):
    subscribe(users["matheus"])
    resp = client_as(users["ruth"]).post(
        "/api/admin/notifications/test", json={"user_id": users["matheus"].id}
    )
    assert resp.status_code == 403 and use_channel.sent == []
