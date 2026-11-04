"""Create, update, and list projects. A lead number starts from the project short code."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit.service import record_audit
from app.common.exceptions import AppError, ErrorCode
from app.leads.models import Lead
from app.organization.models import ACTIVE, Company, Project
from app.projects.schemas import TEMPLATES, CreateProjectRequest, ProjectPublic, UpdateProjectRequest
from app.roles.service import RoleName
from app.team.service import ensure_project_owners, project_ids_for_member
from app.users.models import User

TEMPLATE_DESCRIPTION = {
    "GENERIC": "A simple project. Expected Value is the opportunity.",
    "HIRING": "Candidates. Recruitment Stage and Recruitment Outcome are tracked instead of a money value.",
    "PANEERWALA": "Paneer orders. Expected Value is the opportunity and Order Amount is the actual order.",
    "PRESCHOOL": "Admission enquiries. Expected Value is the opportunity amount.",
    "SPACE-VIEW": "Interior and space planning. Site is required, and Expected Value is the opportunity.",
}

_VIEW_ROLES = frozenset({RoleName.SUPER_ADMIN, RoleName.BUSINESS_OWNER, RoleName.SALESPERSON})


def _role_names(user: User) -> set[str]:
    return {link.role.name for link in user.user_roles}


def _forbidden() -> AppError:
    return AppError(ErrorCode.FORBIDDEN, "You do not have permission to perform this action.", 403)


def _validation(field: str, code: str, message: str) -> AppError:
    return AppError(
        ErrorCode.VALIDATION_ERROR,
        message,
        422,
        details=[{"field": field, "code": code, "message": message}],
    )


def can_create_projects(user: User) -> bool:
    return RoleName.SUPER_ADMIN in _role_names(user)


def _require_viewer(user: User) -> None:
    if not _role_names(user) & _VIEW_ROLES:
        raise _forbidden()


def _next_number(code: str, lead_count: int) -> str:
    return f"{code}-{lead_count + 1:04d}"


def _to_public(project: Project, company_name: str, lead_count: int) -> ProjectPublic:
    return ProjectPublic(
        id=str(project.id),
        company_id=str(project.company_id),
        company_name=company_name,
        name=project.name,
        code=project.code,
        template=project.template,
        description=project.description,
        status=project.status,
        lead_count=lead_count,
        next_lead_number=_next_number(project.code, lead_count),
    )


def list_projects(db: Session, actor: User) -> tuple[list[ProjectPublic], list[Company]]:
    _require_viewer(actor)
    roles = _role_names(actor)
    stmt = select(Project, Company.name).join(Company, Company.id == Project.company_id)
    # Super Admin keeps inactive projects so they can be edited back to active.
    if not can_create_projects(actor):
        stmt = stmt.where(Project.status == ACTIVE)

    if can_create_projects(actor):
        pass
    elif RoleName.BUSINESS_OWNER in roles or RoleName.SALESPERSON in roles:
        if actor.company_id is None:
            return [], []
        member_ids = project_ids_for_member(db, actor.id)
        if not member_ids:
            return [], []
        stmt = stmt.where(Project.company_id == actor.company_id, Project.id.in_(member_ids))
    else:
        return [], []

    rows = db.execute(stmt.order_by(Company.name, Project.name)).all()
    project_ids = [project.id for project, _name in rows]
    counts: dict[uuid.UUID, int] = {}
    if project_ids:
        count_rows = db.execute(
            select(Lead.project_id, func.count())
            .where(Lead.project_id.in_(project_ids), Lead.is_deleted.is_(False))
            .group_by(Lead.project_id)
        ).all()
        counts = {project_id: int(total) for project_id, total in count_rows if project_id is not None}
    projects = [_to_public(project, company_name, counts.get(project.id, 0)) for project, company_name in rows]
    if not can_create_projects(actor):
        return projects, []
    companies = list(
        db.scalars(select(Company).where(Company.status == ACTIVE).order_by(Company.name)).all()
    )
    return projects, companies


def create_project(
    db: Session,
    actor: User,
    payload: CreateProjectRequest,
    ip_address: str | None,
) -> ProjectPublic:
    if not can_create_projects(actor):
        raise _forbidden()
    if payload.template not in TEMPLATES:
        raise _validation("template", "INVALID", "Choose a template.")
    company = db.get(Company, payload.company_id)
    if company is None:
        raise _validation("company_id", "UNKNOWN_COMPANY", "Choose a business.")
    if company.status != ACTIVE:
        raise _validation("company_id", "INACTIVE_COMPANY", "This business is not active.")
    now = datetime.now(UTC)
    project = Project(
        company_id=company.id,
        name=payload.name,
        code=payload.code,
        template=payload.template,
        description=TEMPLATE_DESCRIPTION[payload.template],
        status=ACTIVE,
        created_at=now,
        updated_at=now,
    )
    db.add(project)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise _validation(
            "code",
            "DUPLICATE_CODE",
            "This business already has a project with that short code.",
        ) from exc
    ensure_project_owners(db, project, actor.id)
    record_audit(
        db,
        action="project_created",
        actor_id=actor.id,
        target_type="project",
        target_id=project.id,
        context={"code": project.code, "company_id": str(company.id)},
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(project)
    return _to_public(project, company.name, 0)


def update_project(
    db: Session,
    actor: User,
    project_id: uuid.UUID,
    payload: UpdateProjectRequest,
    ip_address: str | None,
) -> ProjectPublic:
    if not can_create_projects(actor):
        raise _forbidden()
    project = db.get(Project, project_id)
    if project is None:
        raise AppError(ErrorCode.NOT_FOUND, "Project not found.", 404)
    company = db.get(Company, project.company_id)
    if company is None:
        raise AppError(ErrorCode.NOT_FOUND, "Project not found.", 404)
    before = {"name": project.name, "description": project.description, "status": project.status}
    project.name = payload.name
    project.description = payload.description
    project.status = payload.status
    project.updated_at = datetime.now(UTC)
    lead_count = db.scalar(
        select(func.count()).select_from(Lead).where(Lead.project_id == project.id, Lead.is_deleted.is_(False))
    ) or 0
    record_audit(
        db,
        action="project_updated",
        actor_id=actor.id,
        target_type="project",
        target_id=project.id,
        context={"before": before, "after": {"name": project.name, "description": project.description, "status": project.status}},
        ip_address=ip_address,
    )
    db.commit()
    db.refresh(project)
    return _to_public(project, company.name, int(lead_count))


def delete_project(
    db: Session,
    actor: User,
    project_id: uuid.UUID,
    ip_address: str | None,
) -> str:
    if not can_create_projects(actor):
        raise _forbidden()
    project = db.get(Project, project_id)
    if project is None:
        raise AppError(ErrorCode.NOT_FOUND, "Project not found.", 404)
    lead_count = db.scalar(select(func.count()).select_from(Lead).where(Lead.project_id == project.id)) or 0
    if int(lead_count) > 0:
        raise AppError(
            ErrorCode.CONFLICT,
            "This project still has leads. Mark it inactive instead of deleting it.",
            409,
        )
    name = project.name
    record_audit(
        db,
        action="project_deleted",
        actor_id=actor.id,
        target_type="project",
        target_id=project.id,
        context={"name": name, "code": project.code},
        ip_address=ip_address,
    )
    db.delete(project)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(
            ErrorCode.CONFLICT,
            "This project still has leads. Mark it inactive instead of deleting it.",
            409,
        ) from exc
    return name
