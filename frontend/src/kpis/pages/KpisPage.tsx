import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import PhoneDisabledOutlinedIcon from '@mui/icons-material/PhoneDisabledOutlined'
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined'
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined'
import FiberNewOutlinedIcon from '@mui/icons-material/FiberNewOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import StarOutlineIcon from '@mui/icons-material/StarOutline'
import HighlightOffOutlinedIcon from '@mui/icons-material/HighlightOffOutlined'
import DomainOutlinedIcon from '@mui/icons-material/DomainOutlined'
import WorkOutlineOutlinedIcon from '@mui/icons-material/WorkOutlineOutlined'
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import CurrencyRupeeIcon from '@mui/icons-material/CurrencyRupee'
import ViewColumnOutlinedIcon from '@mui/icons-material/ViewColumnOutlined'
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  MenuItem,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import { toolbarIconSx } from '../../components/common/toolbarStyles'
import type { LeadProjectOption } from '../../leads/types'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'
import { useAuth } from '../../store/auth-context'

type Tone = 'default' | 'attention' | 'good'
type Card = { key: string; label: string; value: string; hint: string; tone: Tone }
type Stage = { status: string; label: string; count: number; percent: number; color: string }
type Source = { source: string; count: number }
type Person = {
  user_id: string
  name: string
  leads: number
  calls_today: number
  connected: number
  no_answer: number
  overdue: number
  still_new: number
  won: number
  lost: number
}
type Business = {
  company_id: string
  name: string
  projects: number
  users: number
  leads: number
  leads_this_week: number
  overdue: number
  calls_today: number
  quiet_projects: number
}
type ProjectRow = {
  project_id: string
  name: string
  leads: number
  overdue: number
  calls_today: number
  salespeople: number
}
type Dashboard = {
  role: 'salesperson' | 'owner' | 'admin'
  view: 'mine' | 'project' | 'businesses' | 'projects'
  title: string
  subtitle: string
  cards: Card[]
  stages: Stage[]
  sources: Source[]
  people: Person[]
  businesses: Business[]
  projects: ProjectRow[]
  companies: { id: string; name: string }[]
  week: { new_leads: number; calls: number; connected: number; no_answer: number; won: number; lost: number }
  money: { won_value: string | null; pipeline_value: string | null } | null
}

const ICONS: Record<string, typeof GroupsOutlinedIcon> = {
  total: GroupsOutlinedIcon,
  connected: PhoneOutlinedIcon,
  not_connected: PhoneDisabledOutlinedIcon,
  calls: PhoneOutlinedIcon,
  due_today: TodayOutlinedIcon,
  overdue: ErrorOutlineIcon,
  never_called: PersonOffOutlinedIcon,
  no_followup: EventBusyOutlinedIcon,
  still_new: FiberNewOutlinedIcon,
  aging_new: HistoryOutlinedIcon,
  won: StarOutlineIcon,
  lost: HighlightOffOutlinedIcon,
  salespeople: GroupsOutlinedIcon,
  new_leads: FiberNewOutlinedIcon,
  won_in_dates: StarOutlineIcon,
  lost_in_dates: HighlightOffOutlinedIcon,
  businesses: DomainOutlinedIcon,
  projects: WorkOutlineOutlinedIcon,
  users: PeopleAltOutlinedIcon,
  leads: GroupsOutlinedIcon,
  leads_week: FiberNewOutlinedIcon,
  overdue_projects: ErrorOutlineIcon,
  quiet_projects: PhoneOutlinedIcon,
}

const SALES_DEFAULT = ['total', 'connected', 'not_connected', 'won']
const TEAM_DEFAULT = ['total', 'connected', 'not_connected', 'won', 'overdue', 'salespeople']
const OVERVIEW_DEFAULT = [
  'businesses',
  'projects',
  'users',
  'leads',
  'leads_week',
  'overdue_projects',
  'quiet_projects',
]
const CARD_KEYS = [
  ...SALES_DEFAULT,
  'calls',
  'due_today',
  'overdue',
  'never_called',
  'no_followup',
  'still_new',
  'aging_new',
  'lost',
  'salespeople',
  'new_leads',
  'won_in_dates',
  'lost_in_dates',
  ...OVERVIEW_DEFAULT,
]

function todayInput() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function cardsStorageKey(userId: string) {
  return `aaditech.dashboardCards.v1.${userId}`
}

