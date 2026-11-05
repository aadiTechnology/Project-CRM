"""KPI HTTP routes."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import require_permission
from app.common.responses import ApiResponse, error_responses
from app.core.database import get_db
from app.kpis.schemas import KpiDashboardData
from app.kpis.service import build_kpi_dashboard
from app.users.models import User

router = APIRouter()


@router.get(
    "",
    response_model=ApiResponse[KpiDashboardData],
    summary="Dashboard",
    description=(
        "Role dashboard. A salesperson sees their own calls and follow-ups. "
        "A business owner sees the selected project's team. "
        "A super admin starts from businesses, then projects, then that project's team."
    ),
    responses=error_responses(401, 403, 422),
)
def get_kpis(
    actor: User = Depends(require_permission("leads.read")),
    db: Session = Depends(get_db),
    project_id: uuid.UUID | None = Query(default=None),
    company_id: uuid.UUID | None = Query(default=None),
    user_id: uuid.UUID | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> ApiResponse[KpiDashboardData]:
    return ApiResponse(
        data=build_kpi_dashboard(
            db,
            actor=actor,
            project_id=project_id,
            company_id=company_id,
            user_id=user_id,
            date_from=date_from,
            date_to=date_to,
        ),
        message="Success",
    )
