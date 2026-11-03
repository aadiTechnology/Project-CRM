"""Project list and creation."""

import uuid
from datetime import UTC, datetime

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.organization.models import ACTIVE, Company
from app.roles.models import UserRole
from app.roles.service import get_role_by_name
from app.users.models import User

from tests.helpers import VALID_PASSWORD, csrf_headers, login


def _now() -> datetime:
    return datetime.now(UTC)


def _add_company(name: str, *, status: str = ACTIVE) -> uuid.UUID:
    db = SessionLocal()
    try:
        company = Company(name=name, status=status, created_at=_now(), updated_at=_now())
        db.add(company)
        db.commit()
        return company.id
    finally:
        db.close()


def _add_member(email: str, role_name: str, company_id: uuid.UUID | None = None) -> None:
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
    finally:
        db.close()


async def test_super_admin_creates_a_project_and_owner_can_see_it(client):
    company_id = _add_company("Little Steps")
    _add_member("platform@example.com", "SUPER_ADMIN")
    _add_member("owner@example.com", "BUSINESS_OWNER", company_id)
    _add_member("rep@example.com", "SALESPERSON", company_id)

    assert (await login(client, email="platform@example.com")).status_code == 200
    created = await client.post(
        "/api/v1/projects",
        json={
            "name": "Preschool",
            "code": "preschool",
            "company_id": str(company_id),
            "template": "PRESCHOOL",
        },
        headers=await csrf_headers(client),
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["message"].startswith("Preschool is created")
    item = next(project for project in body["data"]["items"] if project["code"] == "PRESCHOOL")
    assert item["company_name"] == "Little Steps"
    assert item["next_lead_number"] == "PRESCHOOL-0001"
    assert item["status"] == "active"
    assert body["data"]["can_create"] is True

    duplicate = await client.post(
        "/api/v1/projects",
        json={"name": "Preschool again", "code": "PRESCHOOL", "company_id": str(company_id), "template": "GENERIC"},
        headers=await csrf_headers(client),
    )
    assert duplicate.status_code == 422
    assert duplicate.json()["error"]["details"][0]["field"] == "code"

    assert (await login(client, email="owner@example.com")).status_code == 200
    listed = await client.get("/api/v1/projects")
    assert listed.status_code == 200
    owner_body = listed.json()["data"]
    assert owner_body["can_create"] is False
    assert owner_body["companies"] == []
    assert [project["code"] for project in owner_body["items"]] == ["PRESCHOOL"]

    blocked = await client.post(
        "/api/v1/projects",
        json={"name": "Other", "code": "OTHER", "company_id": str(company_id), "template": "GENERIC"},
        headers=await csrf_headers(client),
    )
    assert blocked.status_code == 403

    assert (await login(client, email="rep@example.com")).status_code == 200
    # Salesperson with no Team assignment sees an empty project list.
    listed_rep = await client.get("/api/v1/projects")
    assert listed_rep.status_code == 200
    assert listed_rep.json()["data"]["items"] == []
    assert listed_rep.json()["data"]["can_create"] is False


async def test_super_admin_edits_a_project_and_owner_cannot(client):
    company_id = _add_company("North Campus")
    _add_member("editor@example.com", "SUPER_ADMIN")
    _add_member("campus-owner@example.com", "BUSINESS_OWNER", company_id)

    assert (await login(client, email="editor@example.com")).status_code == 200
    created = await client.post(
        "/api/v1/projects",
        json={"name": "Admissions", "code": "ADMIT", "company_id": str(company_id), "template": "GENERIC"},
        headers=await csrf_headers(client),
    )
    assert created.status_code == 200, created.text
    project_id = next(item["id"] for item in created.json()["data"]["items"] if item["code"] == "ADMIT")

    updated = await client.patch(
        f"/api/v1/projects/{project_id}",
        json={"name": "Admissions 2026", "description": "Autumn intake", "status": "inactive"},
        headers=await csrf_headers(client),
    )
    assert updated.status_code == 200, updated.text
    item = next(project for project in updated.json()["data"]["items"] if project["id"] == project_id)
    assert item["name"] == "Admissions 2026"
    assert item["description"] == "Autumn intake"
    assert item["status"] == "inactive"
    assert item["code"] == "ADMIT"
    assert updated.json()["message"] == "Admissions 2026 is updated."

    assert (await login(client, email="campus-owner@example.com")).status_code == 200
    hidden = await client.get("/api/v1/projects")
    assert hidden.status_code == 200
    assert hidden.json()["data"]["items"] == []
    blocked = await client.patch(
        f"/api/v1/projects/{project_id}",
        json={"name": "Nope", "description": "", "status": "active"},
        headers=await csrf_headers(client),
    )
    assert blocked.status_code == 403

    assert (await login(client, email="editor@example.com")).status_code == 200
    restored = await client.patch(
        f"/api/v1/projects/{project_id}",
        json={"name": "Admissions 2026", "description": "Autumn intake", "status": "active"},
        headers=await csrf_headers(client),
    )
    assert restored.status_code == 200, restored.text
    assert (await login(client, email="campus-owner@example.com")).status_code == 200
    visible = await client.get("/api/v1/projects")
    assert [project["code"] for project in visible.json()["data"]["items"]] == ["ADMIT"]
