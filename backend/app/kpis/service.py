"""Role dashboards built from leads, calls, and project membership."""

from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.access.scope import resolve_record_scope
from app.audit.models import AuditLog
from app.common.exceptions import AppError, ErrorCode
from app.kpis.schemas import (
    BusinessRow,
    CompanyOption,
    KpiCard,
    KpiDashboardData,
    MoneyFoot,
    PersonRow,
    ProjectRow,
    SourceCount,
    StageShare,
    WeekPulse,
)
from app.leads.models import Lead, LeadCall
from app.leads.schemas import normalize_status
from app.organization.models import ACTIVE, Company, Project, ProjectMember
from app.pipeline.models import PipelineStage
from app.roles.models import Role, UserRole
from app.roles.service import RoleName
from app.users.models import User

IST = ZoneInfo("Asia/Kolkata")
STAGE_COLOR = {
    "new": "#3b82f6",
    "contacted": "#60a5fa",
    "in_progress": "#ca8a04",
    "qualified": "#1d4ed8",
    "nurture": "#7c3aed",
    "won": "#059669",
    "lost": "#dc2626",
}
EMPTY_WEEK = WeekPulse(new_leads=0, calls=0, connected=0, no_answer=0, won=0, lost=0)


def _role(user: User) -> str:
    names = {link.role.name for link in user.user_roles}
    if RoleName.SUPER_ADMIN in names:
        return "admin"
    if RoleName.BUSINESS_OWNER in names:
        return "owner"
    return "salesperson"


def _today_start(now: datetime | None = None) -> datetime:
    clock = now.astimezone(IST) if now else datetime.now(IST)
    return datetime(clock.year, clock.month, clock.day, tzinfo=IST)


