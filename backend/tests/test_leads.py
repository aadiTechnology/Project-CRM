"""Lead CRUD, ownership scope, assignment, and filters."""

import uuid
from datetime import UTC, datetime

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.leads.models import Lead
from app.organization.models import ACTIVE, Company, Project, ProjectMember, Team
from app.roles.models import UserRole
from app.roles.service import get_role_by_name
from app.users.models import User
from sqlalchemy import select

from tests.helpers import VALID_PASSWORD, csrf_headers, login

FOLLOW_UP = "2026-11-02T10:30:00Z"
LATER = "2026-12-01T10:30:00Z"


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
            created_at=now,
            updated_at=now,
        )
        user.user_roles.append(UserRole(role=role, created_at=now))
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


def _add_project(
    company_id: uuid.UUID,
    *,
    name: str = "Field",
    code: str = "FIELD",
    member_ids: list[uuid.UUID] | None = None,
) -> uuid.UUID:
    db = SessionLocal()
    try:
        now = _now()
        project = Project(
            company_id=company_id,
            name=name,
            code=code,
            template="GENERIC",
            description="Test project",
            status=ACTIVE,
            created_at=now,
            updated_at=now,
        )
        db.add(project)
        db.flush()
        for user_id in member_ids or []:
            db.add(ProjectMember(project_id=project.id, user_id=user_id, assigned_by_id=None, created_at=now))
        db.commit()
        return project.id
    finally:
        db.close()


def _lead_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "full_name": "Asha Patil",
        "mobile": "9876543210",
        "email": "asha.lead@example.com",
        "company_name": "Patil Traders",
        "city": "Pune",
        "lead_source": "Website",
        "requirement": "CRM for a field team",
        "expected_value": "1500.50",
        "status": "new",
        "priority": "high",
        "next_followup_at": FOLLOW_UP,
    }
    payload.update(overrides)
    return payload


async def _login(client, email: str) -> None:
    assert (await login(client, email=email)).status_code == 200


