"""Manage project-scoped pipeline stages. The New entry stage is locked for every project."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit.service import record_audit
from app.common.exceptions import AppError, ErrorCode
from app.core.logging import log_event
from app.leads.models import Lead
from app.organization.models import ACTIVE, Project
from app.pipeline.models import ENTRY_KEY, PipelineStage
from app.pipeline.schemas import (
    CreatePipelineStageRequest,
    DeletePipelineStageRequest,
    PipelineStageListData,
    ReorderPipelineStagesRequest,
    UpdatePipelineStageRequest,
    is_valid_key,
    slug_key,
    to_stage_public,
)
from app.roles.service import RoleName
from app.team.service import project_ids_for_member
from app.users.models import User
from app.users.service import is_platform_admin

logger = logging.getLogger("app.pipeline")

_MANAGE_ROLES = frozenset({RoleName.SUPER_ADMIN, RoleName.BUSINESS_OWNER})
_READ_ROLES = frozenset(
    {RoleName.SUPER_ADMIN, RoleName.BUSINESS_OWNER, RoleName.SALESPERSON, RoleName.MARKETING}
)
_LEGACY_STATUS = {
    "new": "new",
    "New": "new",
    "contacted": "contacted",
    "Contacted": "contacted",
    "in_progress": "in_progress",
    "In Progress": "in_progress",
    "qualified": "qualified",
    "Qualified": "qualified",
    "won": "won",
    "Won": "won",
    "lost": "lost",
    "Lost": "lost",
    "nurture": "nurture",
    "Nurture": "nurture",
    "unqualified": "lost",
}

DEFAULT_STAGES: tuple[tuple[str, str, str, bool, bool, bool], ...] = (
    ("new", "New", "#93c5fd", True, False, False),
    ("contacted", "Contacted", "#60a5fa", False, False, False),
    ("in_progress", "In Progress", "#f59e0b", False, False, False),
    ("qualified", "Qualified", "#34d399", False, False, False),
    ("won", "Won", "#10b981", False, True, False),
    ("lost", "Lost", "#f87171", False, False, True),
    ("nurture", "Nurture", "#a78bfa", False, False, False),
)


def _role_names(user: User) -> set[str]:
    return {link.role.name for link in user.user_roles}


def _forbidden() -> AppError:
    return AppError(ErrorCode.FORBIDDEN, "You do not have permission to perform this action.", 403)


def _not_found(message: str = "Stage not found.") -> AppError:
    return AppError(ErrorCode.NOT_FOUND, message, 404)


def _validation(field: str, code: str, message: str) -> AppError:
    return AppError(
        ErrorCode.VALIDATION_ERROR,
        message,
        422,
        details=[{"field": field, "code": code, "message": message}],
    )


def _require_reader(user: User) -> None:
    if not _role_names(user) & _READ_ROLES:
        raise _forbidden()


def _require_manager(user: User) -> None:
    if not _role_names(user) & _MANAGE_ROLES:
        raise _forbidden()


def _is_locked(stage: PipelineStage) -> bool:
    return stage.key == ENTRY_KEY or stage.is_entry


def accessible_project(db: Session, actor: User, project_id: uuid.UUID) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.status != ACTIVE:
        raise _validation("project_id", "UNKNOWN_PROJECT", "Choose a project.")
    if is_platform_admin(actor):
        return project
    if actor.company_id is None or project.company_id != actor.company_id:
        raise _validation("project_id", "UNKNOWN_PROJECT", "Choose a project.")
    roles = _role_names(actor)
    if RoleName.BUSINESS_OWNER in roles:
        return project
    member_ids = project_ids_for_member(db, actor.id)
    if project.id not in member_ids:
        raise _validation("project_id", "NOT_ASSIGNED", "You are not assigned to this project.")
    return project


def canonicalize_status(value: str) -> str:
    return _LEGACY_STATUS.get(value, value.strip().lower().replace(" ", "_")[:40])


def ensure_default_stages(db: Session, project_id: uuid.UUID) -> None:
    exists = db.scalar(
        select(PipelineStage.id).where(PipelineStage.project_id == project_id).limit(1)
    )
    if exists is not None:
        return
    now = datetime.now(UTC)
    for index, (key, label, color, is_entry, is_won, is_lost) in enumerate(DEFAULT_STAGES, start=1):
        db.add(
            PipelineStage(
                project_id=project_id,
                key=key,
                label=label,
                color=color,
                sort_order=index,
                is_entry=is_entry,
                is_won=is_won,
                is_lost=is_lost,
                created_at=now,
                updated_at=now,
            )
        )
    db.flush()


def entry_stage_key(db: Session, project_id: uuid.UUID | None) -> str:
    if project_id is None:
        return ENTRY_KEY
    ensure_default_stages(db, project_id)
    return ENTRY_KEY


def assert_stage_key(db: Session, project_id: uuid.UUID | None, status: str) -> str:
    key = canonicalize_status(status)
    if project_id is None:
        if key != ENTRY_KEY:
            raise _validation("status", "UNKNOWN_STAGE", "Choose a valid pipeline stage.")
        return ENTRY_KEY
    ensure_default_stages(db, project_id)
    exists = db.scalar(
        select(PipelineStage.id).where(
            PipelineStage.project_id == project_id,
            PipelineStage.key == key,
        )
    )
    if exists is None:
        raise _validation("status", "UNKNOWN_STAGE", "Choose a valid pipeline stage.")
    return key


def is_lost_stage(db: Session, project_id: uuid.UUID | None, status: str) -> bool:
    """True when status is a lost/unqualified outcome (no further reminders)."""
    key = canonicalize_status(status)
    if key in {"lost", "unqualified"}:
        return True
    if project_id is None:
        return False
    ensure_default_stages(db, project_id)
    return (
        db.scalar(
            select(PipelineStage.id).where(
                PipelineStage.project_id == project_id,
                PipelineStage.key == key,
                PipelineStage.is_lost.is_(True),
            )
        )
        is not None
    )


def _lead_counts(db: Session, project_id: uuid.UUID) -> dict[str, int]:
    rows = db.execute(
        select(Lead.status, func.count())
        .where(
            Lead.project_id == project_id,
            Lead.is_deleted.is_(False),
        )
        .group_by(Lead.status)
    ).all()
    counts: dict[str, int] = {}
    for status, count in rows:
        key = canonicalize_status(str(status))
        counts[key] = counts.get(key, 0) + int(count)
    return counts


def list_stages(db: Session, actor: User, project_id: uuid.UUID) -> PipelineStageListData:
    _require_reader(actor)
    accessible_project(db, actor, project_id)
    ensure_default_stages(db, project_id)
    db.commit()
    stages = list(
        db.scalars(
            select(PipelineStage)
            .where(PipelineStage.project_id == project_id)
            .order_by(PipelineStage.sort_order, PipelineStage.label)
        ).all()
    )
    counts = _lead_counts(db, project_id)
    return PipelineStageListData(
        items=[to_stage_public(stage, counts.get(stage.key, 0)) for stage in stages],
        project_id=str(project_id),
    )


def _unique_key(db: Session, project_id: uuid.UUID, label: str) -> str:
    base = slug_key(label)
    if not is_valid_key(base) or base == ENTRY_KEY:
        base = "stage"
    candidate = base
    index = 2
    while True:
        exists = db.scalar(
            select(PipelineStage.id).where(
                PipelineStage.project_id == project_id,
                PipelineStage.key == candidate,
            )
        )
        if exists is None and candidate != ENTRY_KEY:
            return candidate
        candidate = f"{base}_{index}"[:40]
        index += 1


def _next_sort(db: Session, project_id: uuid.UUID) -> int:
    current = db.scalar(
        select(func.coalesce(func.max(PipelineStage.sort_order), 0)).where(
            PipelineStage.project_id == project_id
        )
    )
    return int(current or 0) + 1


def create_stage(
    db: Session,
    actor: User,
    payload: CreatePipelineStageRequest,
    ip_address: str | None,
) -> PipelineStage:
    _require_manager(actor)
    accessible_project(db, actor, payload.project_id)
    ensure_default_stages(db, payload.project_id)
    now = datetime.now(UTC)
    key = _unique_key(db, payload.project_id, payload.label)
    stage = PipelineStage(
        project_id=payload.project_id,
        key=key,
        label=payload.label,
        color=payload.color,
        sort_order=_next_sort(db, payload.project_id),
        is_entry=False,
        is_won=payload.is_won,
        is_lost=payload.is_lost,
        created_at=now,
        updated_at=now,
    )
    db.add(stage)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(ErrorCode.CONFLICT, "A stage with this key already exists.", 409) from None
    record_audit(
        db,
        action="pipeline_stage_created",
        actor_id=actor.id,
        target_type="pipeline_stage",
        target_id=stage.id,
        context={"key": stage.key, "label": stage.label, "project_id": str(payload.project_id)},
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(stage)
    log_event(logger, "pipeline_stage_created", actor_id=str(actor.id), stage_id=str(stage.id))
    return stage


def update_stage(
    db: Session,
    actor: User,
    stage_id: uuid.UUID,
    payload: UpdatePipelineStageRequest,
    ip_address: str | None,
) -> PipelineStage:
    _require_manager(actor)
    stage = db.get(PipelineStage, stage_id)
    if stage is None:
        raise _not_found()
    accessible_project(db, actor, stage.project_id)
    fields = payload.model_fields_set
    if not fields:
        raise _validation("request", "REQUIRED", "Provide at least one field to update.")
    locked = _is_locked(stage)
    if locked:
        if "label" in fields or "is_won" in fields or "is_lost" in fields:
            raise AppError(
                ErrorCode.CONFLICT,
                "The New stage is fixed for every project. You can only change its color.",
                409,
            )
        if "color" in fields and payload.color is not None:
            stage.color = payload.color
    else:
        if "label" in fields and payload.label is not None:
            stage.label = payload.label
        if "color" in fields and payload.color is not None:
            stage.color = payload.color
        if "is_won" in fields and payload.is_won is not None:
            stage.is_won = payload.is_won
        if "is_lost" in fields and payload.is_lost is not None:
            stage.is_lost = payload.is_lost
    stage.updated_at = datetime.now(UTC)
    record_audit(
        db,
        action="pipeline_stage_updated",
        actor_id=actor.id,
        target_type="pipeline_stage",
        target_id=stage.id,
        context={"fields": sorted(fields)},
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(stage)
    return stage


def reorder_stages(
    db: Session,
    actor: User,
    payload: ReorderPipelineStagesRequest,
    ip_address: str | None,
) -> PipelineStageListData:
    _require_manager(actor)
    accessible_project(db, actor, payload.project_id)
    ensure_default_stages(db, payload.project_id)
    stages = list(
        db.scalars(select(PipelineStage).where(PipelineStage.project_id == payload.project_id)).all()
    )
    by_id = {stage.id: stage for stage in stages}
    if set(payload.stage_ids) != set(by_id):
        raise _validation("stage_ids", "MISMATCH", "Send every stage id for this project exactly once.")
    entry = next((stage for stage in stages if _is_locked(stage)), None)
    if entry is not None and payload.stage_ids[0] != entry.id:
        raise _validation("stage_ids", "ENTRY_FIRST", "The New stage must stay first.")
    now = datetime.now(UTC)
    for index, stage_id in enumerate(payload.stage_ids, start=1):
        stage = by_id[stage_id]
        stage.sort_order = index
        stage.updated_at = now
    record_audit(
        db,
        action="pipeline_stages_reordered",
        actor_id=actor.id,
        target_type="project",
        target_id=payload.project_id,
        context={"order": [str(item) for item in payload.stage_ids]},
        ip_address=ip_address,
    )
    db.commit()
    return list_stages(db, actor, payload.project_id)


def delete_stage(
    db: Session,
    actor: User,
    stage_id: uuid.UUID,
    payload: DeletePipelineStageRequest | None,
    ip_address: str | None,
) -> uuid.UUID:
    _require_manager(actor)
    stage = db.get(PipelineStage, stage_id)
    if stage is None:
        raise _not_found()
    accessible_project(db, actor, stage.project_id)
    project_id = stage.project_id
    if _is_locked(stage):
        raise AppError(ErrorCode.CONFLICT, "The New stage cannot be removed.", 409)
    remaining = (
        db.scalar(
            select(func.count()).select_from(PipelineStage).where(
                PipelineStage.project_id == project_id,
                PipelineStage.id != stage.id,
            )
        )
        or 0
    )
    if remaining < 1:
        raise AppError(ErrorCode.CONFLICT, "Keep at least one pipeline stage.", 409)
    lead_count = (
        db.scalar(
            select(func.count()).select_from(Lead).where(
                Lead.project_id == project_id,
                Lead.is_deleted.is_(False),
                Lead.status == stage.key,
            )
        )
        or 0
    )
    move_key = None if payload is None else payload.move_to_stage_key
    if lead_count > 0:
        if not move_key:
            raise AppError(
                ErrorCode.CONFLICT,
                f"{lead_count} lead(s) still use this stage. Move them first or send move_to_stage_key.",
                409,
            )
        move_key = canonicalize_status(move_key)
        if move_key == stage.key:
            raise _validation("move_to_stage_key", "SAME_STAGE", "Choose a different stage.")
        target = db.scalar(
            select(PipelineStage).where(
                PipelineStage.project_id == project_id,
                PipelineStage.key == move_key,
            )
        )
        if target is None:
            raise _validation("move_to_stage_key", "UNKNOWN_STAGE", "Choose a valid pipeline stage.")
        db.execute(
            update(Lead)
            .where(
                Lead.project_id == project_id,
                Lead.is_deleted.is_(False),
                Lead.status == stage.key,
            )
            .values(status=move_key, updated_at=datetime.now(UTC))
        )
    db.delete(stage)
    record_audit(
        db,
        action="pipeline_stage_deleted",
        actor_id=actor.id,
        target_type="pipeline_stage",
        target_id=stage_id,
        context={"key": stage.key, "moved_to": move_key},
        ip_address=ip_address,
    )
    db.commit()
    return project_id