def _local_day(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(IST)


def _money(value: Decimal) -> str:
    amount = value.quantize(Decimal("0.01"))
    return f"₹{amount:,.2f}"


def _card(key: str, label: str, value: int | str, hint: str, *, tone: str = "default") -> KpiCard:
    return KpiCard(key=key, label=label, value=str(value), hint=hint, tone=tone)  # type: ignore[arg-type]


def _validation(message: str) -> AppError:
    return AppError(ErrorCode.VALIDATION_ERROR, message, 422)


def _selected_range(
    date_from: date | None,
    date_to: date | None,
    now: datetime | None,
) -> tuple[datetime, datetime, datetime]:
    today_start = _today_start(now)
    start_day = date_from or date_to or today_start.date()
    end_day = date_to or date_from or today_start.date()
    if end_day < start_day:
        start_day, end_day = end_day, start_day
    start = datetime(start_day.year, start_day.month, start_day.day, tzinfo=IST)
    end = datetime(end_day.year, end_day.month, end_day.day, tzinfo=IST) + timedelta(days=1)
    if (end - start).days > 366:
        raise _validation("Choose a date range of one year or less.")
    return start, end, today_start


def build_kpi_dashboard(
    db: Session,
    *,
    actor: User,
    project_id: uuid.UUID | None = None,
    company_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    now: datetime | None = None,
) -> KpiDashboardData:
    role = _role(actor)
    range_start, range_end, today_start = _selected_range(date_from, date_to, now)
    if role == "admin" and project_id is None:
        if company_id is None:
            return _admin_businesses(db, range_start, range_end, today_start)
        return _admin_projects(db, company_id, range_start, range_end, today_start)
    return _work_dashboard(
        db,
        actor=actor,
        role=role,
        project_id=project_id,
        user_id=None if role == "salesperson" else user_id,
        range_start=range_start,
        range_end=range_end,
        today_start=today_start,
    )


def _companies(db: Session) -> list[CompanyOption]:
    rows = db.scalars(select(Company).where(Company.status == ACTIVE).order_by(Company.name)).all()
    return [CompanyOption(id=str(company.id), name=company.name) for company in rows]


def _admin_businesses(
    db: Session,
    range_start: datetime,
    range_end: datetime,
    today_start: datetime,
) -> KpiDashboardData:
    companies = list(db.scalars(select(Company).where(Company.status == ACTIVE).order_by(Company.name)).all())
    company_ids = [company.id for company in companies]
    if not company_ids:
        return KpiDashboardData(
            role="admin",
            view="businesses",
            title="Dashboard",
            subtitle="No active businesses yet.",
            cards=[],
            stages=[],
            sources=[],
            people=[],
            businesses=[],
            projects=[],
            companies=[],
            week=EMPTY_WEEK,
            money=None,
        )

    project_rows = db.execute(
        select(Project.company_id, Project.id).where(
            Project.company_id.in_(company_ids),
            Project.status == ACTIVE,
        )
    ).all()
    projects_by_company: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for company_id, project_id in project_rows:
        projects_by_company[company_id].append(project_id)

    user_counts = dict(
        db.execute(
            select(User.company_id, func.count())
            .where(User.company_id.in_(company_ids), User.is_active.is_(True))
            .group_by(User.company_id)
        ).all()
    )
    leads = list(
        db.scalars(
            select(Lead).where(Lead.company_id.in_(company_ids), Lead.is_deleted.is_(False))
        ).all()
    )
    lead_ids = [lead.id for lead in leads]
    calls_today = _calls_between(db, lead_ids, range_start, range_end)
    lead_by_id = {lead.id: lead for lead in leads}
    calls_by_project: Counter[uuid.UUID] = Counter()
    calls_by_company: Counter[uuid.UUID] = Counter()
    for call in calls_today:
        lead = lead_by_id.get(call.lead_id)
        if lead is None:
            continue
        calls_by_company[lead.company_id] += 1
        if lead.project_id is not None:
            calls_by_project[lead.project_id] += 1

    stages = _stage_flags(db, {lead.project_id for lead in leads if lead.project_id})
    today = today_start.date()
    businesses: list[BusinessRow] = []
    overdue_projects = 0
    quiet_projects = 0
    leads_week = 0
    for company in companies:
        company_leads = [lead for lead in leads if lead.company_id == company.id]
        overdue = 0
        week_count = 0
        project_overdue: set[uuid.UUID] = set()
        ranged_leads = [lead for lead in company_leads if _lead_in_range(lead, range_start, range_end)]
        week_count = len(ranged_leads)
        leads_week += week_count
        for lead in ranged_leads:
            if _is_overdue(lead, stages, today):
                overdue += 1
                if lead.project_id is not None:
                    project_overdue.add(lead.project_id)
        quiet = 0
        for project_id in projects_by_company.get(company.id, []):
            has_leads = any(lead.project_id == project_id for lead in company_leads)
            if has_leads and calls_by_project[project_id] == 0:
                quiet += 1
        overdue_projects += len(project_overdue)
        quiet_projects += quiet
        businesses.append(
            BusinessRow(
                company_id=str(company.id),
                name=company.name,
                projects=len(projects_by_company.get(company.id, [])),
                users=int(user_counts.get(company.id, 0)),
                leads=week_count,
                leads_this_week=week_count,
                overdue=overdue,
                calls_today=calls_by_company[company.id],
                quiet_projects=quiet,
            )
        )
    businesses.sort(key=lambda row: (-row.overdue, row.name.lower()))
    cards = [
        _card("businesses", "Businesses", len(companies), "Active organisations"),
        _card("projects", "Projects", sum(len(ids) for ids in projects_by_company.values()), "Active projects"),
        _card("users", "Users", sum(int(count) for count in user_counts.values()), "Active people"),
        _card("leads", "Leads", leads_week, "Added in the selected dates"),
        _card("leads_week", "New leads", leads_week, "Added in the selected dates"),
        _card(
            "overdue_projects",
            "Projects with overdue",
            overdue_projects,
            "At least one follow-up is late",
            tone="attention" if overdue_projects else "default",
        ),
        _card(
            "quiet_projects",
            "No calls",
            quiet_projects,
            "Projects with leads and no call in the selected dates",
            tone="attention" if quiet_projects else "default",
        ),
    ]
    return KpiDashboardData(
        role="admin",
        view="businesses",
        title="Dashboard",
        subtitle="Which business needs attention. Open one to see its projects.",
        cards=cards,
        stages=[],
        sources=[],
        people=[],
        businesses=businesses,
        projects=[],
        companies=[CompanyOption(id=str(company.id), name=company.name) for company in companies],
        week=EMPTY_WEEK,
        money=None,
    )


def _admin_projects(
    db: Session,
    company_id: uuid.UUID,
    range_start: datetime,
    range_end: datetime,
    today_start: datetime,
) -> KpiDashboardData:
    company = db.get(Company, company_id)
    if company is None or company.status != ACTIVE:
        raise _validation("Choose a business.")
    projects = list(
        db.scalars(
            select(Project)
            .where(Project.company_id == company_id, Project.status == ACTIVE)
            .order_by(Project.name)
        ).all()
    )
    project_ids = [project.id for project in projects]
    leads = list(
        db.scalars(
            select(Lead).where(
                Lead.company_id == company_id,
                Lead.is_deleted.is_(False),
                Lead.project_id.in_(project_ids) if project_ids else Lead.project_id.is_(None),
            )
        ).all()
    ) if project_ids else []
    stages = _stage_flags(db, set(project_ids))
    calls = _calls_between(db, [lead.id for lead in leads], range_start, range_end)
    calls_by_project: Counter[uuid.UUID] = Counter()
    lead_project = {lead.id: lead.project_id for lead in leads}
    for call in calls:
        project_id = lead_project.get(call.lead_id)
        if project_id is not None:
            calls_by_project[project_id] += 1
    sales_counts = _salesperson_counts(db, project_ids)
    today = today_start.date()
    rows: list[ProjectRow] = []
    for project in projects:
        project_leads = [
            lead
            for lead in leads
            if lead.project_id == project.id and _lead_in_range(lead, range_start, range_end)
        ]
        rows.append(
            ProjectRow(
                project_id=str(project.id),
                name=project.name,
                leads=len(project_leads),
                overdue=sum(1 for lead in project_leads if _is_overdue(lead, stages, today)),
                calls_today=calls_by_project[project.id],
                salespeople=sales_counts.get(project.id, 0),
            )
        )
    rows.sort(key=lambda row: (-row.overdue, -row.leads, row.name.lower()))
    quiet = sum(1 for row in rows if row.leads > 0 and row.calls_today == 0)
    overdue_projects = sum(1 for row in rows if row.overdue > 0)
    return KpiDashboardData(
        role="admin",
        view="projects",
        title="Dashboard",
        subtitle=f"Projects in {company.name}. Open one for the team’s calls.",
        cards=[
            _card("projects", "Projects", len(rows), company.name),
            _card("leads", "Leads", sum(row.leads for row in rows), "Added in the selected dates"),
            _card(
                "overdue_projects",
                "With overdue",
                overdue_projects,
                "Projects that have a late follow-up",
                tone="attention" if overdue_projects else "default",
            ),
            _card(
                "quiet_projects",
                "No calls",
                quiet,
                "Leads are waiting and nobody called",
                tone="attention" if quiet else "default",
            ),
        ],
        stages=[],
        sources=[],
        people=[],
        businesses=[],
        projects=rows,
        companies=_companies(db),
        week=EMPTY_WEEK,
        money=None,
    )


def _work_dashboard(
    db: Session,
    *,
    actor: User,
    role: str,
    project_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
    range_start: datetime,
    range_end: datetime,
    today_start: datetime,
) -> KpiDashboardData:
    scope = resolve_record_scope(db, actor)
    conditions = [Lead.is_deleted.is_(False)]
    if scope.company_id is not None:
        conditions.append(Lead.company_id == scope.company_id)
    if scope.owner_ids is not None:
        if not scope.owner_ids:
            conditions.append(Lead.id.is_(None))
        else:
            conditions.append(Lead.owner_id.in_(scope.owner_ids))
    if project_id is not None:
        conditions.append(Lead.project_id == project_id)
    project_leads = list(db.scalars(select(Lead).where(*conditions)).all())
    project_ids = {lead.project_id for lead in project_leads if lead.project_id is not None}
    if project_id is not None:
        project_ids.add(project_id)
    stages = _stage_flags(db, project_ids)
    roster_ids = [lead.id for lead in project_leads]
    roster_calls = _calls_between(db, roster_ids, range_start, range_end)
    ranged_leads = [lead for lead in project_leads if _lead_in_range(lead, range_start, range_end)]
    today = today_start.date()
    people: list[PersonRow] = []
    if project_id is not None and role != "salesperson":
        people = _people(db, project_id, ranged_leads, stages, roster_calls, today)
    focus_name = ""
    leads = ranged_leads
    call_leads = project_leads
    if user_id is not None and project_id is not None and role != "salesperson":
        match = next((person for person in people if person.user_id == str(user_id)), None)
        if match is None:
            raise _validation("Choose a salesperson on this project.")
        focus_name = match.name
        leads = [lead for lead in ranged_leads if lead.owner_id == user_id]
        call_leads = [lead for lead in project_leads if lead.owner_id == user_id]
    lead_ids = [lead.id for lead in leads]
    call_ids = [lead.id for lead in call_leads]
    calls_in_range = _calls_between(db, call_ids, range_start, range_end)
    called_ever = set(db.scalars(select(LeadCall.lead_id).where(LeadCall.lead_id.in_(lead_ids))).all()) if lead_ids else set()
    view = "mine" if role == "salesperson" or focus_name else "project"
    summary = _summarize(
        leads,
        stages,
        calls_in_range,
        called_ever,
        today=today,
        range_start=range_start,
        range_end=range_end,
        won_ids=_moved_ids(db, call_ids, range_start, range_end, "won"),
        lost_ids=_moved_ids(db, call_ids, range_start, range_end, "lost"),
    )
    money = _money_foot(leads, stages) if role != "salesperson" else None
    if focus_name:
        subtitle = f"{focus_name}'s leads and calls in the selected dates."
    elif view == "mine":
        subtitle = "Your leads and calls in the selected dates."
    elif project_id is None:
        subtitle = "Every lead you can see. Pick a project to see each salesperson."
    else:
        subtitle = "How this project’s team is working."
    cards = _work_cards(view, summary)
    if view == "project":
        cards = _work_cards_with_roster(cards, people)
    return KpiDashboardData(
        role=role,  # type: ignore[arg-type]
        view=view,  # type: ignore[arg-type]
        title="Dashboard",
        subtitle=subtitle,
        cards=cards,
        stages=summary["stages"],
        sources=summary["sources"],
        people=people,
        businesses=[],
        projects=[],
        companies=_companies(db) if role == "admin" else [],
        week=summary["week"],
        money=money,
    )


def _summarize(
    leads: list[Lead],
    stages: dict[tuple[uuid.UUID | None, str], dict],
    calls_in_range: list[LeadCall],
    called_ever: set[uuid.UUID],
    *,
    today,
    range_start: datetime,
    range_end: datetime,
    won_ids: set[uuid.UUID],
    lost_ids: set[uuid.UUID],
) -> dict:
    status_counts: Counter[str] = Counter()
    source_counts: Counter[str] = Counter()
    due_today = overdue = never_called = no_followup = still_new = 0
    won = lost = new_week = 0
    for lead in leads:
        status = normalize_status(lead.status)
        flags = stages.get((lead.project_id, status), {})
        label = flags.get("label") or status.replace("_", " ").title()
        status_counts[status] += 1
        source_counts[(lead.lead_source or "").strip() or "Not set"] += 1
        is_won = bool(flags.get("won")) or status == "won"
        is_lost = bool(flags.get("lost")) or status == "lost"
        is_entry = bool(flags.get("entry")) or status == "new"
        closed = is_won or is_lost
        if is_won:
            won += 1
        if is_lost:
            lost += 1
        if is_entry:
            still_new += 1
        if _lead_in_range(lead, range_start, range_end):
            new_week += 1
        if not closed and lead.next_followup_at is None:
            no_followup += 1
        due = lead.next_followup_at
        if due is not None and not closed:
            due_day = _local_day(due).date()
            if due_day < today:
                overdue += 1
            elif due_day == today:
                due_today += 1
        has_note = bool((lead.call_summary or "").strip())
        if lead.id not in called_ever and not has_note and not closed:
            never_called += 1

    connected = sum(1 for call in calls_in_range if call.outcome == "connected")
    no_answer = sum(1 for call in calls_in_range if call.outcome == "no_answer")
    total = len(leads)
    appearance: dict[str, tuple[str, str, int]] = {}
    for (_project_id, status), flags in stages.items():
        sort = int(flags.get("sort", 99))
        current = appearance.get(status)
        if current is None or sort < current[2]:
            appearance[status] = (
                flags.get("label") or status.replace("_", " ").title(),
                flags.get("color") or STAGE_COLOR.get(status, "#64748b"),
                sort,
            )
    stage_list = [
        StageShare(
            status=status,
            label=appearance.get(status, (status.replace("_", " ").title(), STAGE_COLOR.get(status, "#64748b"), 99))[0],
            count=count,
            percent=0.0 if total == 0 else round((count / total) * 100, 1),
            color=appearance.get(status, (status.replace("_", " ").title(), STAGE_COLOR.get(status, "#64748b"), 99))[1],
            )
        for status, count in status_counts.items()
    ]
    stage_list.sort(key=lambda row: appearance.get(row.status, ("", "", 99))[2])
    sources = [SourceCount(source=name, count=count) for name, count in source_counts.most_common()]
    return {
        "total": total,
        "due_today": due_today,
        "overdue": overdue,
        "never_called": never_called,
        "no_followup": no_followup,
        "still_new": still_new,
        "won": won,
        "lost": lost,
        "calls_today": len(calls_in_range),
        "connected": connected,
        "no_answer": no_answer,
        "stages": stage_list,
        "sources": sources,
        "week": WeekPulse(
            new_leads=new_week,
            calls=len(calls_in_range),
            connected=connected,
            no_answer=no_answer,
            won=len(won_ids),
            lost=len(lost_ids),
        ),
    }


def _work_cards(view: str, summary: dict) -> list[KpiCard]:
    shared = [
        _card("total", "Total leads", summary["total"], "Added in the selected dates"),
        _card("connected", "Connected", summary["connected"], "Calls where someone picked up"),
        _card("not_connected", "Not connected", summary["no_answer"], "Calls with no answer"),
        _card("won", "Won", summary["won"], "Leads marked won", tone="good" if summary["won"] else "default"),
        _card("calls", "Calls", summary["calls_today"], "Calls logged in the selected dates"),
        _card("due_today", "Due today", summary["due_today"], "Follow-ups scheduled for today"),
        _card(
            "overdue",
            "Overdue",
            summary["overdue"],
            "Follow-ups that are already late",
            tone="attention" if summary["overdue"] else "default",
        ),
        _card("never_called", "Never called", summary["never_called"], "No call and no imported note"),
        _card("no_followup", "No next follow-up", summary["no_followup"], "Open leads with no due date"),
        _card("still_new", "Still new", summary["still_new"], "Leads that have not moved"),
        _card("lost", "Lost", summary["lost"], "Leads marked lost"),
    ]
    if view == "mine":
        return shared
    week = summary["week"]
    return shared + [
        _card("new_leads", "New leads", week.new_leads, "Added in the selected dates"),
        _card(
            "won_in_dates",
            "Won in dates",
            week.won,
            "Moved to won in the selected dates",
            tone="good" if week.won else "default",
        ),
        _card("lost_in_dates", "Lost in dates", week.lost, "Moved to lost in the selected dates"),
    ]


def _people(
    db: Session,
    project_id: uuid.UUID,
    leads: list[Lead],
    stages: dict,
    calls_today: list[LeadCall],
    today,
) -> list[PersonRow]:
    salespeople = list(
        db.scalars(
            select(User)
            .join(ProjectMember, ProjectMember.user_id == User.id)
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                ProjectMember.project_id == project_id,
                Role.name == RoleName.SALESPERSON,
                User.is_active.is_(True),
            )
            .order_by(User.full_name)
        ).all()
    )
    by_id = {person.id: person for person in salespeople}
    rows: list[PersonRow] = []
    for person in by_id.values():
        owned = [lead for lead in leads if lead.owner_id == person.id]
        mine = [call for call in calls_today if call.user_id == person.id]
        rows.append(
            PersonRow(
                user_id=str(person.id),
                name=person.full_name,
                leads=len(owned),
                calls_today=len(mine),
                connected=sum(1 for call in mine if call.outcome == "connected"),
                no_answer=sum(1 for call in mine if call.outcome == "no_answer"),
                overdue=sum(1 for lead in owned if _is_overdue(lead, stages, today)),
                still_new=sum(
                    1
                    for lead in owned
                    if _is_entry(lead, stages)
                ),
                won=sum(1 for lead in owned if _is_won(lead, stages)),
                lost=sum(1 for lead in owned if _is_lost(lead, stages)),
            )
        )
    rows.sort(key=lambda row: (-row.overdue, -row.calls_today, row.name.lower()))
    return rows


