"""Team board: assign owners/salespeople, add reps, move leads."""

import uuid
from datetime import UTC, datetime

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.leads.models import Lead
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
            full_name=email.split("@", 1)[0].replace(".", " ").title(),
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


async def test_super_admin_assigns_project_to_business_owner(client):
    company_id = _add_company("North")
    other = _add_company("South")
    _add_member("root@example.com", "SUPER_ADMIN")
    owner_a = _add_member("owner-a@example.com", "BUSINESS_OWNER", company_id)
    owner_b = _add_member("owner-b@example.com", "BUSINESS_OWNER", company_id)
    _add_member("south-owner@example.com", "BUSINESS_OWNER", other)

    assert (await login(client, email="root@example.com")).status_code == 200
    created = await client.post(
        "/api/v1/projects",
        json={"name": "Hiring", "code": "HIRING", "company_id": str(company_id), "template": "HIRING"},
        headers=await csrf_headers(client),
    )
    assert created.status_code == 200, created.text
    project_id = next(item["id"] for item in created.json()["data"]["items"] if item["code"] == "HIRING")

    board = await client.get("/api/v1/team", params={"company_id": str(company_id)})
    assert board.status_code == 200
    data = board.json()["data"]
    assert data["mode"] == "platform"
    assert {person["id"] for person in data["people"]} == {str(owner_a), str(owner_b)}
    # Creating a project auto-assigns every owner of that business.
    assert {item["user_id"] for item in data["assignments"]} == {str(owner_a), str(owner_b)}

    removed = await client.patch(
        "/api/v1/team/assignments",
        json={"project_id": project_id, "user_id": str(owner_b), "assigned": False},
        headers=await csrf_headers(client),
    )
    assert removed.status_code == 200
    assert {item["user_id"] for item in removed.json()["data"]["assignments"]} == {str(owner_a)}

    assert (await login(client, email="owner-a@example.com")).status_code == 200
    listed_a = await client.get("/api/v1/projects")
    assert [item["code"] for item in listed_a.json()["data"]["items"]] == ["HIRING"]

    assert (await login(client, email="owner-b@example.com")).status_code == 200
    listed_b = await client.get("/api/v1/projects")
    assert listed_b.json()["data"]["items"] == []


async def test_owner_assigns_salesperson_adds_rep_and_moves_leads(client):
    company_id = _add_company("North")
    _add_member("root@example.com", "SUPER_ADMIN")
    owner_id = _add_member("owner@example.com", "BUSINESS_OWNER", company_id)
    rep_id = _add_member("rep@example.com", "SALESPERSON", company_id)
    mate_id = _add_member("mate@example.com", "SALESPERSON", company_id)

    assert (await login(client, email="root@example.com")).status_code == 200
    created = await client.post(
        "/api/v1/projects",
        json={"name": "Preschool", "code": "PRESCHOOL", "company_id": str(company_id), "template": "PRESCHOOL"},
        headers=await csrf_headers(client),
    )
    project_id = next(item["id"] for item in created.json()["data"]["items"] if item["code"] == "PRESCHOOL")

    assert (await login(client, email="owner@example.com")).status_code == 200
    board = await client.get("/api/v1/team")
    assert board.status_code == 200
    assert board.json()["data"]["mode"] == "owner"
    assert board.json()["data"]["viewer"]["id"] == str(owner_id)

    assigned = await client.patch(
        "/api/v1/team/assignments",
        json={"project_id": project_id, "user_id": str(rep_id), "assigned": True},
        headers=await csrf_headers(client),
    )
    assert assigned.status_code == 200
    assert {"project_id": project_id, "user_id": str(rep_id)} in assigned.json()["data"]["assignments"]

    added = await client.post(
        "/api/v1/team/salespeople",
        json={"full_name": "New Rep", "email": "new.rep@example.com", "password": VALID_PASSWORD},
        headers=await csrf_headers(client),
    )
    assert added.status_code == 200
    assert any(person["email"] == "new.rep@example.com" for person in added.json()["data"]["people"])

    assert (await login(client, email="rep@example.com")).status_code == 200
    lead = await client.post(
        "/api/v1/leads",
        json={
            "full_name": "Asha Patil",
            "mobile": "9000000001",
            "email": "asha.move@example.com",
            "status": "new",
            "priority": "high",
            "next_followup_at": "2026-11-02T10:30:00Z",
            "project_id": project_id,
        },
        headers=await csrf_headers(client),
    )
    assert lead.status_code == 201, lead.text
    lead_id = lead.json()["data"]["id"]
    assert lead.json()["data"]["project_id"] == project_id

    assert (await login(client, email="owner@example.com")).status_code == 200
    moved = await client.post(
        "/api/v1/team/move-leads",
        json={
            "project_id": project_id,
            "from_user_id": str(rep_id),
            "to_user_id": str(mate_id),
            "which": "all",
        },
        headers=await csrf_headers(client),
    )
    assert moved.status_code == 200
    assert moved.json()["data"]["moved"] == 1

    db = SessionLocal()
    try:
        from sqlalchemy import select

        stored = db.get(Lead, uuid.UUID(lead_id))
        assert stored is not None
        assert stored.owner_id == mate_id
        # Destination must be assigned to the project or they cannot list the moved lead.
        assert db.get(ProjectMember, (uuid.UUID(project_id), mate_id)) is not None
        assert db.get(ProjectMember, (uuid.UUID(project_id), rep_id)) is not None
        assert db.get(Project, uuid.UUID(project_id)) is not None
        assert db.scalar(select(ProjectMember.user_id).where(ProjectMember.user_id == owner_id)) == owner_id
        assert moved.json()["data"].get("project_assigned") is True
    finally:
        db.close()

    assert (await login(client, email="mate@example.com")).status_code == 200
    listed = await client.get("/api/v1/leads")
    assert listed.status_code == 200
    assert any(item["id"] == lead_id for item in listed.json()["data"]["items"])


