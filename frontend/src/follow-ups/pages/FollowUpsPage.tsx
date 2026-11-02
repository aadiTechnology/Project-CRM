import CheckIcon from '@mui/icons-material/Check'
import PhoneInTalkOutlinedIcon from '@mui/icons-material/PhoneInTalkOutlined'
import PhoneMissedOutlinedIcon from '@mui/icons-material/PhoneMissedOutlined'
import SkipNextOutlinedIcon from '@mui/icons-material/SkipNextOutlined'
import SnoozeOutlinedIcon from '@mui/icons-material/SnoozeOutlined'
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined'
import {
  Box,
  Chip,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ColumnChooser } from '../../column-visibility/ColumnChooser'
import { useColumnVisibility } from '../../column-visibility/useColumnVisibility'
import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import {
  CUSTOM_STEP,
  FollowupPlanStep,
  gapForStep,
  loadFollowupPlan,
  nextPlanStep,
  planLabels,
} from '../../followup-plan/plan'
import { addDaysIso, followWhen, formatDueLabel } from '../../leads/lead-dates'
import {
  Lead,
  LeadList,
  LeadProjectOption,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  type LeadPriority,
} from '../../leads/types'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'
import { useAuth } from '../../store/auth-context'

type SessionTally = { connected: number; noAnswer: number; snoozed: number; skipped: number }

const STEP_PALETTE = ['#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6', '#64748b', '#0ea5e9', '#f43f5e']

const actionIconSx = {
  width: 30,
  height: 30,
  borderRadius: '8px',
  color: 'text.secondary',
  '&:hover': { bgcolor: '#eef2f7', color: 'text.primary' },
} as const

function stepColor(label: string, plan: FollowupPlanStep[]) {
  const index = plan.findIndex((step) => step.label === label)
  if (label === CUSTOM_STEP) return STEP_PALETTE[5]
  return STEP_PALETTE[index >= 0 ? index % STEP_PALETTE.length : 0]
}

function dueDisplay(lead: Lead) {
  const when = followWhen(lead.next_followup_at)
  const label = formatDueLabel(lead.next_followup_at)
  if (!lead.next_followup_at) return { label: '—', overdue: false, when: null as ReturnType<typeof followWhen> }
  if (when === 'o') return { label, overdue: true, when }
  return { label, overdue: false, when }
}

