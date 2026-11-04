"""Lead use cases. Visibility follows the caller's company and ownership scope."""

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.access.scope import record_is_in_scope, resolve_record_scope
from app.audit.models import AuditLog
from app.audit.service import record_audit
from app.common.exceptions import AppError, ErrorCode
from app.core.logging import log_event
from app.lead_fields.service import active_fields_for_project, normalize_extra_values
from app.leads.models import Lead, LeadCall
from app.leads.schemas import (
    CreateLeadCallRequest,
    CreateLeadRequest,
    LeadActivityItem,
    LeadActivityList,
    LeadCallList,
    LeadCallPublic,
    UpdateLeadRequest,
    normalize_priority,
    normalize_status,
)
from app.pipeline.models import PipelineStage
from app.pipeline.service import assert_stage_key, entry_stage_key, is_closed_stage

_PRIORITY_FILTER_VALUES: dict[str, tuple[str, ...]] = {
    "high": ("high", "Hot"),
    "medium": ("medium", "Warm"),
    "low": ("low", "Cold"),
}
_STATUS_FILTER_VALUES: dict[str, tuple[str, ...]] = {
    "new": ("new", "New"),
    "contacted": ("contacted", "Contacted"),
    "in_progress": ("in_progress", "In Progress"),
    "qualified": ("qualified", "Qualified"),
    "won": ("won", "Won"),
    "lost": ("lost", "Lost", "unqualified"),
    "nurture": ("nurture", "Nurture"),
}
from app.organization.models import ACTIVE, Company, Project
from app.permissions.service import get_permission_keys
from app.roles.service import RoleName
from app.team.service import project_ids_for_member
from app.users.models import User
from app.users.service import is_platform_admin

logger = logging.getLogger("app.leads")
_MOBILE = re.compile(r"^\+?[0-9][0-9\s\-()]{7,18}$")
_NOTE_LABELS = frozenset(
    {
        "call summary",
        "follow-up notes",
        "follow up notes",
        "remarks",
        "discussion summary",
    }
)
_NOTE_KEYS = frozenset({"call_summary", "follow_up_notes", "followup_notes", "remarks"})
ASSIGN_PERMISSION = "leads.assign"


@dataclass(frozen=True)
class LeadFilters:
    search: str | None = None
    status: str | None = None
    owner_id: uuid.UUID | None = None
    source: str | None = None
    priority: str | None = None
    next_followup_on: date | None = None
    project_id: uuid.UUID | None = None
    plan_step: str | None = None
    exclude_lost: bool = False
    has_followup: bool = False


def _validation(field: str, code: str, message: str) -> AppError:
    return AppError(
        ErrorCode.VALIDATION_ERROR,
        message,
        422,
        details=[{"field": field, "code": code, "message": message}],
    )


def _not_found() -> AppError:
    return AppError(ErrorCode.NOT_FOUND, "Lead not found.", 404)


def _clean_mobile(value: str | None, field: str) -> str | None:
    if value is None:
        return None
    digits = "".join(character for character in value if character.isdigit())
    if _MOBILE.fullmatch(value) is None or not 8 <= len(digits) <= 15:
        raise _validation(field, "INVALID_MOBILE", "Enter a valid mobile number.")
    return value


def _active_company(db: Session, company_id: uuid.UUID) -> Company:
    company = db.get(Company, company_id)
    if company is None:
        raise _validation("company_id", "UNKNOWN_COMPANY", "Company not found.")
    if company.status != "active":
        raise _validation("company_id", "INACTIVE_COMPANY", "Company is not active.")
    return company


def _company_id_for_create(db: Session, actor: User, requested: uuid.UUID | None) -> uuid.UUID:
    if is_platform_admin(actor):
        company_id = actor.company_id if requested is None else requested
        if company_id is None:
            raise _validation("company_id", "REQUIRED", "Company is required.")
        _active_company(db, company_id)
        return company_id
    if actor.company_id is None:
        raise AppError(ErrorCode.FORBIDDEN, "You do not have permission to perform this action.", 403)
    if requested is not None and requested != actor.company_id:
        raise AppError(ErrorCode.FORBIDDEN, "You do not have permission to perform this action.", 403)
    _active_company(db, actor.company_id)
    return actor.company_id


