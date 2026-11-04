"""One row per call so each summary is kept.

Revision ID: 0016_lead_calls
Revises: 0015_lead_field_show_as_column
Create Date: 2026-11-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0016_lead_calls"
down_revision = "0015_lead_field_show_as_column"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lead_calls",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("outcome", sa.String(length=20), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("outcome IN ('connected', 'no_answer')", name="ck_lead_calls_outcome"),
        sa.CheckConstraint(
            "outcome <> 'connected' OR (summary IS NOT NULL AND btrim(summary) <> '')",
            name="ck_lead_calls_connected_summary",
        ),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE", name="fk_lead_calls_lead_id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL", name="fk_lead_calls_user_id"),
    )
    op.create_index("ix_lead_calls_lead_created", "lead_calls", ["lead_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_lead_calls_lead_created", table_name="lead_calls")
    op.drop_table("lead_calls")
