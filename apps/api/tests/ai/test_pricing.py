from finance_api.ai.pricing import estimate_cost_cents


def test_custo_terra_arredonda_para_cima_em_centavos_de_dolar():
    # 3.000 tokens de entrada (US$ 0,003) + 500 de saída (US$ 0,0025) = US$ 0,0055 -> 1 centavo
    assert estimate_cost_cents("gpt-6.1-terra", 3000, 500) == 1
    # 1M de entrada + 1M de saída = US$ 1 + US$ 5 = 600 centavos
    assert estimate_cost_cents("gpt-6.1-terra", 1_000_000, 1_000_000) == 600


def test_tokens_em_cache_saem_mais_baratos():
    # 1M de entrada, toda em cache: US$ 0,05 -> 5 centavos
    assert estimate_cost_cents("gpt-6.1-terra", 1_000_000, 0, cached_input_tokens=1_000_000) == 5
    # cache maior que a entrada é limitado à entrada
    assert estimate_cost_cents("gpt-6.1-terra", 1_000_000, 0, cached_input_tokens=9_000_000) == 5


def test_snapshot_datado_usa_o_preco_do_modelo():
    assert estimate_cost_cents("gpt-6.1-terra-2026-10-01", 1_000_000, 0) == 100


def test_sem_preco_ou_sem_uso_fica_nulo():
    assert estimate_cost_cents("modelo-desconhecido", 1000, 1000) is None
    assert estimate_cost_cents("gpt-6.1-terra", None, 1000) is None
    assert estimate_cost_cents("gpt-6.1-terra", 0, 0) == 0
