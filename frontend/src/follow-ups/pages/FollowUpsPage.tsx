import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined'
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import { columnHeaderSx } from '../../components/common/tableStyles'
import { resolveCallSummary } from '../../lead-fields/builtinLabels'
import { FollowupPlanSettingsDialog } from '../../followup-plan/FollowupPlanSettingsDialog'
import { FollowupPlanStep, loadFollowupPlan } from '../../followup-plan/plan'
import { followWhen, formatDueLabel, parseFollowup, type FollowWhen } from '../../leads/lead-dates'
import {
  Lead,
  LeadList,
  LeadProjectOption,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  type LeadPriority,
} from '../../leads/types'
import { ReminderLeadDrawer } from '../../reminders/components/ReminderLeadDrawer'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'
import { useAuth } from '../../store/auth-context'

type DueFilter = 'ALL' | FollowWhen

/**
 * Follow-ups ≠ Reminders.
 * Reminders = today’s call workbench (quick actions).
 * Follow-ups = who is due next — remark + date + channel; open drawer to act.
 */

function lastRemark(lead: Lead): { title: string; detail?: string } {
  const fromSummary = resolveCallSummary(lead.call_summary, lead.extra_values)
  const fromReq = (lead.requirement || '').trim()
  const text = fromSummary || fromReq
  if (!text) return { title: 'No remark yet' }

  const lines = text
    .split(/\n+/)
    .map((line: string) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return { title: 'No remark yet' }
  if (lines.length === 1) return { title: lines[0] }
  return { title: lines[lines.length - 1], detail: lines[lines.length - 2] }
}

function nextFollowupMeta(lead: Lead): {
  text: string
  overdue: boolean
  today: boolean
  when: FollowWhen | null
} {
  const when = followWhen(lead.next_followup_at)
  const due = parseFollowup(lead.next_followup_at)
  if (!due || !when) return { text: '—', overdue: false, today: false, when: null }

  const base = formatDueLabel(lead.next_followup_at)
  if (when === 'o') return { text: `${base} · Overdue`, overdue: true, today: false, when }
  if (when === 't') {
    const hasClock = due.getHours() !== 0 || due.getMinutes() !== 0
    const time = due.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
    return { text: hasClock ? `Today · ${time}` : 'Today', overdue: false, today: true, when }
  }
  return { text: base, overdue: false, today: false, when }
}

const DUE_FILTERS: { id: DueFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'o', label: 'Overdue' },
  { id: 't', label: 'Today' },
  { id: 'u', label: 'Upcoming' },
]

const FOLLOWUPS_GRID_MD = 'minmax(0,1.5fr) 130px 96px minmax(0,1.35fr) minmax(140px,180px)'
const FOLLOWUPS_GRID_XS = '1fr'

function ToneChip({ label, bg, color }: { label: string; bg?: string; color?: string }) {
  return (
    <Chip
      size="small"
      label={label || '—'}
      sx={{
        bgcolor: bg ?? '#f1f5f9',
        color: color ?? '#475569',
        fontWeight: 600,
        height: 24,
        borderRadius: '999px',
      }}
    />
  )
}

