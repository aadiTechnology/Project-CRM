"""Reminder behaviour check.

Run from the backend folder:

    .\\.venv\\Scripts\\python.exe -m pytest tests/test_reminder_checks.py -v

Covers the reminder queue, snooze, reschedule, no answer, call history,
won, lost, and reopen. A failure names the broken step.
"""

from datetime import UTC, datetime, timedelta

from tests.helpers import csrf_headers
from tests.test_leads import (
    FOLLOW_UP,
    _add_company,
    _add_member,
    _add_project,
    _add_team,
    _lead_payload,
    _login,
)

DUE = datetime(2026, 11, 2, 10, 30, tzinfo=UTC)


def _due_ids(body: dict) -> list[str]:
    return [item["id"] for item in body["data"]["items"] if item["next_followup_at"]]


def _parse(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


async def _reminder_lead(client) -> str:
    company_id = _add_company("Reminder Check")
    team_id = _add_team(company_id, "Desk")
    rep_id = _add_member("reminder-rep@example.com", "SALESPERSON", company_id=company_id, team_id=team_id)
    _add_member("reminder-other@example.com", "SALESPERSON", company_id=company_id, team_id=team_id)
    project_id = _add_project(company_id, name="Reminder", code="REM", member_ids=[rep_id])
    await _login(client, "reminder-rep@example.com")
    created = await client.post(
        "/api/v1/leads",
        json=_lead_payload(project_id=str(project_id), mobile="9810000001", full_name="Reminder Lead"),
        headers=await csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    return created.json()["data"]["id"]


async def _headers(client):
    from tests.helpers import csrf_headers

    return await csrf_headers(client)


async def test_open_lead_is_on_the_reminder_list_until_the_date_is_cleared(client):
    lead_id = await _reminder_lead(client)
    listed = await client.get("/api/v1/leads?exclude_lost=true&limit=50")
    assert listed.status_code == 200
    assert lead_id in _due_ids(listed.json())

    cleared = await client.patch(
        f"/api/v1/leads/{lead_id}",
        json={"next_followup_at": None},
        headers=await _headers(client),
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["data"]["next_followup_at"] is None
    again = await client.get("/api/v1/leads?exclude_lost=true&limit=50")
    assert lead_id not in _due_ids(again.json())


async def test_snooze_and_reschedule_move_the_due_date(client):
    lead_id = await _reminder_lead(client)
    headers = await _headers(client)
    snoozed_at = (DUE + timedelta(days=1)).isoformat().replace("+00:00", "Z")
    snoozed = await client.patch(
        f"/api/v1/leads/{lead_id}",
        json={"next_followup_at": snoozed_at},
        headers=headers,
    )
    assert snoozed.status_code == 200, snoozed.text
    assert _parse(snoozed.json()["data"]["next_followup_at"]) == DUE + timedelta(days=1)

    rescheduled = await client.patch(
        f"/api/v1/leads/{lead_id}",
        json={"next_followup_at": "2026-12-01T10:30:00Z", "plan_step": "Custom"},
        headers=headers,
    )
    assert rescheduled.status_code == 200, rescheduled.text
    assert _parse(rescheduled.json()["data"]["next_followup_at"]) == datetime(2026, 12, 1, 10, 30, tzinfo=UTC)
    listed = await client.get("/api/v1/leads?exclude_lost=true&limit=50")
    assert lead_id in _due_ids(listed.json())


async def test_each_call_keeps_its_summary_and_no_answer_stays_on_the_list(client):
    lead_id = await _reminder_lead(client)
    headers = await _headers(client)

    blank = await client.post(
        f"/api/v1/leads/{lead_id}/calls",
        json={"outcome": "connected", "summary": "  "},
        headers=headers,
    )
    assert blank.status_code == 422
    assert blank.json()["error"]["details"][0]["field"] == "summary"

    first = await client.post(
        f"/api/v1/leads/{lead_id}/calls",
        json={"outcome": "connected", "summary": "Call 1: asked for a quote"},
        headers=headers,
    )
    assert first.status_code == 201, first.text

    missed = await client.post(
        f"/api/v1/leads/{lead_id}/calls",
        json={"outcome": "no_answer", "summary": "No answer"},
        headers=headers,
    )
    assert missed.status_code == 201, missed.text
    moved = await client.patch(
        f"/api/v1/leads/{lead_id}",
        json={"next_followup_at": (DUE + timedelta(days=1)).isoformat().replace("+00:00", "Z")},
        headers=headers,
    )
    assert moved.status_code == 200, moved.text

    second = await client.post(
        f"/api/v1/leads/{lead_id}/calls",
        json={"outcome": "connected", "summary": "Call 2: ready to buy"},
        headers=headers,
    )
    assert second.status_code == 201, second.text

    calls = await client.get(f"/api/v1/leads/{lead_id}/calls")
    assert calls.status_code == 200
    summaries = [item["summary"] for item in calls.json()["data"]["items"]]
    assert summaries == ["Call 2: ready to buy", "No answer", "Call 1: asked for a quote"]
    lead = await client.get(f"/api/v1/leads/{lead_id}")
    assert lead.json()["data"]["call_summary"] == "Call 2: ready to buy"
    listed = await client.get("/api/v1/leads?exclude_lost=true&limit=50")
    assert lead_id in _due_ids(listed.json())


async def test_won_and_lost_leave_reminders_and_keep_call_history(client):
    lead_id = await _reminder_lead(client)
    headers = await _headers(client)
    saved = await client.post(
        f"/api/v1/leads/{lead_id}/calls",
        json={"outcome": "connected", "summary": "Call 1: interested"},
        headers=headers,
    )
    assert saved.status_code == 201, saved.text
    won = await client.patch(f"/api/v1/leads/{lead_id}", json={"status": "won"}, headers=headers)
    assert won.status_code == 200, won.text
    assert won.json()["data"]["status"] == "won"
    assert won.json()["data"]["next_followup_at"] is None
    hidden = await client.get("/api/v1/leads?exclude_lost=true&limit=50")
    assert lead_id not in [item["id"] for item in hidden.json()["data"]["items"]]
    history = await client.get(f"/api/v1/leads/{lead_id}/calls")
    assert [item["summary"] for item in history.json()["data"]["items"]] == ["Call 1: interested"]

    reopened = await client.patch(
        f"/api/v1/leads/{lead_id}",
        json={"status": "contacted", "next_followup_at": FOLLOW_UP},
        headers=headers,
    )
    assert reopened.status_code == 200, reopened.text
    back = await client.get("/api/v1/leads?exclude_lost=true&limit=50")
    assert lead_id in _due_ids(back.json())

    lost = await client.patch(
        f"/api/v1/leads/{lead_id}",
        json={"status": "lost", "next_followup_at": None},
        headers=headers,
    )
    assert lost.status_code == 200, lost.text
    assert lost.json()["data"]["status"] == "lost"
    assert lost.json()["data"]["next_followup_at"] is None
    gone = await client.get("/api/v1/leads?exclude_lost=true&limit=50")
    assert lead_id not in [item["id"] for item in gone.json()["data"]["items"]]
    still = await client.get(f"/api/v1/leads/{lead_id}/calls")
    assert still.json()["data"]["items"][0]["summary"] == "Call 1: interested"


async def test_another_salesperson_cannot_read_the_reminder(client):
    lead_id = await _reminder_lead(client)
    await _login(client, "reminder-other@example.com")
    hidden = await client.get(f"/api/v1/leads/{lead_id}")
    assert hidden.status_code == 404
    calls = await client.get(f"/api/v1/leads/{lead_id}/calls")
    assert calls.status_code == 404
