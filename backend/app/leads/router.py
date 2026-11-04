"""Lead HTTP routes."""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.auth.dependencies import client_ip, require_permission
from app.common.responses import ApiResponse, error_responses
from app.core.database import get_db
from app.leads.import_service import import_leads_from_excel
from app.leads.schemas import (
    CreateLeadRequest,
    ImportLeadsResult,
    CreateLeadCallRequest,
    LeadActivityList,
    LeadCallList,
    LeadCallPublic,
    LeadListData,
    LeadPlanStep,
    LeadPriority,
    LeadPublic,
    UpdateLeadRequest,
    to_lead_public,
)
from app.leads.service import (
    LeadFilters,
    create_lead,
    delete_lead,
    get_lead,
    create_lead_call,
    list_lead_activity,
    list_lead_calls,
    list_leads,
    project_names_for_leads,
    update_lead,
)
from app.users.models import User

router = APIRouter()


def _public(lead, names: dict):  # type: ignore[no-untyped-def]
    name = None if lead.project_id is None else names.get(lead.project_id)
    return to_lead_public(lead, name)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiResponse[LeadPublic],
    summary="Create a lead",
    description=(
        "Creates a lead in the caller's company. The owner defaults to the caller. "
        "Assigning a different owner requires leads.assign. A platform administrator must send company_id "
        "when their own account has no company."
    ),
    responses=error_responses(401, 403, 409, 422),
)
def post_lead(
    payload: CreateLeadRequest,
    request: Request,
    actor: User = Depends(require_permission("leads.create")),
    db: Session = Depends(get_db),
) -> ApiResponse[LeadPublic]:
    created = create_lead(db, actor=actor, payload=payload, ip_address=client_ip(request))
    names = project_names_for_leads(db, [created])
    return ApiResponse(data=_public(created, names), message="Lead created.")


@router.get(
    "",
    response_model=ApiResponse[LeadListData],
    summary="List leads",
    description=(
        "Returns leads visible to the caller. A salesperson sees leads they own. "
        "A business owner sees every lead in their company. A super admin sees every company. "
        "next_followup_at matches that calendar date in UTC. Results are paginated."
    ),
    responses=error_responses(401, 403, 422),
)
def get_leads(
    actor: User = Depends(require_permission("leads.read")),
    db: Session = Depends(get_db),
    search: str | None = Query(default=None, max_length=100),
    status_filter: str | None = Query(default=None, alias="status", max_length=40),
    owner_id: uuid.UUID | None = Query(default=None),
    source: str | None = Query(default=None, max_length=80),
    priority: LeadPriority | None = Query(default=None),
    next_followup_at: date | None = Query(default=None),
    project_id: uuid.UUID | None = Query(default=None),
    plan_step: LeadPlanStep | None = Query(default=None),
    exclude_lost: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ApiResponse[LeadListData]:
    leads, total = list_leads(
        db,
        actor=actor,
        filters=LeadFilters(
            search=search,
            status=status_filter,
            owner_id=owner_id,
            source=source,
            priority=priority,
            next_followup_on=next_followup_at,
            project_id=project_id,
            plan_step=plan_step,
            exclude_lost=exclude_lost,
        ),
        limit=limit,
        offset=offset,
    )
    names = project_names_for_leads(db, leads)
    return ApiResponse(
        data=LeadListData(items=[_public(lead, names) for lead in leads], total=total),
        message="Success",
    )


@router.post(
    "/import",
    response_model=ApiResponse[ImportLeadsResult],
    summary="Import leads from Excel",
    description=(
        "Uploads an .xlsx file and creates leads for the given project. "
        "Columns are matched by header name to common lead fields and the project's Lead Fields. "
        "Repeated call-summary / follow-up columns are merged into Follow-up notes when that field exists. "
        "Rows with a mobile that already exists in the company are skipped."
    ),
    responses=error_responses(401, 403, 422),
)
async def post_import_leads(
    request: Request,
    project_id: uuid.UUID = Form(...),
    file: UploadFile = File(...),
    actor: User = Depends(require_permission("leads.create")),
    db: Session = Depends(get_db),
) -> ApiResponse[ImportLeadsResult]:
    raw = await file.read()
    result = import_leads_from_excel(
        db,
        actor=actor,
        project_id=project_id,
        file_bytes=raw,
        filename=file.filename or "leads.xlsx",
        ip_address=client_ip(request),
    )
    message = f"Imported {result.created} lead(s)."
    if result.skipped:
        message = f"Imported {result.created} lead(s); skipped {result.skipped}."
    return ApiResponse(data=result, message=message)


@router.get(
    "/{lead_id}/activity",
    response_model=ApiResponse[LeadActivityList],
    summary="Lead activity",
    description="Returns recent activity for one lead from the audit log.",
    responses=error_responses(401, 403, 404),
)
def get_lead_activity(
    lead_id: uuid.UUID,
    actor: User = Depends(require_permission("leads.read")),
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=100),
) -> ApiResponse[LeadActivityList]:
    return ApiResponse(
        data=list_lead_activity(db, actor=actor, lead_id=lead_id, limit=limit),
        message="Success",
    )


