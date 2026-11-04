-- lead_calls: one row per call, so each summary is kept.
-- Postgres. Same change as Alembic revision 0016_lead_calls.
--
-- Use only ONE of these:
--   1. From the backend folder: alembic upgrade head
--   2. Run this file by hand, then stamp so Alembic does not create it again:
--        alembic stamp 0016_lead_calls
-- Do not do both.

CREATE TABLE IF NOT EXISTS lead_calls (
    id uuid PRIMARY KEY,
    lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    user_id uuid REFERENCES users (id) ON DELETE SET NULL,
    outcome varchar(20) NOT NULL,
    summary text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_lead_calls_outcome CHECK (outcome IN ('connected', 'no_answer')),
    CONSTRAINT ck_lead_calls_connected_summary CHECK (
        outcome <> 'connected' OR (summary IS NOT NULL AND btrim(summary) <> '')
    )
);

CREATE INDEX IF NOT EXISTS ix_lead_calls_lead_created ON lead_calls (lead_id, created_at);
