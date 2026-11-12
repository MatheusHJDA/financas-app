from sqlalchemy import select

from finance_api.db.models import AuditLog, Category, Goal, GoalEntry, Transaction


class _As:
    """Cliente que reaplica o usuário a cada chamada (client_as compartilha o app)."""

    def __init__(self, client_as, user):
        self._client_as, self._user = client_as, user

    def __getattr__(self, name):
        return getattr(self._client_as(self._user), name)


def _payload(**kw):
    data = {"owner": "AMBOS", "type": "accumulate", "name": "Reserva", "target_cents": 200000}
    data.update(kw)
    return data


def _audits(db, entity, action):
    return list(
        db.scalars(select(AuditLog).where(AuditLog.entity == entity, AuditLog.action == action))
    )


def test_crud_com_auditoria(db, users, client_as):
    client = client_as(users["matheus"])
    goal = client.post("/api/goals", json=_payload()).json()
    assert goal["active"] is True and goal["progress"]["current_cents"] == 0
    resp = client.patch(f"/api/goals/{goal['id']}", json={"target_cents": 300000, "active": False})
    assert resp.status_code == 200
    assert resp.json()["target_cents"] == 300000 and resp.json()["active"] is False
    entry = client.post(
        f"/api/goals/{goal['id']}/entries", json={"amount_cents": 1000, "date": "2026-11-01"}
    )
    assert entry.status_code == 201
    assert client.delete(f"/api/goals/{goal['id']}").status_code == 204
    assert client.get(f"/api/goals/{goal['id']}").status_code == 404
    assert db.scalars(select(GoalEntry)).all() == []  # aportes saem junto (CASCADE)
    assert len(_audits(db, "goals", "create")) == 1
    assert len(_audits(db, "goals", "update")) == 1
    assert len(_audits(db, "goals", "delete")) == 1
    assert len(_audits(db, "goal_entries", "create")) == 1
    before = _audits(db, "goals", "update")[0].before_json
    assert before["target_cents"] == 200000


def test_permissoes(db, users, client_as):
    matheus, ruth = _As(client_as, users["matheus"]), _As(client_as, users["ruth"])
    mine = matheus.post("/api/goals", json=_payload(owner="MATHEUS", name="Uber")).json()
    both = matheus.post("/api/goals", json=_payload(name="Casal")).json()
    assert ruth.get(f"/api/goals/{mine['id']}").status_code == 200
    assert ruth.patch(f"/api/goals/{mine['id']}", json={"name": "x"}).status_code == 403
    assert ruth.delete(f"/api/goals/{mine['id']}").status_code == 403
    entry = {"amount_cents": 100, "date": "2026-11-01"}
    assert ruth.post(f"/api/goals/{mine['id']}/entries", json=entry).status_code == 403
    assert ruth.post("/api/goals", json=_payload(owner="MATHEUS")).status_code == 403
    assert ruth.post(f"/api/goals/{both['id']}/entries", json=entry).status_code == 201
    assert matheus.patch(f"/api/goals/{both['id']}", json={"name": "Casal 2"}).status_code == 200
    assert db.get(Goal, mine["id"]).name == "Uber"


def test_validacoes(db, users, client_as):
    client = client_as(users["matheus"])
    assert client.post("/api/goals", json=_payload(type="inventada")).status_code == 422
    assert client.post("/api/goals", json=_payload(type="income_period")).status_code == 422
    assert client.post("/api/goals", json=_payload(type="category_cap")).status_code == 422
    assert client.post("/api/goals", json=_payload(linked_account_id=9999)).status_code == 422
    cat = Category(name="Uber/99", kind="income")
    db.add(cat)
    db.flush()
    ok = _payload(type="income_period", period="daily", linked_category_id=cat.id)
    assert client.post("/api/goals", json=ok).status_code == 201
    bad_period = _payload(type="income_period", period="anual", linked_category_id=cat.id)
    assert client.post("/api/goals", json=bad_period).status_code == 422


def test_aporte_validacoes(db, users, client_as):
    client = client_as(users["matheus"])
    goal = client.post("/api/goals", json=_payload()).json()
    url = f"/api/goals/{goal['id']}/entries"
    assert (
        client.post(
            "/api/goals/9999/entries", json={"amount_cents": 1, "date": "2026-11-01"}
        ).status_code
        == 404
    )
    assert client.post(url, json={"amount_cents": 0, "date": "2026-11-01"}).status_code == 422
    missing_tx = {"amount_cents": 5, "date": "2026-11-01", "transaction_id": 9999}
    assert client.post(url, json=missing_tx).status_code == 404
    assert db.scalars(select(Transaction)).all() == []