export function FollowUpsPage() {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('md'))
  const { user } = useAuth()
  const canUpdate = Boolean(user?.permissions.includes('leads.update'))
  const canDelete = Boolean(user?.permissions.includes('leads.delete'))

  const [items, setItems] = useState<Lead[]>([])
  const [projects, setProjects] = useState<LeadProjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [projectId, setProjectId] = useState('')
  const [search, setSearch] = useState('')
  const [dueFilter, setDueFilter] = useState<DueFilter>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [plan, setPlan] = useState<FollowupPlanStep[]>(() => loadFollowupPlan(user?.company_id))
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null)
  const [planOpen, setPlanOpen] = useState(false)

  useEffect(() => {
    setPlan(loadFollowupPlan(user?.company_id))
  }, [user?.company_id])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 1800)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    void (async () => {
      try {
        const result = await api.get<{ items: LeadProjectOption[] }>('/api/v1/projects')
        setProjects(result.data.items)
        setProjectId((current) => current || result.data.items[0]?.id || '')
      } catch {
        setProjects([])
      }
    })()
  }, [])

  const load = useCallback(async () => {
    setError('')
    try {
      const params = new URLSearchParams({ limit: '200', exclude_lost: 'true' })
      if (projectId) params.set('project_id', projectId)
      const result = await api.get<LeadList>(`/api/v1/leads?${params}`)
      // Follow-up list = leads that still have a next date.
      const withDue = result.data.items.filter((lead) => Boolean(lead.next_followup_at))
      withDue.sort((a, b) => {
        const aDue = a.next_followup_at ?? '9999'
        const bDue = b.next_followup_at ?? '9999'
        return aDue.localeCompare(bDue)
      })
      setItems(withDue)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Could not load follow-ups.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const inDateRange = useCallback(
    (lead: Lead) => {
      if (!dateFrom && !dateTo) return true
      const due = parseFollowup(lead.next_followup_at)
      if (!due) return false
      const day = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()
      if (dateFrom) {
        const from = new Date(`${dateFrom}T00:00:00`).getTime()
        if (!Number.isNaN(from) && day < from) return false
      }
      if (dateTo) {
        const to = new Date(`${dateTo}T00:00:00`).getTime()
        if (!Number.isNaN(to) && day > to) return false
      }
      return true
    },
    [dateFrom, dateTo],
  )

  const rangedItems = useMemo(() => items.filter(inDateRange), [inDateRange, items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rangedItems.filter((lead) => {
      const when = followWhen(lead.next_followup_at)
      if (dueFilter !== 'ALL' && when !== dueFilter) return false
      if (!q) return true
      return [lead.full_name, lead.mobile, lead.lead_number, lead.requirement, lead.call_summary, lead.city, lead.project_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [dueFilter, rangedItems, search])

  const counts = useMemo(() => {
    let overdue = 0
    let today = 0
    let upcoming = 0
    for (const lead of rangedItems) {
      const when = followWhen(lead.next_followup_at)
      if (when === 'o') overdue += 1
      else if (when === 't') today += 1
      else if (when === 'u') upcoming += 1
    }
    return { overdue, today, upcoming, all: rangedItems.length }
  }, [rangedItems])

  const drawerLead = useMemo(
    () => (drawerLeadId ? items.find((item) => item.id === drawerLeadId) ?? null : null),
    [drawerLeadId, items],
  )

  const onDrawerChanged = useCallback(
    async (message: string) => {
      setNotice(message)
      await load()
    },
    [load],
  )

  if (loading && items.length === 0) return <LoadingScreen />

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="h1" sx={{ flex: 1, minWidth: 0 }}>
          Follow-up List
        </Typography>
        <Chip
          label={`${filtered.length} Follow-up${filtered.length === 1 ? '' : 's'}`}
          sx={{
            fontWeight: 700,
            bgcolor: counts.overdue > 0 && dueFilter === 'ALL' ? '#fee2e2' : '#dbeafe',
            color: counts.overdue > 0 && dueFilter === 'ALL' ? '#b91c1c' : '#1d4ed8',
            height: 28,
          }}
        />
      </Stack>

      {error ? <ErrorAlert message={error} /> : null}
      {notice ? (
        <Box
          sx={{
            bgcolor: '#ecfdf5',
            color: '#047857',
            border: '1px solid #a7f3d0',
            borderRadius: '12px',
            px: 1.75,
            py: 1.1,
          }}
        >
          <Typography variant="body2">{notice}</Typography>
        </Box>
      ) : null}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ alignItems: { sm: 'center' } }}>
        <TextField
          select
          size="small"
          label="Project"
          required
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          sx={{ width: { xs: '100%', sm: 200 } }}
          disabled={projects.length === 0}
        >
          {projects.length === 0 ? <MenuItem value="">No projects</MenuItem> : null}
          {projects.map((project) => (
            <MenuItem key={project.id} value={project.id}>
              {project.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          placeholder="Search name, mobile, remark…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ width: { xs: '100%', sm: 220 } }}
          disabled={!projectId}
        />
        <TextField
          size="small"
          label="From"
          type="date"
          value={dateFrom}
          disabled={!projectId}
          InputLabelProps={{ shrink: true }}
          inputProps={{ max: dateTo || undefined }}
          onChange={(event) => setDateFrom(event.target.value)}
          sx={{ width: { xs: '100%', sm: 150 } }}
        />
        <TextField
          size="small"
          label="To"
          type="date"
          value={dateTo}
          disabled={!projectId}
          InputLabelProps={{ shrink: true }}
          inputProps={{ min: dateFrom || undefined }}
          onChange={(event) => setDateTo(event.target.value)}
          sx={{ width: { xs: '100%', sm: 150 } }}
        />
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ ml: { sm: 'auto' } }}>
          {DUE_FILTERS.map((item) => {
            const count =
              item.id === 'ALL'
                ? counts.all
                : item.id === 'o'
                  ? counts.overdue
                  : item.id === 't'
                    ? counts.today
                    : counts.upcoming
            const active = dueFilter === item.id
            return (
              <Button
                key={item.id}
                size="small"
                variant={active ? 'contained' : 'outlined'}
                onClick={() => setDueFilter(item.id)}
                sx={{
                  minHeight: 32,
                  px: 1.25,
                  borderRadius: '999px',
                  textTransform: 'none',
                  fontWeight: 600,
                  ...(item.id === 'o' && !active
                    ? { color: '#b91c1c', borderColor: '#fecaca' }
                    : {}),
                  ...(item.id === 'o' && active ? { bgcolor: '#b91c1c', '&:hover': { bgcolor: '#991b1b' } } : {}),
                }}
              >
                {item.label}
                <Box component="span" sx={{ ml: 0.6, opacity: 0.85 }}>
                  {count}
                </Box>
              </Button>
            )
          })}
        </Stack>
      </Stack>

      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '16px',
          bgcolor: 'background.paper',
          overflow: 'hidden',
          boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        }}
      >
        {filtered.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 3 }}>
            {search.trim() || dueFilter !== 'ALL' || dateFrom || dateTo
              ? 'No follow-ups match these filters.'
              : 'When a lead has a next follow-up date, it appears here for the salesperson.'}
          </Typography>
        ) : (
          <Box sx={{ overflowX: { xs: 'visible', md: 'auto' } }}>
            <Box sx={{ minWidth: { md: 720 } }}>
              <Box
                sx={{
                  display: { xs: 'none', md: 'grid' },
                  gridTemplateColumns: FOLLOWUPS_GRID_MD,
                  columnGap: 1.25,
                  alignItems: 'center',
                  px: 2,
                  py: 1,
                  bgcolor: '#f8fafc',
                }}
              >
                <Typography sx={columnHeaderSx}>Lead</Typography>
                <Typography sx={columnHeaderSx}>Phone</Typography>
                <Typography sx={columnHeaderSx}>Priority</Typography>
                <Typography sx={columnHeaderSx}>Last Remark</Typography>
                <Typography sx={columnHeaderSx}>Follow-up</Typography>
              </Box>

              {filtered.map((lead) => {
                const priorityKey: LeadPriority = lead.priority in PRIORITY_TONE ? lead.priority : 'medium'
                const remark = lastRemark(lead)
                const next = nextFollowupMeta(lead)

                return (
                  <Box
                    key={lead.id}
                    onClick={() => setDrawerLeadId(lead.id)}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: FOLLOWUPS_GRID_XS,
                        md: FOLLOWUPS_GRID_MD,
                      },
                      columnGap: 1.25,
                      rowGap: 0.75,
                      alignItems: 'center',
                      px: 2,
                      py: 1.15,
                      cursor: 'pointer',
                      bgcolor: next.overdue ? '#fffbfb' : 'transparent',
                      '&:hover': { bgcolor: next.overdue ? '#fff5f5' : '#f8fbff' },
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap>
                        {lead.full_name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {lead.lead_number}
                        {lead.project_name ? ` · ${lead.project_name}` : ''}
                      </Typography>
                      {phone ? (
                        <Typography variant="caption" color="text.secondary" noWrap display="block">
                          {remark.title}
                        </Typography>
                      ) : null}
                    </Box>

                    <Typography
                      variant="body2"
                      noWrap
                      sx={{ gridColumn: { xs: '1', md: 'auto' }, color: 'primary.main', fontWeight: 600 }}
                    >
                      {lead.mobile || '—'}
                    </Typography>

                    <Box sx={{ gridColumn: { xs: '1', md: 'auto' } }}>
                      <ToneChip label={PRIORITY_LABEL[priorityKey]} {...PRIORITY_TONE[priorityKey]} />
                    </Box>

                    <Box sx={{ minWidth: 0, gridColumn: { xs: '1', md: 'auto' } }}>
                      <Typography variant="body2" noWrap title={remark.title} sx={{ fontWeight: 600 }}>
                        {remark.title}
                      </Typography>
                      {remark.detail ? (
                        <Typography variant="caption" color="text.secondary" noWrap display="block" title={remark.detail}>
                          {remark.detail}
                        </Typography>
                      ) : null}
                    </Box>

                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{
                        alignItems: 'center',
                        gridColumn: { xs: '1', md: 'auto' },
                        fontSize: 13,
                        color: next.overdue ? '#b91c1c' : 'text.secondary',
                        fontWeight: next.overdue || next.today ? 700 : 500,
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                    >
                      <TodayOutlinedIcon sx={{ fontSize: 15, flexShrink: 0 }} />
                      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={next.text}>
                        {next.text}
                      </Box>
                    </Stack>
                  </Box>
                )
              })}
            </Box>
          </Box>
        )}

        <Stack direction="row" spacing={1} sx={{ px: 2, py: 1.5, alignItems: 'center', color: 'text.secondary' }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            Showing {filtered.length} of {rangedItems.length} follow-ups
          </Typography>
        </Stack>
      </Box>

      <ReminderLeadDrawer
        lead={drawerLead}
        canUpdate={canUpdate}
        canDelete={canDelete}
        plan={plan}
        onClose={() => setDrawerLeadId(null)}
        onChanged={onDrawerChanged}
        onEditPlan={() => setPlanOpen(true)}
      />

      <FollowupPlanSettingsDialog
        open={planOpen}
        companyId={user?.company_id}
        onClose={() => setPlanOpen(false)}
        onSaved={setPlan}
      />
    </Stack>
  )
}
