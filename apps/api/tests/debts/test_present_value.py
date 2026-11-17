from datetime import date
from decimal import Decimal

from finance_api.debts.present_value import present_value_cents

HOJE = date(2026, 11, 17)
TAXA = Decimal("0.0345")
FACE = 141757
NUBANK = [
    (date(2026, 12, 18), 136880),
    (date(2027, 1, 18), 132315),
    (date(2027, 2, 18), 127902),
    (date(2027, 3, 18), 123637),
    (date(2027, 4, 19), 119514),
    (date(2027, 5, 18), 115528),
    (date(2027, 6, 18), 111675),
    (date(2027, 7, 19), 107951),
    (date(2027, 8, 18), 104351),
    (date(2027, 9, 20), 100871),
    (date(2027, 10, 18), 97507),
    (date(2027, 11, 18), 94255),
    (date(2027, 12, 20), 91112),
]


def test_matches_nubank_within_tolerance():
    pvs = []
    for due, esperado in NUBANK:
        pv = present_value_cents(FACE, due, HOJE, TAXA)
        pvs.append(pv)
        assert abs(pv - esperado) <= esperado * 0.003, (due, pv, esperado)
    assert abs(sum(pvs) - 1463495) <= 1463495 * 0.003


def test_due_today_or_past_is_face():
    assert present_value_cents(FACE, HOJE, HOJE, TAXA) == FACE
    assert present_value_cents(FACE, date(2026, 11, 1), HOJE, TAXA) == FACE


def test_decreases_with_distance():
    pvs = [present_value_cents(FACE, d, HOJE, TAXA) for d, _ in NUBANK]
    assert all(a > b for a, b in zip(pvs, pvs[1:], strict=False))
