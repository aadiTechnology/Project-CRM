"""Dashboard numbers stay inside the caller's role."""

import uuid
from datetime import UTC, datetime

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.organization.models import ACTIVE, Company, Project, ProjectMember
from app.roles.models import UserRole
from app.roles.service import get_role_by_name
from app.users.models import User

from tests.helpers import VALID_PASSWORD, csrf_headers, login


def _now() -> datetime:
    return datetime.now(UTC)


def _add_company(name: str) -> uuid.UUID:
    db = SessionLocal()
    try:
        company = Company(name=name, status=ACTIVE, created_at=_now(), updated_at=_now())
        db.add(company)
        db.commit()
        return company.id
    finally:
        db.close()


def _add_member(email: str, role_name: str, company_id: uuid.UUID | None = None) -> uuid.UUID:
    db = SessionLocal()
    try:
        role = get_role_by_name(db, role_name)
        assert role is not None
        now = _now()
        user = User(
            email=email,
            password_hash=hash_password(VALID_PASSWORD),
            full_name=email.split("@", 1)[0],
            preferred_language="en",
            is_active=True,
            email_verified=True,
            session_version=1,
            company_id=company_id,
            created_at=now,
            updated_at=now,
        )
        user.user_roles.append(UserRole(role=role, created_at=now))
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


def _add_project(company_id: uuid.UUID, member_ids: list[uuid.UUID]) -> uuid.UUID:
    db = SessionLocal()
    try:
        now = _now()
        project = Project(
            company_id=company_id,
            name="Hiring",
            code="HIRING",
            template="GENERIC",
            description="Dashboard test",
            status=ACTIVE,
            created_at=now,
            updated_at=now,
        )
        db.add(project)
        db.flush()
        for user_id in member_ids:
            db.add(ProjectMember(project_id=project.id, user_id=user_id, assigned_by_id=None, created_at=now))
        db.commit()
        return project.id
    finally:
        db.close()


async def test_dashboard_changes_with_role(client):
    company_id = _add_company("Dashboard Co")
    _add_member("dash-admin@example.com", "SUPER_ADMIN")
    owner_id = _add_member("dash-owner@example.com", "BUSINESS_OWNER", company_id)
    rep_id = _add_member("dash-rep@example.com", "SALESPERSON", company_id)
    project_id = _add_project(company_id, [owner_id, rep_id])

    assert (await login(client, email="dash-rep@example.com")).status_code == 200
    created = await client.post(
        "/api/v1/leads",
        json={
            "full_name": "Dashboard Lead",
            "mobile": "9876501234",
            "project_id": str(project_id),
            "lead_source": "Website",
            "next_followup_at": "2026-11-06T10:30:00Z",
        },
        headers=await csrf_headers(client),
    )
    assert created.status_code == 201, created.text

    mine = await client.get(f"/api/v1/kpis?project_id={project_id}")
    assert mine.status_code == 200, mine.text
    mine_body = mine.json()["data"]
    assert mine_body["role"] == "salesperson"
    assert mine_body["view"] == "mine"
    assert mine_body["people"] == []
    assert mine_body["money"] is None
    leads = next(card for card in mine_body["cards"] if card["key"] == "still_new")
    assert leads["value"] == "1"

    assert (await login(client, email="dash-owner@example.com")).status_code == 200
    team = await client.get(f"/api/v1/kpis?project_id={project_id}")
    assert team.status_code == 200, team.text
    team_body = team.json()["data"]
    assert team_body["role"] == "owner"
    assert team_body["view"] == "project"
    assert [row["name"] for row in team_body["people"]] == ["dash-rep"]
    assert team_body["people"][0]["leads"] == 1

    one = await client.get(f"/api/v1/kpis?project_id={project_id}&user_id={rep_id}")
    assert one.status_code == 200, one.text
    one_body = one.json()["data"]
    assert one_body["view"] == "mine"
    assert one_body["subtitle"].startswith("dash-rep")
    assert next(card for card in one_body["cards"] if card["key"] == "still_new")["value"] == "1"

    assert (await login(client, email="dash-admin@example.com")).status_code == 200
    businesses = await client.get("/api/v1/kpis")
    assert businesses.status_code == 200, businesses.text
    admin_body = businesses.json()["data"]
    assert admin_body["role"] == "admin"
    assert admin_body["view"] == "businesses"
    assert any(row["name"] == "Dashboard Co" for row in admin_body["businesses"])
    assert admin_body["money"] is None
