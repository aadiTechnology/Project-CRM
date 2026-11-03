"""Manage per-project extra lead fields."""

import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit.service import record_audit
from app.common.exceptions import AppError, ErrorCode
from app.core.logging import log_event
from app.lead_fields.models import OPTION_TYPES, LeadField
from app.lead_fields.schemas import (
    COMMON_FIELDS,
    CreateLeadFieldRequest,
    LeadFieldListData,
    ReorderLeadFieldsRequest,
    UpdateLeadFieldRequest,
    is_valid_key,
    slug_key,
    to_lead_field_public,
)
from app.leads.models import Lead
from app.organization.models import ACTIVE, Project
from app.roles.service import RoleName
from app.team.service import project_ids_for_member
from app.users.models import User

logger = logging.getLogger("app.lead_fields")

_MANAGE_ROLES = frozenset({RoleName.BUSINESS_OWNER, RoleName.SALESPERSON})
_RESERVED_KEYS = frozenset(
    {
        "full_name",
        "mobile",
        "email",
        "company_name",
        "city",
        "address",
        "requirement",
        "expected_value",
        "lead_source",
        "status",
        "priority",
        "next_followup_at",
        "project_id",
        "owner_id",
        "alternate_mobile",
        "enquiry_date",
        "location",
        "reference",
        "call_summary",
        "callsummary",
        "site",
        "order_amount",
    }
)
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_URL_RE = re.compile(r"^https?://\S+$", re.I)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PHONE_RE = re.compile(r"^\+?[0-9][0-9\s\-()]{7,18}$")


def _role_names(user: User) -> set[str]:
    return {link.role.name for link in user.user_roles}


def _forbidden() -> AppError:
    return AppError(ErrorCode.FORBIDDEN, "You do not have permission to perform this action.", 403)


def _not_found(message: str = "Field not found.") -> AppError:
    return AppError(ErrorCode.NOT_FOUND, message, 404)


def _validation(field: str, code: str, message: str) -> AppError:
    return AppError(
        ErrorCode.VALIDATION_ERROR,
        message,
        422,
        details=[{"field": field, "code": code, "message": message}],
    )


def _require_manager(user: User) -> None:
    if not _role_names(user) & _MANAGE_ROLES:
        raise _forbidden()


def _accessible_project(db: Session, actor: User, project_id: uuid.UUID) -> Project:
    _require_manager(actor)
    project = db.get(Project, project_id)
    if project is None or project.status != ACTIVE:
        raise _validation("project_id", "UNKNOWN_PROJECT", "Choose a project.")
    if actor.company_id is None or project.company_id != actor.company_id:
        raise _validation("project_id", "UNKNOWN_PROJECT", "Choose a project.")
    member_ids = project_ids_for_member(db, actor.id)
    if project.id not in member_ids:
        raise _validation("project_id", "NOT_ASSIGNED", "You are not assigned to this project.")
    return project


def _unique_key(db: Session, project_id: uuid.UUID, label: str) -> str:
    base = slug_key(label)
    if base in _RESERVED_KEYS or not is_valid_key(base):
        base = "field"
    candidate = base
    index = 2
    while True:
        exists = db.scalar(
            select(LeadField.id).where(LeadField.project_id == project_id, LeadField.key == candidate)
        )
        if exists is None and candidate not in _RESERVED_KEYS:
            return candidate
        candidate = f"{base}_{index}"[:40]
        index += 1


def _normalize_label(label: str) -> str:
    return " ".join(label.split()).casefold()


def _common_label_taken(label: str) -> bool:
    target = _normalize_label(label)
    return any(_normalize_label(name) == target for name in COMMON_FIELDS)


def _label_taken(
    db: Session,
    project_id: uuid.UUID,
    label: str,
    *,
    excluding_id: uuid.UUID | None = None,
) -> bool:
    target = _normalize_label(label)
    rows = db.execute(
        select(LeadField.id, LeadField.label).where(LeadField.project_id == project_id)
    ).all()
    for field_id, existing_label in rows:
        if excluding_id is not None and field_id == excluding_id:
            continue
        if _normalize_label(str(existing_label)) == target:
            return True
    return False


