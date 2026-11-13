"""Custo estimado das chamadas à OpenAI (centavos de dólar, arredondado para cima).

Preços por 1 milhão de tokens, em centavos de US$, da página oficial
https://developers.openai.com/api/docs/pricing (consultada em 2026-11-13, contexto curto ≤ 272K).
Atualize aqui (com a data) quando trocar de modelo ou o preço mudar. Modelo fora da tabela → None.
"""

import math
from decimal import Decimal

PRICES_SOURCE = "https://developers.openai.com/api/docs/pricing"
PRICES_AS_OF = "2026-11-13"

# modelo -> (entrada, entrada em cache, saída), centavos de US$ por 1M tokens
PRICES_CENTS_PER_MTOK: dict[str, tuple[int, int, int]] = {
    "gpt-6.1-terra": (100, 5, 500),
    "gpt-6-luna": (10, 1, 50),
    "gpt-6.1-sol": (200, 10, 1000),
}

_MTOK = Decimal(1_000_000)


def _prices_for(model: str) -> tuple[int, int, int] | None:
    # A API pode devolver um snapshot datado (ex.: "gpt-6.1-terra-2026-10-01").
    for name in sorted(PRICES_CENTS_PER_MTOK, key=len, reverse=True):
        if model == name or model.startswith(name + "-"):
            return PRICES_CENTS_PER_MTOK[name]
    return None


def estimate_cost_cents(
    model: str,
    input_tokens: int | None,
    output_tokens: int | None,
    cached_input_tokens: int | None = None,
) -> int | None:
    """Centavos de US$ (teto: qualquer custo > 0 vira pelo menos 1). None sem preço ou sem uso."""
    prices = _prices_for(model)
    if prices is None or input_tokens is None or output_tokens is None:
        return None
    price_in, price_cached, price_out = prices
    cached = min(max(cached_input_tokens or 0, 0), input_tokens)
    total = (
        Decimal(input_tokens - cached) * price_in
        + Decimal(cached) * price_cached
        + Decimal(output_tokens) * price_out
    ) / _MTOK
    return math.ceil(total)
