import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import type { LeadField, LeadFieldList } from '../../lead-fields/types'
import { OPTION_TYPES } from '../../lead-fields/types'
import {
  CUSTOM_STEP,
  FollowupPlanStep,
  gapForStep,
  nextPlanStep,
  waitDaysAfterStep,
} from '../../followup-plan/plan'
import {
  addDaysIso,
  dateInputToIsoNoon,
  isoToDateInput,
} from '../../leads/lead-dates'
import {
  LEAD_SOURCES,
  LEAD_STATUSES,
  Lead,
  LeadPriority,
  LeadStatus,
  PRIORITY_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
} from '../../leads/types'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'

type DrawerForm = {
  full_name: string
  mobile: string
  email: string
  city: string
  requirement: string
  call_summary: string
  lead_source: string
  priority: LeadPriority
  status: LeadStatus
  enquiry_date: string
  extra_values: Record<string, string>
}

/** Temporarily hidden custom fields in Reminder drawer. */
const HIDDEN_EXTRA_FIELD_LABELS = new Set([
  'selling point',
  'interested product',
  'student strength',
  'no of branch',
  'no. of branch',
  'number of branch',
  'number of branches',
])

type ActionKind = 'noanswer' | 'skip' | 'note' | null

function currentPlanLabel(lead: Lead, plan: FollowupPlanStep[]) {
  const step = (lead.plan_step || '').trim()
  if (!step) return plan[0]?.label || 'Day 1'
  if (step === CUSTOM_STEP) return CUSTOM_STEP
  if (plan.some((item) => item.label === step)) return step
  return step
}

function formFromLead(lead: Lead): DrawerForm {
  const extras: Record<string, string> = {}
  for (const [key, value] of Object.entries(lead.extra_values ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      extras[key] = String(value)
    } else if (Array.isArray(value)) {
      extras[key] = value.map(String).join(', ')
    }
  }
  return {
    full_name: lead.full_name,
    mobile: lead.mobile,
    email: lead.email ?? '',
    city: lead.city ?? '',
    requirement: lead.requirement ?? '',
    call_summary: lead.call_summary ?? '',
    lead_source: lead.lead_source ?? '',
    priority: lead.priority,
    status: lead.status,
    enquiry_date: isoToDateInput(lead.created_at),
    extra_values: extras,
  }
}

type LeadActivityItem = {
  id: string
  actor_name: string
  at: string
  message: string
}

type Props = {
  lead: Lead | null
  canUpdate: boolean
  plan: FollowupPlanStep[]
  onClose: () => void
  onChanged: (message: string) => Promise<void>
  onEditPlan?: () => void
}

function formatActivityAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-CA')
}

