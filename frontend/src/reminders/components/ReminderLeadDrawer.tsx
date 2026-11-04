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
import { FormEvent, useCallback, useEffect, useState } from 'react'

import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { DeleteIconButton } from '../../components/common/DeleteIconButton'
import { isDuplicateBuiltinLeadField, resolveCallSummary } from '../../lead-fields/builtinLabels'
import type { LeadField, LeadFieldList } from '../../lead-fields/types'
import { OPTION_TYPES } from '../../lead-fields/types'
import {
  CUSTOM_STEP,
  FollowupPlanStep,
  gapForStep,
} from '../../followup-plan/plan'
import {
  addDaysIso,
  dateInputToIsoNoon,
  formatEnquiryDate,
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

type ActionKind = 'noanswer' | null

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
    call_summary: '',
    lead_source: lead.lead_source ?? '',
    priority: lead.priority,
    status: lead.status,
    enquiry_date: (lead.enquiry_date ?? '').slice(0, 10),
    extra_values: extras,
  }
}

type LeadCallItem = {
  id: string
  user_name: string
  outcome: string
  summary: string | null
  created_at: string
}

type Props = {
  lead: Lead | null
  canUpdate: boolean
  canDelete?: boolean
  plan: FollowupPlanStep[]
  onClose: () => void
  onChanged: (message: string) => Promise<void>
  onEditPlan?: () => void
}

function earlierNote(lead: Lead): string {
  return resolveCallSummary(lead.call_summary, lead.extra_values)
}

function historyLines(note: string): { title: string; message: string }[] {
  return note
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const splitAt = line.indexOf(':')
      if (splitAt <= 0 || splitAt > 40) return { title: 'Imported note', message: line }
      const message = line.slice(splitAt + 1).trim()
      return { title: line.slice(0, splitAt).trim(), message: message || line }
    })
}

function formatHistoryDate(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || /^\d{4}-\d{2}-\d{2}T00:00:00/.test(trimmed)) {
    const formatted = formatEnquiryDate(trimmed)
    return formatted === '—' ? '' : formatted
  }
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) {
    const formatted = formatEnquiryDate(trimmed)
    return formatted === '—' ? '' : formatted
  }
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function importedHistoryDate(title: string, lead: Lead): string {
  const laterFollowup = /\bfollow/i.test(title) && /\b(2nd|2|second|3rd|third)\b/i.test(title)
  const raw = laterFollowup
    ? lead.next_followup_at || lead.enquiry_date || lead.created_at
    : lead.enquiry_date || lead.created_at
  return formatHistoryDate(raw)
}

const historyRowSx = {
  py: 1,
  borderBottom: '1px solid',
  borderColor: 'divider',
  '&:last-child': { borderBottom: 0 },
} as const

function formatActivityAt(value: string) {
  return formatHistoryDate(value) || value
}