function defaultVisibility(role: Dashboard['role']) {
  const on = new Set(role === 'salesperson' ? SALES_DEFAULT : [...TEAM_DEFAULT, ...OVERVIEW_DEFAULT])
  return Object.fromEntries(CARD_KEYS.map((key) => [key, on.has(key)]))
}

function loadCardVisibility(userId: string | undefined, role: Dashboard['role']) {
  const base = defaultVisibility(role)
  if (!userId) return base
  try {
    const raw = localStorage.getItem(cardsStorageKey(userId))
    if (!raw) return base
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const next = { ...base }
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') next[key] = value
    }
    return next
  } catch {
    return base
  }
}

function saveCardVisibility(userId: string | undefined, visibility: Record<string, boolean>) {
  if (!userId) return
  localStorage.setItem(cardsStorageKey(userId), JSON.stringify(visibility))
}

function cardColumns(count: number) {
  if (count <= 1) return { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 280px)' }
  if (count === 2) return { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }
  if (count === 3) return { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }
  if (count === 4) return { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }
  return { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }
}

function dashboardRole(roles: string[]): Dashboard['role'] {
  if (roles.includes('SUPER_ADMIN')) return 'admin'
  if (roles.includes('BUSINESS_OWNER')) return 'owner'
  return 'salesperson'
}

function cardPath(role: Dashboard['role'], key: string): string | null {
  if (key === 'due_today' || key === 'overdue' || key === 'calls' || key === 'connected' || key === 'not_connected') {
    return role === 'salesperson' ? '/app/reminders' : '/app/follow-ups'
  }
  if (key === 'no_followup') return '/app/follow-ups'
  if (key === 'won' || key === 'lost' || key === 'won_in_dates' || key === 'lost_in_dates') return '/app/pipeline'
  if (
    key === 'total' ||
    key === 'never_called' ||
    key === 'still_new' ||
    key === 'aging_new' ||
    key === 'new_leads' ||
    key === 'leads'
  ) {
    return '/app/leads'
  }
  return null
}

