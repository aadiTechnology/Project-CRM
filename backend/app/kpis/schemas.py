"""Dashboard response for the signed-in role."""

from typing import Literal

from pydantic import BaseModel


class KpiCard(BaseModel):
    key: str
    label: str
    value: str
    hint: str
    tone: Literal["default", "attention", "good"] = "default"


class StageShare(BaseModel):
    status: str
    label: str
    count: int
    percent: float
    color: str


class SourceCount(BaseModel):
    source: str
    count: int


class PersonRow(BaseModel):
    user_id: str
    name: str
    leads: int
    calls_today: int
    connected: int
    no_answer: int
    overdue: int
    still_new: int
    won: int
    lost: int


class BusinessRow(BaseModel):
    company_id: str
    name: str
    projects: int
    users: int
    leads: int
    leads_this_week: int
    overdue: int
    calls_today: int
    quiet_projects: int


class ProjectRow(BaseModel):
    project_id: str
    name: str
    leads: int
    overdue: int
    calls_today: int
    salespeople: int


class CompanyOption(BaseModel):
    id: str
    name: str


class WeekPulse(BaseModel):
    new_leads: int
    calls: int
    connected: int
    no_answer: int
    won: int
    lost: int


class MoneyFoot(BaseModel):
    won_value: str | None = None
    pipeline_value: str | None = None


class KpiDashboardData(BaseModel):
    role: Literal["salesperson", "owner", "admin"]
    view: Literal["mine", "project", "businesses", "projects"]
    title: str
    subtitle: str
    cards: list[KpiCard]
    stages: list[StageShare]
    sources: list[SourceCount]
    people: list[PersonRow]
    businesses: list[BusinessRow]
    projects: list[ProjectRow]
    companies: list[CompanyOption]
    week: WeekPulse
    money: MoneyFoot | None = None