def _assert_label_available(
    db: Session,
    project_id: uuid.UUID,
    label: str,
    *,
    excluding_id: uuid.UUID | None = None,
) -> None:
    if _common_label_taken(label):
        raise _validation(
            "label",
            "DUPLICATE",
            "This name is already used by a built-in lead column. Choose a different name.",
        )
    if _label_taken(db, project_id, label, excluding_id=excluding_id):
        raise _validation(
            "label",
            "DUPLICATE",
            "A field with this name already exists in this project. Choose a different name.",
        )


def _leads_with_data_counts(db: Session, project_id: uuid.UUID, keys: list[str]) -> dict[str, int]:
    if not keys:
        return {}
    counts: dict[str, int] = {key: 0 for key in keys}
    rows = db.scalars(
        select(Lead.extra_values).where(
            Lead.project_id == project_id,
            Lead.is_deleted.is_(False),
            Lead.extra_values.is_not(None),
        )
    ).all()
    key_set = set(keys)
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        for key, value in raw.items():
            if key in key_set and _value_present(value):
                counts[key] += 1
    return counts


def _value_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return True
    if isinstance(value, list):
        return len(value) > 0
    if isinstance(value, (int, float)):
        return True
    return str(value).strip() != ""


def list_fields(db: Session, actor: User, project_id: uuid.UUID) -> LeadFieldListData:
    project = _accessible_project(db, actor, project_id)
    fields = list(
        db.scalars(
            select(LeadField)
            .where(LeadField.project_id == project.id)
            .order_by(LeadField.sort_order.asc(), LeadField.created_at.asc())
        ).all()
    )
    counts = _leads_with_data_counts(db, project.id, [field.key for field in fields])
    return LeadFieldListData(
        project_id=str(project.id),
        project_name=project.name,
        project_code=project.code,
        common_fields=list(COMMON_FIELDS),
        items=[to_lead_field_public(field, counts.get(field.key, 0)) for field in fields],
    )