def _work_cards_with_roster(cards: list[KpiCard], people: list[PersonRow]) -> list[KpiCard]:
    if not people:
        return cards
    called = sum(1 for row in people if row.calls_today > 0)
    roster = _card(
        "salespeople",
        "Salespeople",
        len(people),
        f"{called} logged a call in the selected dates",
        tone="attention" if called < len(people) else "good",
    )
    return [roster, *cards]


def _money_foot(leads: list[Lead], stages: dict) -> MoneyFoot | None:
    won_sum = Decimal("0")
    pipe_sum = Decimal("0")
    won_seen = pipe_seen = False
    for lead in leads:
        if _is_won(lead, stages):
            amount = lead.order_amount if lead.order_amount is not None else lead.expected_value
            if amount is not None:
                won_seen = True
                won_sum += Decimal(amount)
        elif not _is_lost(lead, stages) and lead.expected_value is not None:
            pipe_seen = True
            pipe_sum += Decimal(lead.expected_value)
    if not won_seen and not pipe_seen:
        return None
    return MoneyFoot(
        won_value=_money(won_sum) if won_seen else None,
        pipeline_value=_money(pipe_sum) if pipe_seen else None,
    )


def _calls_between(db: Session, lead_ids: list[uuid.UUID], start: datetime, end: datetime) -> list[LeadCall]:
    if not lead_ids:
        return []
    return list(
        db.scalars(
            select(LeadCall).where(
                LeadCall.lead_id.in_(lead_ids),
                LeadCall.created_at >= start,
                LeadCall.created_at < end,
            )
        ).all()
    )


