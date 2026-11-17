from datetime import date

from sqlalchemy import select

from finance_api.core import app_settings
from finance_api.db.models import (
    Account,
    Category,
    Goal,
    NotificationLog,
    PushSubscription,
    Setting,
    Transaction,
)
from finance_api.notifications.channels import SendResult
from finance_api.notifications.service import format_brl, run_tick

from .conftest import at

DAILY_BODY = "Hora de enviar as movimentações de hoje"


def _logs(db, **filters):
    stmt = select(NotificationLog).order_by(NotificationLog.id)
    for column, value in filters.items():
        stmt = stmt.where(getattr(NotificationLog, column) == value)
    return list(db.scalars(stmt))


def test_format_brl_em_centavos():
    assert format_brl(0) == "R$ 0,00"
    assert format_brl(5) == "R$ 0,05"
    assert format_brl(123456) == "R$ 1.234,56"
    assert format_brl(100000000) == "R$ 1.000.000,00"


# --- Diário ---------------------------------------------------------------------------------


def test_diario_as_21h_envia_aos_dois_e_20h59_nao(db, users, subscribe, channel):
    subscribe(users["matheus"])
    subscribe(users["ruth"])

    assert run_tick(db, at("2026-11-13", "20:59"), channel) == 0
    assert channel.sent == []

    assert run_tick(db, at("2026-11-13", "21:00"), channel) == 2
    assert sorted(channel.users()) == sorted([users["matheus"].id, users["ruth"].id])
    payload = channel.sent[0][1]
    assert payload == {"title": "Finanças", "body": DAILY_BODY, "url": "/"}


def test_diario_nao_repete_no_segundo_tick(db, users, subscribe, channel):
    subscribe(users["matheus"])
    run_tick(db, at("2026-11-13", "21:00"), channel)
    assert run_tick(db, at("2026-11-13", "21:01"), channel) == 0
    assert run_tick(db, at("2026-11-13", "23:59"), channel) == 0
    assert len(channel.sent) == 1
    # No dia seguinte volta a enviar.
    assert run_tick(db, at("2026-11-14", "21:00"), channel) == 1
    assert [row.type for row in _logs(db)] == ["daily:2026-11-13", "daily:2026-11-14"]


def test_diario_servidor_fora_as_21h_envia_no_proximo_tick(db, users, subscribe, channel):
    subscribe(users["ruth"])
    assert run_tick(db, at("2026-11-13", "20:59"), channel) == 0
    # Servidor caiu em 21:00 e voltou às 21:07.
    assert run_tick(db, at("2026-11-13", "21:07"), channel) == 1
    assert run_tick(db, at("2026-11-13", "21:08"), channel) == 0


def test_diario_respeita_fuso_de_sao_paulo(db, users, subscribe, channel):
    from datetime import UTC, datetime

    subscribe(users["matheus"])
    # 23:30 UTC = 20:30 em São Paulo (UTC-3): ainda não é hora.
    assert run_tick(db, datetime(2026, 11, 13, 23, 30, tzinfo=UTC), channel) == 0
    # 00:00 UTC do dia 14 = 21:00 do dia 13 em São Paulo.
    assert run_tick(db, datetime(2026, 11, 14, 0, 0, tzinfo=UTC), channel) == 1
    assert _logs(db)[0].type == "daily:2026-11-13"


def test_diario_lista_contas_abertas_do_dono_ou_ambos(db, users, subscribe, channel, make_bill):
    hoje = date(2026, 11, 13)
    subscribe(users["matheus"])
    subscribe(users["ruth"])
    make_bill("RUTH", "Luz", hoje, 15000)
    make_bill("MATHEUS", "Academia", hoje, 9990)
    make_bill("AMBOS", "Aluguel", hoje, 120000)
    make_bill("RUTH", "Paga", hoje, 1000, status="paid")  # paga: fora
    make_bill("RUTH", "Amanhã", date(2026, 11, 14), 1000)  # outro dia: fora
    db.add(Setting(key=app_settings.BILL_TIME, value_json="23:59"))  # isola o aviso diário
    db.flush()

    run_tick(db, at("2026-11-13", "21:00"), channel)
    by_user = {user_id: payload["body"] for user_id, payload in channel.sent}

    ruth = by_user[users["ruth"].id]
    assert ruth == f"{DAILY_BODY}. Vencem hoje: Luz (R$ 150,00), Aluguel (R$ 1.200,00)"
    matheus = by_user[users["matheus"].id]
    assert matheus == f"{DAILY_BODY}. Vencem hoje: Academia (R$ 99,90), Aluguel (R$ 1.200,00)"