export function ReminderLeadDrawer({ lead, canUpdate, plan, onClose, onChanged }: Props) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('md'))
  const open = Boolean(lead)

  const [form, setForm] = useState<DrawerForm | null>(null)
  const [fields, setFields] = useState<LeadField[]>([])
  const [activity, setActivity] = useState<LeadActivityItem[]>([])
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')
  const [action, setAction] = useState<ActionKind>(null)
  const [actionNote, setActionNote] = useState('')
  const [customDueDate, setCustomDueDate] = useState(() => isoToDateInput(addDaysIso(null, 1)))

  const loadActivity = useCallback(async (leadId: string) => {
    try {
      const result = await api.get<{ items: LeadActivityItem[] }>(`/api/v1/leads/${leadId}/activity`)
      setActivity(result.data.items)
    } catch {
      setActivity([])
    }
  }, [])

  useEffect(() => {
    if (!lead) {
      setForm(null)
      setFields([])
      setActivity([])
      setLocalError('')
      setAction(null)
      return
    }
    setForm(formFromLead(lead))
    setLocalError('')
    setAction(null)
    setCustomDueDate(isoToDateInput(lead.next_followup_at) || isoToDateInput(addDaysIso(null, 1)))
    void loadActivity(lead.id)
    void (async () => {
      if (!lead.project_id) {
        setFields([])
        return
      }
      try {
        const result = await api.get<LeadFieldList>(`/api/v1/lead-fields?project_id=${lead.project_id}`)
        setFields(result.data.items.filter((field) => field.is_active))
      } catch {
        setFields([])
      }
    })()
  }, [lead, loadActivity])

  const statusTone = lead ? STATUS_TONE[lead.status] ?? STATUS_TONE.new : STATUS_TONE.new
  const currentStep = lead ? currentPlanLabel(lead, plan) : plan[0]?.label || 'Day 1'

  const closed = lead ? lead.status === 'won' || lead.status === 'lost' : false

  const patch = useCallback(
    async (body: Record<string, unknown>, message: string, closeDrawer = false) => {
      if (!lead) return
      setSaving(true)
      setLocalError('')
      try {
      await api.patch(`/api/v1/leads/${lead.id}`, body)
      await onChanged(message)
      await loadActivity(lead.id)
      if (closeDrawer) onClose()
      else setAction(null)
      } catch (requestError) {
        setLocalError(requestError instanceof ApiError ? requestError.message : 'Could not update lead.')
      } finally {
        setSaving(false)
      }
    },
    [lead, loadActivity, onChanged, onClose],
  )

  async function saveField(body: Record<string, unknown>) {
    if (!lead || !canUpdate) return
    await patch(body, 'Lead updated.')
  }

  async function saveCallDone() {
    if (!lead || !form) return
    const summary = form.call_summary.trim()
    if (!summary) {
      setLocalError('Write the Call summary above, then tap Call done.')
      return
    }
    const next = nextPlanStep(plan, currentStep)
    const waitDays = waitDaysAfterStep(plan, currentStep)
    const body: Record<string, unknown> = {
      call_summary: summary,
      plan_step: next?.label ?? currentStep,
      next_followup_at: next ? addDaysIso(null, waitDays) : null,
      requirement: lead.requirement ? `${lead.requirement}\nCall: ${summary}` : `Call: ${summary}`,
    }
    if (lead.status === 'new') body.status = 'contacted'
    await patch(body, `Call done · ${lead.full_name}`)
  }

  async function submitAction(event: FormEvent) {
    event.preventDefault()
    if (!lead || !action) return

    if (action === 'noanswer') {
      const note = actionNote.trim() || 'No answer'
      await patch(
        {
          requirement: lead.requirement ? `${lead.requirement}\n${note}` : note,
          next_followup_at: addDaysIso(lead.next_followup_at, 1),
        },
        `No answer · ${lead.full_name}`,
      )
      return
    }

    if (action === 'skip') {
      const why = actionNote.trim()
      if (!why) {
        setLocalError('Add a reason to skip.')
        return
      }
      const next = nextPlanStep(plan, currentStep)
      if (!next) {
        await patch(
          {
            next_followup_at: null,
            requirement: lead.requirement ? `${lead.requirement}\nSkipped: ${why}` : `Skipped: ${why}`,
          },
          `Skipped · ${lead.full_name}`,
        )
        return
      }
      await patch(
        {
          plan_step: next.label,
          next_followup_at: addDaysIso(null, waitDaysAfterStep(plan, currentStep)),
          requirement: lead.requirement ? `${lead.requirement}\nSkipped: ${why}` : `Skipped: ${why}`,
        },
        `Skipped · ${lead.full_name}`,
      )
      return
    }

    if (action === 'note') {
      const note = actionNote.trim()
      if (!note) {
        setLocalError('Write a call summary.')
        return
      }
      await patch(
        {
          requirement: lead.requirement ? `${lead.requirement}\nCall: ${note}` : `Call: ${note}`,
        },
        `Call summary saved · ${lead.full_name}`,
      )
    }
  }

  const actionTitle = useMemo(() => {
    switch (action) {
      case 'noanswer':
        return 'No answer'
      case 'skip':
        return 'Skip step'
      case 'note':
        return 'Add call summary'
      default:
        return ''
    }
  }, [action])

  return (
    <>
      <Drawer
        anchor={phone ? 'bottom' : 'right'}
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 520 },
            maxWidth: '100%',
            maxHeight: { xs: '92vh', sm: '100%' },
            borderTopLeftRadius: { xs: 16, sm: 0 },
            borderTopRightRadius: { xs: 16, sm: 0 },
            p: 2.25,
            boxShadow: '-12px 0 30px rgba(15,23,42,.12)',
          },
        }}
      >
        {lead && form ? (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="h6" fontWeight={700}>
                {lead.lead_number}
              </Typography>
              <Chip
                size="small"
                label={STATUS_LABEL[lead.status] ?? lead.status}
                sx={{ bgcolor: statusTone.bg, color: statusTone.color, fontWeight: 700 }}
              />
              <Box sx={{ flex: 1 }} />
              <Button onClick={onClose}>Close</Button>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: -1 }}>
              {lead.project_name || 'Project'} · project cannot be changed
            </Typography>

            {localError ? (
              <Typography color="error" variant="body2">
                {localError}
              </Typography>
            ) : null}

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 1.25,
              }}
            >
              <TextField
                label="Contact Person Name"
                value={form.full_name}
                disabled={!canUpdate || saving}
                onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                onBlur={() => {
                  if (form.full_name.trim() && form.full_name !== lead.full_name) {
                    void saveField({ full_name: form.full_name.trim() })
                  }
                }}
              />
              <TextField
                label="Mobile Number"
                value={form.mobile}
                disabled={!canUpdate || saving}
                onChange={(event) => setForm({ ...form, mobile: event.target.value })}
                onBlur={() => {
                  if (form.mobile.trim() && form.mobile !== lead.mobile) {
                    void saveField({ mobile: form.mobile.trim() })
                  }
                }}
              />
              <TextField
                label="Enquiry Date"
                type="date"
                value={form.enquiry_date}
                disabled
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Location"
                value={form.city}
                disabled={!canUpdate || saving}
                onChange={(event) => setForm({ ...form, city: event.target.value })}
                onBlur={() => {
                  if (form.city !== (lead.city ?? '')) {
                    void saveField({ city: form.city.trim() || null })
                  }
                }}
              />
              <TextField
                label="Email"
                value={form.email}
                disabled={!canUpdate || saving}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                onBlur={() => {
                  if (form.email !== (lead.email ?? '')) {
                    void saveField({ email: form.email.trim() || null })
                  }
                }}
              />
              <TextField
                label="Requirement"
                value={form.requirement}
                disabled={!canUpdate || saving}
                onChange={(event) => setForm({ ...form, requirement: event.target.value })}
                onBlur={() => {
                  if (form.requirement !== (lead.requirement ?? '')) {
                    void saveField({ requirement: form.requirement.trim() || null })
                  }
                }}
              />
              <TextField
                label="Call summary"
                value={form.call_summary}
                disabled={!canUpdate || saving}
                multiline
                minRows={3}
                helperText="Fill this, then tap Call done"
                onChange={(event) => setForm({ ...form, call_summary: event.target.value })}
                onBlur={() => {
                  if (form.call_summary !== (lead.call_summary ?? '')) {
                    void saveField({ call_summary: form.call_summary.trim() || null })
                  }
                }}
              />
              <TextField
                select
                label="Lead Source"
                value={form.lead_source}
                disabled={!canUpdate || saving}
                onChange={(event) => {
                  const lead_source = event.target.value
                  setForm({ ...form, lead_source })
                  void saveField({ lead_source: lead_source || null })
                }}
              >
                <MenuItem value="">—</MenuItem>
                {LEAD_SOURCES.map((source) => (
                  <MenuItem key={source} value={source}>
                    {source}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Priority"
                value={form.priority}
                disabled={!canUpdate || saving}
                onChange={(event) => {
                  const priority = event.target.value as LeadPriority
                  setForm({ ...form, priority })
                  void saveField({ priority })
                }}
              >
                <MenuItem value="high">{PRIORITY_LABEL.high}</MenuItem>
                <MenuItem value="medium">{PRIORITY_LABEL.medium}</MenuItem>
                <MenuItem value="low">{PRIORITY_LABEL.low}</MenuItem>
              </TextField>
              <TextField
                select
                label="Status"
                value={form.status}
                disabled={!canUpdate || saving || closed}
                onChange={(event) => {
                  const status = event.target.value as LeadStatus
                  setForm({ ...form, status })
                  void saveField({ status })
                }}
              >
                {LEAD_STATUSES.map((status) => (
                  <MenuItem key={status} value={status}>
                    {STATUS_LABEL[status] ?? status}
                  </MenuItem>
                ))}
              </TextField>
              {/* Hidden for now: Selling point / Interested product / Student strength / No of branch */}
              {fields
                .filter((field) => !HIDDEN_EXTRA_FIELD_LABELS.has(field.label.trim().toLowerCase()))
                .map((field) => {
                const value = form.extra_values[field.key] ?? ''
                if (OPTION_TYPES.has(field.field_type)) {
                  return (
                    <TextField
                      key={field.id}
                      select
                      label={field.label}
                      value={value}
                      disabled={!canUpdate || saving}
                      onChange={(event) => {
                        const next = event.target.value
                        const extra_values = { ...form.extra_values, [field.key]: next }
                        setForm({ ...form, extra_values })
                        void saveField({
                          extra_values: { ...(lead.extra_values ?? {}), [field.key]: next || null },
                        })
                      }}
                    >
                      <MenuItem value="">—</MenuItem>
                      {(field.options ?? []).map((option) => (
                        <MenuItem key={option} value={option}>
                          {option}
                        </MenuItem>
                      ))}
                    </TextField>
                  )
                }
                return (
                  <TextField
                    key={field.id}
                    label={field.label}
                    type={field.field_type === 'date' ? 'date' : field.field_type === 'number' ? 'number' : 'text'}
                    value={value}
                    disabled={!canUpdate || saving}
                    InputLabelProps={field.field_type === 'date' ? { shrink: true } : undefined}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        extra_values: { ...form.extra_values, [field.key]: event.target.value },
                      })
                    }
                    onBlur={() => {
                      const next = form.extra_values[field.key] ?? ''
                      const prev = String(lead.extra_values?.[field.key] ?? '')
                      if (next !== prev) {
                        void saveField({
                          extra_values: { ...(lead.extra_values ?? {}), [field.key]: next || null },
                        })
                      }
                    }}
                  />
                )
              })}
            </Box>

            {/* Follow-up plan steps hidden — keep reminder schedule */}
            {canUpdate ? (
              <Box>
                <Typography fontWeight={700} sx={{ mb: 1 }}>
                  Schedule reminder
                </Typography>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <TextField
                    label="Due date"
                    type="date"
                    size="small"
                    value={customDueDate}
                    InputLabelProps={{ shrink: true }}
                    sx={{ flex: 1, maxWidth: 220 }}
                    onChange={(event) => setCustomDueDate(event.target.value)}
                  />
                  <Button
                    variant="outlined"
                    disabled={saving || !customDueDate}
                    onClick={() => {
                      const iso = dateInputToIsoNoon(customDueDate)
                      if (!iso) {
                        setLocalError('Pick a valid date.')
                        return
                      }
                      void patch(
                        {
                          plan_step: CUSTOM_STEP,
                          next_followup_at: iso,
                        },
                        `Reminder scheduled · ${lead.full_name}`,
                      )
                    }}
                  >
                    Set date
                  </Button>
                </Stack>
                {lead.next_followup_at ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    Current due {isoToDateInput(lead.next_followup_at)}
                  </Typography>
                ) : null}
              </Box>
            ) : null}

            {canUpdate ? (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {lead.next_followup_at ? (
                  <>
                    <Button
                      variant="contained"
                      disabled={saving}
                      onClick={() => void saveCallDone()}
                    >
                      Call done
                    </Button>
                    <Button
                      disabled={saving}
                      onClick={() => {
                        setAction('noanswer')
                        setActionNote('')
                        setLocalError('')
                      }}
                    >
                      No answer
                    </Button>
                    <Button
                      disabled={saving}
                      onClick={() => {
                        void patch(
                          { next_followup_at: addDaysIso(lead.next_followup_at, 1) },
                          `Snoozed · ${lead.full_name}`,
                        )
                      }}
                    >
                      Snooze to tomorrow
                    </Button>
                    <Button
                      disabled={saving}
                      onClick={() => {
                        setAction('skip')
                        setActionNote('')
                        setLocalError('')
                      }}
                    >
                      Skip step
                    </Button>
                  </>
                ) : null}
                {!closed ? (
                  <Button
                    disabled={saving}
                    color="error"
                    onClick={() => void patch({ status: 'lost', next_followup_at: null }, `Marked lost · ${lead.full_name}`)}
                  >
                    Mark Lost
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    disabled={saving}
                    onClick={() =>
                      void patch(
                        {
                          status: 'contacted',
                          plan_step: plan[0]?.label || 'Day 1',
                          next_followup_at: addDaysIso(null, gapForStep(plan, plan[0]?.label || 'Day 1')),
                        },
                        `Reopened · ${lead.full_name}`,
                      )
                    }
                  >
                    Reopen lead
                  </Button>
                )}
              </Stack>
            ) : null}

            <Box>
              <Typography fontWeight={700} sx={{ mb: 1 }}>
                Activity
              </Typography>
              {activity.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No activity yet.
                </Typography>
              ) : (
                <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
                  {activity.map((item) => (
                    <Box
                      component="li"
                      key={item.id}
                      sx={{
                        py: 1,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        '&:last-child': { borderBottom: 0 },
                      }}
                    >
                      <Typography variant="body2" fontWeight={700}>
                        {item.actor_name}
                        <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                          {' '}
                          · {formatActivityAt(item.at)}
                        </Box>
                      </Typography>
                      <Typography variant="body2" color="text.primary">
                        {item.message}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Stack>
        ) : null}
      </Drawer>

      <Dialog open={Boolean(action)} onClose={() => !saving && setAction(null)} fullWidth maxWidth="xs">
        <Box component="form" onSubmit={(event) => void submitAction(event)}>
          <DialogTitle>
            {actionTitle}
            {lead ? ` · ${lead.full_name}` : ''}
          </DialogTitle>
          <DialogContent>
            {action === 'noanswer' || action === 'skip' || action === 'note' ? (
              <TextField
                label={action === 'note' ? 'Call summary' : action === 'skip' ? 'Reason' : 'One-line note'}
                required={action !== 'noanswer'}
                value={actionNote}
                fullWidth
                multiline
                minRows={action === 'note' ? 3 : 2}
                autoFocus
                sx={{ mt: 1 }}
                onChange={(event) => setActionNote(event.target.value)}
              />
            ) : null}
            {localError ? (
              <Typography color="error" variant="body2" sx={{ mt: 1 }}>
                {localError}
              </Typography>
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button disabled={saving} onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              Save
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </>
  )
}
