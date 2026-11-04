"""Team board HTTP routes."""

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.auth.dependencies import client_ip, get_current_user
from app.common.responses import ApiResponse, error_responses
from app.core.database import get_db
from app.team.schemas import (
    CreateSalespersonRequest,
    MoveLeadsRequest,
    MoveLeadsResult,
    SetAssignmentRequest,
    TeamBoardData,
)
from app.team.service import create_salesperson, get_team_board, move_leads, remove_salesperson, set_assignment
from app.users.models import User

router = APIRouter()


@router.get(
    "",
    response_model=ApiResponse[TeamBoardData],
    summary="Team board",
    description=(
        "Super Admin: assign projects to business owners (filter by company_id). "
        "Business Owner: assign salespeople to projects, see lead counts."
    ),
    responses=error_responses(401, 403, 422),
)
def get_team(
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
    company_id: uuid.UUID | None = Query(default=None),
) -> ApiResponse[TeamBoardData]:
    return ApiResponse(data=get_team_board(db, actor, company_id), message="Success")


@router.patch(
    "/assignments",
    response_model=ApiResponse[TeamBoardData],
    summary="Assign or unassign a person on a project",
    responses=error_responses(401, 403, 422),
)
def patch_assignment(
    payload: SetAssignmentRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> ApiResponse[TeamBoardData]:
    board, leads_moved = set_assignment(db, actor, payload, client_ip(request))
    if leads_moved:
        message = f"Assignment updated. Moved {leads_moved} lead(s) to the assigned salesperson."
    else:
        message = "Assignment updated."
    return ApiResponse(data=board, message=message)


@router.post(
    "/salespeople",
    response_model=ApiResponse[TeamBoardData],
    summary="Add a salesperson to the business",
    responses=error_responses(401, 403, 409, 422),
)
def post_salesperson(
    payload: CreateSalespersonRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> ApiResponse[TeamBoardData]:
    board = create_salesperson(db, actor, payload, client_ip(request))
    return ApiResponse(data=board, message="Salesperson added.")


@router.delete(
    "/salespeople/{user_id}",
    response_model=ApiResponse[TeamBoardData],
    summary="Remove a salesperson",
    description=(
        "A Business Owner deactivates a salesperson in their company. "
        "The account is kept. This fails while that person still owns leads."
    ),
    responses=error_responses(401, 403, 404, 409),
)
def delete_salesperson(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> ApiResponse[TeamBoardData]:
    board = remove_salesperson(db, actor, user_id, client_ip(request))
    return ApiResponse(data=board, message="Salesperson deleted.")


@router.post(
    "/move-leads",
    response_model=ApiResponse[MoveLeadsResult],
    summary="Move leads from one salesperson to another inside a project",
    responses=error_responses(401, 403, 422),
)
def post_move_leads(
    payload: MoveLeadsRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> ApiResponse[MoveLeadsResult]:
    result = move_leads(db, actor, payload, client_ip(request))
    message = f"Moved {result.moved} lead(s)."
    if result.project_assigned:
        message += " Destination salesperson was also assigned to the project."
    return ApiResponse(data=result, message=message)