def _owner_for_company(
    db: Session,
    actor: User,
    owner_id: uuid.UUID,
    company_id: uuid.UUID,
    *,
    reassigning: bool,
) -> User:
    if reassigning and ASSIGN_PERMISSION not in get_permission_keys(db, actor.id):
        raise AppError(ErrorCode.FORBIDDEN, "You cannot assign leads to other users.", 403)
    owner = db.get(User, owner_id)
    if owner is None or not owner.is_active or owner.company_id != company_id:
        raise _validation("owner_id", "UNKNOWN_OWNER", "Owner not found.")
    if reassigning:
        scope = resolve_record_scope(db, actor)
        if not record_is_in_scope(scope, owner_id=owner.id, company_id=company_id):
            raise _validation("owner_id", "UNKNOWN_OWNER", "Owner not found.")
    return owner


def _visible(db: Session, actor: User, lead_id: uuid.UUID) -> Lead:
    lead = db.get(Lead, lead_id)
    if lead is None or lead.is_deleted:
        raise _not_found()
    scope = resolve_record_scope(db, actor)
    if not record_is_in_scope(scope, owner_id=lead.owner_id, company_id=lead.company_id):
        raise _not_found()
    return lead


def _next_lead_number(db: Session, project: Project | None = None) -> str:
    if project is None:
        number = db.execute(text("SELECT nextval('lead_number_seq')")).scalar_one()
        return f"LEAD-{int(number):06d}"
    # Include soft-deleted rows so we never reuse a lead_number (unique per company).
    prefix = f"{project.code}-"
    existing = db.scalars(select(Lead.lead_number).where(Lead.project_id == project.id)).all()
    max_n = 0
    for number in existing:
        if not number.startswith(prefix):
            continue
        suffix = number[len(prefix) :]
        if suffix.isdigit():
            max_n = max(max_n, int(suffix))
    return f"{project.code}-{max_n + 1:04d}"


def _role_names(user: User) -> set[str]:
    return {link.role.name for link in user.user_roles}


def _project_for_lead(
    db: Session,
    actor: User,
    company_id: uuid.UUID,
    project_id: uuid.UUID | None,
    *,
    required: bool,
) -> Project | None:
    if project_id is None:
        if required:
            raise _validation("project_id", "REQUIRED", "Choose a project.")
        return None
    project = db.get(Project, project_id)
    if project is None or project.status != ACTIVE or project.company_id != company_id:
        raise _validation("project_id", "UNKNOWN_PROJECT", "Choose a project.")
    if RoleName.SUPER_ADMIN in _role_names(actor):
        return project
    if actor.company_id != company_id:
        raise _validation("project_id", "UNKNOWN_PROJECT", "Choose a project.")
    member_ids = project_ids_for_member(db, actor.id)
    if project.id not in member_ids:
        raise _validation("project_id", "NOT_ASSIGNED", "You are not assigned to this project.")
    return project


def project_names_for_leads(db: Session, leads: list[Lead]) -> dict[uuid.UUID, str]:
    ids = {lead.project_id for lead in leads if lead.project_id is not None}
    if not ids:
        return {}
    rows = db.execute(select(Project.id, Project.name).where(Project.id.in_(ids))).all()
    return {project_id: name for project_id, name in rows}


def _search_clause(term: str) -> Any:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    return or_(
        Lead.full_name.ilike(pattern, escape="\\"),
        Lead.mobile.ilike(pattern, escape="\\"),
        Lead.alternate_mobile.ilike(pattern, escape="\\"),
        Lead.email.ilike(pattern, escape="\\"),
    )


