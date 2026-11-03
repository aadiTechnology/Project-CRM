import PhoneOutlinedIcon from '@mui/icons-material/PhoneOutlined'
import {
  Box,
  Button,
  Chip,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'

import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
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

function channelForLead(lead: Lead): 'call' | 'whatsapp' {
  const source = (lead.lead_source || '').toLowerCase()
  if (source.includes('whatsapp')) return 'whatsapp'
  return 'call'
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

  const gridTemplate = phone
    ? '1fr'
    : 'minmax(200px,1.35fr) 88px minmax(150px,1fr) 170px'

  if (loading && items.length === 0) return <LoadingScreen />

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h1">Follow-up List</Typography>
        </Box>
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
        {dateFrom || dateTo ? (
          <Button
            size="small"
            disabled={!projectId}
            onClick={() => {
              setDateFrom('')
              setDateTo('')
            }}
            sx={{ textTransform: 'none', fontWeight: 600, minHeight: 40, flexShrink: 0 }}
          >
            Clear dates
          </Button>
        ) : null}
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
        {!phone ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              columnGap: 2,
              alignItems: 'center',
              px: 2.25,
              py: 1.15,
              bgcolor: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              Customer
            </Typography>
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              Priority
            </Typography>
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              Last Remark
            </Typography>
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              Next Follow-up
            </Typography>
          </Box>
        ) : null}

        {filtered.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography fontWeight={700} sx={{ mb: 0.5 }}>
              {search.trim() || dueFilter !== 'ALL' ? 'No follow-ups match' : 'No follow-ups due'}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {search.trim() || dueFilter !== 'ALL'
                ? 'Try another filter or clear search.'
                : 'When a lead has a next follow-up date, it appears here for the salesperson.'}
            </Typography>
          </Box>
        ) : (
          filtered.map((lead) => {
            const priorityKey: LeadPriority = lead.priority in PRIORITY_TONE ? lead.priority : 'medium'
            const tone = PRIORITY_TONE[priorityKey]
            const remark = lastRemark(lead)
            const next = nextFollowupMeta(lead)
            const channel = channelForLead(lead)
            const tel = (lead.mobile || '').replace(/\s+/g, '')

            return (
              <Box
                key={lead.id}
                onClick={() => setDrawerLeadId(lead.id)}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: gridTemplate,
                  columnGap: { xs: 1, md: 2 },
                  rowGap: 0.85,
                  alignItems: 'center',
                  px: 2.25,
                  py: 1.4,
                  borderBottom: '1px solid #edf1f7',
                  cursor: 'pointer',
                  bgcolor: next.overdue ? '#fffbfb' : 'transparent',
                  '&:hover': { bgcolor: next.overdue ? '#fff5f5' : '#f8fbff' },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontWeight={700} noWrap sx={{ color: '#0f172a' }}>
                    {lead.full_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                    {lead.lead_number}
                    {lead.project_name ? ` · ${lead.project_name}` : ''}
                  </Typography>
                  {lead.mobile ? (
                    <Typography
                      variant="caption"
                      component={Link}
                      href={`tel:${tel}`}
                      onClick={(event) => event.stopPropagation()}
                      underline="hover"
                      noWrap
                      display="block"
                      sx={{ color: 'primary.main', fontWeight: 600, width: 'fit-content' }}
                    >
                      {lead.mobile}
                    </Typography>
                  ) : null}
                  {phone ? (
                    <Chip
                      size="small"
                      label={PRIORITY_LABEL[priorityKey]}
                      sx={{
                        mt: 0.75,
                        height: 24,
                        fontWeight: 700,
                        bgcolor: tone.bg,
                        color: tone.color,
                      }}
                    />
                  ) : null}
                </Box>

                {!phone ? (
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Chip
                      size="small"
                      label={PRIORITY_LABEL[priorityKey]}
                      sx={{
                        height: 24,
                        fontWeight: 700,
                        bgcolor: tone.bg,
                        color: tone.color,
                      }}
                    />
                  </Box>
                ) : null}

                <Box sx={{ minWidth: 0 }}>
                  {phone ? (
                    <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" sx={{ mb: 0.25 }}>
                      Last remark
                    </Typography>
                  ) : null}
                  <Typography fontWeight={600} noWrap sx={{ color: '#0f172a' }}>
                    {remark.title}
                  </Typography>
                  {remark.detail ? (
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                      {remark.detail}
                    </Typography>
                  ) : null}
                </Box>

                <Stack spacing={0.65} sx={{ minWidth: 0 }}>
                  {phone ? (
                    <Typography variant="caption" fontWeight={700} color="text.secondary" display="block">
                      Next follow-up
                    </Typography>
                  ) : null}
                  <Typography
                    variant="body2"
                    fontWeight={next.overdue || next.today ? 700 : 600}
                    sx={{ color: next.overdue ? '#b91c1c' : '#0f172a' }}
                  >
                    {next.text}
                  </Typography>
                  <Chip
                    size="small"
                    component={tel && channel === 'call' ? 'a' : 'div'}
                    href={tel && channel === 'call' ? `tel:${tel}` : undefined}
                    clickable={Boolean(tel && channel === 'call')}
                    onClick={(event: MouseEvent) => event.stopPropagation()}
                    icon={
                      channel === 'call' ? (
                        <PhoneOutlinedIcon sx={{ fontSize: '14px !important' }} />
                      ) : undefined
                    }
                    label={channel === 'whatsapp' ? 'WhatsApp' : 'Call'}
                    sx={{
                      alignSelf: 'flex-start',
                      height: 24,
                      fontWeight: 700,
                      textDecoration: 'none',
                      bgcolor: '#fce4ec',
                      color: '#e95d90',
                      '& .MuiChip-icon': { color: '#e95d90' },
                    }}
                  />
                </Stack>
              </Box>
            )
          })
        )}
      </Box>

      <Typography variant="caption" color="text.secondary">
        Tap a row to open the lead. Use Reminders for quick call outcomes.
      </Typography>

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