async def test_sales_rep_crud_is_limited_to_own_leads(client):
    company_id = _add_company("North")
    team_id = _add_team(company_id, "Field")
    rep_id = _add_member("rep@example.com", "SALESPERSON", company_id=company_id, team_id=team_id)
    mate_id = _add_member("mate@example.com", "SALESPERSON", company_id=company_id, team_id=team_id)
    project_id = _add_project(company_id, member_ids=[rep_id, mate_id])

    anonymous = await client.post(
        "/api/v1/leads",
        json=_lead_payload(project_id=str(project_id)),
        headers=await csrf_headers(client),
    )
    assert anonymous.status_code == 401

    await _login(client, "rep@example.com")
    created = await client.post(
        "/api/v1/leads",
        json=_lead_payload(project_id=str(project_id)),
        headers=await csrf_headers(client),
    )
    assert created.status_code == 201
    body = created.json()["data"]
    assert body["lead_number"].startswith("FIELD-")
    assert body["project_id"] == str(project_id)
    assert body["owner_id"] == str(rep_id)
    assert body["created_by_id"] == str(rep_id)
    assert body["company_id"] == str(company_id)
    assert body["expected_value"] == "1500.50"
    assert body["is_deleted"] is False
    lead_id = body["id"]

    listed = await client.get("/api/v1/leads")
    assert listed.status_code == 200
    assert listed.json()["data"]["total"] == 1
    assert listed.json()["data"]["items"][0]["id"] == lead_id

    blocked_owner = await client.post(
        "/api/v1/leads",
        json=_lead_payload(
            full_name="Other Lead",
            mobile="9876543211",
            owner_id=str(mate_id),
            project_id=str(project_id),
        ),
        headers=await csrf_headers(client),
    )
    assert blocked_owner.status_code == 403
    assert blocked_owner.json()["error"]["code"] == "FORBIDDEN"

    await _login(client, "mate@example.com")
    hidden_list = await client.get("/api/v1/leads")
    assert hidden_list.json()["data"]["total"] == 0
    hidden = await client.get(f"/api/v1/leads/{lead_id}")
    assert hidden.status_code == 404
    hidden_edit = await client.patch(
        f"/api/v1/leads/{lead_id}",
        json={"city": "Mumbai"},
        headers=await csrf_headers(client),
    )
    assert hidden_edit.status_code == 404

    await _login(client, "rep@example.com")
    updated = await client.patch(
        f"/api/v1/leads/{lead_id}",
        json={"status": "contacted", "city": "Nashik"},
        headers=await csrf_headers(client),
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["status"] == "contacted"
    assert updated.json()["data"]["city"] == "Nashik"
    assert updated.json()["data"]["owner_id"] == str(rep_id)

    reassigned = await client.patch(
        f"/api/v1/leads/{lead_id}",
        json={"owner_id": str(mate_id)},
        headers=await csrf_headers(client),
    )
    assert reassigned.status_code == 403
    assert (await client.get(f"/api/v1/leads/{lead_id}")).json()["data"]["owner_id"] == str(rep_id)

    deleted = await client.delete(f"/api/v1/leads/{lead_id}", headers=await csrf_headers(client))
    assert deleted.status_code == 200
    assert deleted.json()["data"]["is_deleted"] is True
    assert (await client.get(f"/api/v1/leads/{lead_id}")).status_code == 404
    assert (await client.get("/api/v1/leads")).json()["data"]["total"] == 0


async def test_salesperson_own_scope_and_owner_sees_company_leads(client):
    company_id = _add_company("North")
    field_id = _add_team(company_id, "Field")
    desk_id = _add_team(company_id, "Desk")
    rep_id = _add_member("rep@example.com", "SALESPERSON", company_id=company_id, team_id=field_id)
    mate_id = _add_member("mate@example.com", "SALESPERSON", company_id=company_id, team_id=field_id)
    desk_user = _add_member("desk@example.com", "SALESPERSON", company_id=company_id, team_id=desk_id)
    owner_id = _add_member("owner@example.com", "BUSINESS_OWNER", company_id=company_id)
    project_id = _add_project(company_id, member_ids=[rep_id, mate_id, desk_user, owner_id])

    await _login(client, "rep@example.com")
    own = await client.post(
        "/api/v1/leads",
        json=_lead_payload(
            full_name="Owned Lead",
            mobile="9000000001",
            email="owned@example.com",
            project_id=str(project_id),
        ),
        headers=await csrf_headers(client),
    )
    assert own.status_code == 201
    own_id = own.json()["data"]["id"]

    await _login(client, "desk@example.com")
    outside = await client.post(
        "/api/v1/leads",
        json=_lead_payload(
            full_name="Desk Lead",
            mobile="9000000002",
            email="desk.lead@example.com",
            project_id=str(project_id),
        ),
        headers=await csrf_headers(client),
    )
    assert outside.status_code == 201
    outside_id = outside.json()["data"]["id"]

    await _login(client, "mate@example.com")
    assert (await client.get("/api/v1/leads")).json()["data"]["total"] == 0
    assert (await client.get(f"/api/v1/leads/{own_id}")).status_code == 404

    await _login(client, "rep@example.com")
    refused = await client.patch(
        f"/api/v1/leads/{own_id}",
        json={"owner_id": str(mate_id)},
        headers=await csrf_headers(client),
    )
    assert refused.status_code == 403
    assert (await client.get(f"/api/v1/leads/{own_id}")).json()["data"]["owner_id"] == str(rep_id)

    await _login(client, "owner@example.com")
    visible = await client.get("/api/v1/leads")
    assert visible.status_code == 200
    assert {item["id"] for item in visible.json()["data"]["items"]} == {own_id, outside_id}
    assert (await client.get(f"/api/v1/leads/{own_id}")).status_code == 200
    create_blocked = await client.post(
        "/api/v1/leads",
        json=_lead_payload(
            full_name="Owner Lead",
            mobile="9000000003",
            email="owner.lead@example.com",
            project_id=str(project_id),
        ),
        headers=await csrf_headers(client),
    )
    assert create_blocked.status_code == 403


async def test_business_owner_is_limited_to_one_company_and_salesperson_soft_deletes(client):
    north = _add_company("North")
    south = _add_company("South")
    north_owner = _add_member("north-owner@example.com", "BUSINESS_OWNER", company_id=north)
    south_rep = _add_member("south-rep@example.com", "SALESPERSON", company_id=south)
    north_rep = _add_member("north-rep@example.com", "SALESPERSON", company_id=north)
    north_project = _add_project(north, code="NORTH", member_ids=[north_owner, north_rep])
    south_project = _add_project(south, code="SOUTH", member_ids=[south_rep])

    await _login(client, "south-rep@example.com")
    south_lead = await client.post(
        "/api/v1/leads",
        json=_lead_payload(
            full_name="South Lead",
            mobile="9000000011",
            email="south.lead@example.com",
            project_id=str(south_project),
        ),
        headers=await csrf_headers(client),
    )
    assert south_lead.status_code == 201
    south_id = south_lead.json()["data"]["id"]

    await _login(client, "north-rep@example.com")
    created = await client.post(
        "/api/v1/leads",
        json=_lead_payload(
            full_name="North Lead",
            mobile="9000000012",
            email="north.lead@example.com",
            project_id=str(north_project),
        ),
        headers=await csrf_headers(client),
    )
    assert created.status_code == 201
    lead_id = created.json()["data"]["id"]
    assert created.json()["data"]["company_id"] == str(north)
    assert created.json()["data"]["owner_id"] == str(north_rep)

    await _login(client, "north-owner@example.com")
    listed = await client.get("/api/v1/leads")
    assert listed.status_code == 200
    assert {item["id"] for item in listed.json()["data"]["items"]} == {lead_id}
    assert (await client.get(f"/api/v1/leads/{south_id}")).status_code == 404
    other_company = await client.post(
        "/api/v1/leads",
        json=_lead_payload(company_id=str(south), owner_id=str(south_rep), project_id=str(south_project)),
        headers=await csrf_headers(client),
    )
    assert other_company.status_code == 403
    assert (await client.delete(f"/api/v1/leads/{lead_id}", headers=await csrf_headers(client))).status_code == 403

    await _login(client, "north-rep@example.com")
    deleted = await client.delete(f"/api/v1/leads/{lead_id}", headers=await csrf_headers(client))
    assert deleted.status_code == 200
    assert deleted.json()["data"]["is_deleted"] is True
    db = SessionLocal()
    try:
        stored = db.get(Lead, uuid.UUID(lead_id))
        assert stored is not None
        assert stored.is_deleted is True
    finally:
        db.close()
    assert (await client.get(f"/api/v1/leads/{lead_id}")).status_code == 404


async def test_platform_admin_sees_every_company(client):
    north = _add_company("North")
    south = _add_company("South")
    north_rep = _add_member("north-rep@example.com", "SALESPERSON", company_id=north)
    south_rep = _add_member("south-rep@example.com", "SALESPERSON", company_id=south)
    _add_member("root@example.com", "SUPER_ADMIN")
    north_project = _add_project(north, code="NORTH", member_ids=[north_rep])
    south_project = _add_project(south, code="SOUTH", member_ids=[south_rep])

    await _login(client, "north-rep@example.com")
    north_lead = await client.post(
        "/api/v1/leads",
        json=_lead_payload(full_name="North Lead", mobile="9000000021", project_id=str(north_project)),
        headers=await csrf_headers(client),
    )
    await _login(client, "south-rep@example.com")
    south_lead = await client.post(
        "/api/v1/leads",
        json=_lead_payload(
            full_name="South Lead",
            mobile="9000000022",
            email="south2@example.com",
            project_id=str(south_project),
        ),
        headers=await csrf_headers(client),
    )
    await _login(client, "root@example.com")
    listed = await client.get("/api/v1/leads")
    assert listed.status_code == 200
    assert {item["id"] for item in listed.json()["data"]["items"]} == {
        north_lead.json()["data"]["id"],
        south_lead.json()["data"]["id"],
    }

    missing_owner = await client.post(
        "/api/v1/leads",
        json=_lead_payload(company_id=str(north), full_name="Needs Owner", mobile="9000000023"),
        headers=await csrf_headers(client),
    )
    assert missing_owner.status_code == 422
    assert missing_owner.json()["error"]["details"][0]["field"] == "owner_id"

    created = await client.post(
        "/api/v1/leads",
        json=_lead_payload(
            company_id=str(south),
            owner_id=str(south_rep),
            project_id=str(south_project),
            full_name="Platform Lead",
            mobile="9000000024",
            email="platform.lead@example.com",
        ),
        headers=await csrf_headers(client),
    )
    assert created.status_code == 201
    assert created.json()["data"]["company_id"] == str(south)
    assert created.json()["data"]["owner_id"] == str(south_rep)
    assert north_rep != south_rep


async def test_marketing_cannot_access_leads(client):
    company_id = _add_company("North")
    rep_id = _add_member("rep@example.com", "SALESPERSON", company_id=company_id)
    _add_member("marketer@example.com", "MARKETING", company_id=company_id)
    project_id = _add_project(company_id, member_ids=[rep_id])

    await _login(client, "rep@example.com")
    created = await client.post(
        "/api/v1/leads",
        json=_lead_payload(full_name="Readable Lead", mobile="9000000031", project_id=str(project_id)),
        headers=await csrf_headers(client),
    )
    assert created.status_code == 201
    lead_id = created.json()["data"]["id"]
    assert created.json()["data"]["owner_id"] == str(rep_id)

    await _login(client, "marketer@example.com")
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["data"]["roles"] == ["MARKETING"]
    assert "leads.read" not in me.json()["data"]["permissions"]
    assert (await client.get("/api/v1/leads")).status_code == 403
    forbidden = await client.post("/api/v1/leads", json=_lead_payload(), headers=await csrf_headers(client))
    assert forbidden.status_code == 403
    assert (
        await client.patch(
            f"/api/v1/leads/{lead_id}",
            json={"city": "Mumbai"},
            headers=await csrf_headers(client),
        )
    ).status_code == 403
    assert (await client.delete(f"/api/v1/leads/{lead_id}", headers=await csrf_headers(client))).status_code == 403


async def test_lead_filters_and_pagination(client):
    company_id = _add_company("North")
    rep_id = _add_member("rep@example.com", "SALESPERSON", company_id=company_id)
    mate_id = _add_member("mate@example.com", "SALESPERSON", company_id=company_id)
    owner_id = _add_member("owner@example.com", "BUSINESS_OWNER", company_id=company_id)
    project_id = _add_project(company_id, member_ids=[rep_id, mate_id, owner_id])

    await _login(client, "rep@example.com")
    first = await client.post(
        "/api/v1/leads",
        json=_lead_payload(
            full_name="100% Ready",
            mobile="9111111111",
            email="ready@example.com",
            lead_source="Website",
            status="new",
            priority="high",
            next_followup_at=FOLLOW_UP,
            project_id=str(project_id),
        ),
        headers=await csrf_headers(client),
    )
    assert first.status_code == 201
    await _login(client, "mate@example.com")
    second = await client.post(
        "/api/v1/leads",
        json=_lead_payload(
            full_name="Later Call",
            mobile="9222222222",
            email="later@example.com",
            lead_source="Referral",
            status="qualified",
            priority="low",
            next_followup_at=LATER,
            project_id=str(project_id),
        ),
        headers=await csrf_headers(client),
    )
    assert second.status_code == 201
    first_id = first.json()["data"]["id"]
    second_id = second.json()["data"]["id"]

    await _login(client, "owner@example.com")
    by_name = await client.get("/api/v1/leads", params={"search": "100%"})
    assert [item["id"] for item in by_name.json()["data"]["items"]] == [first_id]
    by_mobile = await client.get("/api/v1/leads", params={"search": "92222"})
    assert [item["id"] for item in by_mobile.json()["data"]["items"]] == [second_id]
    by_email = await client.get("/api/v1/leads", params={"search": "ready@example.com"})
    assert [item["id"] for item in by_email.json()["data"]["items"]] == [first_id]
    by_status = await client.get("/api/v1/leads", params={"status": "qualified"})
    assert [item["id"] for item in by_status.json()["data"]["items"]] == [second_id]
    by_owner = await client.get("/api/v1/leads", params={"owner_id": str(rep_id)})
    assert [item["id"] for item in by_owner.json()["data"]["items"]] == [first_id]
    by_source = await client.get("/api/v1/leads", params={"source": "Referral"})
    assert [item["id"] for item in by_source.json()["data"]["items"]] == [second_id]
    by_priority = await client.get("/api/v1/leads", params={"priority": "high"})
    assert [item["id"] for item in by_priority.json()["data"]["items"]] == [first_id]
    by_day = await client.get("/api/v1/leads", params={"next_followup_at": "2026-11-02"})
    assert [item["id"] for item in by_day.json()["data"]["items"]] == [first_id]

    page_one = await client.get("/api/v1/leads", params={"limit": 1, "offset": 0})
    page_two = await client.get("/api/v1/leads", params={"limit": 1, "offset": 1})
    assert page_one.json()["data"]["total"] == 2
    assert page_two.json()["data"]["total"] == 2
    assert {page_one.json()["data"]["items"][0]["id"], page_two.json()["data"]["items"][0]["id"]} == {
        first_id,
        second_id,
    }

    await _login(client, "rep@example.com")
    assert (await client.get("/api/v1/leads", params={"owner_id": str(mate_id)})).json()["data"]["total"] == 0


async def test_lead_validation_rejects_incomplete_or_unknown_values(client):
    company_id = _add_company("North")
    rep_id = _add_member("rep@example.com", "SALESPERSON", company_id=company_id)
    project_id = _add_project(company_id, member_ids=[rep_id])
    await _login(client, "rep@example.com")
    headers = await csrf_headers(client)

    missing = await client.post("/api/v1/leads", json={"full_name": "Asha Patil"}, headers=headers)
    assert missing.status_code == 422

    bad_mobile = await client.post(
        "/api/v1/leads",
        json=_lead_payload(mobile="123", project_id=str(project_id)),
        headers=headers,
    )
    assert bad_mobile.status_code == 422
    assert bad_mobile.json()["error"]["details"][0]["field"] == "mobile"
    assert bad_mobile.json()["error"]["message"] == "Mobile number must be 10 or 12 digits."

    bad_email = await client.post(
        "/api/v1/leads",
        json=_lead_payload(email="not-an-email", project_id=str(project_id)),
        headers=headers,
    )
    assert bad_email.status_code == 422
    assert bad_email.json()["error"]["message"] == "Enter a valid email address."
    assert bad_email.json()["error"]["details"][0]["field"] == "email"

    bad_status = await client.post(
        "/api/v1/leads",
        json=_lead_payload(status="not_a_real_stage", project_id=str(project_id)),
        headers=headers,
    )
    assert bad_status.status_code == 422
    assert bad_status.json()["error"]["details"][0]["field"] == "status"

    no_csrf = await client.post("/api/v1/leads", json=_lead_payload(project_id=str(project_id)))
    assert no_csrf.status_code == 403
    assert no_csrf.json()["error"]["code"] == "CSRF_VALIDATION_FAILED"

    db = SessionLocal()
    try:
        assert db.scalar(select(Lead.id)) is None
    finally:
        db.close()


async def test_each_call_keeps_its_own_summary(client):
    company_id = _add_company("Calls Co")
    team_id = _add_team(company_id, "Calls")
    rep_id = _add_member("calls-rep@example.com", "SALESPERSON", company_id=company_id, team_id=team_id)
    other_id = _add_member("calls-other@example.com", "SALESPERSON", company_id=company_id, team_id=team_id)
    project_id = _add_project(company_id, name="Calls", code="CALLS", member_ids=[rep_id, other_id])

    await _login(client, "calls-rep@example.com")
    headers = await csrf_headers(client)
    created = await client.post(
        "/api/v1/leads",
        json=_lead_payload(project_id=str(project_id), mobile="9811111111"),
        headers=headers,
    )
    assert created.status_code == 201, created.text
    lead_id = created.json()["data"]["id"]

    empty = await client.post(
        f"/api/v1/leads/{lead_id}/calls",
        json={"outcome": "connected", "summary": "   "},
        headers=headers,
    )
    assert empty.status_code == 422
    assert empty.json()["error"]["details"][0]["field"] == "summary"

    first = await client.post(
        f"/api/v1/leads/{lead_id}/calls",
        json={"outcome": "connected", "summary": "Asked for a brochure"},
        headers=headers,
    )
    assert first.status_code == 201, first.text
    assert first.json()["data"]["summary"] == "Asked for a brochure"

    second = await client.post(
        f"/api/v1/leads/{lead_id}/calls",
        json={"outcome": "no_answer", "summary": "Rang twice"},
        headers=headers,
    )
    assert second.status_code == 201, second.text

    listed = await client.get(f"/api/v1/leads/{lead_id}/calls")
    assert listed.status_code == 200
    items = listed.json()["data"]["items"]
    assert [item["summary"] for item in items] == ["Rang twice", "Asked for a brochure"]
    assert items[0]["outcome"] == "no_answer"
    assert items[1]["outcome"] == "connected"

    lead = await client.get(f"/api/v1/leads/{lead_id}")
    assert lead.json()["data"]["call_summary"] == "Rang twice"

    await _login(client, "calls-other@example.com")
    hidden = await client.get(f"/api/v1/leads/{lead_id}/calls")
    assert hidden.status_code == 404


async def test_new_call_keeps_imported_summary_in_history(client):
    company_id = _add_company("Import History Co")
    team_id = _add_team(company_id, "Import History")
    rep_id = _add_member("import-history@example.com", "SALESPERSON", company_id=company_id, team_id=team_id)
    project_id = _add_project(company_id, name="Import", code="IMPHIST", member_ids=[rep_id])
    imported = "1st follow-up: required info sent\n2nd follow-up: msg sent no respond"

    await _login(client, "import-history@example.com")
    headers = await csrf_headers(client)
    created = await client.post(
        "/api/v1/leads",
        json=_lead_payload(
            project_id=str(project_id),
            mobile="9822222222",
            call_summary=imported,
        ),
        headers=headers,
    )
    assert created.status_code == 201, created.text
    lead_id = created.json()["data"]["id"]

    saved = await client.post(
        f"/api/v1/leads/{lead_id}/calls",
        json={"outcome": "connected", "summary": "next followup"},
        headers=headers,
    )
    assert saved.status_code == 201, saved.text

    history = await client.get(f"/api/v1/leads/{lead_id}/calls")
    assert history.status_code == 200
    summaries = [item["summary"] for item in history.json()["data"]["items"]]
    assert summaries[0] == "next followup"
    assert imported in summaries
    assert (await client.get(f"/api/v1/leads/{lead_id}")).json()["data"]["call_summary"] == "next followup"