def _uber_goal(db, users, owner="MATHEUS", income_cents=11000, **overrides):
    """Meta diária "Uber diário" (alvo R$ 130,00) com uma receita na categoria hoje."""
    category = Category(name="Uber/99", kind="income")
    account = Account(
        owner="AMBOS",
        created_by=users["matheus"].id,
        name="Conta",
        type="checking",
        initial_balance_date=date(2026, 1, 1),
    )
    db.add_all([category, account])
    db.flush()
    fields = {
        "owner": owner,
        "type": "income_period",
        "name": "Uber diário",
        "target_cents": 13000,
        "period": "daily",
        "linked_category_id": category.id,
    }
    goal = Goal(**{**fields, **overrides})
    db.add(goal)
    if income_cents:
        db.add(
            Transaction(
                kind="income",
                amount_cents=income_cents,
                date=date(2026, 11, 13),
                description="Uber",
                account_id=account.id,
                category_id=category.id,
                owner="MATHEUS",
                created_by=users["matheus"].id,
                source="manual",
            )
        )
    db.flush()
    return goal


def test_daily_inclui_meta_diaria_do_usuario(db, users, subscribe, channel):
    subscribe(users["matheus"])
    subscribe(users["ruth"])
    goal = _uber_goal(db, users)

    run_tick(db, at("2026-11-13", "21:00"), channel)
    by_user = {user_id: payload for user_id, payload in channel.sent}

    matheus = by_user[users["matheus"].id]
    assert matheus["body"] == (
        f"{DAILY_BODY}. Uber diário hoje: R$ 110,00 de R$ 130,00 — quanto rodou?"
    )
    assert matheus["url"] == f"/lancar?meta={goal.id}"
    ruth = by_user[users["ruth"].id]
    assert ruth == {"title": "Finanças", "body": DAILY_BODY, "url": "/"}


def test_daily_meta_ambos_aparece_para_os_dois(db, users, subscribe, channel):
    subscribe(users["matheus"])
    subscribe(users["ruth"])
    goal = _uber_goal(db, users, owner="AMBOS")

    run_tick(db, at("2026-11-13", "21:00"), channel)

    assert len(channel.sent) == 2
    for _, payload in channel.sent:
        assert "Uber diário hoje: R$ 110,00 de R$ 130,00 — quanto rodou?" in payload["body"]
        assert payload["url"] == f"/lancar?meta={goal.id}"


def test_daily_junta_vencimento_e_meta_com_ponto(db, users, subscribe, channel, make_bill):
    subscribe(users["matheus"])
    make_bill("MATHEUS", "Academia", date(2026, 11, 13), 9990)
    _uber_goal(db, users)
    db.add(Setting(key=app_settings.BILL_TIME, value_json="23:59"))
    db.flush()

    run_tick(db, at("2026-11-13", "21:00"), channel)

    assert channel.sent[0][1]["body"] == (
        f"{DAILY_BODY}. Vence hoje: Academia (R$ 99,90)"
        ". Uber diário hoje: R$ 110,00 de R$ 130,00 — quanto rodou?"
    )


def test_daily_ignora_metas_que_nao_sao_diarias_de_renda(db, users, subscribe, channel):
    subscribe(users["matheus"])
    _uber_goal(db, users, period="weekly")
    _uber_goal(db, users, type="category_cap")
    _uber_goal(db, users, active=False)

    run_tick(db, at("2026-11-13", "21:00"), channel)

    assert channel.sent[0][1] == {"title": "Finanças", "body": DAILY_BODY, "url": "/"}


def test_daily_sem_meta_fica_igual(db, users, subscribe, channel):
    subscribe(users["matheus"])
    run_tick(db, at("2026-11-13", "21:00"), channel)
    assert channel.sent[0][1] == {"title": "Finanças", "body": DAILY_BODY, "url": "/"}


