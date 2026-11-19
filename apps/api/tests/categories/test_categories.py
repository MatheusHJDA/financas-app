from sqlalchemy import select

from finance_api.db.models import AuditLog, Goal


def _audits(db):
    return list(
        db.scalars(select(AuditLog).where(AuditLog.entity == "categories").order_by(AuditLog.id))
    )


def test_create_list_update_delete_with_audit(client_as, users, db):
    client = client_as(users["ruth"])
    r = client.post("/api/categories", json={"name": "Mercado", "kind": "expense"})
    assert r.status_code == 201
    cat = r.json()
    assert cat["is_recurring_card_allowed"] is False
    assert cat["parent_id"] is None

    page = client.get("/api/categories").json()
    assert page["total"] == 1
    assert page["items"][0]["name"] == "Mercado"

    r = client.patch(f"/api/categories/{cat['id']}", json={"is_recurring_card_allowed": True})
    assert r.status_code == 200
    assert r.json()["is_recurring_card_allowed"] is True

    assert client.delete(f"/api/categories/{cat['id']}").status_code == 204
    assert [a.action for a in _audits(db)] == ["create", "update", "delete"]


def test_subcategory_and_parent_validation(client_as, users, make_category):
    parent = make_category("Alimentação")
    client = client_as(users["matheus"])
    r = client.post(
        "/api/categories", json={"name": "iFood", "kind": "expense", "parent_id": parent.id}
    )
    assert r.status_code == 201
    assert r.json()["parent_id"] == parent.id
    bad = client.post("/api/categories", json={"name": "X", "kind": "expense", "parent_id": 99999})
    assert bad.status_code == 422


def test_parent_cycle_is_rejected(client_as, users, make_category):
    a = make_category("A")
    b = make_category("B", parent_id=a.id)
    client = client_as(users["matheus"])
    assert client.patch(f"/api/categories/{a.id}", json={"parent_id": a.id}).status_code == 422
    assert client.patch(f"/api/categories/{a.id}", json={"parent_id": b.id}).status_code == 422
    assert client.patch(f"/api/categories/{b.id}", json={"parent_id": None}).status_code == 200


def test_delete_category_in_use_is_409(client_as, users, make_account, make_category, make_tx):
    used = make_category("Usada")
    make_tx(make_account(), category=used)
    parent = make_category("Pai")
    make_category("Filha", parent_id=parent.id)
    client = client_as(users["matheus"])
    assert client.delete(f"/api/categories/{used.id}").status_code == 409
    assert client.delete(f"/api/categories/{parent.id}").status_code == 409


def test_delete_categoria_usada_por_meta_409(client_as, users, db, make_category):
    used = make_category("Meta")
    db.add(
        Goal(
            owner="AMBOS",
            type="category_cap",
            name="Teto",
            target_cents=1000,
            linked_category_id=used.id,
        )
    )
    db.commit()
    assert client_as(users["ruth"]).delete(f"/api/categories/{used.id}").status_code == 409


def test_missing_category_is_404(client_as, users):
    client = client_as(users["ruth"])
    assert client.patch("/api/categories/9999", json={"name": "x"}).status_code == 404
    assert client.delete("/api/categories/9999").status_code == 404


def test_patch_null_name_is_422(client_as, users, make_category):
    cat = make_category()
    assert (
        client_as(users["ruth"]).patch(f"/api/categories/{cat.id}", json={"name": None}).status_code
        == 422
    )


def test_unauthenticated_gets_401(client_as):
    client = client_as(None)
    assert client.get("/api/categories").status_code == 401
    assert client.post("/api/categories", json={"name": "X", "kind": "expense"}).status_code == 401


def test_pagination(client_as, users, make_category):
    for name in ("A", "B", "C"):
        make_category(name)
    page = client_as(users["ruth"]).get("/api/categories", params={"limit": 2, "offset": 1}).json()
    assert page["total"] == 3
    assert len(page["items"]) == 2


def test_blank_name_is_422(client_as, users):
    client = client_as(users["ruth"])
    assert (
        client.post("/api/categories", json={"name": "   ", "kind": "expense"}).status_code == 422
    )