export function KpisPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const role = dashboardRole(user?.roles ?? [])
  const [projects, setProjects] = useState<LeadProjectOption[]>([])
  const [projectsReady, setProjectsReady] = useState(false)
  const [companyId, setCompanyId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [dateFrom, setDateFrom] = useState(todayInput)
  const [dateTo, setDateTo] = useState(todayInput)
  const [cardVisibility, setCardVisibility] = useState<Record<string, boolean>>(() =>
    loadCardVisibility(user?.id, role),
  )

  useEffect(() => {
    setCardVisibility(loadCardVisibility(user?.id, role))
  }, [role, user?.id])
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const loadSeq = useRef(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await api.get<{ items: LeadProjectOption[] }>('/api/v1/projects')
        if (cancelled) return
        setProjects(result.data.items)
      } catch {
        if (!cancelled) setProjects([])
      } finally {
        if (!cancelled) setProjectsReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setError('')
    try {
      const params = new URLSearchParams()
      if (projectId) params.set('project_id', projectId)
      else if (companyId) params.set('company_id', companyId)
      if (projectId && employeeId && role !== 'salesperson') params.set('user_id', employeeId)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const query = params.toString()
      const result = await api.get<Dashboard>(`/api/v1/kpis${query ? `?${query}` : ''}`)
      if (seq !== loadSeq.current) return
      setData(result.data)
    } catch (requestError) {
      if (seq !== loadSeq.current) return
      setError(requestError instanceof ApiError ? requestError.message : 'Could not load the dashboard.')
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [companyId, dateFrom, dateTo, employeeId, projectId, role])

  useEffect(() => {
    if (!projectsReady) return
    if (role !== 'admin' && !projectId && projects.length > 0) {
      setProjectId(projects[0].id)
      return
    }
    setLoading(true)
    void load()
  }, [load, projectId, projects, projectsReady, role])

  const projectChoices = useMemo(
    () => (companyId ? projects.filter((project) => project.company_id === companyId) : projects),
    [companyId, projects],
  )
  const companies = data?.companies ?? []
  const visibleCards = (data?.cards ?? []).filter((card) => cardVisibility[card.key] !== false)

  function toggleCard(key: string) {
    setCardVisibility((current) => {
      const next = { ...current, [key]: current[key] === false }
      saveCardVisibility(user?.id, next)
      return next
    })
  }

  function resetCards() {
    const next = defaultVisibility(role)
    setCardVisibility(next)
    saveCardVisibility(user?.id, next)
  }

  if (loading && !data) return <LoadingScreen />

  return (
    <Stack spacing={{ xs: 2, md: 2.5 }} sx={{ width: '100%', minWidth: 0 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h1">{data?.title ?? 'Dashboard'}</Typography>
        </Box>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.25}
          sx={{ width: { xs: '100%', md: 'auto' }, flexShrink: 0 }}
        >
          {role === 'admin' ? (
            <TextField
              select
              size="small"
              label="Business"
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value)
                setProjectId('')
                setEmployeeId('')
              }}
              sx={{ width: { xs: '100%', sm: 220 } }}
            >
              <MenuItem value="">All businesses</MenuItem>
              {companies.map((company) => (
                <MenuItem key={company.id} value={company.id}>
                  {company.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {role !== 'admin' || companyId ? (
            <TextField
              select
              size="small"
              label="Project"
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value)
                setEmployeeId('')
              }}
              sx={{ width: { xs: '100%', sm: 220 } }}
            >
              {role === 'admin' ? <MenuItem value="">All projects</MenuItem> : null}
              {projectChoices.map((project) => (
                <MenuItem key={project.id} value={project.id}>
                  {project.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {role !== 'salesperson' && projectId && (data?.people.length ?? 0) > 0 ? (
            <TextField
              select
              size="small"
              label="Salesperson"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              sx={{ width: { xs: '100%', sm: 220 } }}
            >
              <MenuItem value="">All salespeople</MenuItem>
              {data?.people.map((person) => (
                <MenuItem key={person.user_id} value={person.user_id}>
                  {person.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <TextField
            size="small"
            label="From"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: { xs: '100%', sm: 160 } }}
          />
          <TextField
            size="small"
            label="To"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: { xs: '100%', sm: 160 } }}
          />
          <CardChooser cards={data?.cards ?? []} visibility={cardVisibility} onToggle={toggleCard} onReset={resetCards} />
        </Stack>
      </Stack>

      {error ? <ErrorAlert message={error} /> : null}

      {visibleCards.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Turn a card on to see it here.
        </Typography>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 1.25, sm: 1.5 },
            gridTemplateColumns: cardColumns(visibleCards.length),
            alignItems: 'stretch',
          }}
        >
          {visibleCards.map((card) => (
            <MetricCard
              key={card.key}
              card={card}
              onOpen={cardPath(data?.role ?? role, card.key)}
              onClick={(path) => navigate(path)}
            />
          ))}
        </Box>
      )}

      {data?.view === 'businesses' ? (
        <Section title="Businesses" hint="Open a business to see which projects are quiet or overdue.">
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            {data.businesses.map((business) => (
              <Box
                key={business.company_id}
                role="button"
                tabIndex={0}
                onClick={() => setCompanyId(business.company_id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setCompanyId(business.company_id)
                  }
                }}
                sx={panelSx(Boolean(business.overdue || business.quiet_projects))}
              >
                <Typography fontWeight={700}>{business.name}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {business.projects} projects · {business.users} users · {business.leads} leads
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.25 }}>
                  <Chip label={`${business.leads_this_week} new`} />
                  <Chip label={`${business.calls_today} calls`} />
                  <Chip label={`${business.overdue} overdue`} hot={business.overdue > 0} />
                  <Chip label={`${business.quiet_projects} quiet projects`} hot={business.quiet_projects > 0} />
                </Stack>
              </Box>
            ))}
          </Box>
        </Section>
      ) : null}

      {data?.view === 'projects' ? (
        <Section title="Projects" hint="Open a project to see each salesperson’s calls.">
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' } }}>
            {data.projects.map((project) => (
              <Box
                key={project.project_id}
                role="button"
                tabIndex={0}
                onClick={() => setProjectId(project.project_id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setProjectId(project.project_id)
                  }
                }}
                sx={panelSx(project.overdue > 0 || (project.leads > 0 && project.calls_today === 0))}
              >
                <Typography fontWeight={700}>{project.name}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {project.leads} leads · {project.salespeople} salespeople
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.25 }}>
                  <Chip label={`${project.calls_today} calls`} />
                  <Chip label={`${project.overdue} overdue`} hot={project.overdue > 0} />
                </Stack>
              </Box>
            ))}
          </Box>
        </Section>
      ) : null}

      {data?.view === 'project' ? (
        <Section title="Salespeople" hint="Calls are what they logged in the selected dates. The other numbers are the leads they own.">
          {data.people.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No salespeople are assigned to this project.
            </Typography>
          ) : (
            <>
              <Stack spacing={1.25} sx={{ display: { xs: 'flex', md: 'none' } }}>
                {data.people.map((person) => (
                  <PersonCard key={person.user_id} person={person} />
                ))}
              </Stack>
              <Box sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(160px, 1.4fr) repeat(8, minmax(72px, 1fr))',
                    gap: 1,
                    minWidth: 860,
                    alignItems: 'center',
                  }}
                >
                  <HeaderCell>Person</HeaderCell>
                  {['Leads', 'Calls', 'Connected', 'No answer', 'Overdue', 'Still new', 'Won', 'Lost'].map((label) => (
                    <HeaderCell key={label} align="right">
                      {label}
                    </HeaderCell>
                  ))}
                  {data.people.map((person) => (
                    <PersonRow key={person.user_id} person={person} />
                  ))}
                </Box>
              </Box>
            </>
          )}
        </Section>
      ) : null}

      {data && (data.view === 'mine' || data.view === 'project') ? (
        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
            alignItems: 'stretch',
          }}
        >
          <Section title="Stages" hint="Where the leads on this view sit." fill>
            <Stack spacing={1.25}>
              {data.stages.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No leads yet.
                </Typography>
              ) : (
                data.stages.map((stage) => (
                  <Box key={stage.status}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5, gap: 1 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {stage.label}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                        {stage.count} · {stage.percent}%
                      </Typography>
                    </Stack>
                    <Box sx={{ height: 8, borderRadius: 999, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
                      <Box
                        sx={{
                          height: '100%',
                          width: `${Math.min(100, stage.percent)}%`,
                          bgcolor: stage.color,
                          borderRadius: 999,
                        }}
                      />
                    </Box>
                  </Box>
                ))
              )}
            </Stack>
          </Section>
          <Section title="Sources" hint="Where these leads came from." fill>
            <Stack spacing={1.25}>
                {data.sources.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No sources yet.
                  </Typography>
                ) : (
                  data.sources.map((source) => {
                    const total = data.sources.reduce((sum, row) => sum + row.count, 0)
                    const percent = total === 0 ? 0 : Math.round((source.count / total) * 1000) / 10
                    return (
                      <Box key={source.source}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5, gap: 1 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {source.source}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                            {source.count} · {percent}%
                          </Typography>
                        </Stack>
                        <Box sx={{ height: 8, borderRadius: 999, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
                          <Box
                            sx={{
                              height: '100%',
                              width: `${Math.min(100, percent)}%`,
                              bgcolor: 'primary.main',
                              borderRadius: 999,
                            }}
                          />
                        </Box>
                      </Box>
                    )
                  })
              )}
            </Stack>
          </Section>
        </Box>
      ) : null}

      {data?.money ? (
        <Section title="Amounts" hint="Shown only where someone entered a value.">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            {data.money.won_value ? (
              <Amount label="Won value" value={data.money.won_value} icon={CurrencyRupeeIcon} />
            ) : null}
            {data.money.pipeline_value ? (
              <Amount label="Pipeline value" value={data.money.pipeline_value} icon={TrendingUpIcon} />
            ) : null}
          </Stack>
        </Section>
      ) : null}
    </Stack>
  )
}

