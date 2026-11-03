import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import CheckIcon from '@mui/icons-material/Check'
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import PhoneInTalkOutlinedIcon from '@mui/icons-material/PhoneInTalkOutlined'
import PhoneMissedOutlinedIcon from '@mui/icons-material/PhoneMissedOutlined'
import SnoozeOutlinedIcon from '@mui/icons-material/SnoozeOutlined'
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'

import { ColumnChooser } from '../../column-visibility/ColumnChooser'
import { useColumnVisibility } from '../../column-visibility/useColumnVisibility'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { DeleteIconButton } from '../../components/common/DeleteIconButton'
import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import { FollowupPlanSettingsDialog } from '../../followup-plan/FollowupPlanSettingsDialog'
import {
  CUSTOM_STEP,
  FollowupPlanStep,
  loadFollowupPlan,
} from '../../followup-plan/plan'
import {
  addDaysIso,
  dateInputToIsoNoon,
  FollowWhen,
  followWhen,
  formatDueLabel,
  isoToDateInput,
} from '../../leads/lead-dates'
import {
  Lead,
  LeadList,
  LeadPriority,
  LeadProjectOption,
  PRIORITY_LABEL,
} from '../../leads/types'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'
import { useAuth } from '../../store/auth-context'
import { ReminderLeadDrawer } from '../components/ReminderLeadDrawer'

type WhenFilter = 'ALL' | 'o' | 't' | 'u'
type SortBy = 'time' | 'pri' | 'name'

const WHEN_LABEL: Record<WhenFilter, string> = {
  ALL: 'All reminders',
  o: 'Overdue reminders',
  t: "Today's reminders",
  u: 'Upcoming reminders',
}

const WHEN_CHIP: Record<Exclude<FollowWhen, 'ALL'>, { label: string; bg: string; color: string }> = {
  o: { label: 'Overdue', bg: '#fee2e2', color: '#b91c1c' },
  t: { label: 'Due today', bg: '#fef3c7', color: '#92400e' },
  u: { label: 'Upcoming', bg: '#e0ecff', color: '#1d4ed8' },
}

const PRI_TONE: Record<LeadPriority, { bg: string; color: string }> = {
  high: { bg: '#fee2e2', color: '#b91c1c' },
  medium: { bg: '#fef3c7', color: '#92400e' },
  low: { bg: '#dbeafe', color: '#1e40af' },
}

const PRI_RANK: Record<LeadPriority, number> = { high: 0, medium: 1, low: 2 }
const actionIconSx = {
  width: 30,
  height: 30,
  borderRadius: '8px',
  color: 'text.secondary',
  '&:hover': { bgcolor: '#eef2f7', color: 'text.primary' },
} as const

