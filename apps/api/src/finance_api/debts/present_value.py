"""Valor presente de uma parcela de empréstimo (quanto custa pagar hoje)."""

import calendar
from datetime import date
from decimal import ROUND_HALF_UP, Decimal


def _add_months(base: date, months: int) -> date:
    total = base.year * 12 + (base.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    day = min(base.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def present_value_cents(face_cents: int, due: date, today: date, monthly_rate: Decimal) -> int:
    """Estima o valor da parcela se paga hoje, descontada à taxa do contrato.

    Aproxima o desconto do Nubank: o prazo é contado em meses inteiros de
    calendário entre ``today`` e ``due`` (``n``) mais os dias restantes
    divididos por 30 (``d/30``); valor = ``face / (1 + taxa) ** (n + d/30)``.
    Arredonda ``ROUND_HALF_UP`` para centavos inteiros. Parcela vencida ou
    vencendo hoje vale o valor de face.
    """
    if due <= today:
        return face_cents
    n = (due.year - today.year) * 12 + (due.month - today.month)
    if _add_months(today, n) > due:
        n -= 1
    d = (due - _add_months(today, n)).days
    expoente = Decimal(n) + Decimal(d) / Decimal(30)
    fator = (Decimal(1) + monthly_rate) ** expoente
    return int((Decimal(face_cents) / fator).quantize(Decimal(1), ROUND_HALF_UP))