function MetricCard({ card, onOpen, onClick }: { card: Card; onOpen: string | null; onClick: (path: string) => void }) {
  const Icon = ICONS[card.key] ?? GroupsOutlinedIcon
  const attention = card.tone === 'attention'
  const good = card.tone === 'good'
  return (
    <Box
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={() => {
        if (onOpen) onClick(onOpen)
      }}
      onKeyDown={(event) => {
        if (!onOpen) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick(onOpen)
        }
      }}
      sx={{
        p: 2,
        borderRadius: '16px',
        border: '1px solid',
        borderColor: attention ? '#fecaca' : 'divider',
        bgcolor: attention ? '#fff7f7' : good ? '#f0fdf4' : 'background.paper',
        cursor: onOpen ? 'pointer' : 'default',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        minWidth: 0,
        height: '100%',
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: '10px',
            bgcolor: attention ? '#fee2e2' : good ? '#d1fae5' : '#dbeafe',
            color: attention ? '#b91c1c' : good ? '#047857' : 'primary.main',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <Icon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.1 }}>{card.value}</Typography>
          <Typography variant="body2" fontWeight={600} sx={{ mt: 0.25 }}>
            {card.label}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {card.hint}
          </Typography>
        </Box>
      </Stack>
    </Box>
  )
}