export function RemindersPage() {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('md'))
  const { user } = useAuth()
  const canUpdate = Boolean(user?.permissions.includes('leads.update'))
  const canDelete = Boolean(user?.permissions.includes('leads.delete'))
  const canCreate = Boolean(user?.permissions.includes('leads.create'))
  const {
    columns: columnDefs,
    visibility: columnVisibility,
    isVisible: isColumnVisible,
    toggle: toggleColumn,
    reset: resetColumns,
    gridTemplateMd: remindersGridMd,
    gridTemplateXs: remindersGridXs,
    loadError: columnLoadError,
    saveError: columnSaveError,
    clearSaveError: clearColumnSaveError,
    clearLoadError: clearColumnLoadError,
  } = useColumnVisibility('reminders')

  const [leads, setLeads] = useState<Lead[]>([])
  const [projects, setProjects] = useState<LeadProjectOption[]>([])
  const [plan, setPlan] = useState<FollowupPlanStep[]>(() => loadFollowupPlan(user?.company_id))
  const [planOpen, setPlanOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [when, setWhen] = useState<WhenFilter>('ALL')
  const [projectId, setProjectId] = useState('')
  const [priority, setPriority] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortBy>('time')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addLeadId, setAddLeadId] = useState('')
  const [addDate, setAddDate] = useState(() => isoToDateInput(addDaysIso(null, 1)))
  const [addPriority, setAddPriority] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [rescheduleLead, setRescheduleLead] = useState<Lead | null>(null)
  const [rescheduleDate, setRescheduleDate] = useState(() => isoToDateInput(addDaysIso(null, 1)))
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setPlan(loadFollowupPlan(user?.company_id))
  }, [user?.company_id])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 1600)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (columnSaveError) {
      setError("Couldn't save column preferences on this device. Layout kept; try again.")
      clearColumnSaveError()
    }
  }, [columnSaveError, clearColumnSaveError])

  useEffect(() => {
    if (columnLoadError) {
      setError('Column preferences could not be loaded. Showing all columns.')
      clearColumnLoadError()
    }
  }, [columnLoadError, clearColumnLoadError])

  const loadProjects = useCallback(async () => {
    const result = await api.get<{ items: LeadProjectOption[] }>('/api/v1/projects')
    setProjects(result.data.items)
  }, [])

  const load = useCallback(async () => {
    setError('')
    try {
      const params = new URLSearchParams({ limit: '500', exclude_lost: 'true' })
      if (projectId) params.set('project_id', projectId)
      const result = await api.get<LeadList>(`/api/v1/leads?${params}`)
      setLeads(result.data.items)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Could not load reminders.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadProjects().catch(() => {
      /* projects dropdown stays empty */
    })
  }, [loadProjects])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const withFollowup = useMemo(
    () => leads.filter((lead) => Boolean(lead.next_followup_at)),
    [leads],
  )

  const scopedFollowup = useMemo(() => {
    if (!projectId) return withFollowup
    return withFollowup.filter((lead) => lead.project_id === projectId)
  }, [projectId, withFollowup])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = scopedFollowup.filter((lead) => {
      const bucket = followWhen(lead.next_followup_at)
      if (when !== 'ALL' && bucket !== when) return false
      if (priority && lead.priority !== priority) return false
      if (
        q &&
        ![
          lead.full_name,
          lead.mobile,
          lead.lead_number,
          lead.requirement,
          lead.city,
          lead.company_name,
          lead.project_name,
          lead.plan_step,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      ) {
        return false
      }
      return true
    })
    rows.sort((a, b) => {
      const rank = (p: LeadPriority) => PRI_RANK[p] ?? 1
      if (sort === 'name') return a.full_name.localeCompare(b.full_name)
      if (sort === 'pri') {
        return rank(a.priority) - rank(b.priority) || (a.next_followup_at ?? '').localeCompare(b.next_followup_at ?? '')
      }
      return (a.next_followup_at ?? '').localeCompare(b.next_followup_at ?? '') || rank(a.priority) - rank(b.priority)
    })
    return rows
  }, [priority, scopedFollowup, search, sort, when])

  const perPage = 21
  const pages = Math.max(1, Math.ceil(filtered.length / perPage))
  const pageSafe = Math.min(page, pages)
  const pageRows = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage)
  const showPagination = filtered.length > perPage

  useEffect(() => {
    setPage(1)
    setSelected([])
  }, [when, priority, search, sort, projectId])

  function toggleSelect(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function patchLead(id: string, body: Record<string, unknown>, okMessage: string) {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.patch(`/api/v1/leads/${id}`, body)
      setNotice(okMessage)
      await load()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Could not update reminder.')
    } finally {
      setSaving(false)
    }
  }

  function openLead(lead: Lead) {
    setDrawerLeadId(lead.id)
  }

  const drawerLead = useMemo(
    () => (drawerLeadId ? leads.find((item) => item.id === drawerLeadId) ?? null : null),
    [drawerLeadId, leads],
  )

  const onDrawerChanged = useCallback(
    async (message: string) => {
      setNotice(message)
      await load()
    },
    [load],
  )

  async function snoozeLead(lead: Lead) {
    await patchLead(
      lead.id,
      { next_followup_at: addDaysIso(lead.next_followup_at, 1) },
      `Snoozed ${lead.full_name} to tomorrow.`,
    )
  }

  async function markNoAnswer(lead: Lead) {
    const note = 'No answer'
    const requirement = lead.requirement ? `${lead.requirement}\n${note}` : note
    await patchLead(
      lead.id,
      {
        requirement,
        next_followup_at: addDaysIso(lead.next_followup_at, 1),
      },
      `Marked no answer for ${lead.full_name}. Reminder moved to tomorrow.`,
    )
  }

  async function saveReschedule(event: FormEvent) {
    event.preventDefault()
    if (!rescheduleLead || !rescheduleDate) {
      setError('Pick a due date.')
      return
    }
    const iso = dateInputToIsoNoon(rescheduleDate)
    if (!iso) {
      setError('Pick a valid due date.')
      return
    }
    await patchLead(rescheduleLead.id, { next_followup_at: iso }, `Rescheduled ${rescheduleLead.full_name}.`)
    setRescheduleLead(null)
  }

  async function snoozeSelected() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      for (const id of selected) {
        const lead = leads.find((item) => item.id === id)
        if (!lead?.next_followup_at) continue
        await api.patch(`/api/v1/leads/${id}`, { next_followup_at: addDaysIso(lead.next_followup_at, 1) })
      }
      setNotice(`${selected.length} reminder${selected.length === 1 ? '' : 's'} moved to tomorrow.`)
      setSelected([])
      await load()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Could not snooze reminders.')
    } finally {
      setSaving(false)
    }
  }

  async function saveReminder(event: FormEvent) {
    event.preventDefault()
    if (!addLeadId || !addDate) {
      setError('Pick a lead and due date.')
      return
    }
    const iso = dateInputToIsoNoon(addDate)
    if (!iso) {
      setError('Pick a valid due date.')
      return
    }
    const body: Record<string, unknown> = { next_followup_at: iso, plan_step: CUSTOM_STEP }
    if (addPriority) body.priority = addPriority
    if (addNotes.trim()) {
      const lead = leads.find((item) => item.id === addLeadId)
      body.requirement = `${lead?.requirement ? `${lead.requirement}\n` : ''}Reminder: ${addNotes.trim()}`
    }
    await patchLead(addLeadId, body, 'Reminder saved.')
    setAddOpen(false)
    setAddNotes('')
  }

  const addLeadOptions = useMemo(() => {
    if (!projectId) return leads
    return leads.filter((lead) => lead.project_id === projectId)
  }, [leads, projectId])

  if (loading && leads.length === 0) return <LoadingScreen />

  if (!loading && leads.length === 0 && !projectId) {
    return (
      <Stack spacing={2}>
        {error ? <ErrorAlert message={error} /> : null}
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', p: 3 }}>
          <Typography sx={{ mb: 1.5 }}>No leads yet.</Typography>
          {canCreate ? (
            <Button component={RouterLink} to="/app/leads" variant="contained">
              Create lead
            </Button>
          ) : null}
        </Box>
      </Stack>
    )
  }

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="h1" sx={{ flex: 1 }}>
          Reminders
        </Typography>
        <ColumnChooser
          columns={columnDefs}
          visibility={columnVisibility}
          onToggle={toggleColumn}
          onReset={resetColumns}
        />
        {canUpdate ? (
          <Tooltip title="Add reminder">
            <IconButton
              size="small"
              color="primary"
              aria-label="Add reminder"
              onClick={() => setAddOpen(true)}
              sx={{
                bgcolor: 'primary.main',
                color: '#fff',
                width: 32,
                height: 32,
                borderRadius: '8px',
                boxShadow: '0 4px 10px rgba(29,78,216,.2)',
                '&:hover': { bgcolor: 'primary.dark' },
              }}
            >
              <AddOutlinedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>

      {error ? <ErrorAlert message={error} /> : null}
      {notice ? (
        <Box sx={{ bgcolor: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: '12px', px: 1.75, py: 1.25 }}>
          <Typography variant="body2">{notice}</Typography>
        </Box>
      ) : null}

      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1.2fr 1fr 1fr 1fr' },
        }}
      >
        <TextField
          size="small"
          label="Search"
          placeholder="Search reminder, lead, mobile"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <TextField
          select
          size="small"
          label="Project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <MenuItem value="">All projects</MenuItem>
          {projects.map((project) => (
            <MenuItem key={project.id} value={project.id}>
              {project.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="When"
          value={when}
          onChange={(event) => setWhen(event.target.value as WhenFilter)}
        >
          <MenuItem value="ALL">All dates</MenuItem>
          <MenuItem value="o">Overdue</MenuItem>
          <MenuItem value="t">Due today</MenuItem>
          <MenuItem value="u">Upcoming</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="Priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="high">Hot</MenuItem>
          <MenuItem value="medium">Warm</MenuItem>
          <MenuItem value="low">Cold</MenuItem>
        </TextField>
      </Box>

      <Box
        sx={{
          border: '1px solid #dbe3ee',
          borderRadius: '16px',
          bgcolor: 'background.paper',
          overflow: 'hidden',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{
            px: 2,
            py: 1.5,
            alignItems: { sm: 'center' },
            background: 'linear-gradient(180deg,#eaf1ff,#f6f9ff)',
          }}
        >
          <Typography fontWeight={700} sx={{ flex: 1, fontSize: 16 }}>
            {WHEN_LABEL[when]} ({filtered.length})
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              Sort by
            </Typography>
            <TextField
              select
              size="small"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortBy)}
              sx={{
                minWidth: 120,
                '& .MuiOutlinedInput-notchedOutline': { border: 0 },
                '& .MuiSelect-select': { fontWeight: 700, py: 0.5 },
              }}
            >
              <MenuItem value="time">Due date</MenuItem>
              <MenuItem value="pri">Priority</MenuItem>
              <MenuItem value="name">Name</MenuItem>
            </TextField>
          </Stack>
        </Stack>

        {selected.length > 0 && canUpdate ? (
          <Stack
            direction="row"
            spacing={1}
            sx={{ px: 2, py: 1, bgcolor: '#eff6ff', alignItems: 'center' }}
          >
            <Typography variant="body2" fontWeight={700}>
              {selected.length} selected
            </Typography>
            <Button size="small" disabled={saving} onClick={() => void snoozeSelected()}>
              Snooze to tomorrow
            </Button>
            <Button size="small" onClick={() => setSelected([])}>
              Clear
            </Button>
          </Stack>
        ) : null}

        {pageRows.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography fontWeight={700}>Nothing here</Typography>
            <Typography color="text.secondary">No reminders match these filters.</Typography>
          </Box>
        ) : (
          <>
            <Box
              sx={{
                display: { xs: 'none', md: 'grid' },
                gridTemplateColumns: remindersGridMd,
                columnGap: 1.25,
                alignItems: 'center',
                width: '100%',
                px: 2,
                py: 1,
                bgcolor: '#f8fafc',
              }}
            >
              <Checkbox
                size="small"
                disabled={!canUpdate}
                checked={pageRows.length > 0 && pageRows.every((lead) => selected.includes(lead.id))}
                indeterminate={
                  pageRows.some((lead) => selected.includes(lead.id)) &&
                  !pageRows.every((lead) => selected.includes(lead.id))
                }
                onChange={() => {
                  const ids = pageRows.map((lead) => lead.id)
                  const allOn = ids.every((id) => selected.includes(id))
                  setSelected((current) =>
                    allOn ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])],
                  )
                }}
                inputProps={{ 'aria-label': 'Select all on page' }}
                sx={{ p: 0.25 }}
              />
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                Lead
              </Typography>
              {isColumnVisible('project') ? (
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  Project
                </Typography>
              ) : null}
              {isColumnVisible('phone') ? (
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  Phone
                </Typography>
              ) : null}
              {isColumnVisible('priority') ? (
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  Priority
                </Typography>
              ) : null}
              {isColumnVisible('due') ? (
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  Due
                </Typography>
              ) : null}
              {isColumnVisible('status') ? (
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  Status
                </Typography>
              ) : null}
              <Typography variant="caption" fontWeight={700} color="text.secondary" textAlign="left">
                Actions
              </Typography>
            </Box>

            {pageRows.map((lead) => {
              const bucket = followWhen(lead.next_followup_at) ?? 'u'
              const tone = WHEN_CHIP[bucket]
              const priorityKey: LeadPriority = lead.priority in PRI_TONE ? lead.priority : 'medium'
              const pri = PRI_TONE[priorityKey]
              const on = selected.includes(lead.id)
              return (
                <Box
                  key={lead.id}
                  onClick={() => openLead(lead)}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: remindersGridXs,
                      md: remindersGridMd,
                    },
                    columnGap: { xs: 1, md: 1.25 },
                    rowGap: 0.75,
                    alignItems: 'center',
                    width: '100%',
                    px: 2,
                    py: 1.1,
                    bgcolor: on ? '#eff6ff' : 'transparent',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: on ? '#eff6ff' : '#f8fbff' },
                  }}
                >
                  <Checkbox
                    size="small"
                    checked={on}
                    disabled={!canUpdate}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggleSelect(lead.id)}
                    inputProps={{ 'aria-label': `Select ${lead.full_name}` }}
                    sx={{ p: 0.25 }}
                  />

                  <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Box
                      sx={{
                        width: 42,
                        height: 42,
                        borderRadius: '50%',
                        flexShrink: 0,
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: '#fce4ec',
                        color: '#e95d90',
                      }}
                    >
                      <PhoneInTalkOutlinedIcon sx={{ fontSize: 20 }} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap sx={{ color: '#0f172a' }}>
                        {lead.full_name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {lead.requirement || 'Follow-up call'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {lead.lead_number}
                      </Typography>
                    </Box>
                  </Stack>

                  {isColumnVisible('project') ? (
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{
                        gridColumn: { xs: '2', md: 'auto' },
                        ml: { xs: '54px', md: 0 },
                        color: 'text.secondary',
                      }}
                    >
                      {lead.project_name || '—'}
                    </Typography>
                  ) : null}
                  {isColumnVisible('phone') ? (
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{
                        gridColumn: { xs: '2', md: 'auto' },
                        ml: { xs: '54px', md: 0 },
                        color: 'primary.main',
                        fontWeight: 600,
                      }}
                    >
                      {lead.mobile || '—'}
                    </Typography>
                  ) : null}
                  {isColumnVisible('priority') ? (
                    <Chip
                      size="small"
                      label={PRIORITY_LABEL[priorityKey]}
                      sx={{
                        justifySelf: 'start',
                        gridColumn: { xs: '2', md: 'auto' },
                        ml: { xs: '54px', md: 0 },
                        bgcolor: pri.bg,
                        color: pri.color,
                        fontWeight: 600,
                        borderRadius: '999px',
                      }}
                    />
                  ) : null}
                  {isColumnVisible('due') ? (
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{
                        alignItems: 'center',
                        gridColumn: { xs: '2', md: 'auto' },
                        ml: { xs: '54px', md: 0 },
                        color: bucket === 'o' ? '#b91c1c' : bucket === 't' ? '#b45309' : '#334155',
                        fontWeight: bucket === 'o' || bucket === 't' ? 600 : 500,
                        fontSize: 13,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <TodayOutlinedIcon sx={{ fontSize: 15 }} />
                      {formatDueLabel(lead.next_followup_at)}
                    </Stack>
                  ) : null}
                  {isColumnVisible('status') ? (
                    <Chip
                      size="small"
                      label={tone.label}
                      sx={{
                        justifySelf: 'start',
                        gridColumn: { xs: '2', md: 'auto' },
                        ml: { xs: '54px', md: 0 },
                        bgcolor: tone.bg,
                        color: tone.color,
                        fontWeight: 600,
                        borderRadius: '999px',
                      }}
                    />
                  ) : null}

                  {canUpdate ? (
                    <Stack
                      direction="row"
                      spacing={0.25}
                      onClick={(event) => event.stopPropagation()}
                      sx={{
                        gridColumn: { xs: '2', md: 'auto' },
                        justifyContent: 'flex-start',
                        ml: { xs: '54px', md: 0 },
                      }}
                    >
                      <Tooltip title="Write call summary">
                        <span>
                          <IconButton
                            size="small"
                            color="primary"
                            disabled={saving}
                            aria-label={`Write call summary ${lead.full_name}`}
                            onClick={() => openLead(lead)}
                            sx={{
                              width: 30,
                              height: 30,
                              borderRadius: '8px',
                              bgcolor: 'primary.main',
                              color: '#fff',
                              '&:hover': { bgcolor: 'primary.dark' },
                            }}
                          >
                            <CheckIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="No answer">
                        <span>
                          <IconButton
                            size="small"
                            disabled={saving}
                            aria-label={`No answer ${lead.full_name}`}
                            onClick={() => void markNoAnswer(lead)}
                            sx={actionIconSx}
                          >
                            <PhoneMissedOutlinedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Snooze to tomorrow">
                        <span>
                          <IconButton
                            size="small"
                            disabled={saving}
                            aria-label={`Snooze ${lead.full_name}`}
                            onClick={() => void snoozeLead(lead)}
                            sx={actionIconSx}
                          >
                            <SnoozeOutlinedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      {canDelete ? (
                        <DeleteIconButton
                          onClick={() => setDeleteTarget(lead)}
                          disabled={saving}
                          tooltip={`Delete ${lead.full_name}`}
                        />
                      ) : null}
                      <Tooltip title="Reschedule">
                        <span>
                          <IconButton
                            size="small"
                            disabled={saving}
                            aria-label={`Reschedule ${lead.full_name}`}
                            onClick={() => {
                              setRescheduleLead(lead)
                              setRescheduleDate(isoToDateInput(addDaysIso(lead.next_followup_at, 1)))
                            }}
                            sx={actionIconSx}
                          >
                            <EventOutlinedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  ) : null}
                </Box>
              )
            })}
          </>
        )}

        <Stack direction="row" spacing={1} sx={{ px: 2, py: 1.5, alignItems: 'center', color: 'text.secondary' }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            Showing {pageRows.length} of {filtered.length} reminders
          </Typography>
          {showPagination ? (
            <>
              <Button
                size="small"
                disabled={pageSafe <= 1}
                onClick={() => setPage((current) => current - 1)}
                sx={{ minWidth: 32, height: 32, border: '1px solid #dbe3ee', borderRadius: '8px' }}
              >
                ‹
              </Button>
              <Typography variant="body2">
                {pageSafe} / {pages}
              </Typography>
              <Button
                size="small"
                disabled={pageSafe >= pages}
                onClick={() => setPage((current) => current + 1)}
                sx={{ minWidth: 32, height: 32, border: '1px solid #dbe3ee', borderRadius: '8px' }}
              >
                ›
              </Button>
            </>
          ) : null}
        </Stack>
      </Box>

      <Drawer
        anchor={phone ? 'bottom' : 'right'}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 420 },
            maxHeight: { xs: '88vh', sm: '100%' },
            borderTopLeftRadius: { xs: 16, sm: 0 },
            borderTopRightRadius: { xs: 16, sm: 0 },
            p: 2.5,
          },
        }}
      >
        <Box component="form" onSubmit={(event) => void saveReminder(event)}>
          <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>
              Add reminder
            </Typography>
            <IconButton aria-label="Close" color="error" onClick={() => setAddOpen(false)}>
              ✕
            </IconButton>
          </Stack>
          <Stack spacing={2}>
            <TextField
              select
              label="Related lead"
              required
              value={addLeadId}
              onChange={(event) => setAddLeadId(event.target.value)}
            >
              {addLeadOptions.map((lead) => (
                <MenuItem key={lead.id} value={lead.id}>
                  {lead.full_name} · {lead.lead_number}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={1.5}>
              <TextField
                label="Due date"
                type="date"
                required
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={addDate}
                onChange={(event) => setAddDate(event.target.value)}
              />
              <TextField
                select
                label="Priority"
                fullWidth
                value={addPriority}
                onChange={(event) => setAddPriority(event.target.value)}
              >
                <MenuItem value="">Keep current</MenuItem>
                <MenuItem value="high">Hot</MenuItem>
                <MenuItem value="medium">Warm</MenuItem>
                <MenuItem value="low">Cold</MenuItem>
              </TextField>
            </Stack>
            <TextField
              label="Notes"
              multiline
              minRows={3}
              value={addNotes}
              onChange={(event) => setAddNotes(event.target.value)}
            />
            <Stack direction="row" spacing={1}>
              <Button fullWidth onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button fullWidth type="submit" variant="contained" disabled={saving}>
                Save reminder
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Drawer>

      <Dialog open={Boolean(rescheduleLead)} onClose={() => setRescheduleLead(null)} fullWidth maxWidth="xs">
        <Box component="form" onSubmit={(event) => void saveReschedule(event)}>
          <DialogTitle>Reschedule · {rescheduleLead?.full_name}</DialogTitle>
          <DialogContent>
            <TextField
              label="New due date"
              type="date"
              required
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={rescheduleDate}
              sx={{ mt: 1 }}
              onChange={(event) => setRescheduleDate(event.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRescheduleLead(null)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={saving}>
              Save date
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ReminderLeadDrawer
        lead={drawerLead}
        canUpdate={canUpdate}
        canDelete={canDelete}
        plan={plan}
        onClose={() => setDrawerLeadId(null)}
        onChanged={onDrawerChanged}
        onEditPlan={() => setPlanOpen(true)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.full_name}?`}
        description="This will permanently delete the lead, its reminder, and all call history. This action cannot be undone."
        confirmLabel="Delete lead"
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return
          const deletedId = deleteTarget.id
          const deletedName = deleteTarget.full_name
          setDeleting(true)
          try {
            await api.delete(`/api/v1/leads/${deletedId}`)
            if (drawerLeadId === deletedId) setDrawerLeadId(null)
            setDeleteTarget(null)
            setNotice(`Lead deleted · ${deletedName}`)
            await load()
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not delete lead.')
          } finally {
            setDeleting(false)
          }
        }}
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