def _moved_ids(
    db: Session,
    lead_ids: list[uuid.UUID],
    start: datetime,
    end: datetime,
    target: str,
) -> set[uuid.UUID]:
    if not lead_ids:
        return set()
    rows = db.scalars(
        select(AuditLog).where(
            AuditLog.action == "lead_updated",
            AuditLog.target_type == "lead",
            AuditLog.target_id.in_(lead_ids),
            AuditLog.created_at >= start,
            AuditLog.created_at < end,
        )
    ).all()
    found: set[uuid.UUID] = set()
    for row in rows:
        changes = (row.context or {}).get("changes") or {}
        status = changes.get("status") or {}
        if status.get("to") == target and row.target_id is not None:
            found.add(row.target_id)
    return found


def _stage_flags(db: Session, project_ids: set[uuid.UUID]) -> dict[tuple[uuid.UUID | None, str], dict]:
    if not project_ids:
        return {}
    rows = db.scalars(select(PipelineStage).where(PipelineStage.project_id.in_(project_ids))).all()
    flags: dict[tuple[uuid.UUID | None, str], dict] = {}
    for stage in rows:
        flags[(stage.project_id, stage.key)] = {
            "won": stage.is_won,
            "lost": stage.is_lost,
            "entry": stage.is_entry,
            "label": stage.label,
            "color": stage.color,
            "sort": stage.sort_order,
        }
    return flags


