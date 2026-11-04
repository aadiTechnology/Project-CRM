"""Project routes for the platform operator and the business owner."""

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.auth.dependencies import client_ip, get_current_user
from app.common.responses import ApiResponse, error_responses
from app.core.database import get_db
from app.projects.schemas import CompanyOption, CreateProjectRequest, ProjectListData, UpdateProjectRequest
from app.projects.service import can_create_projects, create_project, delete_project, list_projects, update_project
from app.users.models import User

router = APIRouter()


@router.get(
    "",
    response_model=ApiResponse[ProjectListData],
    summary="List projects",
    description=(
        "A Super Admin sees every project and the businesses that can receive a new one. "
        "A Business Owner or Salesperson sees projects assigned to them."
    ),
    responses=error_responses(401, 403),
)
def get_projects(
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> ApiResponse[ProjectListData]:
    projects, companies = list_projects(db, actor)
    return ApiResponse(
        data=ProjectListData(
            can_create=can_create_projects(actor),
            companies=[CompanyOption(id=str(company.id), name=company.name, status=company.status) for company in companies],
            items=projects,
        ),
        message="Success",
    )


@router.post(
    "",
    response_model=ApiResponse[ProjectListData],
    summary="Create a project",
    description="A Super Admin creates a project for one business. The short code becomes the lead number prefix.",
    responses=error_responses(401, 403, 422),
)
def post_project(
    payload: CreateProjectRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> ApiResponse[ProjectListData]:
    created = create_project(db, actor, payload, client_ip(request))
    projects, companies = list_projects(db, actor)
    return ApiResponse(
        data=ProjectListData(
            can_create=True,
            companies=[CompanyOption(id=str(company.id), name=company.name, status=company.status) for company in companies],
            items=projects,
        ),
        message=f"{created.name} is created. The first lead will be {created.next_lead_number}.",
    )


@router.patch(
    "/{project_id}",
    response_model=ApiResponse[ProjectListData],
    summary="Update a project",
    description=(
        "A Super Admin renames a project, changes its description, or marks it active or inactive. "
        "The short code stays fixed because lead numbers already use it."
    ),
    responses=error_responses(401, 403, 404, 422),
)
def patch_project(
    project_id: uuid.UUID,
    payload: UpdateProjectRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> ApiResponse[ProjectListData]:
    updated = update_project(db, actor, project_id, payload, client_ip(request))
    projects, companies = list_projects(db, actor)
    return ApiResponse(
        data=ProjectListData(
            can_create=True,
            companies=[CompanyOption(id=str(company.id), name=company.name, status=company.status) for company in companies],
            items=projects,
        ),
        message=f"{updated.name} is updated.",
    )


@router.delete(
    "/{project_id}",
    response_model=ApiResponse[ProjectListData],
    summary="Delete a project",
    description=(
        "A Super Admin deletes a project that has no leads. "
        "A project that already has leads must be marked inactive instead."
    ),
    responses=error_responses(401, 403, 404, 409),
)
def remove_project(
    project_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_user),
) -> ApiResponse[ProjectListData]:
    name = delete_project(db, actor, project_id, client_ip(request))
    projects, companies = list_projects(db, actor)
    return ApiResponse(
        data=ProjectListData(
            can_create=True,
            companies=[CompanyOption(id=str(company.id), name=company.name, status=company.status) for company in companies],
            items=projects,
        ),
        message=f"{name} is deleted.",
    )
