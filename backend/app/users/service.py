"""Access-management use cases. These never trust a caller-supplied role for self-service."""

import logging
import re
import uuid
from datetime import UTC, datetime

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit.service import record_audit
from app.auth.tokens import revoke_all_refresh_tokens
from app.common.exceptions import AppError, ErrorCode
from app.core.logging import log_event
from app.core.password_policy import password_rule_failures
from app.core.security import hash_password
from app.organization.models import ACTIVE, Company, Team
from app.permissions.service import get_permission_keys
from app.roles.models import Role, UserRole
from app.roles.service import RoleName, get_role_by_name
from app.users.models import User
from app.users.schemas import CreateUserRequest, UpdateManagedUserRequest

logger = logging.getLogger("app.users")
_ROLE_NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,49}$")


def list_users(
    db: Session,
    *,
    limit: int,
    offset: int,
    company_id: uuid.UUID | None = None,
    company_scoped: bool = False,
) -> tuple[list[User], int]:
    """List accounts. company_scoped limits the result to one company.

    A scoped caller with no company sees no accounts. Platform administrators
    keep the unscoped list.
    """

    if company_scoped and company_id is None:
        return [], 0
    filters = [User.company_id == company_id] if company_scoped else []
    total = int(db.scalar(select(func.count()).select_from(User).where(*filters)) or 0)
    stmt = select(User).where(*filters).order_by(User.full_name, User.email).limit(limit).offset(offset)
    return list(db.scalars(stmt).all()), total


def company_names_for_users(db: Session, users: list[User]) -> dict[uuid.UUID, str]:
    ids = {user.company_id for user in users if user.company_id is not None}
    if not ids:
        return {}
    rows = db.scalars(select(Company).where(Company.id.in_(ids))).all()
    return {company.id: company.name for company in rows}


def list_active_companies(db: Session) -> list[Company]:
    return list(db.scalars(select(Company).where(Company.status == ACTIVE).order_by(Company.name)).all())


def is_platform_admin(user: User) -> bool:
    return any(link.role.name == RoleName.SUPER_ADMIN for link in user.user_roles)


def _active_admin_count(db: Session) -> int:
    stmt = (
        select(func.count(User.id))
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(Role.name == RoleName.SUPER_ADMIN, User.is_active.is_(True))
    )
    return int(db.scalar(stmt) or 0)


def _is_active_admin(user: User) -> bool:
    return user.is_active and any(link.role.name == RoleName.SUPER_ADMIN for link in user.user_roles)


def _reject_self(actor: User, target: User) -> None:
    if actor.id == target.id:
        raise AppError(
            ErrorCode.CANNOT_MODIFY_OWN_ACCESS,
            "You cannot change your own access.",
            403,
        )


def change_user_role(
    db: Session,
    *,
    actor: User,
    target_id: uuid.UUID,
    role_name: str,
    ip_address: str | None,
) -> User:
    normalized = role_name.strip().upper()
    if _ROLE_NAME.fullmatch(normalized) is None:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "Unknown role.",
            422,
            details=[{"field": "role", "code": "UNKNOWN_ROLE", "message": "Unknown role."}],
        )
    target = db.get(User, target_id)
    if target is None:
        raise AppError(ErrorCode.NOT_FOUND, "User not found.", 404)
    _reject_self(actor, target)
    role = get_role_by_name(db, normalized)
    if role is None:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "Unknown role.",
            422,
            details=[{"field": "role", "code": "UNKNOWN_ROLE", "message": "Unknown role."}],
        )
    actor_is_admin = any(link.role.name == RoleName.SUPER_ADMIN for link in actor.user_roles)
    if role.name == RoleName.SUPER_ADMIN and not actor_is_admin:
        raise AppError(
            ErrorCode.FORBIDDEN,
            "You do not have permission to perform this action.",
            403,
        )
    if _is_active_admin(target) and role.name != RoleName.SUPER_ADMIN and _active_admin_count(db) <= 1:
        raise AppError(
            ErrorCode.LAST_ADMIN,
            "The last active administrator cannot be changed.",
            409,
        )
    previous = sorted(link.role.name for link in target.user_roles)
    now = datetime.now(UTC)
    db.execute(delete(UserRole).where(UserRole.user_id == target.id))
    db.add(UserRole(user_id=target.id, role_id=role.id, created_at=now))
    target.updated_at = now
    record_audit(
        db,
        action="role_changed",
        actor_id=actor.id,
        target_type="user",
        target_id=target.id,
        context={"from": previous, "to": [role.name]},
        ip_address=ip_address,
    )
    db.commit()
    db.expire(target, ["user_roles"])
    log_event(logger, "role_changed", actor_id=str(actor.id), target_id=str(target.id), role=role.name)
    return target


