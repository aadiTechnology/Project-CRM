# Plan — Follow-ups + KPIs

| Stage | Owner | Status | Output |
|---|---|---|---|
| 1 Requirements | business-analyst-agent | Done | docs/agent-workflow/01-requirements-brief.md |
| 2 Technical design | solution-architect-agent | Done | docs/agent-workflow/02-technical-design.md |
| 3 Implementation | coordinating agent | Done | Follow-ups + KPIs live (Day cadence steps) |

## Goal
Build working **Follow-ups** and **KPIs** screens in `aaditech-auth` (currently nav placeholders / "Coming next"), using the user's reference screenshots and existing CRM data (leads, pipeline, reminders).

## Inputs
- User screenshots: Follow-ups table (plan step, due, priority, session outcome counters); KPIs overview (metric cards, stage distribution, Quick Pulse).
- Existing product: Reminders already covers due-today actions (Connected / No answer / Snooze / Skip) via `next_followup_at`.
- Nav hints: Follow-ups = "Open follow-ups with the plan step, due date, and priority."; KPIs = "Won value, pipeline value, and counts by status and source."
- PRD excerpts: follow-up discipline, overdue/today dashboards, conversion/pipeline metrics.
- Codebase: FastAPI + React/MUI; leads API; no dedicated follow-up-task or KPI module yet.

## Assumptions
1. **Follow-ups ≠ Reminders.** Reminders = action queue for due calls. Follow-ups = open plan steps (Call 1 / Call 2 / Visit, etc.) with due date and priority; filter by step; session counters for outcomes.
2. Plan step is stored on the lead (new field or stable key in existing data) with defaults for demo leads — not a full separate task microservice for MVP.
3. KPI page is **read-only aggregation** over leads the user can already see (same RBAC as leads list); deep links to Pipeline / Reminders.
4. UI must match **current Aadi CRM** look (IBM Plex, blue `#1d4ed8`, slate sidebar) — not the purple "Aadi CRM Development" demo chrome in the reference.
5. Owner + Salesperson can open both menus (already in `nav.ts`).

## Stages

| Stage | Owner | Inputs | Outputs | Dependencies | Done-criteria |
|---|---|---|---|---|---|
| 1 Requirements | business-analyst-agent | User refs, PRD, assumptions, current Reminders/Leads | 01-requirements-brief.md (11 sections + Architect Handoff) | — | Review gate pass |
| 2 Technical design | solution-architect-agent | Architect Handoff + full brief | 02-technical-design.md (9 sections + task breakdown) | Stage 1 Done | Review gate pass |

## Future stages (Not built)
- Developer, QA, Technical Writer, DevOps — after Stage 2, implementation is done by the coordinating agent in-repo.
