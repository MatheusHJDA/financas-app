import pytest
from fastapi import HTTPException

from finance_api.core.permissions import CurrentUser, Owner, can_write, ensure_can_write

RUTH = CurrentUser(id=2, name="Ruth", role="member", owner=Owner.RUTH)
MATHEUS = CurrentUser(id=1, name="Matheus", role="admin", owner=Owner.MATHEUS)
MEMBER_MATHEUS = CurrentUser(id=3, name="Outro", role="member", owner=Owner.MATHEUS)


@pytest.mark.parametrize(
    ("user", "record_owner", "expected"),
    [
        (RUTH, Owner.RUTH, True),
        (RUTH, Owner.MATHEUS, False),
        (RUTH, Owner.AMBOS, True),
        (MATHEUS, Owner.RUTH, True),  # admin pode tudo
        (MATHEUS, Owner.MATHEUS, True),
        (MATHEUS, Owner.AMBOS, True),
        (MEMBER_MATHEUS, Owner.MATHEUS, True),
        (MEMBER_MATHEUS, Owner.RUTH, False),
        (MEMBER_MATHEUS, Owner.AMBOS, True),
    ],
)
def test_can_write(user: CurrentUser, record_owner: Owner, expected: bool) -> None:
    assert can_write(user, record_owner) is expected


def test_ensure_can_write_raises_403() -> None:
    with pytest.raises(HTTPException) as exc:
        ensure_can_write(RUTH, Owner.MATHEUS)
    assert exc.value.status_code == 403


def test_ensure_can_write_allows() -> None:
    assert ensure_can_write(RUTH, Owner.AMBOS) is None
