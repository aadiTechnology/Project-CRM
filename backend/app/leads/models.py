"""Lead persistence. Tasks, activities, and deals are separate modules."""

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.database import Base

NEW = "new"
CONTACTED = "contacted"
QUALIFIED = "qualified"
UNQUALIFIED = "unqualified"
LOST = "lost"
IN_PROGRESS = "In Progress"
WON = "Won"
NURTURE = "Nurture"
STATUSES = (
    NEW,
    CONTACTED,
    QUALIFIED,
    UNQUALIFIED,
    LOST,
    "New",
    "Contacted",
    IN_PROGRESS,
    "Qualified",
    WON,
    "Lost",
    NURTURE,
)

LOW = "low"
MEDIUM = "medium"
HIGH = "high"
HOT = "Hot"
WARM = "Warm"
COLD = "Cold"
PRIORITIES = (LOW, MEDIUM, HIGH, HOT, WARM, COLD)

PLAN_DAY_1 = "Day 1"
PLAN_DAY_3 = "Day 3"
PLAN_DAY_7 = "Day 7"
PLAN_DAY_21 = "Day 21"
PLAN_MONTH_3 = "3-month review"
PLAN_CUSTOM = "Custom"
PLAN_STEPS = (PLAN_DAY_1, PLAN_DAY_3, PLAN_DAY_7, PLAN_DAY_21, PLAN_MONTH_3, PLAN_CUSTOM)


class Lead(Base):
    __tablename__ = "leads"
    __table_args__ = (
        CheckConstraint(
            "priority IN ('low', 'medium', 'high', 'Hot', 'Warm', 'Cold')",
            name="ck_leads_priority",
        ),
        CheckConstraint(
            "expected_value IS NULL OR expected_value >= 0",
            name="ck_leads_expected_value",
        ),
        CheckConstraint(
            "order_amount IS NULL OR order_amount >= 0",
            name="ck_leads_order_amount",
        ),
        UniqueConstraint("company_id", "lead_number", name="uq_leads_company_lead_number"),
        Index("ix_leads_company_owner_status", "company_id", "owner_id", "status"),
        Index("ix_leads_mobile", "mobile"),
        Index("ix_leads_email", "email"),
        Index("ix_leads_lead_source", "lead_source"),
        Index("ix_leads_next_followup_at", "next_followup_at"),
        Index("ix_leads_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("companies.id", ondelete="RESTRICT"),
        nullable=False,
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    lead_number: Mapped[str] = mapped_column(String(30), nullable=False)
    enquiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    location: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reference_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    call_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    recruitment_stage: Mapped[str | None] = mapped_column(String(80), nullable=True)
    recruitment_outcome: Mapped[str | None] = mapped_column(String(80), nullable=True)
    site: Mapped[str | None] = mapped_column(String(200), nullable=True)
    order_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    mobile: Mapped[str] = mapped_column(String(20), nullable=False)
    alternate_mobile: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(150), nullable=True)
    company_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    requirement: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_value: Mapped[Decimal | None] = mapped_column(Numeric(15, 2), nullable=True)
    lead_source: Mapped[str | None] = mapped_column(String(80), nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False, server_default=text("'new'"))
    priority: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'medium'"))
    next_followup_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    plan_step: Mapped[str] = mapped_column(String(40), nullable=False, server_default=text("'Day 1'"))
    extra_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LeadCall(Base):
    """One row per call. The lead's call_summary stays the latest note only."""

    __tablename__ = "lead_calls"
    __table_args__ = (
        CheckConstraint("outcome IN ('connected', 'no_answer')", name="ck_lead_calls_outcome"),
        CheckConstraint(
            "outcome <> 'connected' OR (summary IS NOT NULL AND btrim(summary) <> '')",
            name="ck_lead_calls_connected_summary",
        ),
        Index("ix_lead_calls_lead_created", "lead_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("leads.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    outcome: Mapped[str] = mapped_column(String(20), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
