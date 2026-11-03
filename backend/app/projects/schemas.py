"""Project request and response schemas."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

TEMPLATES = ("GENERIC", "HIRING", "PANEERWALA", "PRESCHOOL", "SPACE-VIEW")
TemplateName = Literal["GENERIC", "HIRING", "PANEERWALA", "PRESCHOOL", "SPACE-VIEW"]


def _collapse(value: str) -> str:
    return " ".join(value.split())


def _clean_name(value: str) -> str:
    cleaned = _collapse(value)
    if len(cleaned) < 2:
        raise ValueError("Project name must be at least 2 characters.")
    return cleaned


class CreateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    code: str = Field(min_length=1, max_length=12)
    company_id: uuid.UUID
    template: TemplateName

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("code")
    @classmethod
    def clean_code(cls, value: str) -> str:
        cleaned = _collapse(value).upper().replace(" ", "")
        if not 2 <= len(cleaned) <= 12 or not cleaned.replace("-", "").isalnum() or not cleaned[0].isalpha():
            raise ValueError("Use 2 to 12 letters, numbers, or hyphens, starting with a letter.")
        if "--" in cleaned or cleaned.endswith("-"):
            raise ValueError("Use 2 to 12 letters, numbers, or hyphens, starting with a letter.")
        return cleaned


class UpdateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    status: Literal["active", "inactive"]

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str) -> str:
        return _collapse(value)


class CompanyOption(BaseModel):
    id: str
    name: str
    status: str


class ProjectPublic(BaseModel):
    id: str
    company_id: str
    company_name: str
    name: str
    code: str
    template: str
    description: str
    status: str
    lead_count: int
    next_lead_number: str


class ProjectListData(BaseModel):
    can_create: bool
    companies: list[CompanyOption]
    items: list[ProjectPublic]