@router.get(
    "/{lead_id}/calls",
    response_model=ApiResponse[LeadCallList],
    summary="List calls for a lead",
    description="Returns every logged call for one lead, newest first. Each row keeps its own summary.",
    responses=error_responses(401, 403, 404),
)
def get_lead_calls(
    lead_id: uuid.UUID,
    actor: User = Depends(require_permission("leads.read")),
    db: Session = Depends(get_db),
) -> ApiResponse[LeadCallList]:
    return ApiResponse(data=list_lead_calls(db, actor=actor, lead_id=lead_id), message="Success")


@router.post(
    "/{lead_id}/calls",
    status_code=status.HTTP_201_CREATED,
    response_model=ApiResponse[LeadCallPublic],
    summary="Log a call",
    description=(
        "Stores one call on the lead. Connected requires a summary. "
        "A summary also becomes the lead's latest call summary. Older calls stay on this list."
    ),
    responses=error_responses(401, 403, 404, 422),
)
def post_lead_call(
    lead_id: uuid.UUID,
    payload: CreateLeadCallRequest,
    request: Request,
    actor: User = Depends(require_permission("leads.update")),
    db: Session = Depends(get_db),
) -> ApiResponse[LeadCallPublic]:
    created = create_lead_call(
        db,
        actor=actor,
        lead_id=lead_id,
        payload=payload,
        ip_address=client_ip(request),
    )
    label = "Connected" if created.outcome == "connected" else "No answer"
    return ApiResponse(data=created, message=f"{label} saved.")


@router.get(
    "/{lead_id}",
    response_model=ApiResponse[LeadPublic],
    summary="Read a lead",
    description="Returns one lead when it is inside the caller's company and ownership scope.",
    responses=error_responses(401, 403, 404),
)
def get_one_lead(
    lead_id: uuid.UUID,
    actor: User = Depends(require_permission("leads.read")),
    db: Session = Depends(get_db),
) -> ApiResponse[LeadPublic]:
    lead = get_lead(db, actor=actor, lead_id=lead_id)
    names = project_names_for_leads(db, [lead])
    return ApiResponse(data=_public(lead, names), message="Success")


@router.patch(
    "/{lead_id}",
    response_model=ApiResponse[LeadPublic],
    summary="Update a lead",
    description=(
        "Updates a lead inside the caller's scope. Changing owner_id assigns the lead and requires "
        "leads.assign. Salespeople cannot assign a lead to someone else."
    ),
    responses=error_responses(401, 403, 404, 422),
)
def patch_lead(
    lead_id: uuid.UUID,
    payload: UpdateLeadRequest,
    request: Request,
    actor: User = Depends(require_permission("leads.update")),
    db: Session = Depends(get_db),
) -> ApiResponse[LeadPublic]:
    updated = update_lead(
        db,
        actor=actor,
        lead_id=lead_id,
        payload=payload,
        ip_address=client_ip(request),
    )
    names = project_names_for_leads(db, [updated])
    return ApiResponse(data=_public(updated, names), message="Lead updated.")


@router.delete(
    "/{lead_id}",
    response_model=ApiResponse[LeadPublic],
    summary="Delete a lead",
    description="Soft-deletes a lead inside the caller's scope by setting is_deleted. The row is kept.",
    responses=error_responses(401, 403, 404),
)
def remove_lead(
    lead_id: uuid.UUID,
    request: Request,
    actor: User = Depends(require_permission("leads.delete")),
    db: Session = Depends(get_db),
) -> ApiResponse[LeadPublic]:
    deleted = delete_lead(db, actor=actor, lead_id=lead_id, ip_address=client_ip(request))
    names = project_names_for_leads(db, [deleted])
    return ApiResponse(data=_public(deleted, names), message="Lead deleted.")
