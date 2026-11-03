"""Lead request and response schemas."""

import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.auth.schemas import normalize_email
from app.leads.models import Lead

LeadStatus = str
LeadPriority = Literal["low", "medium", "high"]
LeadPlanStep = str

# Demo seed rows used title-case labels; API always returns canonical values.
_PRIORITY_PUBLIC = {
    "low": "low",
    "medium": "medium",
    "high": "high",
    "Cold": "low",
    "Warm": "medium",
    "Hot": "high",
}
_STATUS_PUBLIC = {
    "new": "new",
    "contacted": "contacted",
    "qualified": "qualified",
    "unqualified": "lost",
    "lost": "lost",
    "New": "new",
    "Contacted": "contacted",
    "In Progress": "in_progress",
    "in_progress": "in_progress",
    "Qualified": "qualified",
    "Won": "won",
    "won": "won",
    "Lost": "lost",
    "Nurture": "nurture",
    "nurture": "nurture",
}


def normalize_priority(value: str) -> str:
    return _PRIORITY_PUBLIC.get(value, "medium")


def normalize_status(value: str) -> str:
    mapped = _STATUS_PUBLIC.get(value)
    if mapped is not None:
        return mapped
    cleaned = value.strip().lower().replace(" ", "_")
    return cleaned[:40] or "new"

def _collapse(value: str) -> str:
    return " ".join(value.split())


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


class CreateLeadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1, max_length=120)
    mobile: str = Field(min_length=1, max_length=20)
    alternate_mobile: str | None = Field(default=None, max_length=20)
    email: EmailStr | None = Field(default=None, max_length=150)
    company_name: str | None = Field(default=None, max_length=150)
    city: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=4000)
    requirement: str | None = Field(default=None, max_length=4000)
    expected_value: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    enquiry_date: date | None = None
    reference_name: str | None = Field(default=None, max_length=120)
    call_summary: str | None = Field(default=None, max_length=4000)
    lead_source: str | None = Field(default=None, max_length=80)
    owner_id: uuid.UUID | None = None
    company_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    status: str | None = Field(default=None, max_length=40)
    priority: LeadPriority = "medium"
    plan_step: LeadPlanStep = Field(default="Day 1", min_length=1, max_length=40)
    next_followup_at: datetime
    extra_values: dict[str, Any] | None = None

    @field_validator("full_name")
    @classmethod
    def clean_full_name(cls, value: str) -> str:
        cleaned = _collapse(value)
        if len(cleaned) < 2:
            raise ValueError("Full name must be at least 2 characters.")
        return cleaned

    @field_validator("email", mode="before")
    @classmethod
    def blank_email(cls, value: object) -> object:
        if isinstance(value, str):
            cleaned = normalize_email(value)
            return cleaned or None
        return value

    @field_validator("company_name", "city", "lead_source", "reference_name")
    @classmethod
    def clean_short_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _optional_text(_collapse(value))

    @field_validator("address", "requirement", "alternate_mobile", "call_summary")
    @classmethod
    def clean_free_text(cls, value: str | None) -> str | None:
        return _optional_text(value)

    @field_validator("mobile")
    @classmethod
    def clean_mobile(cls, value: str) -> str:
        digits = re.sub(r"\D+", "", value or "")
        if len(digits) not in (10, 12):
            raise ValueError("Mobile number must be 10 or 12 digits.")
        return digits


class UpdateLeadRequest(BaseModel):
    """Omitted fields stay unchanged. Null clears an optional text field."""

    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, max_length=120)
    mobile: str | None = Field(default=None, max_length=20)
    alternate_mobile: str | None = Field(default=None, max_length=20)
    email: EmailStr | None = Field(default=None, max_length=150)
    company_name: str | None = Field(default=None, max_length=150)
    city: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=4000)
    requirement: str | None = Field(default=None, max_length=4000)
    expected_value: Decimal | None = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    enquiry_date: date | None = None
    reference_name: str | None = Field(default=None, max_length=120)
    call_summary: str | None = Field(default=None, max_length=4000)
    lead_source: str | None = Field(default=None, max_length=80)
    owner_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    status: str | None = Field(default=None, max_length=40)
    priority: LeadPriority | None = None
    plan_step: LeadPlanStep | None = Field(default=None, min_length=1, max_length=40)
    next_followup_at: datetime | None = None
    extra_values: dict[str, Any] | None = None

    @field_validator("full_name")
    @classmethod
    def clean_full_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = _collapse(value)
        if len(cleaned) < 2:
            raise ValueError("Full name must be at least 2 characters.")
        return cleaned

    @field_validator("email", mode="before")
    @classmethod
    def blank_email(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            cleaned = normalize_email(value)
            return cleaned or None
        return value

    @field_validator("company_name", "city", "lead_source", "reference_name")
    @classmethod
    def clean_short_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _optional_text(_collapse(value))

    @field_validator("address", "requirement", "alternate_mobile", "mobile", "call_summary")
    @classmethod
    def clean_free_text(cls, value: str | None) -> str | None:
        return _optional_text(value)


class LeadPublic(BaseModel):
    id: str
    company_id: str
    project_id: str | None
    project_name: str | None
    lead_number: str
    full_name: str
    mobile: str
    alternate_mobile: str | None
    email: str | None
    company_name: str | None
    city: str | None
    address: str | None
    requirement: str | None
    expected_value: str | None
    enquiry_date: date | None
    reference_name: str | None
    call_summary: str | None
    lead_source: str | None
    owner_id: str
    created_by_id: str
    status: str
    priority: str
    plan_step: str
    next_followup_at: datetime | None
    extra_values: dict[str, Any]
    is_deleted: bool
    created_at: datetime
    updated_at: datetime


class LeadListData(BaseModel):
    items: list[LeadPublic]
    total: int


class ImportLeadError(BaseModel):
    row: int
    message: str
    name: str | None = None
    mobile: str | None = None


class ImportLeadsResult(BaseModel):
    created: int
    skipped: int
    errors: list[ImportLeadError]
    headers_seen: list[str]


class LeadActivityItem(BaseModel):
    id: str
    actor_name: str
    at: datetime
    message: str


class LeadActivityList(BaseModel):
    items: list[LeadActivityItem]


def to_lead_public(lead: Lead, project_name: str | None = None) -> LeadPublic:
    expected = None if lead.expected_value is None else f"{lead.expected_value:.2f}"
    extras = lead.extra_values if isinstance(lead.extra_values, dict) else {}
    return LeadPublic(
        id=str(lead.id),
        company_id=str(lead.company_id),
        project_id=None if lead.project_id is None else str(lead.project_id),
        project_name=project_name,
        lead_number=lead.lead_number,
        full_name=lead.full_name,
        mobile=lead.mobile,
        alternate_mobile=lead.alternate_mobile,
        email=lead.email,
        company_name=lead.company_name,
        city=lead.city,
        address=lead.address,
        requirement=lead.requirement,
        expected_value=expected,
        enquiry_date=lead.enquiry_date,
        reference_name=lead.reference_name,
        call_summary=lead.call_summary,
        lead_source=lead.lead_source,
        owner_id=str(lead.owner_id),
        created_by_id=str(lead.created_by_id),
        status=normalize_status(lead.status),
        priority=normalize_priority(lead.priority),
        plan_step=(lead.plan_step or "Day 1").strip()[:40] or "Day 1",
        next_followup_at=lead.next_followup_at,
        extra_values=extras,
        is_deleted=lead.is_deleted,
        created_at=lead.created_at,
        updated_at=lead.updated_at,
    )