def test_horario_do_admin_vale_sem_reiniciar(db, users, subscribe, channel):
    subscribe(users["matheus"])
    assert run_tick(db, at("2026-11-13", "20:00"), channel) == 0
    db.add(Setting(key=app_settings.DAILY_TIME, value_json="19:30"))
    db.flush()
    assert run_tick(db, at("2026-11-13", "20:00"), channel) == 1


def test_horario_invalido_nas_configuracoes_usa_o_padrao(db, users, subscribe, channel):
    subscribe(users["matheus"])
    db.add(Setting(key=app_settings.DAILY_TIME, value_json="25:99"))
    db.flush()
    assert run_tick(db, at("2026-11-13", "20:59"), channel) == 0
    assert run_tick(db, at("2026-11-13", "21:00"), channel) == 1


def test_now_sem_fuso_e_recusado(db, channel):
    import pytest

    with pytest.raises(ValueError):
        run_tick(db, at("2026-11-13", "21:00").replace(tzinfo=None), channel)


# --- Vencimentos ----------------------------------------------------------------------------


def test_vencimento_dois_dias_antes_e_no_dia_para_o_dono(db, users, subscribe, channel, make_bill):
    ruth_id, matheus_id = users["ruth"].id, users["matheus"].id
    subscribe(users["ruth"])
    subscribe(users["matheus"])
    luz = make_bill("RUTH", "Luz", date(2026, 11, 15), 15000)

    assert run_tick(db, at("2026-11-13", "08:59"), channel) == 0
    assert run_tick(db, at("2026-11-13", "09:00"), channel) == 1
    assert channel.sent == [
        (
            ruth_id,
            {
                "title": "Conta vence em 2 dias",
                "body": "Luz (R$ 150,00) vence em 2 dias",
                "url": "/geral",
            },
        )
    ]
    assert run_tick(db, at("2026-11-13", "09:01"), channel) == 0  # idempotente
    assert run_tick(db, at("2026-11-14", "09:00"), channel) == 0  # d-1: sem aviso

    assert run_tick(db, at("2026-11-15", "09:00"), channel) == 1
    assert channel.sent[-1][0] == ruth_id and channel.sent[-1][1]["title"] == "Conta vence hoje"
    assert matheus_id not in channel.users()
    types = {row.type for row in _logs(db)}
    assert {f"bill:{luz.id}:d-2", f"bill:{luz.id}:d-0"} <= types


def test_vencimento_ambos_avisa_os_dois(db, users, subscribe, channel, make_bill):
    subscribe(users["ruth"])
    subscribe(users["matheus"])
    make_bill("AMBOS", "Aluguel", date(2026, 11, 15), 120000)
    assert run_tick(db, at("2026-11-13", "09:00"), channel) == 2
    assert sorted(channel.users()) == sorted([users["ruth"].id, users["matheus"].id])


def test_vencimento_paga_ou_fora_da_janela_nao_avisa(db, users, subscribe, channel, make_bill):
    subscribe(users["ruth"])
    make_bill("RUTH", "Paga", date(2026, 11, 15), 100, status="paid")
    make_bill("RUTH", "Longe", date(2026, 11, 20), 100)
    assert run_tick(db, at("2026-11-13", "09:00"), channel) == 0


def test_vencimento_usa_antecedencia_das_configuracoes(db, users, subscribe, channel, make_bill):
    subscribe(users["ruth"])
    make_bill("RUTH", "Luz", date(2026, 11, 16), 15000)
    assert run_tick(db, at("2026-11-13", "09:00"), channel) == 0
    db.add(Setting(key=app_settings.BILL_DAYS_BEFORE, value_json=3))
    db.flush()
    assert run_tick(db, at("2026-11-13", "09:00"), channel) == 1
    assert channel.sent[0][1]["body"] == "Luz (R$ 150,00) vence em 3 dias"


def test_vencimento_atrasado_no_mesmo_dia_envia_no_proximo_tick(
    db, users, subscribe, channel, make_bill
):
    subscribe(users["ruth"])
    make_bill("RUTH", "Luz", date(2026, 11, 15), 15000)
    assert run_tick(db, at("2026-11-13", "09:12"), channel) == 1


# --- Respostas do serviço de push e log -----------------------------------------------------