async def test_reassigning_project_moves_leads_to_new_salesperson(client):
    """BO removes Kunal and assigns Demo → Demo owns the project leads."""
    company_id = _add_company("Handoff Co")
    _add_member("root@example.com", "SUPER_ADMIN")
    _add_member("owner@example.com", "BUSINESS_OWNER", company_id)
    kunal_id = _add_member("kunal@example.com", "SALESPERSON", company_id)
    demo_id = _add_member("demo@example.com", "SALESPERSON", company_id)

    assert (await login(client, email="root@example.com")).status_code == 200
    created = await client.post(
        "/api/v1/projects",
        json={"name": "Hiring", "code": "HIRING", "company_id": str(company_id), "template": "HIRING"},
        headers=await csrf_headers(client),
    )
    project_id = next(item["id"] for item in created.json()["data"]["items"] if item["code"] == "HIRING")

    assert (await login(client, email="owner@example.com")).status_code == 200
    assert (
        await client.patch(
            "/api/v1/team/assignments",
            json={"project_id": project_id, "user_id": str(kunal_id), "assigned": True},
            headers=await csrf_headers(client),
        )
    ).status_code == 200

    assert (await login(client, email="kunal@example.com")).status_code == 200
    lead = await client.post(
        "/api/v1/leads",
        json={
            "full_name": "Handoff Lead",
            "mobile": "9000000099",
            "status": "new",
            "priority": "high",
            "next_followup_at": "2026-11-02T10:30:00Z",
            "project_id": project_id,
        },
        headers=await csrf_headers(client),
    )
    assert lead.status_code == 201, lead.text
    lead_id = lead.json()["data"]["id"]

    assert (await login(client, email="owner@example.com")).status_code == 200
    removed = await client.patch(
        "/api/v1/team/assignments",
        json={"project_id": project_id, "user_id": str(kunal_id), "assigned": False},
        headers=await csrf_headers(client),
    )
    assert removed.status_code == 200

    assigned = await client.patch(
        "/api/v1/team/assignments",
        json={"project_id": project_id, "user_id": str(demo_id), "assigned": True},
        headers=await csrf_headers(client),
    )
    assert assigned.status_code == 200
    assert "Moved 1 lead" in assigned.json()["message"]

    db = SessionLocal()
    try:
        stored = db.get(Lead, uuid.UUID(lead_id))
        assert stored is not None
        assert stored.owner_id == demo_id
        assert db.get(ProjectMember, (uuid.UUID(project_id), kunal_id)) is None
        assert db.get(ProjectMember, (uuid.UUID(project_id), demo_id)) is not None
    finally:
        db.close()

    assert (await login(client, email="demo@example.com")).status_code == 200
    listed = await client.get("/api/v1/leads")
    assert listed.status_code == 200
    assert any(item["id"] == lead_id for item in listed.json()["data"]["items"])

    assert (await login(client, email="kunal@example.com")).status_code == 200
    listed_old = await client.get("/api/v1/leads")
    assert listed_old.status_code == 200
    assert not any(item["id"] == lead_id for item in listed_old.json()["data"]["items"])


