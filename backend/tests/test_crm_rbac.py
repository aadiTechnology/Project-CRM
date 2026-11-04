"""CRM company scope, roles, and admin user management."""

import uuid
from datetime import UTC, datetime

from app.access.scope import AccessScope, record_is_in_scope, resolve_access_scope, resolve_record_scope
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.organization.models import ACTIVE, Company, Team
from app.roles.models import UserRole
from app.roles.service import get_role_by_name
from app.users.models import User
from sqlalchemy import select

from tests.helpers import VALID_PASSWORD, assign_role, csrf_headers, login, register_student

PENDING_MESSAGE = (
    "Registration received. An administrator must approve this account before you can sign in."
)


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


def _add_team(company_id: uuid.UUID, name: str) -> uuid.UUID:
    db = SessionLocal()
    try:
        team = Team(
            company_id=company_id,
            name=name,
            status=ACTIVE,
            created_at=_now(),
            updated_at=_now(),
        )
        db.add(team)
        db.commit()
        return team.id
    finally:
        db.close()


def _add_member(
    email: str,
    role_name: str,
    *,
    company_id: uuid.UUID | None = None,
    team_id: uuid.UUID | None = None,
    manager_id: uuid.UUID | None = None,
) -> uuid.UUID:
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
            email_verified=False,
            session_version=1,
            company_id=company_id,
            team_id=team_id,
            manager_id=manager_id,
            created_at=now,
            updated_at=now,
        )
        user.user_roles.append(UserRole(role=role, created_at=now))
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


async def _platform_admin(client) -> None:
    assert (
        await register_student(client, email="root@example.com", full_name="Root Admin")
    ).status_code == 201
    assign_role("root@example.com", "SUPER_ADMIN")
    assert (await login(client, email="root@example.com")).status_code == 200


async def test_public_registration_stays_inactive_until_approval(client):
    created = await register_student(client, approve=False)
    assert created.status_code == 201
    assert created.json()["message"] == PENDING_MESSAGE
    assert created.json()["data"]["roles"] == ["SALESPERSON"]

    blocked = await login(client)
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "ACCOUNT_INACTIVE"

    await _platform_admin(client)
    approved = await client.patch(
        f"/api/v1/users/{created.json()['data']['id']}",
        json={"is_active": True},
        headers=await csrf_headers(client),
    )
    assert approved.status_code == 200
    assert approved.json()["data"]["is_active"] is True
    assert "password" not in approved.json()["data"]

    assert (await login(client, email="student@example.com")).status_code == 200
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    body = me.json()["data"]
    assert body["is_active"] is True
    assert body["company_id"] is None
    assert body["team_id"] is None
    assert body["manager_id"] is None
    assert body["roles"] == ["SALESPERSON"]
    assert "features.read" in body["permissions"]


