"""Extra lead field definitions scoped to one project."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.core.database import Base

FIELD_TYPES = (
    "text",
    "area",
    "number",
    "email",
    "phone",
    "select",
    "multi",
    "radio",
    "check",
    "date",
    "url",
)
OPTION_TYPES = frozenset({"select", "multi", "radio"})


class LeadField(Base):
    __tablename__ = "lead_fields"
    __table_args__ = (
        CheckConstraint(
            "field_type IN ("
            "'text', 'area', 'number', 'email', 'phone', 'select', 'multi', "
            "'radio', 'check', 'date', 'url')",
            name="ck_lead_fields_field_type",
        ),
        UniqueConstraint("project_id", "key", name="uq_lead_fields_project_key"),
        Index("ix_lead_fields_project_sort", "project_id", "sort_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(40), nullable=False)
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    field_type: Mapped[str] = mapped_column(String(20), nullable=False)
    options: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    show_in_list: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    show_as_column: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
