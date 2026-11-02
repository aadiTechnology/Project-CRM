"""Add show_as_column on lead_fields for Leads table columns.

Revision ID: 0015_lead_field_show_as_column
Revises: 0014_custom_followup_plan_steps
"""

import sqlalchemy as sa
from alembic import op

revision = "0015_lead_field_show_as_column"
down_revision = "0014_custom_followup_plan_steps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lead_fields",
        sa.Column(
            "show_as_column",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("lead_fields", "show_as_column")