def _salesperson_counts(db: Session, project_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not project_ids:
        return {}
    rows = db.execute(
        select(ProjectMember.project_id, func.count())
        .join(User, User.id == ProjectMember.user_id)
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            ProjectMember.project_id.in_(project_ids),
            Role.name == RoleName.SALESPERSON,
            User.is_active.is_(True),
        )
        .group_by(ProjectMember.project_id)
    ).all()
    return {project_id: int(count) for project_id, count in rows}


def _lead_on(lead: Lead) -> date:
    """Enquiry date is the lead's own date. Leads without one use the day they were added."""

    if lead.enquiry_date is not None:
        return lead.enquiry_date
    return _local_day(lead.created_at).date()


def _lead_in_range(lead: Lead, start: datetime, end: datetime) -> bool:
    day = _lead_on(lead)
    return start.date() <= day < end.date()


def _flags(lead: Lead, stages: dict) -> dict:
    return stages.get((lead.project_id, normalize_status(lead.status)), {})


def _is_won(lead: Lead, stages: dict) -> bool:
    return bool(_flags(lead, stages).get("won")) or normalize_status(lead.status) == "won"


def _is_lost(lead: Lead, stages: dict) -> bool:
    return bool(_flags(lead, stages).get("lost")) or normalize_status(lead.status) == "lost"


def _is_entry(lead: Lead, stages: dict) -> bool:
    return bool(_flags(lead, stages).get("entry")) or normalize_status(lead.status) == "new"


def _is_overdue(lead: Lead, stages: dict, today) -> bool:
    if lead.next_followup_at is None or _is_won(lead, stages) or _is_lost(lead, stages):
        return False
    return _local_day(lead.next_followup_at).date() < today