async def test_unassign_moves_leads_when_one_salesperson_remains(client):
    """Assign Demo first, then remove Kunal → leads move to Demo."""
    company_id = _add_company("Sole Handoff")
    _add_member("root@example.com", "SUPER_ADMIN")
    _add_member("owner@example.com", "BUSINESS_OWNER", company_id)
    kunal_id = _add_member("kunal2@example.com", "SALESPERSON", company_id)
    demo_id = _add_member("demo2@example.com", "SALESPERSON", company_id)

    assert (await login(client, email="root@example.com")).status_code == 200
    created = await client.post(
        "/api/v1/projects",
        json={"name": "Paneer", "code": "PANEER", "company_id": str(company_id), "template": "PANEERWALA"},
        headers=await csrf_headers(client),
    )
    project_id = next(item["id"] for item in created.json()["data"]["items"] if item["code"] == "PANEER")

    assert (await login(client, email="owner@example.com")).status_code == 200
    for user_id in (kunal_id, demo_id):
        assert (
            await client.patch(
                "/api/v1/team/assignments",
                json={"project_id": project_id, "user_id": str(user_id), "assigned": True},
                headers=await csrf_headers(client),
            )
        ).status_code == 200

    assert (await login(client, email="kunal2@example.com")).status_code == 200
    lead = await client.post(
        "/api/v1/leads",
        json={
            "full_name": "Second Handoff",
            "mobile": "9000000088",
            "status": "new",
            "priority": "medium",
            "next_followup_at": "2026-11-02T10:30:00Z",
            "project_id": project_id,
        },
        headers=await csrf_headers(client),
    )
    assert lead.status_code == 201, lead.text
    lead_id = lead.json()["data"]["id"]

    assert (await login(client, email="owner@example.com")).status_code == 200
    removed = await client.patch(
        "/api/v1/team/assignments",
        json={"project_id": project_id, "user_id": str(kunal_id), "assigned": False},
        headers=await csrf_headers(client),
    )
    assert removed.status_code == 200
    assert "Moved 1 lead" in removed.json()["message"]

    db = SessionLocal()
    try:
        stored = db.get(Lead, uuid.UUID(lead_id))
        assert stored is not None
        assert stored.owner_id == demo_id
    finally:
        db.close()


async def test_owner_deletes_salesperson_without_leads(client):
    company_id = _add_company("Delete Team")
    _add_member("team-owner@example.com", "BUSINESS_OWNER", company_id)
    spare_id = _add_member("spare@example.com", "SALESPERSON", company_id)
    busy_id = _add_member("busy@example.com", "SALESPERSON", company_id)

    assert (await login(client, email="team-owner@example.com")).status_code == 200
    deleted = await client.delete(f"/api/v1/team/salespeople/{spare_id}", headers=await csrf_headers(client))
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["message"] == "Salesperson deleted."
    assert all(person["id"] != str(spare_id) for person in deleted.json()["data"]["people"])
    assert (await login(client, email="spare@example.com")).status_code == 403

    assert (await login(client, email="team-owner@example.com")).status_code == 200
    db = SessionLocal()
    try:
        now = _now()
        db.add(
            Lead(
                company_id=company_id,
                lead_number="TEAM-0001",
                full_name="Busy Lead",
                mobile="9000000088",
                owner_id=busy_id,
                created_by_id=busy_id,
                status="new",
                priority="medium",
                plan_step="Day 1",
                is_deleted=False,
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()
    finally:
        db.close()
    refused = await client.delete(f"/api/v1/team/salespeople/{busy_id}", headers=await csrf_headers(client))
    assert refused.status_code == 409
