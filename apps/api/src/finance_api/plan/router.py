from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from finance_api.core.deps import DbSession, get_current_user
from finance_api.core.permissions import CurrentUser
from finance_api.plan import service
from finance_api.plan.engine import project
from finance_api.plan.schemas import (
    PlanAssumptionsIn,
    PlanProjectionOut,
    to_engine,
)

# U10: /plan/assumptions e /plan/projection. Qualquer usuário logado lê e edita (é do casal).
router = APIRouter(tags=["plan"], dependencies=[Depends(get_current_user)])

User = Annotated[CurrentUser, Depends(get_current_user)]


@router.get("/plan/assumptions", response_model=PlanAssumptionsIn)
def get_assumptions(db: DbSession) -> PlanAssumptionsIn:
    return service.load_assumptions(db)


@router.put("/plan/assumptions", response_model=PlanAssumptionsIn)
def put_assumptions(body: PlanAssumptionsIn, db: DbSession, user: User) -> PlanAssumptionsIn:
    service.save_assumptions(db, user, body)
    return body


@router.get("/plan/projection", response_model=PlanProjectionOut)
def get_projection(
    db: DbSession,
    scenario: Annotated[Literal["amortize_now", "no_amortization"], Query()],
) -> PlanProjectionOut:
    assumptions = to_engine(service.load_assumptions(db))
    return PlanProjectionOut.from_engine(project(assumptions, scenario))
