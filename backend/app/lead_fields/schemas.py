"""Lead field request and response schemas."""

import re
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.lead_fields.models import FIELD_TYPES, OPTION_TYPES, LeadField

FieldType = Literal[
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
]

FIELD_TYPE_LABEL: dict[str, str] = {
    "text": "Text",
    "area": "Textarea",
    "number": "Number",
    "email": "Email",
    "phone": "Phone",
    "select": "Dropdown",
    "multi": "Multi-select",
    "radio": "Radio button",
    "check": "Checkbox (yes/no)",
    "date": "Date",
    "url": "URL",
}

_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


def slug_key(label: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    return (cleaned or "field")[:40]


def _collapse(value: str) -> str:
    return " ".join(value.split())


class CreateLeadFieldRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: uuid.UUID
    label: str = Field(min_length=2, max_length=40)
    field_type: FieldType
    options: list[str] | None = None
    is_required: bool = False
    show_in_list: bool = True
    show_as_column: bool = False
    is_active: bool = True

    @field_validator("label")
    @classmethod
    def clean_label(cls, value: str) -> str:
        cleaned = _collapse(value)
        if len(cleaned) < 2:
            raise ValueError("Label must be 2 to 40 characters.")
        return cleaned

    @field_validator("options")
    @classmethod
    def clean_options(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            text = _collapse(str(item))
            if not text or text.lower() in seen:
                continue
            seen.add(text.lower())
            cleaned.append(text[:80])
        return cleaned

    @model_validator(mode="after")
    def options_match_type(self) -> "CreateLeadFieldRequest":
        if self.field_type in OPTION_TYPES:
            if not self.options:
                raise ValueError("Add at least one option for this field type.")
        else:
            self.options = None
        return self


class UpdateLeadFieldRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, min_length=2, max_length=40)
    field_type: FieldType | None = None
    options: list[str] | None = None
    is_required: bool | None = None
    show_in_list: bool | None = None
    show_as_column: bool | None = None
    is_active: bool | None = None

    @field_validator("label")
    @classmethod
    def clean_label(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = _collapse(value)
        if len(cleaned) < 2:
            raise ValueError("Label must be 2 to 40 characters.")
        return cleaned

    @field_validator("options")
    @classmethod
    def clean_options(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        seen: set[str] = set()
        for item in value:
            text = _collapse(str(item))
            if not text or text.lower() in seen:
                continue
            seen.add(text.lower())
            cleaned.append(text[:80])
        return cleaned


class ReorderLeadFieldsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: uuid.UUID
    field_ids: list[uuid.UUID] = Field(min_length=1)


class LeadFieldPublic(BaseModel):
    id: str
    project_id: str
    key: str
    label: str
    field_type: str
    field_type_label: str
    options: list[str] | None
    is_required: bool
    show_in_list: bool
    show_as_column: bool
    is_active: bool
    sort_order: int
    leads_with_data: int


class LeadFieldListData(BaseModel):
    project_id: str
    project_name: str
    project_code: str
    common_fields: list[str]
    items: list[LeadFieldPublic]


COMMON_FIELDS = [
    "Contact person",
    "Mobile",
    "Enquiry date",
    "Location",
    "Email",
    "Requirement",
    "Call Summary",
    "Reference",
    "Lead source",
    "Priority",
    "Follow-up",
    "Status",
]


def to_lead_field_public(field: LeadField, leads_with_data: int = 0) -> LeadFieldPublic:
    options = field.options if isinstance(field.options, list) else None
    return LeadFieldPublic(
        id=str(field.id),
        project_id=str(field.project_id),
        key=field.key,
        label=field.label,
        field_type=field.field_type,
        field_type_label=FIELD_TYPE_LABEL.get(field.field_type, field.field_type),
        options=options,
        is_required=field.is_required,
        show_in_list=field.show_in_list,
        show_as_column=field.show_as_column,
        is_active=field.is_active,
        sort_order=field.sort_order,
        leads_with_data=leads_with_data,
    )


def is_valid_key(value: str) -> bool:
    return _KEY_RE.fullmatch(value) is not None


# Keep FIELD_TYPES imported for callers that validate against the DB set.
assert set(FIELD_TYPES) == set(FIELD_TYPE_LABEL)
