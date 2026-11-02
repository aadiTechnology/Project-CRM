# Plan — Column visibility (Leads / Reminders / Follow-ups)

| Stage | Owner | Status | Output |
|---|---|---|---|
| 1 Requirements | business-analyst-agent | Done | docs/agent-workflow/01-requirements-brief-column-visibility.md |
| 2 Technical design | solution-architect-agent | Done | docs/agent-workflow/02-technical-design-column-visibility.md |
| 3 Implementation | coordinating agent | Done | frontend/src/column-visibility + Leads/Reminders/Follow-ups |

> Note: Prior Follow-ups + KPIs artifacts remain in `00-plan.md` / `02-technical-design.md`. This feature uses versioned filenames so those are not overwritten.

## Goal
Let users choose which columns to show or hide on the **Leads**, **Reminders**, and **Follow-ups** list screens (checkbox-style column picker: selected columns visible, others hidden).

## Inputs
- User request (Hinglish): feature for lead, reminder, follow-up — user selects which columns to see via check; others hide; wants analysis first.
- Codebase findings (`aaditech-auth`):
  - Lists are hardcoded CSS grids (not DataGrid / not configurable column arrays).
  - Leads: Lead, Status, Priority, Follow-up, Source, open action — `LeadsPage.tsx`.
  - Reminders: Checkbox, Lead, Plan, Priority, Due, Status, Actions — `RemindersPage.tsx`.
  - Follow-ups: Lead, Plan, Priority, Due, Actions — `FollowUpsPage.tsx`.
  - No per-user column show/hide prefs today.
  - Related but different: Lead Fields `show_in_list` (admin) shows up to 3 custom field values under the Lead cell — not a real column picker; Reminders/Follow-ups ignore it.
- Tech: React 19 + MUI + Vite frontend; FastAPI + PostgreSQL backend.

## Assumptions
1. **Assumption:** Preference is **per user** and persists across sessions (not only for the current browser tab).
2. **Assumption:** Scope is the three list pages only (Leads, Reminders, Follow-ups) — not Pipeline, KPIs, or other tables in MVP.
3. **Assumption:** At least one identifying column (e.g. Lead name) and essential actions (open / row actions) stay always visible and cannot be fully hidden.
4. **Assumption:** Custom lead fields with `show_in_list` remain as subtitle under Lead for now unless BA/architect expands scope; column picker primarily toggles the existing fixed columns.
5. **Assumption:** Mobile stacked layout still works when columns are hidden (desktop grid is the main target).

## Stages

| Stage | Owner | Inputs | Outputs | Dependencies | Done-criteria |
|---|---|---|---|---|---|
| 1 Requirements | business-analyst-agent | User idea, assumptions, current list UI behavior | 01-requirements-brief-column-visibility.md (11 sections) | — | Review gate pass |
| 2 Technical design | solution-architect-agent | Architect Handoff + full brief | 02-technical-design-column-visibility.md (9 sections) | Stage 1 Done | Review gate pass |

## Future stages (Not built)
- Developer, QA, Technical Writer, DevOps — implementation after design is approved.