def list_leads(
    db: Session,
    *,
    actor: User,
    filters: LeadFilters,
    limit: int,
    offset: int,
) -> tuple[list[Lead], int]:
    scope = resolve_record_scope(db, actor)
    if scope.owner_ids is not None and (
        not scope.owner_ids or (filters.owner_id is not None and filters.owner_id not in scope.owner_ids)
    ):
        return [], 0

    conditions: list[ColumnElement[bool]] = [Lead.is_deleted.is_(False)]
    if scope.company_id is not None:
        conditions.append(Lead.company_id == scope.company_id)
    if scope.owner_ids is not None:
        conditions.append(Lead.owner_id.in_(scope.owner_ids))
    if filters.owner_id is not None:
        conditions.append(Lead.owner_id == filters.owner_id)
    if filters.status is not None:
        key = normalize_status(filters.status)
        status_values = _STATUS_FILTER_VALUES.get(key, (key, filters.status))
        conditions.append(Lead.status.in_(status_values))
    if filters.priority is not None:
        priority_values = _PRIORITY_FILTER_VALUES.get(normalize_priority(filters.priority), (filters.priority,))
        conditions.append(Lead.priority.in_(priority_values))
    if filters.source is not None and filters.source.strip():
        conditions.append(Lead.lead_source == filters.source.strip())
    if filters.project_id is not None:
        conditions.append(Lead.project_id == filters.project_id)
    if filters.plan_step is not None and filters.plan_step.strip():
        conditions.append(Lead.plan_step == filters.plan_step.strip())
    if filters.exclude_lost:
        # Closed outcomes (lost + won) leave Reminders / Follow-ups until reopened with a due date.
        closed_on_project = (
            select(PipelineStage.id)
            .where(
                PipelineStage.project_id == Lead.project_id,
                PipelineStage.key == Lead.status,
                or_(PipelineStage.is_lost.is_(True), PipelineStage.is_won.is_(True)),
            )
            .exists()
        )
        conditions.append(~closed_on_project)
        conditions.append(Lead.status.notin_(("lost", "Lost", "unqualified", "won", "Won")))
    if filters.has_followup:
        conditions.append(Lead.next_followup_at.is_not(None))
    # Salespeople only work leads on projects they are assigned to (plus their own unscoped legacy rows).
    if RoleName.SALESPERSON in {link.role.name for link in actor.user_roles} and RoleName.BUSINESS_OWNER not in {
        link.role.name for link in actor.user_roles
    } and RoleName.SUPER_ADMIN not in {link.role.name for link in actor.user_roles}:
        member_ids = project_ids_for_member(db, actor.id)
        if member_ids:
            conditions.append(or_(Lead.project_id.in_(member_ids), Lead.project_id.is_(None)))
        else:
            return [], 0
    if filters.next_followup_on is not None:
        start = datetime(
            filters.next_followup_on.year,
            filters.next_followup_on.month,
            filters.next_followup_on.day,
            tzinfo=UTC,
        )
        conditions.append(Lead.next_followup_at >= start)
        conditions.append(Lead.next_followup_at < start + timedelta(days=1))
    if filters.search is not None and filters.search.strip():
        conditions.append(_search_clause(filters.search.strip()))

    total = int(db.scalar(select(func.count()).select_from(Lead).where(*conditions)) or 0)
    stmt = (
        select(Lead)
        .where(*conditions)
        .order_by(Lead.created_at.desc(), Lead.lead_number.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db.scalars(stmt).all()), total


def get_lead(db: Session, *, actor: User, lead_id: uuid.UUID) -> Lead:
    return _visible(db, actor, lead_id)


def create_lead(
    db: Session,
    *,
    actor: User,
    payload: CreateLeadRequest,
    ip_address: str | None,
) -> Lead:
    mobile = _clean_mobile(payload.mobile, "mobile")
    if mobile is None:
        raise _validation("mobile", "REQUIRED", "Mobile is required.")
    alternate = _clean_mobile(payload.alternate_mobile, "alternate_mobile")
    company_id = _company_id_for_create(db, actor, payload.company_id)
    owner_id = actor.id if payload.owner_id is None else payload.owner_id
    if payload.owner_id is None and actor.company_id != company_id:
        raise _validation("owner_id", "REQUIRED", "Owner is required.")
    _owner_for_company(db, actor, owner_id, company_id, reassigning=owner_id != actor.id)
    require_project = RoleName.SALESPERSON in _role_names(actor) and RoleName.SUPER_ADMIN not in _role_names(actor)
    project = _project_for_lead(db, actor, company_id, payload.project_id, required=require_project)
    extras = normalize_extra_values(
        db,
        None if project is None else project.id,
        payload.extra_values,
        require_required=True,
    )
    project_id_for_stage = None if project is None else project.id
    status_key = (
        entry_stage_key(db, project_id_for_stage)
        if payload.status is None
        else assert_stage_key(db, project_id_for_stage, payload.status)
    )
    now = datetime.now(UTC)
    lead = Lead(
        company_id=company_id,
        project_id=None if project is None else project.id,
        lead_number=_next_lead_number(db, project),
        full_name=payload.full_name,
        mobile=mobile,
        alternate_mobile=alternate,
        email=payload.email,
        company_name=payload.company_name,
        city=payload.city,
        address=payload.address,
        requirement=payload.requirement,
        expected_value=payload.expected_value,
        enquiry_date=payload.enquiry_date,
        reference_name=payload.reference_name,
        call_summary=payload.call_summary,
        lead_source=payload.lead_source,
        owner_id=owner_id,
        created_by_id=actor.id,
        status=status_key,
        priority=payload.priority,
        plan_step=(payload.plan_step or "Day 1").strip()[:40] or "Day 1",
        next_followup_at=payload.next_followup_at,
        extra_values=extras or None,
        is_deleted=False,
        created_at=now,
        updated_at=now,
    )
    db.add(lead)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        detail = str(getattr(exc, "orig", exc))
        if "uq_leads_company_lead_number" in detail or "lead_number" in detail.lower():
            raise AppError(
                ErrorCode.CONFLICT,
                "Lead number conflict — retry import. If it keeps failing, contact support.",
                409,
            ) from None
        raise AppError(ErrorCode.CONFLICT, "Lead could not be saved.", 409) from None
    record_audit(
        db,
        action="lead_created",
        actor_id=actor.id,
        target_type="lead",
        target_id=lead.id,
        context={
            "lead_number": lead.lead_number,
            "company_id": str(company_id),
            "owner_id": str(owner_id),
            "status": lead.status,
        },
        ip_address=ip_address,
    )
    imported = (payload.call_summary or "").strip()
    if imported:
        db.add(
            LeadCall(
                lead_id=lead.id,
                user_id=actor.id,
                outcome="connected",
                summary=imported,
                created_at=now,
            )
        )
    db.commit()
    db.refresh(lead)
    log_event(logger, "lead_created", actor_id=str(actor.id), lead_id=str(lead.id))
    return lead


def update_lead(
    db: Session,
    *,
    actor: User,
    lead_id: uuid.UUID,
    payload: UpdateLeadRequest,
    ip_address: str | None,
) -> Lead:
    fields = payload.model_fields_set
    if not fields:
        raise _validation("request", "REQUIRED", "Provide at least one field to update.")
    lead = _visible(db, actor, lead_id)
    changed: list[str] = []
    changes: dict[str, Any] = {}
    before_status = lead.status
    before_priority = lead.priority
    before_plan = lead.plan_step
    before_due = lead.next_followup_at
    before_owner = lead.owner_id
    before_requirement = lead.requirement or ""

    if "full_name" in fields:
        if payload.full_name is None:
            raise _validation("full_name", "REQUIRED", "Full name is required.")
        lead.full_name = payload.full_name
        changed.append("full_name")
    if "mobile" in fields:
        mobile = _clean_mobile(payload.mobile, "mobile")
        if mobile is None:
            raise _validation("mobile", "REQUIRED", "Mobile is required.")
        lead.mobile = mobile
        changed.append("mobile")
    if "alternate_mobile" in fields:
        lead.alternate_mobile = _clean_mobile(payload.alternate_mobile, "alternate_mobile")
        changed.append("alternate_mobile")
    if "email" in fields:
        lead.email = payload.email
        changed.append("email")
    if "company_name" in fields:
        lead.company_name = payload.company_name
        changed.append("company_name")
    if "city" in fields:
        lead.city = payload.city
        changed.append("city")
    if "address" in fields:
        lead.address = payload.address
        changed.append("address")
    if "requirement" in fields:
        lead.requirement = payload.requirement
        changed.append("requirement")
        new_req = payload.requirement or ""
        if new_req.startswith(before_requirement) and len(new_req) > len(before_requirement):
            appended = new_req[len(before_requirement) :].strip()
            if appended:
                changes["note"] = appended.lstrip("\n")
    if "expected_value" in fields:
        lead.expected_value = payload.expected_value
        changed.append("expected_value")
    if "enquiry_date" in fields:
        lead.enquiry_date = payload.enquiry_date
        changed.append("enquiry_date")
    if "reference_name" in fields:
        lead.reference_name = payload.reference_name
        changed.append("reference_name")
    if "call_summary" in fields:
        lead.call_summary = payload.call_summary
        changed.append("call_summary")
    if "lead_source" in fields:
        lead.lead_source = payload.lead_source
        changed.append("lead_source")
    if "status" in fields:
        if payload.status is None:
            raise _validation("status", "REQUIRED", "Status is required.")
        lead.status = assert_stage_key(db, lead.project_id, payload.status)
        changed.append("status")
        if lead.status != before_status:
            changes["status"] = {"from": before_status, "to": lead.status}
        # Lost/won leave the reminder queue (unless caller set a new due explicitly, e.g. reopen).
        if is_closed_stage(db, lead.project_id, lead.status) and "next_followup_at" not in fields:
            if lead.next_followup_at is not None:
                lead.next_followup_at = None
                changed.append("next_followup_at")
                changes["next_followup_at"] = {
                    "from": None if before_due is None else before_due.isoformat(),
                    "to": None,
                }
    if "priority" in fields:
        if payload.priority is None:
            raise _validation("priority", "REQUIRED", "Priority is required.")
        lead.priority = payload.priority
        changed.append("priority")
        if lead.priority != before_priority:
            changes["priority"] = {"from": before_priority, "to": lead.priority}
    if "plan_step" in fields:
        step = (payload.plan_step or "").strip()
        if not step or len(step) > 40:
            raise _validation(
                "plan_step",
                "INVALID",
                "Plan step must be 1–40 characters.",
            )
        lead.plan_step = step
        changed.append("plan_step")
        if lead.plan_step != before_plan:
            changes["plan_step"] = {"from": before_plan, "to": lead.plan_step}
    if "next_followup_at" in fields:
        # Null clears the due date (Skip on Follow-ups).
        lead.next_followup_at = payload.next_followup_at
        changed.append("next_followup_at")
        changes["next_followup_at"] = {
            "from": None if before_due is None else before_due.isoformat(),
            "to": None if lead.next_followup_at is None else lead.next_followup_at.isoformat(),
        }
    if "project_id" in fields:
        project = _project_for_lead(
            db,
            actor,
            lead.company_id,
            payload.project_id,
            required=payload.project_id is not None
            or (RoleName.SALESPERSON in _role_names(actor) and RoleName.SUPER_ADMIN not in _role_names(actor)),
        )
        lead.project_id = None if project is None else project.id
        changed.append("project_id")
    if "extra_values" in fields:
        target_project_id = lead.project_id
        extras = normalize_extra_values(
            db,
            target_project_id,
            payload.extra_values,
            require_required=True,
        )
        lead.extra_values = extras or None
        changed.append("extra_values")
    if "owner_id" in fields:
        if payload.owner_id is None:
            raise _validation("owner_id", "REQUIRED", "Owner is required.")
        if payload.owner_id != lead.owner_id:
            _owner_for_company(
                db,
                actor,
                payload.owner_id,
                lead.company_id,
                reassigning=True,
            )
            lead.owner_id = payload.owner_id
            changed.append("owner_id")
            changes["owner_id"] = {"from": str(before_owner), "to": str(lead.owner_id)}

    lead.updated_at = datetime.now(UTC)
    context: dict[str, Any] = {"fields": changed, "changes": changes}
    if "owner_id" in changed:
        context["owner_id"] = str(lead.owner_id)
    record_audit(
        db,
        action="lead_updated",
        actor_id=actor.id,
        target_type="lead",
        target_id=lead.id,
        context=context,
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(lead)
    log_event(logger, "lead_updated", actor_id=str(actor.id), lead_id=str(lead.id))
    return lead


def delete_lead(
    db: Session,
    *,
    actor: User,
    lead_id: uuid.UUID,
    ip_address: str | None,
) -> Lead:
    lead = _visible(db, actor, lead_id)
    lead.is_deleted = True
    lead.updated_at = datetime.now(UTC)
    record_audit(
        db,
        action="lead_deleted",
        actor_id=actor.id,
        target_type="lead",
        target_id=lead.id,
        context={"lead_number": lead.lead_number, "is_deleted": True},
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(lead)
    log_event(logger, "lead_deleted", actor_id=str(actor.id), lead_id=str(lead.id))
    return lead


_STATUS_LABELS = {
    "new": "New",
    "contacted": "Contacted",
    "in_progress": "In Progress",
    "qualified": "Qualified",
    "won": "Won",
    "lost": "Lost",
    "nurture": "Nurture",
}
_PRIORITY_LABELS = {
    "high": "Hot",
    "Hot": "Hot",
    "medium": "Warm",
    "Warm": "Warm",
    "low": "Cold",
    "Cold": "Cold",
}


def _label_status(value: str | None) -> str:
    if not value:
        return "—"
    return _STATUS_LABELS.get(value, value.replace("_", " ").title())


def _label_priority(value: str | None) -> str:
    if not value:
        return "—"
    return _PRIORITY_LABELS.get(value, value)


def _format_activity_message(action: str, context: dict[str, Any] | None) -> str:
    ctx = context or {}
    changes = ctx.get("changes") if isinstance(ctx.get("changes"), dict) else {}

    if action == "lead_call_logged":
        outcome = "Connected" if ctx.get("outcome") == "connected" else "No answer"
        summary = ctx.get("summary")
        if isinstance(summary, str) and summary.strip():
            return f"{outcome}: {summary.strip()}"
        return outcome

    if action == "lead_created":
        return "Lead created and assigned"

    if action == "lead_deleted":
        return "Lead deleted"

    if action != "lead_updated":
        return action.replace("_", " ").capitalize()

    note = changes.get("note")
    if isinstance(note, str) and note.strip():
        return note.strip()

    status_change = changes.get("status")
    if isinstance(status_change, dict) and status_change.get("from") != status_change.get("to"):
        return (
            f"Status changed {_label_status(str(status_change.get('from')))} → "
            f"{_label_status(str(status_change.get('to')))}"
        )

    priority_change = changes.get("priority")
    if isinstance(priority_change, dict) and priority_change.get("from") != priority_change.get("to"):
        return (
            f"Priority changed from {_label_priority(str(priority_change.get('from')))} "
            f"to {_label_priority(str(priority_change.get('to')))}"
        )

    plan_change = changes.get("plan_step")
    if isinstance(plan_change, dict) and plan_change.get("from") != plan_change.get("to"):
        return f"Plan step {plan_change.get('from')} → {plan_change.get('to')}"

    due_change = changes.get("next_followup_at")
    if isinstance(due_change, dict):
        to_due = due_change.get("to")
        if to_due is None:
            return "Follow-up cleared"
        day = str(to_due)[:10]
        return f"Follow-up moved to {day}"

    owner_change = changes.get("owner_id")
    if isinstance(owner_change, dict):
        return "Lead reassigned"

    fields = ctx.get("fields")
    if isinstance(fields, list) and fields:
        return f"Updated {', '.join(str(field) for field in fields[:4])}"

    return "Lead updated"


def list_lead_activity(
    db: Session,
    *,
    actor: User,
    lead_id: uuid.UUID,
    limit: int = 50,
) -> LeadActivityList:
    _visible(db, actor, lead_id)
    rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.target_type == "lead", AuditLog.target_id == lead_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    ).all()
    actor_ids = {row.actor_id for row in rows if row.actor_id is not None}
    names: dict[uuid.UUID, str] = {}
    if actor_ids:
        for user in db.scalars(select(User).where(User.id.in_(actor_ids))).all():
            names[user.id] = user.full_name
    items = [
        LeadActivityItem(
            id=str(row.id),
            actor_name=names.get(row.actor_id, "System") if row.actor_id else "System",
            at=row.created_at,
            message=_format_activity_message(row.action, row.context),
        )
        for row in rows
    ]
    return LeadActivityList(items=items)


def list_lead_calls(db: Session, *, actor: User, lead_id: uuid.UUID) -> LeadCallList:
    _visible(db, actor, lead_id)
    rows = db.execute(
        select(LeadCall, User.full_name)
        .outerjoin(User, User.id == LeadCall.user_id)
        .where(LeadCall.lead_id == lead_id)
        .order_by(LeadCall.created_at.desc())
    ).all()
    return LeadCallList(
        items=[
            LeadCallPublic(
                id=str(call.id),
                lead_id=str(call.lead_id),
                user_id=None if call.user_id is None else str(call.user_id),
                user_name=user_name or "Someone",
                outcome=call.outcome,
                summary=call.summary,
                created_at=call.created_at,
            )
            for call, user_name in rows
        ]
    )


def _note_texts(db: Session, lead: Lead) -> list[str]:
    """Imported call notes live on the lead and sometimes on a custom notes field."""

    texts: list[str] = []
    summary = (lead.call_summary or "").strip()
    if summary:
        texts.append(summary)
    extras = lead.extra_values if isinstance(lead.extra_values, dict) else {}
    if lead.project_id is None or not extras:
        return texts
    for field in active_fields_for_project(db, lead.project_id):
        label = field.label.strip().lower()
        if label not in _NOTE_LABELS and field.key not in _NOTE_KEYS:
            continue
        raw = extras.get(field.key)
        if raw is None:
            continue
        text = str(raw).strip()
        if text and text not in texts:
            texts.append(text)
    return texts


def _archive_previous_notes(db: Session, lead: Lead, *, skip: str | None) -> None:
    """Keep imported notes when a new call replaces the latest summary."""

    existing = {
        (row or "").strip()
        for row in db.scalars(select(LeadCall.summary).where(LeadCall.lead_id == lead.id)).all()
    }
    skip_text = (skip or "").strip()
    stamp = lead.created_at
    if lead.enquiry_date is not None:
        stamp = datetime(
            lead.enquiry_date.year,
            lead.enquiry_date.month,
            lead.enquiry_date.day,
            12,
            0,
            tzinfo=UTC,
        )
    for text in _note_texts(db, lead):
        if text == skip_text or text in existing:
            continue
        db.add(
            LeadCall(
                lead_id=lead.id,
                user_id=lead.owner_id,
                outcome="connected",
                summary=text,
                created_at=stamp,
            )
        )
        existing.add(text)


def create_lead_call(
    db: Session,
    *,
    actor: User,
    lead_id: uuid.UUID,
    payload: CreateLeadCallRequest,
    ip_address: str | None,
) -> LeadCallPublic:
    lead = _visible(db, actor, lead_id)
    if payload.outcome == "connected" and not payload.summary:
        raise _validation("summary", "REQUIRED", "Write what was said on this call.")
    now = datetime.now(UTC)
    _archive_previous_notes(db, lead, skip=payload.summary)
    call = LeadCall(
        lead_id=lead.id,
        user_id=actor.id,
        outcome=payload.outcome,
        summary=payload.summary,
        created_at=now,
    )
    db.add(call)
    if payload.summary:
        lead.call_summary = payload.summary
        lead.updated_at = now
    record_audit(
        db,
        action="lead_call_logged",
        actor_id=actor.id,
        target_type="lead",
        target_id=lead.id,
        context={"outcome": payload.outcome, "summary": payload.summary},
        ip_address=ip_address,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        logger.exception("lead_call_save_failed", extra={"lead_id": str(lead_id)})
        raise AppError(
            ErrorCode.CONFLICT,
            "This call could not be saved. Try again.",
            409,
        ) from None
    db.refresh(call)
    return LeadCallPublic(
        id=str(call.id),
        lead_id=str(call.lead_id),
        user_id=str(actor.id),
        user_name=actor.full_name,
        outcome=call.outcome,
        summary=call.summary,
        created_at=call.created_at,
    )
