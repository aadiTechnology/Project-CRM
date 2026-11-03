import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined'
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { ColumnChooser } from '../../column-visibility/ColumnChooser'
import type { ColumnDef } from '../../column-visibility/definitions'
import { useColumnVisibility } from '../../column-visibility/useColumnVisibility'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { DeleteIconButton } from '../../components/common/DeleteIconButton'
import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import { toolbarIconSx } from '../../components/common/toolbarStyles'
import { FollowupPlanSettingsDialog } from '../../followup-plan/FollowupPlanSettingsDialog'
import { FollowupPlanStep, loadFollowupPlan } from '../../followup-plan/plan'
import { isDuplicateBuiltinLeadField } from '../../lead-fields/builtinLabels'
import { LeadFieldsManager } from '../../lead-fields/components/LeadFieldsManager'
import type { LeadField, LeadFieldList } from '../../lead-fields/types'
import { OPTION_TYPES } from '../../lead-fields/types'
import { ReminderLeadDrawer } from '../../reminders/components/ReminderLeadDrawer'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'
import { useAuth } from '../../store/auth-context'
import { defaultFollowupLocal, formatDueLabel, localInputToIso } from '../lead-dates'
import {
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  Lead,
  LeadList,
  LeadPriority,
  LeadProjectOption,
  LeadStatus,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
} from '../types'

