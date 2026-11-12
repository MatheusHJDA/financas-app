from sqlalchemy import select

from finance_api.db.models import AuditLog, Debt


class _As:
    """Cliente que reaplica o usuário a cada chamada (client_as compartilha o app)."""

    def __init__(self, client_as, user):
        self._client_as, self._user = client_as, user

    def __getattr__(self, name):
        return getattr(self._client_as(self._user), name)


def _payload(**kw):
    data = {
        "owner": "AMBOS",
        "name": "Empréstimo",
        "principal_cents": 2200000,
        "monthly_rate": "0.0345",
        "installments": 24,
        "installment_cents": 136282,
        "start_date": "2026-11-01",
        "current_balance_cents": 2200000,
    }
    data.update(kw)
    return data


def _audits(db, action):
    return list(
        db.scalars(select(AuditLog).where(AuditLog.entity == "debts", AuditLog.action == action))
    )


def test_crud_completo_com_auditoria(db, users, client_as):
    client = client_as(users["matheus"])
    resp = client.post("/api/debts", json=_payload())
    assert resp.status_code == 201
    debt = resp.json()
    assert debt["monthly_rate"] == "0.034500"  # Price: taxa como string, 6 casas
    assert isinstance(debt["current_balance_cents"], int)
    assert client.get(f"/api/debts/{debt['id']}").json()["name"] == "Empréstimo"
    page = client.get("/api/debts").json()
    assert page["total"] == 1

    resp = client.patch(f"/api/debts/{debt['id']}", json={"current_balance_cents": 2000000})
    assert resp.status_code == 200 and resp.json()["current_balance_cents"] == 2000000
    audit = _audits(db, "update")[0]
    assert audit.before_json["current_balance_cents"] == 2200000
    assert audit.after_json["current_balance_cents"] == 2000000

    assert client.delete(f"/api/debts/{debt['id']}").status_code == 204
    assert client.get(f"/api/debts/{debt['id']}").status_code == 404
    assert len(_audits(db, "create")) == 1 and len(_audits(db, "delete")) == 1


def test_404_em_patch_e_delete(users, client_as):
    client = client_as(users["matheus"])
    assert client.patch("/api/debts/999", json={"name": "x"}).status_code == 404
    assert client.delete("/api/debts/999").status_code == 404


def test_permissoes(db, users, client_as):
    matheus, ruth = _As(client_as, users["matheus"]), _As(client_as, users["ruth"])
    mine = matheus.post("/api/debts", json=_payload(owner="MATHEUS", name="Meu")).json()
    both = matheus.post("/api/debts", json=_payload(owner="AMBOS", name="Nosso")).json()
    assert ruth.get(f"/api/debts/{mine['id']}").status_code == 200  # leitura é livre
    assert ruth.patch(f"/api/debts/{mine['id']}", json={"name": "x"}).status_code == 403
    assert ruth.delete(f"/api/debts/{mine['id']}").status_code == 403
    assert ruth.post("/api/debts", json=_payload(owner="MATHEUS")).status_code == 403
    assert ruth.patch(f"/api/debts/{both['id']}", json={"name": "Nosso 2"}).status_code == 200
    assert db.get(Debt, mine["id"]).name == "Meu"
    ruth_debt = ruth.post("/api/debts", json=_payload(owner="RUTH", name="Dela")).json()
    assert matheus.patch(f"/api/debts/{ruth_debt['id']}", json={"name": "ok"}).status_code == 200


def test_validacoes(users, client_as):
    client = client_as(users["matheus"])
    assert client.post("/api/debts", json=_payload(principal_cents=0)).status_code == 422
    assert client.post("/api/debts", json=_payload(monthly_rate="-0.1")).status_code == 422
    assert client.post("/api/debts", json=_payload(current_balance_cents=-1)).status_code == 422
    assert client.post("/api/debts", json=_payload(monthly_rate="0")).status_code == 201
