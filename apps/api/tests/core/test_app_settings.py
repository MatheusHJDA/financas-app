import pytest

from finance_api.core import app_settings
from finance_api.db.models import Setting


def test_padroes_quando_nada_gravado(db):
    assert app_settings.get_all(db) == app_settings.DEFAULTS
    assert app_settings.get(db, app_settings.DAILY_TIME) == "21:00"


def test_valor_gravado_sobrepoe_padrao_e_chave_estranha_e_ignorada(db):
    db.add(Setting(key=app_settings.BILL_DAYS_BEFORE, value_json=3))
    db.add(Setting(key="outra.coisa", value_json="x"))
    db.flush()
    values = app_settings.get_all(db)
    assert values[app_settings.BILL_DAYS_BEFORE] == 3
    assert "outra.coisa" not in values
    with pytest.raises(KeyError):
        app_settings.get(db, "outra.coisa")