def set_user_active(
    db: Session,
    *,
    actor: User,
    target_id: uuid.UUID,
    is_active: bool,
    ip_address: str | None,
) -> User:
    target = db.get(User, target_id)
    if target is None:
        raise AppError(ErrorCode.NOT_FOUND, "User not found.", 404)
    _reject_self(actor, target)
    if (
        not is_active
        and _is_active_admin(target)
        and _active_admin_count(db) <= 1
    ):
        raise AppError(
            ErrorCode.LAST_ADMIN,
            "The last active administrator cannot be changed.",
            409,
        )
    now = datetime.now(UTC)
    target.is_active = is_active
    target.updated_at = now
    if not is_active:
        target.session_version += 1
        revoke_all_refresh_tokens(db, target.id, now)
    action = "user_activated" if is_active else "user_deactivated"
    record_audit(
        db,
        action=action,
        actor_id=actor.id,
        target_type="user",
        target_id=target.id,
        context={"is_active": is_active},
        ip_address=ip_address,
    )
    db.commit()
    log_event(logger, action, actor_id=str(actor.id), target_id=str(target.id))
    return target


def create_initial_admin(
    db: Session,
    *,
    email: str,
    full_name: str,
    password: str,
    preferred_language: str,
) -> User:
    cleaned_name = " ".join(full_name.split())
    if len(cleaned_name) < 2:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Full name must be at least 2 characters.", 422)
    try:
        normalized_email = validate_email(email, check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise AppError(ErrorCode.VALIDATION_ERROR, "Enter a valid email address.", 422) from None
    failures = password_rule_failures(password)
    if failures:
        raise AppError(ErrorCode.VALIDATION_ERROR, failures[0].message, 422)
    if _active_admin_count(db) > 0:
        raise AppError(
            ErrorCode.CONFLICT,
            "An administrator already exists. Manage roles from the admin access screen.",
            409,
        )
    admin_role = get_role_by_name(db, RoleName.SUPER_ADMIN)
    if admin_role is None:
        raise AppError(ErrorCode.INTERNAL_ERROR, "Administrator role is not configured.", 500)
    if db.scalar(select(User).where(User.email == normalized_email)) is not None:
        raise AppError(ErrorCode.EMAIL_ALREADY_EXISTS, "An account with this email already exists.", 409)
    now = datetime.now(UTC)
    user = User(
        email=normalized_email,
        password_hash=hash_password(password),
        full_name=cleaned_name,
        preferred_language=preferred_language,
        is_active=True,
        email_verified=True,
        session_version=1,
        created_at=now,
        updated_at=now,
    )
    user.user_roles.append(UserRole(role=admin_role, created_at=now))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError(
            ErrorCode.EMAIL_ALREADY_EXISTS,
            "An account with this email already exists.",
            409,
        ) from None
    log_event(logger, "initial_admin_created", user_id=str(user.id))
    return user


def _validation(field: str, code: str, message: str) -> AppError:
    return AppError(
        ErrorCode.VALIDATION_ERROR,
        message,
        422,
        details=[{"field": field, "code": code, "message": message}],
    )


def _password_error(password: str) -> None:
    failures = password_rule_failures(password)
    if not failures:
        return
    raise AppError(
        ErrorCode.VALIDATION_ERROR,
        "Password does not meet the password policy.",
        422,
        details=[
            {"field": "password", "code": failure.code, "message": failure.message} for failure in failures
        ],
    )


def _role_or_error(db: Session, role_name: str) -> Role:
    normalized = role_name.strip().upper()
    if _ROLE_NAME.fullmatch(normalized) is None:
        raise _validation("role", "UNKNOWN_ROLE", "Unknown role.")
    role = get_role_by_name(db, normalized)
    if role is None:
        raise _validation("role", "UNKNOWN_ROLE", "Unknown role.")
    return role


def _load_company(db: Session, company_id: uuid.UUID) -> Company:
    company = db.get(Company, company_id)
    if company is None:
        raise _validation("company_id", "UNKNOWN_COMPANY", "Company not found.")
    if company.status != "active":
        raise _validation("company_id", "INACTIVE_COMPANY", "Company is not active.")
    return company


def _load_team(db: Session, team_id: uuid.UUID, company_id: uuid.UUID | None) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise _validation("team_id", "UNKNOWN_TEAM", "Team not found.")
    if team.status != "active":
        raise _validation("team_id", "INACTIVE_TEAM", "Team is not active.")
    if company_id is not None and team.company_id != company_id:
        raise _validation("team_id", "TEAM_COMPANY_MISMATCH", "Team does not belong to this company.")
    return team


def _assert_manager(
    db: Session,
    manager_id: uuid.UUID,
    company_id: uuid.UUID | None,
    target_id: uuid.UUID | None,
) -> None:
    if target_id is not None and manager_id == target_id:
        raise _validation("manager_id", "INVALID_MANAGER", "A user cannot be their own manager.")
    manager = db.get(User, manager_id)
    if manager is None:
        raise _validation("manager_id", "UNKNOWN_MANAGER", "Manager not found.")
    if manager.company_id != company_id:
        raise _validation("manager_id", "MANAGER_COMPANY_MISMATCH", "Manager must belong to the same company.")


def _company_for_create(
    db: Session,
    actor: User,
    company_id: uuid.UUID | None,
    team_id: uuid.UUID | None,
) -> uuid.UUID | None:
    if not is_platform_admin(actor):
        if actor.company_id is None:
            raise AppError(ErrorCode.FORBIDDEN, "You do not have permission to perform this action.", 403)
        if company_id is not None and company_id != actor.company_id:
            raise AppError(ErrorCode.FORBIDDEN, "You do not have permission to perform this action.", 403)
        company_id = actor.company_id
    if team_id is not None:
        team = _load_team(db, team_id, company_id)
        if company_id is None:
            company_id = team.company_id
        _load_company(db, company_id)
        return company_id
    if company_id is not None:
        _load_company(db, company_id)
    return company_id


def _visible_to_actor(actor: User, target: User) -> bool:
    if is_platform_admin(actor):
        return True
    if actor.company_id is None or target.company_id != actor.company_id:
        return False
    return not any(link.role.name == RoleName.SUPER_ADMIN for link in target.user_roles)


def _managed_user(db: Session, actor: User, target_id: uuid.UUID) -> User:
    target = db.get(User, target_id)
    if target is None or not _visible_to_actor(actor, target):
        raise AppError(ErrorCode.NOT_FOUND, "User not found.", 404)
    return target


def create_managed_user(
    db: Session,
    *,
    actor: User,
    payload: CreateUserRequest,
    ip_address: str | None,
) -> User:
    _password_error(payload.password)
    role = _role_or_error(db, payload.role)
    if role.name == RoleName.SUPER_ADMIN and not is_platform_admin(actor):
        raise AppError(ErrorCode.FORBIDDEN, "You do not have permission to perform this action.", 403)
    company_id = _company_for_create(db, actor, payload.company_id, payload.team_id)
    if payload.manager_id is not None:
        _assert_manager(db, payload.manager_id, company_id, None)
    if db.scalar(select(User).where(User.email == payload.email)) is not None:
        raise AppError(ErrorCode.EMAIL_ALREADY_EXISTS, "An account with this email already exists.", 409)
    now = datetime.now(UTC)
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        preferred_language=payload.preferred_language,
        is_active=payload.is_active,
        email_verified=False,
        session_version=1,
        company_id=company_id,
        team_id=payload.team_id,
        manager_id=payload.manager_id,
        created_at=now,
        updated_at=now,
    )
    user.user_roles.append(UserRole(role=role, created_at=now))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(
            ErrorCode.EMAIL_ALREADY_EXISTS,
            "An account with this email already exists.",
            409,
        ) from None
    record_audit(
        db,
        action="user_created",
        actor_id=actor.id,
        target_type="user",
        target_id=user.id,
        context={
            "role": role.name,
            "company_id": None if company_id is None else str(company_id),
            "team_id": None if payload.team_id is None else str(payload.team_id),
            "manager_id": None if payload.manager_id is None else str(payload.manager_id),
            "is_active": payload.is_active,
        },
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(user)
    log_event(logger, "user_created", actor_id=str(actor.id), target_id=str(user.id), role=role.name)
    return user


def update_managed_user(
    db: Session,
    *,
    actor: User,
    target_id: uuid.UUID,
    payload: UpdateManagedUserRequest,
    ip_address: str | None,
) -> User:
    fields = payload.model_fields_set
    if not fields:
        raise _validation("request", "REQUIRED", "Provide at least one field to update.")
    if "role" in fields and not payload.role:
        raise _validation("role", "REQUIRED", "Role is required.")
    if "is_active" in fields and payload.is_active is None:
        raise _validation("is_active", "REQUIRED", "Status is required.")
    target = _managed_user(db, actor, target_id)
    _reject_self(actor, target)

    new_role: Role | None = None
    if "role" in fields:
        if "roles.assign" not in get_permission_keys(db, actor.id):
            raise AppError(ErrorCode.FORBIDDEN, "You do not have permission to perform this action.", 403)
        new_role = _role_or_error(db, payload.role or "")
        if new_role.name == RoleName.SUPER_ADMIN and not is_platform_admin(actor):
            raise AppError(ErrorCode.FORBIDDEN, "You do not have permission to perform this action.", 403)

    removes_last_admin = False
    if _is_active_admin(target) and _active_admin_count(db) <= 1:
        if new_role is not None and new_role.name != RoleName.SUPER_ADMIN:
            removes_last_admin = True
        if "is_active" in fields and payload.is_active is False:
            removes_last_admin = True
    if removes_last_admin:
        raise AppError(ErrorCode.LAST_ADMIN, "The last active administrator cannot be changed.", 409)

    now = datetime.now(UTC)
    company_id = target.company_id
    changed: dict[str, object] = {}
    if "team_id" in fields:
        if payload.team_id is None:
            target.team_id = None
        else:
            team = _load_team(db, payload.team_id, company_id)
            if company_id is None:
                if not is_platform_admin(actor) and team.company_id != actor.company_id:
                    raise AppError(
                        ErrorCode.FORBIDDEN,
                        "You do not have permission to perform this action.",
                        403,
                    )
                _load_company(db, team.company_id)
                target.company_id = team.company_id
                company_id = team.company_id
            target.team_id = team.id
        changed["team_id"] = None if target.team_id is None else str(target.team_id)
    if "manager_id" in fields:
        if payload.manager_id is not None:
            _assert_manager(db, payload.manager_id, company_id, target.id)
        target.manager_id = payload.manager_id
        changed["manager_id"] = None if target.manager_id is None else str(target.manager_id)
    if new_role is not None:
        db.execute(delete(UserRole).where(UserRole.user_id == target.id))
        db.add(UserRole(user_id=target.id, role_id=new_role.id, created_at=now))
        changed["role"] = new_role.name
    if "is_active" in fields and payload.is_active is not None:
        if payload.is_active is False and target.is_active:
            target.session_version += 1
            revoke_all_refresh_tokens(db, target.id, now)
        target.is_active = payload.is_active
        changed["is_active"] = payload.is_active
    target.updated_at = now
    record_audit(
        db,
        action="user_updated",
        actor_id=actor.id,
        target_type="user",
        target_id=target.id,
        context=changed,
        ip_address=ip_address,
    )
    db.commit()
    db.expire(target, ["user_roles"])
    log_event(logger, "user_updated", actor_id=str(actor.id), target_id=str(target.id))
    return target


def deactivate_managed_user(
    db: Session,
    *,
    actor: User,
    target_id: uuid.UUID,
    ip_address: str | None,
) -> User:
    target = _managed_user(db, actor, target_id)
    return set_user_active(
        db,
        actor=actor,
        target_id=target.id,
        is_active=False,
        ip_address=ip_address,
    )


def delete_managed_user(
    db: Session,
    *,
    actor: User,
    target_id: uuid.UUID,
    ip_address: str | None,
) -> User:
    """Remove the account so it disappears from the user list.

    Leads they own or created are handed to the person who deletes them.
    The account row is not kept.
    """

    from app.leads.models import Lead

    target = _managed_user(db, actor, target_id)
    _reject_self(actor, target)
    if _is_active_admin(target) and _active_admin_count(db) <= 1:
        raise AppError(
            ErrorCode.LAST_ADMIN,
            "The last active administrator cannot be changed.",
            409,
        )
    now = datetime.now(UTC)
    db.execute(
        update(Lead)
        .where(Lead.owner_id == target.id)
        .values(owner_id=actor.id, updated_at=now)
    )
    db.execute(
        update(Lead)
        .where(Lead.created_by_id == target.id)
        .values(created_by_id=actor.id, updated_at=now)
    )
    db.execute(update(User).where(User.manager_id == target.id).values(manager_id=None))
    revoke_all_refresh_tokens(db, target.id, now)
    record_audit(
        db,
        action="user_deleted",
        actor_id=actor.id,
        target_type="user",
        target_id=target.id,
        context={"email": target.email, "full_name": target.full_name},
        ip_address=ip_address,
    )
    db.delete(target)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(
            ErrorCode.CONFLICT,
            "This user could not be deleted because other records still use the account.",
            409,
        ) from exc
    log_event(logger, "user_deleted", actor_id=str(actor.id), target_id=str(target_id))
    return target