export function FollowUpsPage() {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('md'))
  const { user } = useAuth()
  const canUpdate = Boolean(user?.permissions.includes('leads.update'))
  const {
    columns: columnDefs,
    visibility: columnVisibility,
    isVisible: isColumnVisible,
    toggle: toggleColumn,
    reset: resetColumns,
    gridTemplateMd: followUpsGridMd,
    gridTemplateXs: followUpsGridXs,
    loadError: columnLoadError,
    saveError: columnSaveError,
    clearSaveError: clearColumnSaveError,
    clearLoadError: clearColumnLoadError,
  } = useColumnVisibility('follow-ups')

  const [items, setItems] = useState<Lead[]>([])
  const [projects, setProjects] = useState<LeadProjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [projectId, setProjectId] = useState('')
  const [step, setStep] = useState('')
  const [saving, setSaving] = useState(false)
  const [tally, setTally] = useState<SessionTally>({ connected: 0, noAnswer: 0, snoozed: 0, skipped: 0 })
  const [plan, setPlan] = useState<FollowupPlanStep[]>(() => loadFollowupPlan(user?.company_id))

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

  useEffect(() => {
    void (async () => {
      try {
        const result = await api.get<{ items: LeadProjectOption[] }>('/api/v1/projects')
        setProjects(result.data.items)
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
      if (step) params.set('plan_step', step)
      const result = await api.get<LeadList>(`/api/v1/leads?${params}`)
      const rows = [...result.data.items].sort((a, b) => {
        const aDue = a.next_followup_at ?? '9999'
        const bDue = b.next_followup_at ?? '9999'
        return aDue.localeCompare(bDue)
      })
      setItems(rows)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Could not load follow-ups.')
    } finally {
      setLoading(false)
    }
  }, [projectId, step])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const subtitle = useMemo(
    () =>
      `Open plans by step. Completed this session: ${tally.connected} connected · ${tally.noAnswer} no answer · ${tally.snoozed} snoozed · ${tally.skipped} skipped.`,
    [tally],
  )

  async function patchOutcome(
    lead: Lead,
    body: Record<string, unknown>,
    kind: keyof SessionTally,
    message: string,
  ) {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.patch(`/api/v1/leads/${lead.id}`, body)
      setTally((current) => ({ ...current, [kind]: current[kind] + 1 }))
      setNotice(message)
      await load()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Could not update follow-up.')
    } finally {
      setSaving(false)
    }
  }

  async function onConnected(lead: Lead) {
    const current = lead.plan_step || plan[0]?.label || 'Day 1'
    const next = nextPlanStep(plan, current)
    const target = next?.label ?? current
    const body: Record<string, unknown> = {
      next_followup_at: next ? addDaysIso(null, gapForStep(plan, current)) : null,
      plan_step: target,
    }
    if (lead.status === 'new') body.status = 'contacted'
    const note = 'Connected'
    body.requirement = lead.requirement ? `${lead.requirement}\n${note}` : note
    await patchOutcome(lead, body, 'connected', `Connected · ${lead.full_name}`)
  }

  async function onNoAnswer(lead: Lead) {
    const note = 'No answer'
    await patchOutcome(
      lead,
      {
        requirement: lead.requirement ? `${lead.requirement}\n${note}` : note,
        next_followup_at: addDaysIso(lead.next_followup_at, 1),
      },
      'noAnswer',
      `No answer · ${lead.full_name}`,
    )
  }

  async function onSnooze(lead: Lead) {
    await patchOutcome(
      lead,
      { next_followup_at: addDaysIso(lead.next_followup_at, 1) },
      'snoozed',
      `Snoozed · ${lead.full_name}`,
    )
  }

  async function onSkip(lead: Lead) {
    await patchOutcome(lead, { next_followup_at: null }, 'skipped', `Skipped · ${lead.full_name}`)
  }

  if (loading && items.length === 0) return <LoadingScreen />

  return (
    <Stack spacing={2.5}>
      <Stack spacing={0.75}>
        <Typography variant="h1">Follow-ups</Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 760, lineHeight: 1.55 }}>
          {subtitle}
        </Typography>
      </Stack>

      {error ? <ErrorAlert message={error} /> : null}
      {notice ? (
        <Typography color="success.main" variant="body2" fontWeight={600}>
          {notice}
        </Typography>
      ) : null}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
        <TextField
          select
          size="small"
          label="Project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          sx={{ minWidth: { xs: '100%', sm: 260 } }}
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
          label="Plan step"
          value={step}
          onChange={(event) => setStep(event.target.value)}
          sx={{ minWidth: { xs: '100%', sm: 260 } }}
        >
          <MenuItem value="">All steps</MenuItem>
          {planLabels(plan).map((item) => (
            <MenuItem key={item} value={item}>
              {item}
            </MenuItem>
          ))}
        </TextField>
        <Box sx={{ ml: { sm: 'auto' }, alignSelf: { xs: 'flex-end', sm: 'center' } }}>
          <ColumnChooser
            columns={columnDefs}
            visibility={columnVisibility}
            onToggle={toggleColumn}
            onReset={resetColumns}
          />
        </Box>
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
              gridTemplateColumns: followUpsGridMd,
              columnGap: 1.25,
              alignItems: 'center',
              px: 2,
              py: 1,
              bgcolor: '#f8fafc',
              borderBottom: '1px solid #dbe3ee',
            }}
          >
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
            {isColumnVisible('plan') ? (
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                Plan
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
            <Typography variant="caption" fontWeight={700} color="text.secondary" textAlign="right">
              Actions
            </Typography>
          </Box>
        ) : null}

        {items.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            {step ? `No follow-ups for ${step}.` : 'No open follow-ups in your scope.'}
          </Typography>
        ) : (
          items.map((lead) => {
            const due = dueDisplay(lead)
            const priorityKey: LeadPriority = lead.priority in PRIORITY_TONE ? lead.priority : 'medium'
            const planLabel = lead.plan_step || plan[0]?.label || 'Day 1'
            const color = stepColor(planLabel, plan)
            return (
              <Box
                key={lead.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: followUpsGridXs,
                    md: followUpsGridMd,
                  },
                  columnGap: 1.25,
                  rowGap: 0.75,
                  alignItems: 'center',
                  px: 2,
                  py: 1.15,
                  borderBottom: '1px solid #edf1f7',
                  '&:hover': { bgcolor: '#f8fbff' },
                }}
              >
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
                  <Box
                    sx={{
                      width: 42,
                      height: 42,
                      borderRadius: '50%',
                      flexShrink: 0,
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: `color-mix(in srgb, ${color} 14%, #fff)`,
                      color,
                    }}
                  >
                    <PhoneInTalkOutlinedIcon sx={{ fontSize: 20 }} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={700} noWrap>
                      {lead.full_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                      {lead.lead_number}
                    </Typography>
                  </Box>
                </Stack>

                {isColumnVisible('project') ? (
                  <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                    {lead.project_name || '—'}
                  </Typography>
                ) : null}
                {isColumnVisible('phone') ? (
                  <Typography variant="body2" noWrap sx={{ color: 'primary.main', fontWeight: 600 }}>
                    {lead.mobile || '—'}
                  </Typography>
                ) : null}
                {isColumnVisible('plan') ? (
                  <Chip
                    size="small"
                    label={planLabel}
                    sx={{
                      justifySelf: 'start',
                      bgcolor: `color-mix(in srgb, ${color} 12%, #fff)`,
                      color,
                      fontWeight: 600,
                      borderRadius: '999px',
                    }}
                  />
                ) : null}
                {isColumnVisible('priority') ? (
                  <Chip
                    size="small"
                    label={PRIORITY_LABEL[priorityKey]}
                    sx={{
                      justifySelf: 'start',
                      bgcolor: PRIORITY_TONE[priorityKey].bg,
                      color: PRIORITY_TONE[priorityKey].color,
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
                      color: due.overdue ? '#b91c1c' : due.when === 't' ? '#b45309' : '#334155',
                      fontWeight: due.overdue || due.when === 't' ? 600 : 500,
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <TodayOutlinedIcon sx={{ fontSize: 15 }} />
                    {due.label}
                  </Stack>
                ) : null}

                {canUpdate ? (
                  <Stack direction="row" spacing={0.25} sx={{ justifyContent: 'flex-end' }}>
                    <Tooltip title="Connected">
                      <span>
                        <IconButton
                          size="small"
                          disabled={saving}
                          aria-label={`Connected ${lead.full_name}`}
                          onClick={() => void onConnected(lead)}
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
                          onClick={() => void onNoAnswer(lead)}
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
                          onClick={() => void onSnooze(lead)}
                          sx={actionIconSx}
                        >
                          <SnoozeOutlinedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Skip">
                      <span>
                        <IconButton
                          size="small"
                          disabled={saving}
                          aria-label={`Skip ${lead.full_name}`}
                          onClick={() => void onSkip(lead)}
                          sx={actionIconSx}
                        >
                          <SkipNextOutlinedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                ) : (
                  <span />
                )}
              </Box>
            )
          })
        )}
      </Box>
    </Stack>
  )
}