def test_410_e_404_apagam_a_inscricao(db, users, subscribe, channel):
    gone = subscribe(users["ruth"], "gone")
    dead = subscribe(users["ruth"], "dead")
    alive = subscribe(users["ruth"], "alive")
    channel.results[gone.endpoint] = SendResult(ok=False, gone=True, error="HTTP 410")
    channel.results[dead.endpoint] = SendResult(ok=False, gone=True, error="HTTP 404")

    assert run_tick(db, at("2026-11-13", "21:00"), channel) == 1
    remaining = list(db.scalars(select(PushSubscription.id)))
    assert remaining == [alive.id]
    failed = _logs(db, status="failed")
    assert len(failed) == 2 and all("removida" in (row.error or "") for row in failed)


def test_sucesso_grava_last_ok_at_e_log(db, users, subscribe, channel):
    sub = subscribe(users["matheus"])
    assert sub.last_ok_at is None
    now = at("2026-11-13", "21:00")
    run_tick(db, now, channel)
    db.refresh(sub)
    assert sub.last_ok_at == now
    [row] = _logs(db)
    assert (row.user_id, row.channel, row.type, row.status, row.error) == (
        users["matheus"].id,
        "fake",
        "daily:2026-11-13",
        "sent",
        None,
    )
    assert row.sent_at == now


def test_falha_comum_nao_apaga_grava_erro_e_desiste_apos_tres(db, users, subscribe, channel):
    sub = subscribe(users["ruth"])
    channel.results[sub.endpoint] = SendResult(ok=False, error="HTTP 500")
    for minute in range(10):
        run_tick(db, at("2026-11-13", f"21:0{minute}"), channel)
    assert db.get(PushSubscription, sub.id) is not None
    assert sub.last_ok_at is None
    rows = _logs(db, status="failed")
    assert len(rows) == 3 and rows[0].error == "HTTP 500"
    # Voltou a funcionar, mas o aviso do dia já foi dado por vencido.
    channel.results.clear()
    assert run_tick(db, at("2026-11-13", "22:00"), channel) == 0


def test_falha_transitoria_tenta_de_novo_no_tick_seguinte(db, users, subscribe, channel):
    sub = subscribe(users["ruth"])
    channel.results[sub.endpoint] = SendResult(ok=False, error="HTTP 503")
    assert run_tick(db, at("2026-11-13", "21:00"), channel) == 0
    channel.results.clear()
    assert run_tick(db, at("2026-11-13", "21:01"), channel) == 1


def test_canal_que_levanta_excecao_nao_derruba_o_tick(db, users, subscribe, channel):
    subscribe(users["ruth"])
    channel.raises = RuntimeError("segredo-no-erro")
    assert run_tick(db, at("2026-11-13", "21:00"), channel) == 0
    [row] = _logs(db)
    assert row.status == "failed" and row.error == "RuntimeError no canal"


def test_usuario_sem_inscricao_nao_gera_log_e_recebe_ao_se_inscrever(db, users, subscribe, channel):
    assert run_tick(db, at("2026-11-13", "21:00"), channel) == 0
    assert _logs(db) == []
    subscribe(users["ruth"])
    assert run_tick(db, at("2026-11-13", "21:05"), channel) == 1


def test_tipo_do_log_cabe_em_40_caracteres(db, users, subscribe, channel, make_bill):
    subscribe(users["ruth"])
    make_bill("RUTH", "Luz", date(2026, 11, 15), 100)
    run_tick(db, at("2026-11-13", "21:00"), channel)
    assert _logs(db) and all(len(row.type) <= 40 for row in _logs(db))


def test_varios_aparelhos_falhando_no_mesmo_tick_sao_uma_tentativa(db, users, subscribe, channel):
    subs = [subscribe(users["ruth"], tag) for tag in ("a", "b", "c")]
    for sub in subs:
        channel.results[sub.endpoint] = SendResult(ok=False, error="HTTP 503")
    assert run_tick(db, at("2026-11-13", "21:00"), channel) == 0
    assert len(_logs(db, status="failed")) == 3  # uma linha por aparelho
    channel.results.clear()
    # foi só uma tentativa: o próximo tick ainda tenta
    assert run_tick(db, at("2026-11-13", "21:01"), channel) == 3
