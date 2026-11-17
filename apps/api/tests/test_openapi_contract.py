from pathlib import Path

import yaml
from openapi_spec_validator import validate

SPEC_PATH = Path(__file__).resolve().parents[3] / "docs" / "api" / "openapi.yaml"

# (caminho, métodos) conforme .planning/U0-fundacao.md, Passo 4.
EXPECTED: dict[str, set[str]] = {
    "/health": {"get"},
    "/auth/users": {"get"},
    "/auth/login": {"post"},
    "/auth/logout": {"post"},
    "/auth/me": {"get"},
    "/auth/sessions": {"get"},
    "/auth/sessions/{id}": {"delete"},
    "/accounts": {"get", "post"},
    "/accounts/{id}": {"get", "patch", "delete"},
    "/categories": {"get", "post"},
    "/categories/{id}": {"patch", "delete"},
    "/transactions": {"get", "post"},
    "/transactions/{id}": {"get", "patch", "delete"},
    "/transactions/export.csv": {"get"},
    "/overview": {"get"},
    "/recurring-bills": {"get", "post"},
    "/recurring-bills/{id}": {"patch", "delete"},
    "/bill-instances": {"get"},
    "/bill-instances/{id}/pay": {"post"},
    "/debts": {"get", "post"},
    "/debts/{id}": {"get", "patch", "delete"},
    "/debts/{id}/installments": {"get"},
    "/debts/{id}/installments/pay": {"post"},
    "/goals": {"get", "post"},
    "/goals/{id}": {"get", "patch", "delete"},
    "/goals/{id}/entries": {"post"},
    "/ingest": {"post"},
    "/ingest/{extraction_id}": {"get"},
    "/drafts/{id}/confirm": {"post"},
    "/drafts/{id}/discard": {"post"},
    "/drafts/confirm-batch": {"post"},
    "/attachments/{id}": {"get"},
    "/push/vapid-public-key": {"get"},
    "/push/subscriptions": {"get", "post"},
    "/push/subscriptions/{id}": {"delete"},
    "/plan/assumptions": {"get", "put"},
    "/plan/projection": {"get"},
    "/admin/users": {"get"},
    "/admin/users/{id}/reset-pin": {"post"},
    "/admin/users/{id}/sessions": {"delete"},
    "/admin/settings": {"get", "put"},
    "/admin/notifications/test": {"post"},
    "/admin/push-subscriptions": {"get"},
    "/admin/ai/calls": {"get"},
    "/admin/audit": {"get"},
    "/admin/system": {"get"},
    "/admin/backups/latest": {"get"},
    "/reports/month": {"get"},
}

PUBLIC = {("/health", "get"), ("/auth/users", "get"), ("/auth/login", "post")}


def _spec() -> dict:
    return yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))


def test_spec_is_valid_openapi_31() -> None:
    spec = _spec()
    assert spec["openapi"].startswith("3.1")
    validate(spec)


def test_all_paths_and_methods_exist() -> None:
    paths = _spec()["paths"]
    for path, methods in EXPECTED.items():
        assert path in paths, path
        missing = methods - set(paths[path])
        assert not missing, (path, missing)


def test_servers_and_cookie_security() -> None:
    spec = _spec()
    assert spec["servers"] == [{"url": "/api"}]
    scheme = spec["components"]["securitySchemes"]["cookieAuth"]
    assert scheme == {"type": "apiKey", "in": "cookie", "name": "session"}
    assert spec["security"] == [{"cookieAuth": []}]


def test_public_endpoints_have_empty_security() -> None:
    paths = _spec()["paths"]
    for path, method in PUBLIC:
        assert paths[path][method]["security"] == [], (path, method)


def test_money_fields_are_integer_cents() -> None:
    schemas = _spec()["components"]["schemas"]
    seen = 0
    for name, schema in schemas.items():
        for prop, definition in schema.get("properties", {}).items():
            if prop.endswith("_cents"):
                seen += 1
                kind = definition.get("type")
                assert kind in ("integer", ["integer", "null"]), (name, prop)
    assert seen > 10


def test_month_report_contract() -> None:
    spec = _spec()
    op = spec["paths"]["/reports/month"]["get"]
    assert op["operationId"] == "getMonthReport"
    params = {p["name"]: p for p in op["parameters"]}
    assert params["month"]["required"] is True
    assert params["month"]["schema"]["pattern"] == r"^\d{4}-(0[1-9]|1[0-2])$"
    assert params["owner"]["schema"] == {"$ref": "#/components/schemas/Owner"}
    assert "422" in op["responses"]
    schemas = spec["components"]["schemas"]
    report = schemas["MonthReport"]
    assert set(report["required"]) == {
        "month",
        "income_cents",
        "expense_cents",
        "balance_cents",
        "bills",
        "previous",
        "expense_delta_cents",
        "by_category",
        "daily_cumulative_expense",
    }
    assert set(schemas["MonthBills"]["required"]) == {
        "total_count",
        "paid_count",
        "paid_cents",
        "open_count",
        "open_cents",
    }
    assert set(schemas["CategoryShare"]["required"]) == {
        "category_id",
        "name",
        "total_cents",
        "share_bp",
    }
    assert set(schemas["DailyCumulative"]["required"]) == {"current", "previous"}
    assert set(schemas["DailyPoint"]["required"]) == {"day", "cents"}