export function ReminderLeadDrawer({ lead, canUpdate, canDelete = false, plan, onClose, onChanged }: Props) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('md'))
  const open = Boolean(lead)

  const [form, setForm] = useState<DrawerForm | null>(null)
  const [fields, setFields] = useState<LeadField[]>([])
  const [calls, setCalls] = useState<LeadCallItem[]>([])
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')
  const [action, setAction] = useState<ActionKind>(null)
  const [actionNote, setActionNote] = useState('')
  const [customDueDate, setCustomDueDate] = useState(() => isoToDateInput(addDaysIso(null, 1)))
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)

  const loadCalls = useCallback(async (leadId: string) => {
    try {
      const result = await api.get<{ items: LeadCallItem[] }>(`/api/v1/leads/${leadId}/calls`)
      setCalls(result.data.items)
    } catch {
      setCalls([])
    }
  }, [])

  useEffect(() => {
    if (!lead) {
      setForm(null)
      setFields([])
      setCalls([])
      setLocalError('')
      setAction(null)
      return
    }
    setForm(formFromLead(lead))
    setLocalError('')
    setAction(null)
    setCustomDueDate(isoToDateInput(lead.next_followup_at) || isoToDateInput(addDaysIso(null, 1)))
    void loadCalls(lead.id)
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
  }, [lead, loadCalls])

  const statusTone = lead ? STATUS_TONE[lead.status] ?? STATUS_TONE.new : STATUS_TONE.new

  const closed = lead ? lead.status === 'won' || lead.status === 'lost' : false

  const patch = useCallback(
    async (body: Record<string, unknown>, message: string, closeDrawer = false) => {
      if (!lead) return
      setSaving(true)
      setLocalError('')
      try {
      await api.patch(`/api/v1/leads/${lead.id}`, body)
      await onChanged(message)
      await loadCalls(lead.id)
      if (closeDrawer) onClose()
      else setAction(null)
      } catch (requestError) {
        setLocalError(requestError instanceof ApiError ? requestError.message : 'Could not update lead.')
      } finally {
        setSaving(false)
      }
    },
    [lead, loadCalls, onChanged, onClose],
  )

  async function saveField(body: Record<string, unknown>) {
    if (!lead || !canUpdate) return
    await patch(body, 'Lead updated.')
  }

  async function deleteLead() {
    if (!lead || !canDelete) return
    const name = lead.full_name
    setSaving(true)
    setLocalError('')
    try {
      await api.delete(`/api/v1/leads/${lead.id}`)
      setConfirmDeleteOpen(false)
      onClose()
      await onChanged(`Lead deleted · ${name}`)
    } catch (requestError) {
      setLocalError(requestError instanceof ApiError ? requestError.message : 'Could not delete lead.')
      setConfirmDeleteOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function submitAction(event: FormEvent) {
    event.preventDefault()
    if (!lead || !action) return

    if (action === 'noanswer') {
      const note = actionNote.trim()
      setSaving(true)
      setLocalError('')
      try {
        await api.post(`/api/v1/leads/${lead.id}/calls`, {
          outcome: 'no_answer',
          summary: note || null,
        })
        await api.patch(`/api/v1/leads/${lead.id}`, {
          next_followup_at: addDaysIso(lead.next_followup_at, 1),
        })
        setAction(null)
        setActionNote('')
        if (form) setForm({ ...form, call_summary: '' })
        await loadCalls(lead.id)
        await onChanged(`No answer · ${lead.full_name}`)
      } catch (requestError) {
        setLocalError(requestError instanceof ApiError ? requestError.message : 'Could not save this call.')
      } finally {
        setSaving(false)
      }
    }
  }

  async function saveThisCall() {
    if (!lead || !form) return
    const summary = form.call_summary.trim()
    if (!summary) {
      setLocalError('Write what was said on this call.')
      return
    }
    setSaving(true)
    setLocalError('')
    try {
      await api.post(`/api/v1/leads/${lead.id}/calls`, { outcome: 'connected', summary })
      setForm({ ...form, call_summary: '' })
      await loadCalls(lead.id)
      await onChanged(`Connected · ${lead.full_name}`)
    } catch (requestError) {
      setLocalError(requestError instanceof ApiError ? requestError.message : 'Could not save this call.')
    } finally {
      setSaving(false)
    }
  }

  const actionTitle = action === 'noanswer' ? 'No answer' : ''

  return (
    <>
      <Drawer
        anchor={phone ? 'bottom' : 'right'}
        open={open}
        onClose={(_event, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
          onClose()
        }}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 520 },
            maxWidth: '100%',
            height: { xs: 'auto', sm: '100%' },
            maxHeight: { xs: '92vh', sm: '100%' },
            borderTopLeftRadius: { xs: 16, sm: 0 },
            borderTopRightRadius: { xs: 16, sm: 0 },
            p: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '-12px 0 30px rgba(15,23,42,.12)',
          },
        }}
      >
        {lead && form ? (
          <>
            <Box
              sx={{
                flexShrink: 0,
                px: 2.25,
                pt: 2.25,
                pb: 1.5,
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'divider',
                zIndex: 1,
              }}
            >
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
                <Button color="error" onClick={onClose}>
                  Close
                </Button>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {lead.project_name || 'Project'} · project cannot be changed
              </Typography>
            </Box>

            <Stack
              spacing={2}
              sx={{
                flex: '1 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                px: 2.25,
                pt: 2,
                pb: 2.25,
              }}
            >
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
              <Box sx={{ gridColumn: '1 / -1' }}>
                <TextField
                  label="This call"
                  value={form.call_summary}
                  disabled={!canUpdate || saving}
                  multiline
                  minRows={3}
                  fullWidth
                  placeholder="What was said on this call"
                  helperText="Each save keeps a separate summary. This box starts empty for the next call."
                  onChange={(event) => setForm({ ...form, call_summary: event.target.value })}
                />
                {canUpdate ? (
                  <Button
                    variant="contained"
                    size="small"
                    disabled={saving || !form.call_summary.trim()}
                    onClick={() => void saveThisCall()}
                    sx={{ mt: 1 }}
                  >
                    Save this call
                  </Button>
                ) : null}
              </Box>
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
                {form.lead_source && !(LEAD_SOURCES as readonly string[]).includes(form.lead_source) ? (
                  <MenuItem value={form.lead_source}>{form.lead_source}</MenuItem>
                ) : null}
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
                .filter((field) => !isDuplicateBuiltinLeadField(field.label, field.key))
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
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.75 }}>
                    <Typography variant="caption" color="text.secondary">
                      Current due {isoToDateInput(lead.next_followup_at)}
                    </Typography>
                    <Button
                      size="small"
                      color="error"
                      disabled={saving}
                      onClick={() => setConfirmClearOpen(true)}
                      sx={{ minHeight: 24, px: 0.75, fontSize: 12 }}
                    >
                      Remove reminder
                    </Button>
                  </Stack>
                ) : (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    No reminder set for this lead.
                  </Typography>
                )}
              </Box>
            ) : null}

            {canUpdate || canDelete ? (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {canUpdate && lead.next_followup_at ? (
                  <>
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
                  </>
                ) : null}
                {canUpdate && !closed ? (
                  <Button
                    disabled={saving}
                    color="error"
                    onClick={() => void patch({ status: 'lost', next_followup_at: null }, `Marked lost · ${lead.full_name}`)}
                  >
                    Mark Lost
                  </Button>
                ) : null}
                {canUpdate && closed ? (
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
                ) : null}
                {canDelete ? (
                  <DeleteIconButton
                    onClick={() => setConfirmDeleteOpen(true)}
                    disabled={saving}
                    tooltip="Delete lead"
                  />
                ) : null}
              </Stack>
            ) : null}

            <Box>
              <Typography fontWeight={700} sx={{ mb: 1 }}>
                Call history
              </Typography>
              {calls.length === 0 && !earlierNote(lead) ? (
                <Typography variant="body2" color="text.secondary">
                  No calls logged yet.
                </Typography>
              ) : (
                <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
                  {calls.map((call) => (
                    <Box component="li" key={call.id} sx={historyRowSx}>
                      <Typography variant="body2" fontWeight={700}>
                        {call.outcome === 'connected' ? 'Connected' : 'No answer'}
                        <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                          {' '}
                          · {call.user_name} · {formatActivityAt(call.created_at)}
                        </Box>
                      </Typography>
                      {call.summary ? (
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                          {call.summary}
                        </Typography>
                      ) : null}
                    </Box>
                  ))}
                  {calls.length === 0
                    ? historyLines(earlierNote(lead)).map((line, index) => (
                        <Box component="li" key={`${line.title}-${index}`} sx={historyRowSx}>
                          <Typography variant="body2" fontWeight={700}>
                            {line.title}
                            <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                              {' '}
                              · {importedHistoryDate(line.title, lead) || 'Imported note'}
                            </Box>
                          </Typography>
                          <Typography variant="body2">{line.message}</Typography>
                        </Box>
                      ))
                    : null}
                </Box>
              )}
            </Box>
          </Stack>
          </>
        ) : null}
      </Drawer>

      <Dialog
        open={Boolean(action)}
        onClose={(_event, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
          if (!saving) setAction(null)
        }}
        disableEscapeKeyDown
        fullWidth
        maxWidth="xs"
      >
        <Box component="form" onSubmit={(event) => void submitAction(event)}>
          <DialogTitle>
            {actionTitle}
            {lead ? ` · ${lead.full_name}` : ''}
          </DialogTitle>
          <DialogContent>
            {action === 'noanswer' ? (
              <TextField
                label="One-line note"
                value={actionNote}
                fullWidth
                multiline
                minRows={2}
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

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={lead ? `Delete ${lead.full_name}?` : 'Delete lead?'}
        description="Remove this lead from the project?"
        confirmLabel="Delete"
        loading={saving}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => void deleteLead()}
      />

      <ConfirmDialog
        open={confirmClearOpen}
        title="Remove this reminder?"
        description="Clear the next follow-up date for this lead?"
        confirmLabel="Remove"
        loading={saving}
        onCancel={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          setConfirmClearOpen(false)
          if (lead) void patch({ next_followup_at: null }, `Reminder removed · ${lead.full_name}`)
        }}
      />
    </>
  )
}