def create_field(
    db: Session,
    actor: User,
    payload: CreateLeadFieldRequest,
    ip_address: str | None,
) -> LeadField:
    project = _accessible_project(db, actor, payload.project_id)
    _assert_label_available(db, project.id, payload.label)
    max_order = db.scalar(
        select(func.coalesce(func.max(LeadField.sort_order), 0)).where(LeadField.project_id == project.id)
    )
    now = datetime.now(UTC)
    field = LeadField(
        project_id=project.id,
        key=_unique_key(db, project.id, payload.label),
        label=payload.label,
        field_type=payload.field_type,
        options=payload.options,
        is_required=payload.is_required,
        show_in_list=payload.show_in_list,
        show_as_column=payload.show_as_column,
        is_active=payload.is_active,
        sort_order=int(max_order or 0) + 1,
        created_at=now,
        updated_at=now,
    )
    db.add(field)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(ErrorCode.CONFLICT, "Field could not be saved.", 409) from None
    record_audit(
        db,
        action="lead_field_created",
        actor_id=actor.id,
        target_type="lead_field",
        target_id=field.id,
        context={"project_id": str(project.id), "key": field.key, "label": field.label},
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(field)
    log_event(logger, "lead_field_created", actor_id=str(actor.id), field_id=str(field.id))
    return field


def update_field(
    db: Session,
    actor: User,
    field_id: uuid.UUID,
    payload: UpdateLeadFieldRequest,
    ip_address: str | None,
) -> LeadField:
    fields_set = payload.model_fields_set
    if not fields_set:
        raise _validation("request", "REQUIRED", "Provide at least one field to update.")
    field = db.get(LeadField, field_id)
    if field is None:
        raise _not_found()
    _accessible_project(db, actor, field.project_id)
    counts = _leads_with_data_counts(db, field.project_id, [field.key])
    used = counts.get(field.key, 0)

    if "label" in fields_set and payload.label is not None:
        _assert_label_available(db, field.project_id, payload.label, excluding_id=field.id)
        field.label = payload.label
    if "field_type" in fields_set and payload.field_type is not None:
        if used > 0 and payload.field_type != field.field_type:
            raise _validation(
                "field_type",
                "LOCKED",
                "Field type is locked because leads already hold data for this field.",
            )
        field.field_type = payload.field_type
        if field.field_type not in OPTION_TYPES:
            field.options = None
    if "options" in fields_set:
        if field.field_type in OPTION_TYPES:
            if not payload.options:
                raise _validation("options", "REQUIRED", "Add at least one option for this field type.")
            field.options = payload.options
        else:
            field.options = None
    if "is_required" in fields_set and payload.is_required is not None:
        field.is_required = payload.is_required
    if "show_in_list" in fields_set and payload.show_in_list is not None:
        field.show_in_list = payload.show_in_list
    if "show_as_column" in fields_set and payload.show_as_column is not None:
        field.show_as_column = payload.show_as_column
    if "is_active" in fields_set and payload.is_active is not None:
        field.is_active = payload.is_active

    if field.field_type in OPTION_TYPES and not field.options:
        raise _validation("options", "REQUIRED", "Add at least one option for this field type.")

    field.updated_at = datetime.now(UTC)
    record_audit(
        db,
        action="lead_field_updated",
        actor_id=actor.id,
        target_type="lead_field",
        target_id=field.id,
        context={"project_id": str(field.project_id), "key": field.key, "fields": sorted(fields_set)},
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(field)
    log_event(logger, "lead_field_updated", actor_id=str(actor.id), field_id=str(field.id))
    return field


def delete_field(
    db: Session,
    actor: User,
    field_id: uuid.UUID,
    ip_address: str | None,
) -> uuid.UUID:
    field = db.get(LeadField, field_id)
    if field is None:
        raise _not_found()
    project = _accessible_project(db, actor, field.project_id)
    counts = _leads_with_data_counts(db, field.project_id, [field.key])
    used = counts.get(field.key, 0)
    if used > 0:
        raise AppError(
            ErrorCode.CONFLICT,
            (
                f'"{field.label}" holds data in {used} lead{"s" if used != 1 else ""}. '
                "Deleting would destroy that history, so deactivate it instead."
            ),
            409,
            details=[{"field": "field", "code": "HAS_DATA", "message": "Deactivate instead of delete."}],
        )
    label = field.label
    key = field.key
    project_id = project.id
    db.delete(field)
    record_audit(
        db,
        action="lead_field_deleted",
        actor_id=actor.id,
        target_type="lead_field",
        target_id=field_id,
        context={"project_id": str(project_id), "key": key, "label": label},
        ip_address=ip_address,
    )
    db.commit()
    log_event(logger, "lead_field_deleted", actor_id=str(actor.id), field_id=str(field_id))
    return project_id


def reorder_fields(
    db: Session,
    actor: User,
    payload: ReorderLeadFieldsRequest,
    ip_address: str | None,
) -> LeadFieldListData:
    project = _accessible_project(db, actor, payload.project_id)
    existing = list(db.scalars(select(LeadField).where(LeadField.project_id == project.id)).all())
    by_id = {field.id: field for field in existing}
    if set(payload.field_ids) != set(by_id):
        raise _validation("field_ids", "INVALID", "Send every field for this project, once.")
    now = datetime.now(UTC)
    for index, field_id in enumerate(payload.field_ids, start=1):
        field = by_id[field_id]
        field.sort_order = index
        field.updated_at = now
    record_audit(
        db,
        action="lead_fields_reordered",
        actor_id=actor.id,
        target_type="project",
        target_id=project.id,
        context={"field_ids": [str(item) for item in payload.field_ids]},
        ip_address=ip_address,
    )
    db.commit()
    return list_fields(db, actor, project.id)


def active_fields_for_project(db: Session, project_id: uuid.UUID) -> list[LeadField]:
    return list(
        db.scalars(
            select(LeadField)
            .where(LeadField.project_id == project_id, LeadField.is_active.is_(True))
            .order_by(LeadField.sort_order.asc(), LeadField.created_at.asc())
        ).all()
    )


def _coerce_value(field: LeadField, raw: Any) -> Any:
    path = f"extra_values.{field.key}"
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        if field.is_required:
            raise _validation(path, "REQUIRED", f"{field.label} is required.")
        return None

    if field.field_type == "check":
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str) and raw.lower() in {"1", "true", "yes", "on"}:
            return True
        if isinstance(raw, str) and raw.lower() in {"0", "false", "no", "off"}:
            return False
        raise _validation(path, "INVALID", f"{field.label} must be yes or no.")

    if field.field_type == "multi":
        values = raw if isinstance(raw, list) else [raw]
        cleaned = [_collapse_text(str(item)) for item in values]
        cleaned = [item for item in cleaned if item]
        options = set(field.options or [])
        if any(item not in options for item in cleaned):
            raise _validation(path, "INVALID", f"Choose a valid option for {field.label}.")
        if field.is_required and not cleaned:
            raise _validation(path, "REQUIRED", f"{field.label} is required.")
        return cleaned

    if field.field_type in {"select", "radio"}:
        value = _collapse_text(str(raw))
        if value not in set(field.options or []):
            raise _validation(path, "INVALID", f"Choose a valid option for {field.label}.")
        return value

    if field.field_type == "number":
        try:
            number = float(raw) if not isinstance(raw, (int, float)) else float(raw)
        except (TypeError, ValueError):
            raise _validation(path, "INVALID", f"{field.label} must be a number.") from None
        return number

    value = _collapse_text(str(raw))
    if field.field_type == "email" and _EMAIL_RE.fullmatch(value) is None:
        raise _validation(path, "INVALID", f"Enter a valid email for {field.label}.")
    if field.field_type == "phone":
        digits = "".join(character for character in value if character.isdigit())
        if _PHONE_RE.fullmatch(value) is None or not 8 <= len(digits) <= 15:
            raise _validation(path, "INVALID", f"Enter a valid phone for {field.label}.")
    if field.field_type == "url" and _URL_RE.fullmatch(value) is None:
        raise _validation(path, "INVALID", f"Enter a valid URL for {field.label}.")
    if field.field_type == "date" and _DATE_RE.fullmatch(value) is None:
        raise _validation(path, "INVALID", f"Enter a date (YYYY-MM-DD) for {field.label}.")
    if field.is_required and not value:
        raise _validation(path, "REQUIRED", f"{field.label} is required.")
    return value


def _collapse_text(value: str) -> str:
    return " ".join(value.split())


def normalize_extra_values(
    db: Session,
    project_id: uuid.UUID | None,
    raw: dict[str, Any] | None,
    *,
    require_required: bool,
) -> dict[str, Any]:
    """Validate and clean extra field values for a lead on a project."""

    if project_id is None:
        if raw:
            raise _validation("extra_values", "NO_PROJECT", "Choose a project before filling extra fields.")
        return {}
    definitions = active_fields_for_project(db, project_id)
    by_key = {field.key: field for field in definitions}
    incoming = raw or {}
    unknown = [key for key in incoming if key not in by_key]
    if unknown:
        raise _validation(
            f"extra_values.{unknown[0]}",
            "UNKNOWN_FIELD",
            "This field is not active on the selected project.",
        )
    cleaned: dict[str, Any] = {}
    for field in definitions:
        if field.key not in incoming:
            if require_required and field.is_required:
                raise _validation(f"extra_values.{field.key}", "REQUIRED", f"{field.label} is required.")
            continue
        value = _coerce_value(field, incoming[field.key])
        if value is None:
            continue
        if field.field_type == "check" and value is False and not field.is_required:
            cleaned[field.key] = False
            continue
        if _value_present(value) or (field.field_type == "check" and value is False):
            cleaned[field.key] = value
        elif require_required and field.is_required:
            raise _validation(f"extra_values.{field.key}", "REQUIRED", f"{field.label} is required.")
    return cleaned


def merge_extra_values(
    db: Session,
    project_id: uuid.UUID | None,
    current: dict[str, Any] | None,
    patch: dict[str, Any] | None,
    *,
    keys_set: set[str] | None,
) -> dict[str, Any]:
    """Merge a partial extra_values patch into the lead's stored map."""

    base = dict(current or {})
    if keys_set is None:
        return normalize_extra_values(db, project_id, patch, require_required=True)
    # Only replace keys that were sent; still validate required active fields against the result.
    definitions = active_fields_for_project(db, project_id) if project_id else []
    by_key = {field.key: field for field in definitions}
    for key in keys_set:
        if key not in by_key:
            raise _validation(f"extra_values.{key}", "UNKNOWN_FIELD", "This field is not active on the selected project.")
        value = _coerce_value(by_key[key], None if patch is None else patch.get(key))
        if value is None:
            base.pop(key, None)
        else:
            base[key] = value
    # Drop inactive keys that are no longer defined as active (keep historical inactive keys).
    for field in definitions:
        if field.is_required and field.key not in base:
            raise _validation(f"extra_values.{field.key}", "REQUIRED", f"{field.label} is required.")
    return base