async def test_admin_creates_user_without_returning_the_password(client):
    company_id = _add_company("North")
    team_id = _add_team(company_id, "Field")
    manager_id = _add_member("manager@example.com", "SALESPERSON", company_id=company_id, team_id=team_id)
    await _platform_admin(client)

    created = await client.post(
        "/api/v1/users",
        json={
            "full_name": "Asha Rep",
            "email": "asha@example.com",
            "password": VALID_PASSWORD,
            "role": "SALESPERSON",
            "company_id": str(company_id),
            "team_id": str(team_id),
            "manager_id": str(manager_id),
        },
        headers=await csrf_headers(client),
    )
    assert created.status_code == 201
    body = created.json()["data"]
    assert body["email"] == "asha@example.com"
    assert body["roles"] == ["SALESPERSON"]
    assert body["company_id"] == str(company_id)
    assert body["team_id"] == str(team_id)
    assert body["manager_id"] == str(manager_id)
    assert body["is_active"] is True
    assert "password" not in body
    assert "password_hash" not in created.text
    assert VALID_PASSWORD not in created.text

    db = SessionLocal()
    try:
        stored = db.scalar(select(User).where(User.email == "asha@example.com"))
        assert stored is not None
        assert stored.password_hash.startswith("$argon2id$")
    finally:
        db.close()

    updated = await client.patch(
        f"/api/v1/users/{body['id']}",
        json={"role": "SALESPERSON", "team_id": None},
        headers=await csrf_headers(client),
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["roles"] == ["SALESPERSON"]
    assert updated.json()["data"]["team_id"] is None
    assert updated.json()["data"]["manager_id"] == str(manager_id)

    assert (await login(client, email="asha@example.com")).status_code == 200
    me = await client.get("/api/v1/auth/me")
    assert me.json()["data"]["company_id"] == str(company_id)
    assert me.json()["data"]["team_id"] is None
    assert me.json()["data"]["manager_id"] == str(manager_id)
    assert me.json()["data"]["roles"] == ["SALESPERSON"]
    assert me.json()["data"]["is_active"] is True


async def test_company_admin_cannot_manage_another_company(client):
    north = _add_company("North")
    south = _add_company("South")
    _add_member("north-admin@example.com", "BUSINESS_OWNER", company_id=north)
    south_user = _add_member("south-rep@example.com", "SALESPERSON", company_id=south)
    await _platform_admin(client)
    assert (await login(client, email="north-admin@example.com")).status_code == 200

    # Business owners do not manage users in this product — only Super Admin does.
    listed = await client.get("/api/v1/users")
    assert listed.status_code == 403

    blocked = await client.post(
        "/api/v1/users",
        json={
            "full_name": "Other Rep",
            "email": "other@example.com",
            "password": VALID_PASSWORD,
            "role": "SALESPERSON",
            "company_id": str(south),
        },
        headers=await csrf_headers(client),
    )
    assert blocked.status_code == 403

    hidden = await client.patch(
        f"/api/v1/users/{south_user}",
        json={"is_active": False},
        headers=await csrf_headers(client),
    )
    assert hidden.status_code == 403


async def test_user_management_permissions_and_soft_delete(client):
    anonymous = await client.post(
        "/api/v1/users",
        json={
            "full_name": "Missing User",
            "email": "missing@example.com",
            "password": VALID_PASSWORD,
            "role": "SALESPERSON",
        },
        headers=await csrf_headers(client),
    )
    assert anonymous.status_code == 401

    assert (await register_student(client)).status_code == 201
    assert (await login(client)).status_code == 200
    forbidden = await client.delete(
        f"/api/v1/users/{uuid.uuid4()}",
        headers=await csrf_headers(client),
    )
    assert forbidden.status_code == 403

    await _platform_admin(client)
    roles = await client.get("/api/v1/roles")
    granted = {role["name"]: {item["key"] for item in role["permissions"]} for role in roles.json()["data"]}
    assert {"features.read", "leads.read", "leads.assign"} <= granted["BUSINESS_OWNER"]
    assert "users.create" not in granted["BUSINESS_OWNER"]
    assert granted["SALESPERSON"] == {
        "features.read",
        "leads.read",
        "leads.create",
        "leads.update",
        "leads.delete",
    }
    assert "users.read" not in granted["SALESPERSON"]
    assert {"SUPER_ADMIN", "BUSINESS_OWNER", "SALESPERSON", "MARKETING"} <= set(granted)

    created = await client.post(
        "/api/v1/users",
        json={
            "full_name": "Temporary Rep",
            "email": "temp@example.com",
            "password": VALID_PASSWORD,
            "role": "SALESPERSON",
        },
        headers=await csrf_headers(client),
    )
    assert created.status_code == 201
    user_id = created.json()["data"]["id"]
    deleted = await client.delete(f"/api/v1/users/{user_id}", headers=await csrf_headers(client))
    assert deleted.status_code == 200
    assert deleted.json()["data"]["email"] == "temp@example.com"
    assert "password_hash" not in deleted.text
    listed = await client.get("/api/v1/users?limit=100")
    assert all(item["id"] != user_id for item in listed.json()["data"]["items"])

    assert (await login(client, email="temp@example.com")).status_code == 401


def test_access_scope_follows_role_and_team():
    company_id = _add_company("North")
    other_company = _add_company("South")
    team_id = _add_team(company_id, "Field")
    other_team = _add_team(company_id, "Desk")
    rep_id = _add_member("rep@example.com", "SALESPERSON", company_id=company_id, team_id=team_id)
    teammate_id = _add_member("mate@example.com", "SALESPERSON", company_id=company_id, team_id=team_id)
    outsider_id = _add_member("desk@example.com", "SALESPERSON", company_id=company_id, team_id=other_team)
    manager_id = _add_member("lead@example.com", "SALESPERSON", company_id=company_id, team_id=team_id)
    admin_id = _add_member("admin@example.com", "BUSINESS_OWNER", company_id=company_id)
    viewer_id = _add_member("viewer@example.com", "SALESPERSON", company_id=company_id)
    platform_id = _add_member("platform@example.com", "SUPER_ADMIN")

    db = SessionLocal()
    try:
        users = {user.email: user for user in db.scalars(select(User)).all()}
        assert resolve_access_scope(users["rep@example.com"]) is AccessScope.OWN
        assert resolve_access_scope(users["mate@example.com"]) is AccessScope.OWN
        assert resolve_access_scope(users["viewer@example.com"]) is AccessScope.OWN
        assert resolve_access_scope(users["lead@example.com"]) is AccessScope.OWN
        assert resolve_access_scope(users["admin@example.com"]) is AccessScope.ALL
        assert resolve_access_scope(users["platform@example.com"]) is AccessScope.ALL

        rep_scope = resolve_record_scope(db, users["rep@example.com"])
        assert record_is_in_scope(rep_scope, owner_id=rep_id, company_id=company_id)
        assert not record_is_in_scope(rep_scope, owner_id=teammate_id, company_id=company_id)

        lead_scope = resolve_record_scope(db, users["lead@example.com"])
        assert lead_scope.owner_ids == {manager_id}
        assert record_is_in_scope(lead_scope, owner_id=manager_id, company_id=company_id)
        assert not record_is_in_scope(lead_scope, owner_id=teammate_id, company_id=company_id)

        admin_scope = resolve_record_scope(db, users["admin@example.com"])
        assert admin_scope.owner_ids is None
        assert admin_scope.company_id == company_id
        assert record_is_in_scope(admin_scope, owner_id=outsider_id, company_id=company_id)
        assert not record_is_in_scope(admin_scope, owner_id=outsider_id, company_id=other_company)

        platform_scope = resolve_record_scope(db, users["platform@example.com"])
        assert platform_scope.company_id is None
        assert platform_scope.owner_ids is None
        assert record_is_in_scope(platform_scope, owner_id=admin_id, company_id=other_company)
        assert record_is_in_scope(platform_scope, owner_id=viewer_id, company_id=company_id)
    finally:
        db.close()