function ToneChip({
  label,
  bg,
  color,
}: {
  label: string
  bg?: string
  color?: string
}) {
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

type LeadForm = {
  project_id: string
  full_name: string
  mobile: string
  email: string
  city: string
  lead_source: string
  requirement: string
  enquiry_date: string
  reference_name: string
  call_summary: string
  status: LeadStatus
  priority: LeadPriority
  next_followup_at: string
  extra_values: Record<string, string | string[] | boolean>
}

function todayDateInput() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function blankForm(projectId = ''): LeadForm {
  return {
    project_id: projectId,
    full_name: '',
    mobile: '',
    email: '',
    city: '',
    lead_source: '',
    requirement: '',
    enquiry_date: todayDateInput(),
    reference_name: '',
    call_summary: '',
    status: 'new',
    priority: 'medium',
    next_followup_at: defaultFollowupLocal(),
    extra_values: {},
  }
}

function formatExtraDisplay(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  return String(value)
}

export function LeadsPage() {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const openLeadId = searchParams.get('open')
  const manageFieldsFromQuery = searchParams.get('manageFields') === '1'
  const openedFromQuery = useRef<string | null>(null)
  const { user } = useAuth()
  const canCreate = Boolean(user?.permissions.includes('leads.create'))
  const canUpdate = Boolean(user?.permissions.includes('leads.update'))
  const canDelete = Boolean(user?.permissions.includes('leads.delete'))
  const isOwner = Boolean(user?.roles.includes('BUSINESS_OWNER'))
  const isSales = Boolean(user?.roles.includes('SALESPERSON')) && !isOwner

  const [items, setItems] = useState<Lead[]>([])
  const [projects, setProjects] = useState<LeadProjectOption[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [source, setSource] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [page, setPage] = useState(1)
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null)
  const [drawerFallback, setDrawerFallback] = useState<Lead | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [plan, setPlan] = useState<FollowupPlanStep[]>(() => loadFollowupPlan(user?.company_id))
  const [planOpen, setPlanOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importProjectId, setImportProjectId] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{
    created: number
    skipped: number
    errors: { row: number; message: string; name?: string | null; mobile?: string | null }[]
  } | null>(null)
  const [form, setForm] = useState<LeadForm>(blankForm())
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [projectFields, setProjectFields] = useState<LeadField[]>([])
  const [fieldsByProject, setFieldsByProject] = useState<Record<string, LeadField[]>>({})
  const [fieldsDrawerOpen, setFieldsDrawerOpen] = useState(false)
  const [manageProjectId, setManageProjectId] = useState('')
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const columnFieldsUnion = useMemo(() => {
    const map = new Map<string, LeadField>()
    const source = projectFilter
      ? (fieldsByProject[projectFilter] ?? [])
      : Object.values(fieldsByProject).flat()
    for (const field of source) {
      if (
        field.is_active &&
        field.show_as_column &&
        !isDuplicateBuiltinLeadField(field.label, field.key) &&
        !map.has(field.key)
      ) {
        map.set(field.key, field)
      }
    }
    return [...map.values()].sort(
      (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
    )
  }, [fieldsByProject, projectFilter])

  const extraColumnDefs = useMemo<ColumnDef[]>(
    () =>
      columnFieldsUnion.map((field) => ({
        key: `extra:${field.key}`,
        label: field.label,
        hideable: true,
        track: '120px',
      })),
    [columnFieldsUnion],
  )

  const {
    columns: columnDefs,
    visibility: columnVisibility,
    isVisible: isColumnVisible,
    toggle: toggleColumn,
    reset: resetColumns,
    gridTemplateMd: leadsGridMd,
    gridTemplateXs: leadsGridXs,
    loadError: columnLoadError,
    saveError: columnSaveError,
    clearSaveError: clearColumnSaveError,
    clearLoadError: clearColumnLoadError,
  } = useColumnVisibility('leads', extraColumnDefs)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2200)
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

  const activeFields = useMemo(
    () =>
      projectFields.filter(
        (field) => field.is_active && !isDuplicateBuiltinLeadField(field.label, field.key),
      ),
    [projectFields],
  )

  function closeImportDialog() {
    if (importing) return
    setImportOpen(false)
    setImportFile(null)
    setImportResult(null)
    if (importInputRef.current) importInputRef.current.value = ''
  }

  const fetchFields = useCallback(async (selected: string) => {
    if (!selected) return [] as LeadField[]
    try {
      const result = await api.get<LeadFieldList>(`/api/v1/lead-fields?project_id=${selected}`)
      return result.data.items
    } catch {
      return [] as LeadField[]
    }
  }, [])

  const loadProjectFields = useCallback(
    async (selected: string) => {
      const items = await fetchFields(selected)
      setProjectFields(items)
      return items
    },
    [fetchFields],
  )

  const loadProjects = useCallback(async () => {
    try {
      const result = await api.get<{ items: LeadProjectOption[]; can_create: boolean }>('/api/v1/projects')
      setProjects(result.data.items)
      setProjectFilter((current) => current || result.data.items[0]?.id || '')
      return result.data.items
    } catch (requestError) {
      setProjects([])
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Could not load your projects. Refresh and try again.',
      )
      return [] as LeadProjectOption[]
    }
  }, [])

  const load = useCallback(async () => {
    setError('')
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (status) params.set('status', status)
      if (priority) params.set('priority', priority)
      if (source) params.set('source', source)
      if (projectFilter) params.set('project_id', projectFilter)
      params.set('limit', '100')
      const query = params.toString()
      const result = await api.get<LeadList>(`/api/v1/leads${query ? `?${query}` : ''}`)
      setItems(result.data.items)
      setTotal(result.data.total)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Could not load leads.')
    } finally {
      setLoading(false)
    }
  }, [priority, projectFilter, search, source, status])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [search, status, priority, source, projectFilter])

  const perPage = 21
  const pages = Math.max(1, Math.ceil(items.length / perPage))
  const pageSafe = Math.min(page, pages)
  const pageRows = items.slice((pageSafe - 1) * perPage, pageSafe * perPage)
  const showPagination = items.length > perPage

  const loadFieldsForProject = useCallback(
    async (projectId: string) => {
      if (!projectId) return
      const fields = await fetchFields(projectId)
      setFieldsByProject((current) => ({ ...current, [projectId]: fields }))
    },
    [fetchFields],
  )

  useEffect(() => {
    if (projectFilter) {
      void loadFieldsForProject(projectFilter)
      return
    }
    for (const project of projects) {
      void loadFieldsForProject(project.id)
    }
  }, [loadFieldsForProject, projectFilter, projects])

  const refreshFieldsAfterManage = useCallback(async () => {
    if (manageProjectId) {
      await loadFieldsForProject(manageProjectId)
    }
    if (form.project_id) {
      await loadProjectFields(form.project_id)
    }
  }, [form.project_id, loadFieldsForProject, loadProjectFields, manageProjectId])

  function subtitleFieldsForLead(lead: Lead): LeadField[] {
    if (!lead.project_id) return []
    return (fieldsByProject[lead.project_id] ?? []).filter(
      (field) =>
        field.is_active &&
        field.show_in_list &&
        !field.show_as_column &&
        !isDuplicateBuiltinLeadField(field.label, field.key),
    )
      .slice(0, 3)
  }

  function openFieldsDrawer(projectId?: string) {
    const next = projectId || projectFilter || projects[0]?.id || ''
    setManageProjectId(next)
    setFieldsDrawerOpen(true)
  }

  function closeFieldsDrawer() {
    setFieldsDrawerOpen(false)
    if (manageFieldsFromQuery) {
      const next = new URLSearchParams(searchParams)
      next.delete('manageFields')
      setSearchParams(next, { replace: true })
    }
  }

  useEffect(() => {
    if (!manageFieldsFromQuery || fieldsDrawerOpen) return
    if (projects.length === 0) return
    openFieldsDrawer(projectFilter || projects[0]?.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manageFieldsFromQuery, projects, projectFilter])

  async function openCreate() {
    const list = projects.length ? projects : await loadProjects()
    const first = list[0]?.id ?? ''
    setForm(blankForm(first))
    setFieldErrors({})
    await loadProjectFields(first)
    setCreateOpen(true)
  }

  function closeCreateDialog() {
    if (saving) return
    setCreateOpen(false)
  }

  useEffect(() => {
    setPlan(loadFollowupPlan(user?.company_id))
  }, [user?.company_id])

  const drawerLead = useMemo(() => {
    if (!drawerLeadId) return null
    return items.find((lead) => lead.id === drawerLeadId) ?? (drawerFallback?.id === drawerLeadId ? drawerFallback : null)
  }, [drawerFallback, drawerLeadId, items])

  const onDrawerChanged = useCallback(
    async (message: string) => {
      setNotice(message)
      await load()
    },
    [load],
  )

  function openLead(lead: Lead) {
    setDrawerLeadId(lead.id)
    setDrawerFallback(lead)
  }

  function closeLeadDrawer() {
    setDrawerLeadId(null)
    setDrawerFallback(null)
  }

  useEffect(() => {
    if (!openLeadId || loading || openedFromQuery.current === openLeadId) return

    let cancelled = false
    void (async () => {
      const match = items.find((lead) => lead.id === openLeadId)
      try {
        const lead =
          match ??
          (await api.get<Lead>(`/api/v1/leads/${openLeadId}`)).data
        if (cancelled) return
        openedFromQuery.current = openLeadId
        openLead(lead)
        navigate('/app/leads', { replace: true })
      } catch {
        if (!cancelled) {
          openedFromQuery.current = openLeadId
          navigate('/app/leads', { replace: true })
          setError('Could not open that lead.')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [items, loading, navigate, openLeadId])

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!form.project_id) next.project_id = 'Choose which project this lead belongs to.'
    if (form.full_name.trim().length < 2) next.full_name = 'Enter the lead name.'
    const mobileDigits = form.mobile.replace(/\D+/g, '')
    if (!mobileDigits) next.mobile = 'Enter a mobile number.'
    else if (mobileDigits.length !== 10 && mobileDigits.length !== 12) {
      next.mobile = 'Mobile number must be 10 or 12 digits.'
    }
    if (!form.lead_source) next.lead_source = 'Choose a source.'
    if (!form.city.trim()) next.city = 'Enter a city.'
    if (!form.enquiry_date.trim()) next.enquiry_date = 'Choose the enquiry date.'
    for (const field of activeFields) {
      if (!field.is_required) continue
      const value = form.extra_values[field.key]
      const empty =
        value == null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0) ||
        (field.field_type === 'check' && value !== true)
      if (empty) next[`extra_values.${field.key}`] = `${field.label} is required.`
    }
    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  function payloadFromForm() {
    const extras: Record<string, unknown> = {}
    for (const field of activeFields) {
      const value = form.extra_values[field.key]
      if (value === undefined || value === '') continue
      if (Array.isArray(value) && value.length === 0) continue
      extras[field.key] = field.field_type === 'number' && typeof value === 'string' && value.trim()
        ? Number(value)
        : value
    }
    return {
      project_id: form.project_id || null,
      full_name: form.full_name.trim(),
      mobile: form.mobile.replace(/\D+/g, ''),
      email: form.email.trim() || null,
      city: form.city.trim() || null,
      lead_source: form.lead_source || null,
      requirement: form.requirement.trim() || null,
      enquiry_date: form.enquiry_date.trim() || null,
      reference_name: form.reference_name.trim() || null,
      call_summary: form.call_summary.trim() || null,
      status: form.status,
      priority: form.priority,
      next_followup_at: form.next_followup_at.trim() ? localInputToIso(form.next_followup_at) : null,
      extra_values: extras,
    }
  }

  function setExtra(key: string, value: string | string[] | boolean) {
    setForm((current) => ({
      ...current,
      extra_values: { ...current.extra_values, [key]: value },
    }))
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    if (!validate()) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.post<Lead>('/api/v1/leads', payloadFromForm())
      setCreateOpen(false)
      setNotice('Lead created.')
      await load()
      await loadProjects()
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.details?.length) {
        const next: Record<string, string> = {}
        for (const detail of requestError.details) next[detail.field] = detail.message
        setFieldErrors(next)
      }
      setError(requestError instanceof ApiError ? requestError.message : 'Could not create lead.')
    } finally {
      setSaving(false)
    }
  }

  function formFields(disabled: boolean) {
    const selected = projects.find((project) => project.id === form.project_id)
    return (
      <Stack spacing={2} sx={{ pt: 0.5 }}>
        <TextField
          select
          label="Project"
          value={form.project_id}
          required
          fullWidth
          disabled={disabled || projects.length === 0}
          error={Boolean(fieldErrors.project_id)}
          helperText={
            fieldErrors.project_id ||
            (projects.length === 0
              ? 'No project assigned yet. Ask your business owner to assign you on Team.'
              : selected
                ? `Lead number will use ${selected.code}-…`
                : 'Which project did this enquiry come for?')
          }
          onChange={(event) => {
            const nextProject = event.target.value
            setForm((current) => ({ ...current, project_id: nextProject, extra_values: {} }))
            void loadProjectFields(nextProject)
          }}
        >
          {projects.map((project) => (
            <MenuItem key={project.id} value={project.id}>
              {project.name} ({project.code})
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="Lead name"
          value={form.full_name}
          required
          fullWidth
          autoFocus
          disabled={disabled}
          error={Boolean(fieldErrors.full_name)}
          helperText={fieldErrors.full_name}
          onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Mobile"
            value={form.mobile}
            required
            fullWidth
            disabled={disabled}
            error={Boolean(fieldErrors.mobile)}
            helperText={fieldErrors.mobile || '10 or 12 digits only'}
            inputProps={{ inputMode: 'numeric', maxLength: 12, pattern: '[0-9]*' }}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D+/g, '').slice(0, 12)
              setForm((current) => ({ ...current, mobile: digits }))
              if (fieldErrors.mobile) {
                setFieldErrors((current) => {
                  const next = { ...current }
                  delete next.mobile
                  return next
                })
              }
            }}
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            fullWidth
            disabled={disabled}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Source"
            value={form.lead_source}
            required
            fullWidth
            disabled={disabled}
            error={Boolean(fieldErrors.lead_source)}
            helperText={fieldErrors.lead_source || 'Where did this lead come from?'}
            onChange={(event) => setForm((current) => ({ ...current, lead_source: event.target.value }))}
          >
            {LEAD_SOURCES.map((item) => (
              <MenuItem key={item} value={item}>
                {item}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="City"
            value={form.city}
            required
            fullWidth
            disabled={disabled}
            error={Boolean(fieldErrors.city)}
            helperText={fieldErrors.city}
            onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Enquiry Date"
            type="date"
            value={form.enquiry_date}
            required
            fullWidth
            disabled={disabled}
            InputLabelProps={{ shrink: true }}
            error={Boolean(fieldErrors.enquiry_date)}
            helperText={fieldErrors.enquiry_date}
            onChange={(event) => setForm((current) => ({ ...current, enquiry_date: event.target.value }))}
          />
          <TextField
            label="Reference"
            value={form.reference_name}
            fullWidth
            disabled={disabled}
            placeholder="Who referred them?"
            onChange={(event) => setForm((current) => ({ ...current, reference_name: event.target.value }))}
          />
        </Stack>

        <TextField
          label="Requirement"
          value={form.requirement}
          fullWidth
          multiline
          minRows={2}
          disabled={disabled}
          placeholder="What are they looking for?"
          onChange={(event) => setForm((current) => ({ ...current, requirement: event.target.value }))}
        />

        <TextField
          label="Call Summary"
          value={form.call_summary}
          fullWidth
          multiline
          minRows={2}
          disabled={disabled}
          placeholder="Notes from the call"
          onChange={(event) => setForm((current) => ({ ...current, call_summary: event.target.value }))}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Status"
            value={form.status}
            fullWidth
            disabled={disabled}
            onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as LeadStatus }))}
          >
            {LEAD_STATUSES.map((item) => (
              <MenuItem key={item} value={item}>
                {STATUS_LABEL[item]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Priority"
            value={form.priority}
            fullWidth
            disabled={disabled}
            onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as LeadPriority }))}
          >
            {LEAD_PRIORITIES.map((item) => (
              <MenuItem key={item} value={item}>
                {PRIORITY_LABEL[item]}
              </MenuItem>
            ))}
          </TextField>
        </Stack>

        <TextField
          label="Next follow-up"
          type="datetime-local"
          value={form.next_followup_at}
          fullWidth
          disabled={disabled}
          InputLabelProps={{ shrink: true }}
          helperText="Optional — when will you call them next?"
          onChange={(event) => setForm((current) => ({ ...current, next_followup_at: event.target.value }))}
        />

        {activeFields.length ? (
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Project fields{selected ? ` · ${selected.name}` : ''}
            </Typography>
            {activeFields.map((field) => {
              const errorKey = `extra_values.${field.key}`
              const value = form.extra_values[field.key]
              if (field.field_type === 'check') {
                return (
                  <FormControlLabel
                    key={field.id}
                    control={
                      <Checkbox
                        checked={value === true}
                        disabled={disabled}
                        onChange={(event) => setExtra(field.key, event.target.checked)}
                      />
                    }
                    label={
                      field.is_required ? (
                        <>
                          {field.label}{' '}
                          <Box component="span" sx={{ color: 'error.main' }}>
                            *
                          </Box>
                        </>
                      ) : (
                        field.label
                      )
                    }
                  />
                )
              }
              if (field.field_type === 'multi') {
                const selectedValues = Array.isArray(value) ? value : []
                return (
                  <TextField
                    key={field.id}
                    select
                    SelectProps={{ multiple: true }}
                    label={field.label}
                    value={selectedValues}
                    required={field.is_required}
                    fullWidth
                    disabled={disabled}
                    error={Boolean(fieldErrors[errorKey])}
                    helperText={fieldErrors[errorKey]}
                    onChange={(event) => {
                      const next = event.target.value
                      setExtra(field.key, typeof next === 'string' ? next.split(',') : next)
                    }}
                  >
                    {(field.options ?? []).map((option) => (
                      <MenuItem key={option} value={option}>
                        {option}
                      </MenuItem>
                    ))}
                  </TextField>
                )
              }
              if (OPTION_TYPES.has(field.field_type) || field.field_type === 'radio') {
                return (
                  <TextField
                    key={field.id}
                    select
                    label={field.label}
                    value={typeof value === 'string' ? value : ''}
                    required={field.is_required}
                    fullWidth
                    disabled={disabled}
                    error={Boolean(fieldErrors[errorKey])}
                    helperText={fieldErrors[errorKey]}
                    onChange={(event) => setExtra(field.key, event.target.value)}
                  >
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
                  value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
                  required={field.is_required}
                  fullWidth
                  disabled={disabled}
                  multiline={field.field_type === 'area'}
                  minRows={field.field_type === 'area' ? 2 : undefined}
                  type={
                    field.field_type === 'number'
                      ? 'number'
                      : field.field_type === 'email'
                        ? 'email'
                        : field.field_type === 'date'
                          ? 'date'
                          : field.field_type === 'url'
                            ? 'url'
                            : 'text'
                  }
                  InputLabelProps={field.field_type === 'date' ? { shrink: true } : undefined}
                  error={Boolean(fieldErrors[errorKey])}
                  helperText={fieldErrors[errorKey]}
                  onChange={(event) => setExtra(field.key, event.target.value)}
                />
              )
            })}
          </Stack>
        ) : null}
      </Stack>
    )
  }

  if (loading && items.length === 0 && projects.length === 0) return <LoadingScreen />

  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="h1" sx={{ flex: 1, minWidth: 0 }}>
          Leads
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          {canCreate ? (
            <Tooltip title="Create lead">
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  aria-label="Create lead"
                  disabled={isSales && projects.length === 0}
                  onClick={() => void openCreate()}
                  sx={toolbarIconSx}
                >
                  <AddOutlinedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
          {canCreate ? (
            <Tooltip title="Import leads">
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  aria-label="Import leads"
                  disabled={isSales && projects.length === 0}
                  onClick={() => {
                    setError('')
                    setNotice('')
                    setImportResult(null)
                    setImportFile(null)
                    if (importInputRef.current) importInputRef.current.value = ''
                    setImportProjectId(projectFilter || projects[0]?.id || '')
                    setImportOpen(true)
                  }}
                  sx={toolbarIconSx}
                >
                  <FileUploadOutlinedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
          <Tooltip
            title={
              projects.length === 0
                ? 'Assign a project first to manage fields'
                : projectFilter
                  ? 'Manage fields for the filtered project'
                  : 'Manage extra fields for a project'
            }
          >
            <span>
              <IconButton
                size="small"
                color="primary"
                aria-label="Manage fields"
                disabled={projects.length === 0}
                onClick={() => openFieldsDrawer()}
                sx={toolbarIconSx}
              >
                <TuneOutlinedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
          <ColumnChooser
            columns={columnDefs}
            visibility={columnVisibility}
            onToggle={toggleColumn}
            onReset={resetColumns}
          />
        </Stack>
      </Stack>

      {isSales && projects.length === 0 ? (
        <Alert severity="warning">
          You are not assigned to any project yet. Ask your business owner to tick you on Team, then you can create leads here.
        </Alert>
      ) : null}

      {error ? <ErrorAlert message={error} /> : null}
      {notice ? (
        <Box
          sx={{
            bgcolor: '#ecfdf5',
            color: '#047857',
            border: '1px solid #a7f3d0',
            borderRadius: '12px',
            px: 1.75,
            py: 1.25,
          }}
        >
          <Typography variant="body2">{notice}</Typography>
        </Box>
      ) : null}

      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1.2fr 1fr 1fr 1fr 1fr' },
        }}
      >
        <TextField
          select
          size="small"
          label="Project"
          required
          value={projectFilter}
          onChange={(event) => setProjectFilter(event.target.value)}
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
          placeholder="Search name, mobile, email…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={!projectFilter}
        />
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          disabled={!projectFilter}
        >
          <MenuItem value="">All statuses</MenuItem>
          {LEAD_STATUSES.map((item) => (
            <MenuItem key={item} value={item}>
              {STATUS_LABEL[item]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          disabled={!projectFilter}
        >
          <MenuItem value="">All</MenuItem>
          {LEAD_PRIORITIES.map((item) => (
            <MenuItem key={item} value={item}>
              {PRIORITY_LABEL[item]}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          disabled={!projectFilter}
        >
          <MenuItem value="">All sources</MenuItem>
          {LEAD_SOURCES.map((item) => (
            <MenuItem key={item} value={item}>
              {item}
            </MenuItem>
          ))}
        </TextField>
      </Box>

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
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography fontWeight={700}>
            {total} lead{total === 1 ? '' : 's'}
          </Typography>
        </Box>
        {items.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 3 }}>
            {canCreate && projects.length
              ? `No leads yet on your projects. Create the first one for ${projects[0]?.name ?? 'a project'}.`
              : canCreate
                ? 'No leads yet. Get assigned to a project, then create the first one.'
                : 'No leads match these filters.'}
          </Typography>
        ) : (
          <Box sx={{ overflowX: { xs: 'visible', md: 'auto' } }}>
            <Box sx={{ minWidth: { md: columnFieldsUnion.length > 0 ? 900 : 0 } }}>
              <Box
                sx={{
                  display: { xs: 'none', md: 'grid' },
                  gridTemplateColumns: leadsGridMd,
                  columnGap: 1.25,
                  alignItems: 'center',
                  px: 2,
                  py: 1,
                  bgcolor: '#f8fafc',
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
                {isColumnVisible('status') ? (
                  <Typography variant="caption" fontWeight={700} color="text.secondary">
                    Status
                  </Typography>
                ) : null}
                {isColumnVisible('priority') ? (
                  <Typography variant="caption" fontWeight={700} color="text.secondary">
                    Priority
                  </Typography>
                ) : null}
                {isColumnVisible('follow_up') ? (
                  <Typography variant="caption" fontWeight={700} color="text.secondary">
                    Follow-up
                  </Typography>
                ) : null}
                {isColumnVisible('source') ? (
                  <Typography variant="caption" fontWeight={700} color="text.secondary">
                    Source
                  </Typography>
                ) : null}
                {columnFieldsUnion.map((field) =>
                  isColumnVisible(`extra:${field.key}`) ? (
                    <Typography
                      key={field.id}
                      variant="caption"
                      fontWeight={700}
                      color="text.secondary"
                      noWrap
                    >
                      {field.label}
                    </Typography>
                  ) : null,
                )}
                <Typography variant="caption" fontWeight={700} color="text.secondary" textAlign="right">
                  Actions
                </Typography>
              </Box>
              {pageRows.map((lead) => {
                const clickable = canUpdate || isOwner
                const statusTone = STATUS_TONE[lead.status] ?? { bg: '#f1f5f9', color: '#475569' }
                const leadSubtitleFields = subtitleFieldsForLead(lead)
                const leadProjectFields = lead.project_id ? (fieldsByProject[lead.project_id] ?? []) : []
                const leadColumnKeys = new Set(
                  leadProjectFields.filter((field) => field.is_active && field.show_as_column).map((field) => field.key),
                )
                return (
                  <Box
                    key={lead.id}
                    onClick={() => {
                      if (clickable) openLead(lead)
                    }}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: leadsGridXs,
                        md: leadsGridMd,
                      },
                      columnGap: 1.25,
                      rowGap: 0.75,
                      alignItems: 'center',
                      px: 2,
                      py: 1.15,
                      cursor: clickable ? 'pointer' : 'default',
                      '&:hover': { bgcolor: '#f8fbff' },
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap>
                        {lead.full_name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {lead.lead_number}
                        {lead.city ? ` · ${lead.city}` : ''}
                      </Typography>
                      {leadSubtitleFields.length > 0 ? (
                        <Typography variant="caption" color="text.secondary" noWrap display="block">
                          {leadSubtitleFields
                            .map((field) => `${field.label}: ${formatExtraDisplay(lead.extra_values?.[field.key])}`)
                            .join(' · ')}
                        </Typography>
                      ) : null}
                    </Box>
                    {isColumnVisible('project') ? (
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{ gridColumn: { xs: '1', md: 'auto' }, color: 'text.secondary' }}
                      >
                        {lead.project_name || '—'}
                      </Typography>
                    ) : null}
                    {isColumnVisible('phone') ? (
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{ gridColumn: { xs: '1', md: 'auto' }, color: 'primary.main', fontWeight: 600 }}
                      >
                        {lead.mobile || '—'}
                      </Typography>
                    ) : null}
                    {isColumnVisible('status') ? (
                      <Box sx={{ gridColumn: { xs: '1', md: 'auto' } }}>
                        <ToneChip label={STATUS_LABEL[lead.status] ?? lead.status} {...statusTone} />
                      </Box>
                    ) : null}
                    {isColumnVisible('priority') ? (
                      <Box sx={{ gridColumn: { xs: '1', md: 'auto' } }}>
                        <ToneChip label={PRIORITY_LABEL[lead.priority]} {...PRIORITY_TONE[lead.priority]} />
                      </Box>
                    ) : null}
                    {isColumnVisible('follow_up') ? (
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{
                          alignItems: 'center',
                          gridColumn: { xs: '1', md: 'auto' },
                          fontSize: 13,
                          color: 'text.secondary',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <TodayOutlinedIcon sx={{ fontSize: 15 }} />
                        {formatDueLabel(lead.next_followup_at)}
                      </Stack>
                    ) : null}
                    {isColumnVisible('source') ? (
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{ gridColumn: { xs: '1', md: 'auto' }, color: 'text.secondary' }}
                      >
                        {lead.lead_source || '—'}
                      </Typography>
                    ) : null}
                    {columnFieldsUnion.map((field) =>
                      isColumnVisible(`extra:${field.key}`) ? (
                        <Typography
                          key={field.id}
                          variant="body2"
                          noWrap
                          sx={{ gridColumn: { xs: '1', md: 'auto' }, color: 'text.secondary' }}
                        >
                          {leadColumnKeys.has(field.key)
                            ? formatExtraDisplay(lead.extra_values?.[field.key])
                            : '—'}
                        </Typography>
                      ) : null,
                    )}
                    <Box
                      sx={{
                        justifySelf: { xs: 'start', md: 'end' },
                        gridColumn: { xs: '1', md: 'auto' },
                      }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {canDelete ? (
                        <DeleteIconButton
                          onClick={() => setDeleteTarget(lead)}
                          disabled={deleting}
                          tooltip={`Delete ${lead.full_name}`}
                        />
                      ) : null}
                    </Box>
                  </Box>
                )
              })}
            </Box>
          </Box>
        )}

        <Stack direction="row" spacing={1} sx={{ px: 2, py: 1.5, alignItems: 'center', color: 'text.secondary' }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            Showing {pageRows.length} of {items.length} leads
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

      <Dialog
        open={importOpen}
        onClose={(_event, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
          closeImportDialog()
        }}
        disableEscapeKeyDown
        fullScreen={phone}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1, py: 1.5 }}>
          <Box component="span" sx={{ flex: 1 }}>
            Import leads
          </Box>
          <IconButton
            aria-label="Close"
            color="error"
            onClick={closeImportDialog}
            edge="end"
            size="small"
            disabled={importing}
          >
            <CloseOutlinedIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.5, pb: 1.5 }}>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Upload .xlsx — headers match this project&apos;s fields.
            </Typography>
            <TextField
              select
              label="Project"
              value={importProjectId}
              onChange={(event) => setImportProjectId(event.target.value)}
              required
              fullWidth
              disabled={importing}
            >
              {projects.map((project) => (
                <MenuItem key={project.id} value={project.id}>
                  {project.name}
                </MenuItem>
              ))}
            </TextField>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null
                setImportFile(next)
                setImportResult(null)
              }}
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                onClick={() => importInputRef.current?.click()}
                disabled={importing}
              >
                Choose Excel file
              </Button>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 260 }}>
                {importFile ? importFile.name : 'No file selected'}
              </Typography>
            </Stack>
            {importResult ? (
              <Stack spacing={1}>
                <Alert severity={importResult.created > 0 ? 'success' : 'warning'}>
                  Imported {importResult.created} lead(s)
                  {importResult.skipped ? `; skipped ${importResult.skipped}` : ''}.
                  {importResult.errors[0]
                    ? ` First error — row ${importResult.errors[0].row}${
                        importResult.errors[0].name ? ` (${importResult.errors[0].name})` : ''
                      }: ${importResult.errors[0].message}`
                    : ''}
                </Alert>
                {importResult.errors.length > 0 ? (
                  <Box
                    sx={{
                      maxHeight: 180,
                      overflow: 'auto',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      px: 1.5,
                      py: 1,
                    }}
                  >
                    {importResult.errors.map((item) => (
                      <Typography key={`${item.row}-${item.message}`} variant="body2" color="text.secondary">
                        Row {item.row}
                        {item.name ? ` (${item.name})` : ''}: {item.message}
                      </Typography>
                    ))}
                  </Box>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 1.5 }}>
          <Button color="error" onClick={closeImportDialog} disabled={importing}>
            Close
          </Button>
          <Button
            variant="contained"
            disabled={importing || !importProjectId || !importFile}
            onClick={() => {
              void (async () => {
                if (!importFile || !importProjectId) return
                setImporting(true)
                setError('')
                setNotice('')
                try {
                  const body = new FormData()
                  body.append('project_id', importProjectId)
                  body.append('file', importFile)
                  const result = await api.postForm<{
                    created: number
                    skipped: number
                    errors: { row: number; message: string; name?: string | null; mobile?: string | null }[]
                  }>('/api/v1/leads/import', body)
                  setImportResult(result.data)
                  const message =
                    result.message ||
                    `Imported ${result.data.created} lead(s)${
                      result.data.skipped ? `; skipped ${result.data.skipped}` : ''
                    }.`
                  // Full success: close dialog + short page toast. Partial: keep dialog open with row errors.
                  if (result.data.errors.length === 0) {
                    setImportOpen(false)
                    setImportFile(null)
                    setImportResult(null)
                    if (importInputRef.current) importInputRef.current.value = ''
                    setProjectFilter(importProjectId)
                    setNotice(message)
                  } else if (result.data.created > 0) {
                    setProjectFilter(importProjectId)
                  }
                  await load()
                } catch (requestError) {
                  setError(
                    requestError instanceof ApiError
                      ? requestError.message
                      : 'Could not import leads. Check the file and try again.',
                  )
                } finally {
                  setImporting(false)
                }
              })()
            }}
          >
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </DialogActions>
      </Dialog>

      <Drawer
        anchor="right"
        open={createOpen}
        onClose={(_event, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
          closeCreateDialog()
        }}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 480, md: 520 },
            boxSizing: 'border-box',
          },
        }}
      >
        <Box
          component="form"
          onSubmit={(event) => void onCreate(event)}
          sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
              px: 2,
              py: 1.5,
              borderBottom: '1px solid',
              borderColor: 'divider',
              position: 'sticky',
              top: 0,
              bgcolor: 'background.paper',
              zIndex: 1,
              flexShrink: 0,
            }}
          >
            <Typography sx={{ flex: 1, minWidth: 0 }} noWrap fontWeight={700} fontSize={18}>
              {form.full_name.trim() || 'Create lead'}
            </Typography>
            <IconButton
              type="button"
              aria-label="Close"
              color="error"
              onClick={(event) => {
                event.preventDefault()
                closeCreateDialog()
              }}
              size="small"
              disabled={saving}
            >
              <CloseOutlinedIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Box sx={{ flex: '1 1 auto', overflowY: 'auto', px: 2, py: 2, minHeight: 0 }}>
            {formFields(saving)}
          </Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              justifyContent: 'flex-end',
              px: 2,
              py: 1.5,
              borderTop: '1px solid',
              borderColor: 'divider',
              position: 'sticky',
              bottom: 0,
              bgcolor: 'background.paper',
              zIndex: 1,
              flexShrink: 0,
            }}
          >
            <Button
              type="button"
              onClick={(event) => {
                event.preventDefault()
                closeCreateDialog()
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving || projects.length === 0}>
              Create
            </Button>
          </Stack>
        </Box>
      </Drawer>

      <ReminderLeadDrawer
        lead={drawerLead}
        canUpdate={canUpdate}
        canDelete={canDelete}
        plan={plan}
        onClose={closeLeadDrawer}
        onChanged={onDrawerChanged}
        onEditPlan={() => setPlanOpen(true)}
      />

      <FollowupPlanSettingsDialog
        open={planOpen}
        companyId={user?.company_id}
        onClose={() => setPlanOpen(false)}
        onSaved={setPlan}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.full_name}?`}
        description="This will permanently delete the lead and all its data. This action cannot be undone."
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
            if (drawerLeadId === deletedId) closeLeadDrawer()
            setDeleteTarget(null)
            setNotice(`Lead deleted · ${deletedName}`)
            await load()
            await loadProjects()
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not delete lead.')
          } finally {
            setDeleting(false)
          }
        }}
      />

      <Drawer
        anchor="right"
        open={fieldsDrawerOpen}
        onClose={(_event, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return
          closeFieldsDrawer()
        }}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 560, md: 720 },
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: 'center',
            px: 2,
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            position: 'sticky',
            top: 0,
            bgcolor: 'background.paper',
            zIndex: 1,
            flexShrink: 0,
          }}
        >
          <Typography variant="h2" sx={{ flex: 1, fontSize: 20, fontWeight: 700 }}>
            Manage fields
          </Typography>
          <IconButton aria-label="Close manage fields" color="error" onClick={closeFieldsDrawer} size="small">
            <CloseOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.5, minHeight: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Active fields show on Create/Edit and Import. In list shows under the lead name (first 3). Separate column
            adds a real table column you can also toggle in the column chooser.
          </Typography>
          <LeadFieldsManager
            projectId={manageProjectId}
            projects={projects}
            showProjectSelector
            showTitle={false}
            onProjectChange={setManageProjectId}
            onChanged={() => void refreshFieldsAfterManage()}
          />
        </Box>
      </Drawer>
    </Stack>
  )
}
