# Agent workflow lessons

## 2026-11-01 — Column visibility analysis
- Prior Follow-ups/KPIs docs already occupied `00-plan.md` / `02-technical-design.md`; versioned filenames (`*-column-visibility.md`) avoided overwrite.
- User asked only for analyze first — complete BA + review gate before starting architect unless they ask to design/build.
- Lead Fields `show_in_list` looks like “columns” in admin copy but is subtitle-only; call out that distinction early to avoid scope creep into custom-field columns.

## 2026-11-01 — Column visibility build
- User confirmed per-screen prefs; accepted remaining defaults — proceed to SA then implement without another clarification round.
- localStorage keyed by userId+screen matched existing followup-plan pattern and avoided backend work for MVP.
- Destructure hook fields in pages to keep eslint hook deps clean (avoid whole `columnsUi` object).