function Section({ title, hint, children, fill }: { title: string; hint: string; children: ReactNode; fill?: boolean }) {
  return (
    <Box sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: '16px', border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', minWidth: 0, height: fill ? '100%' : undefined, boxSizing: 'border-box' }}>
      <Typography fontWeight={700}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {hint}
      </Typography>
      {children}
    </Box>
  )
}

function Chip({ label, hot }: { label: string; hot?: boolean }) {
  return (
    <Box
      sx={{
        px: 1,
        py: 0.25,
        borderRadius: 999,
        bgcolor: hot ? '#fee2e2' : '#f1f5f9',
        color: hot ? '#991b1b' : '#475569',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {label}
    </Box>
  )
}

function PersonCard({ person }: { person: Person }) {
  return (
    <Box sx={{ p: 1.5, borderRadius: '12px', border: '1px solid', borderColor: person.overdue ? '#fecaca' : 'divider' }}>
      <Typography fontWeight={700}>{person.name}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {person.leads} leads · {person.calls_today} calls today ({person.connected} connected, {person.no_answer} no answer)
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }} color={person.overdue ? 'error.main' : 'text.secondary'}>
        {person.overdue} overdue · {person.still_new} still new · {person.won} won · {person.lost} lost
      </Typography>
    </Box>
  )
}

function HeaderCell({ children, align = 'left' }: { children: string; align?: 'left' | 'right' }) {
  return (
    <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textAlign: align }}>
      {children}
    </Typography>
  )
}

function PersonRow({ person }: { person: Person }) {
  const cells = [
    person.leads,
    person.calls_today,
    person.connected,
    person.no_answer,
    person.overdue,
    person.still_new,
    person.won,
    person.lost,
  ]
  return (
    <>
      <Typography variant="body2" fontWeight={700} noWrap>
        {person.name}
      </Typography>
      {cells.map((value, index) => (
        <Typography
          key={`${person.user_id}-${index}`}
          variant="body2"
          sx={{ textAlign: 'right', fontWeight: index === 4 && value > 0 ? 700 : 500, color: index === 4 && value > 0 ? 'error.main' : 'text.primary' }}
        >
          {value}
        </Typography>
      ))}
    </>
  )
}

function CardChooser({
  cards,
  visibility,
  onToggle,
  onReset,
}: {
  cards: Card[]
  visibility: Record<string, boolean>
  onToggle: (key: string) => void
  onReset: () => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const titleId = useId()
  const open = Boolean(anchor)

  return (
    <>
      <Tooltip title="Cards">
        <IconButton
          size="small"
          aria-label="Cards"
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={toolbarIconSx}
        >
          <ViewColumnOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 260, p: 1.5, borderRadius: '12px' } } }}
      >
        <Typography id={titleId} variant="subtitle2" fontWeight={700} sx={{ mb: 1, px: 0.5 }}>
          Cards
        </Typography>
        <Stack spacing={0.25} role="group" aria-labelledby={titleId}>
          {cards.map((card) => (
            <FormControlLabel
              key={card.key}
              control={
                <Checkbox size="small" checked={visibility[card.key] !== false} onChange={() => onToggle(card.key)} />
              }
              label={<Typography variant="body2">{card.label}</Typography>}
              sx={{ mx: 0, px: 0.5, borderRadius: '8px', '&:hover': { bgcolor: '#f8fafc' } }}
            />
          ))}
        </Stack>
        <Box sx={{ mt: 1.25, px: 0.5 }}>
          <Button size="small" onClick={onReset} sx={{ textTransform: 'none', fontWeight: 600 }}>
            Reset to default
          </Button>
        </Box>
      </Popover>
    </>
  )
}

function Amount({ label, value, icon: Icon }: { label: string; value: string; icon: typeof CurrencyRupeeIcon }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', p: 1.5, borderRadius: '12px', bgcolor: '#f8fafc', flex: 1 }}>
      <Icon fontSize="small" />
      <Box>
        <Typography fontWeight={800}>{value}</Typography>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
      </Box>
    </Stack>
  )
}

function panelSx(hot: boolean) {
  return {
    p: 2,
    borderRadius: '16px',
    border: '1px solid',
    borderColor: hot ? '#fecaca' : 'divider',
    bgcolor: hot ? '#fff7f7' : 'background.paper',
    cursor: 'pointer',
    textAlign: 'left',
    minWidth: 0,
  } as const
}
