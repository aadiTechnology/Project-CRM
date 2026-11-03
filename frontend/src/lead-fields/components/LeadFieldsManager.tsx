import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import { toolbarIconSx } from '../../components/common/toolbarStyles'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'
import {
  FIELD_TYPE_OPTIONS,
  LeadField,
  LeadFieldList,
  LeadFieldType,
  OPTION_TYPES,
} from '../types'

type FieldForm = {
  label: string
  field_type: LeadFieldType
  optionsText: string
  is_required: boolean
  show_in_list: boolean
  show_as_column: boolean
  is_active: boolean
}

export type LeadFieldsProjectOption = {
  id: string
  name: string
  code: string
}

export type LeadFieldsManagerProps = {
  projectId: string
  projects?: LeadFieldsProjectOption[]
  showProjectSelector?: boolean
  showTitle?: boolean
  onProjectChange?: (projectId: string) => void
  onChanged?: () => void
}

function blankForm(): FieldForm {
  return {
    label: '',
    field_type: 'text',
    optionsText: '',
    is_required: false,
    show_in_list: true,
    show_as_column: false,
    is_active: true,
  }
}

function formFromField(field: LeadField): FieldForm {
  return {
    label: field.label,
    field_type: field.field_type,
    optionsText: (field.options ?? []).join('\n'),
    is_required: field.is_required,
    show_in_list: field.show_in_list,
    show_as_column: Boolean(field.show_as_column),
    is_active: field.is_active,
  }
}

function parseOptions(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function collapseLabel(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeLabel(value: string) {
  return collapseLabel(value).toLowerCase()
}

export function LeadFieldsManager({
  projectId,
  projects = [],
  showProjectSelector = false,
  showTitle = true,
  onProjectChange,
  onChanged,
}: LeadFieldsManagerProps) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('md'))
  const [data, setData] = useState<LeadFieldList | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<LeadField | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LeadField | null>(null)
  const [form, setForm] = useState<FieldForm>(blankForm())
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const needsOptions = OPTION_TYPES.has(form.field_type)
  const typeLocked = Boolean(editing && editing.leads_with_data > 0)

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 1600)
    return () => window.clearTimeout(timer)
  }, [notice])

  const loadFields = useCallback(async (selected: string) => {
    if (!selected) {
      setData(null)
      return
    }
    setError('')
    try {
      const result = await api.get<LeadFieldList>(`/api/v1/lead-fields?project_id=${selected}`)
      setData(result.data)
    } catch (requestError) {
      setData(null)
      setError(requestError instanceof ApiError ? requestError.message : 'Could not load lead fields.')
    }
  }, [])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      await loadFields(projectId)
      setLoading(false)
    })()
  }, [loadFields, projectId])

  async function notifyChanged() {
    onChanged?.()
  }

  function openAdd() {
    setEditing(null)
    setForm(blankForm())
    setFieldErrors({})
    setDialogOpen(true)
  }

  function openEdit(field: LeadField) {
    setEditing(field)
    setForm(formFromField(field))
    setFieldErrors({})
    setDialogOpen(true)
  }

  function validateForm(): boolean {
    const next: Record<string, string> = {}
    const label = collapseLabel(form.label)
    if (label.length < 2) next.label = 'Label must be 2 to 40 characters.'
    else if (label.length > 40) next.label = 'Label must be 2 to 40 characters.'
    else {
      const key = normalizeLabel(label)
      const duplicateCustom = (data?.items ?? []).some(
        (field) => field.id !== editing?.id && normalizeLabel(field.label) === key,
      )
      const duplicateCommon = (data?.common_fields ?? []).some(
        (name) => normalizeLabel(name) === key,
      )
      if (duplicateCommon) {
        next.label = 'This name is already used by a built-in lead column. Choose a different name.'
      } else if (duplicateCustom) {
        next.label = 'A field with this name already exists. Choose a different name.'
      }
    }
    if (needsOptions && parseOptions(form.optionsText).length === 0) {
      next.optionsText = 'Add at least one option, one per line.'
    }
    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  async function onSaveField(event: FormEvent) {
    event.preventDefault()
    if (!projectId || !validateForm()) return
    setSaving(true)
    setError('')
    setNotice('')
    const body = {
      label: collapseLabel(form.label),
      field_type: form.field_type,
      options: needsOptions ? parseOptions(form.optionsText) : null,
      is_required: form.is_required,
      show_in_list: form.show_in_list,
      show_as_column: form.show_as_column,
      is_active: form.is_active,
    }
    try {
      if (editing) {
        await api.patch(`/api/v1/lead-fields/${editing.id}`, body)
        setNotice('Field updated.')
      } else {
        await api.post('/api/v1/lead-fields', { ...body, project_id: projectId })
        setNotice('Field added.')
      }
      setDialogOpen(false)
      await loadFields(projectId)
      await notifyChanged()
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.details?.length) {
        const next: Record<string, string> = {}
        for (const detail of requestError.details) {
          if (detail.field === 'options') next.optionsText = detail.message
          else next[detail.field] = detail.message
        }
        setFieldErrors(next)
      }
      setError(requestError instanceof ApiError ? requestError.message : 'Could not save field.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleFlag(
    field: LeadField,
    key: 'is_required' | 'show_in_list' | 'show_as_column' | 'is_active',
    value: boolean,
  ) {
    setSaving(true)
    setError('')
    try {
      await api.patch(`/api/v1/lead-fields/${field.id}`, { [key]: value })
      await loadFields(projectId)
      await notifyChanged()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Could not update field.')
    } finally {
      setSaving(false)
    }
  }

  async function moveField(field: LeadField, direction: -1 | 1) {
    if (!data) return
    const items = [...data.items]
    const index = items.findIndex((row) => row.id === field.id)
    const swap = index + direction
    if (index < 0 || swap < 0 || swap >= items.length) return
    ;[items[index], items[swap]] = [items[swap], items[index]]
    setSaving(true)
    setError('')
    try {
      const result = await api.post<LeadFieldList>('/api/v1/lead-fields/reorder', {
        project_id: projectId,
        field_ids: items.map((row) => row.id),
      })
      setData(result.data)
      await notifyChanged()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Could not reorder fields.')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(field: LeadField) {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await api.delete<LeadFieldList>(`/api/v1/lead-fields/${field.id}`)
      setData(result.data)
      setNotice(`Deleted ${field.label}.`)
      await notifyChanged()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Could not delete field.')
    } finally {
      setSaving(false)
      setDeleteTarget(null)
    }
  }

  const selectedName = useMemo(
    () => projects.find((project) => project.id === projectId)?.name ?? data?.project_name ?? 'this project',
    [data?.project_name, projectId, projects],
  )

  if (!projectId) {
    return (
      <Box sx={{ p: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
        <Typography>Select a project to manage its extra fields.</Typography>
      </Box>
    )
  }

  return (
    <Stack spacing={1.25}>
      {showTitle ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="h1" sx={{ flex: 1 }}>
            Lead Fields
          </Typography>
          <Tooltip title="Add field">
            <span>
              <IconButton
                size="small"
                color="primary"
                aria-label="Add field"
                disabled={!projectId || saving}
                onClick={openAdd}
                sx={toolbarIconSx}
              >
                <AddOutlinedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
          <Tooltip title="Add field">
            <span>
              <IconButton
                size="small"
                color="primary"
                aria-label="Add field"
                disabled={!projectId || saving}
                onClick={openAdd}
                sx={toolbarIconSx}
              >
                <AddOutlinedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      )}

      {error ? <ErrorAlert message={error} /> : null}
      {notice ? (
        <Box sx={{ bgcolor: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', borderRadius: '12px', px: 1.75, py: 1.25 }}>
          <Typography variant="body2">{notice}</Typography>
        </Box>
      ) : null}

      {showProjectSelector && projects.length > 0 ? (
        <TextField
          select
          size="small"
          label="Project"
          value={projectId}
          onChange={(event) => onProjectChange?.(event.target.value)}
          sx={{ width: { xs: '100%', sm: 280 } }}
        >
          {projects.map((project) => (
            <MenuItem key={project.id} value={project.id}>
              {project.name} ({project.code})
            </MenuItem>
          ))}
        </TextField>
      ) : null}

      {loading ? (
        <LoadingScreen />
      ) : !data?.items.length ? (
        <Box sx={{ p: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
          <Typography fontWeight={700}>No extra fields yet</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Use + to add the first field for {selectedName}.
          </Typography>
        </Box>
      ) : phone ? (
        <Stack spacing={1.25}>
          {data.items.map((field, index) => (
            <Box
              key={field.id}
              sx={{
                p: 1.75,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '12px',
                bgcolor: 'background.paper',
                opacity: field.is_active ? 1 : 0.65,
              }}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box sx={{ minWidth: 0, flex: 1, pr: 1 }}>
                    <Typography fontWeight={700} sx={{ wordBreak: 'break-word' }}>
                      {field.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ wordBreak: 'break-word' }}>
                      {field.key} · {field.field_type_label}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.25}>
                    <IconButton size="small" disabled={saving} onClick={() => openEdit(field)}>
                      <EditOutlinedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={saving}
                      aria-label={`Delete ${field.label}`}
                      onClick={() => setDeleteTarget(field)}
                    >
                      <DeleteForeverOutlinedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Stack>
                </Stack>
                <Stack direction="row" spacing={0.5}>
                  <IconButton size="small" disabled={saving || index === 0} onClick={() => void moveField(field, -1)}>
                    <ArrowUpwardIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={saving || index === data.items.length - 1}
                    onClick={() => void moveField(field, 1)}
                  >
                    <ArrowDownwardIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Stack>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={field.is_required}
                      disabled={saving}
                      onChange={(event) => void toggleFlag(field, 'is_required', event.target.checked)}
                    />
                  }
                  label="Required"
                />
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={field.show_in_list}
                          disabled={saving}
                          onChange={(event) => void toggleFlag(field, 'show_in_list', event.target.checked)}
                        />
                      }
                      label="In list"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={Boolean(field.show_as_column)}
                          disabled={saving}
                          onChange={(event) => void toggleFlag(field, 'show_as_column', event.target.checked)}
                        />
                      }
                      label="Column"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={field.is_active}
                          disabled={saving}
                          onChange={(event) => void toggleFlag(field, 'is_active', event.target.checked)}
                        />
                      }
                      label="Active"
                    />
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : (
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
          <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid #dbe3ee', bgcolor: '#f8fafc' }}>
            <Typography fontWeight={700} sx={{ fontSize: 16 }}>
              Extra fields ({data.items.length})
            </Typography>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
          <Table
            size="small"
            sx={{
              width: '100%',
              minWidth: 640,
              tableLayout: 'fixed',
              '& th, & td': {
                borderBottomColor: '#edf1f7',
                py: 1.1,
                px: 1.5,
                verticalAlign: 'middle',
              },
              '& th': {
                fontWeight: 700,
                color: 'text.secondary',
                bgcolor: '#f8fafc',
                fontSize: 12,
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 72 }}>Order</TableCell>
                <TableCell sx={{ width: '34%', minWidth: 160 }}>Field</TableCell>
                <TableCell sx={{ width: '12%' }}>Type</TableCell>
                <TableCell align="center" sx={{ width: '10%' }}>
                  Required
                </TableCell>
                <TableCell align="center" sx={{ width: '10%' }}>
                  In list
                </TableCell>
                <TableCell align="center" sx={{ width: '10%' }}>
                  Column
                </TableCell>
                <TableCell align="center" sx={{ width: '10%' }}>
                  Active
                </TableCell>
                <TableCell align="right" sx={{ width: 88 }}>
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.items.map((field, index) => (
                <TableRow
                  key={field.id}
                  hover
                  sx={{ opacity: field.is_active ? 1 : 0.65, '&:last-child td': { borderBottom: 0 } }}
                >
                  <TableCell>
                    <Stack direction="row" spacing={0}>
                      <Tooltip title="Move up">
                        <span>
                          <IconButton
                            size="small"
                            disabled={saving || index === 0}
                            aria-label={`Move ${field.label} up`}
                            onClick={() => void moveField(field, -1)}
                            sx={{ p: 0.5 }}
                          >
                            <ArrowUpwardIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Move down">
                        <span>
                          <IconButton
                            size="small"
                            disabled={saving || index === data.items.length - 1}
                            aria-label={`Move ${field.label} down`}
                            onClick={() => void moveField(field, 1)}
                            sx={{ p: 0.5 }}
                          >
                            <ArrowDownwardIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ overflow: 'visible' }}>
                    <Typography
                      fontWeight={700}
                      title={field.label}
                      sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.35 }}
                    >
                      {field.label}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
                    >
                      {field.key}
                      {field.options?.length ? ` · ${field.options.join(', ')}` : ''}
                      {field.leads_with_data ? ` · ${field.leads_with_data} leads` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" noWrap>
                      {field.field_type_label}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Checkbox
                      size="small"
                      checked={field.is_required}
                      disabled={saving}
                      inputProps={{ 'aria-label': `Required for ${field.label}` }}
                      onChange={(event) => void toggleFlag(field, 'is_required', event.target.checked)}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Checkbox
                      size="small"
                      checked={field.show_in_list}
                      disabled={saving}
                      inputProps={{ 'aria-label': `In list for ${field.label}` }}
                      onChange={(event) => void toggleFlag(field, 'show_in_list', event.target.checked)}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Checkbox
                      size="small"
                      checked={Boolean(field.show_as_column)}
                      disabled={saving}
                      inputProps={{ 'aria-label': `Separate column for ${field.label}` }}
                      onChange={(event) => void toggleFlag(field, 'show_as_column', event.target.checked)}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Checkbox
                      size="small"
                      checked={field.is_active}
                      disabled={saving}
                      inputProps={{ 'aria-label': `Active for ${field.label}` }}
                      onChange={(event) => void toggleFlag(field, 'is_active', event.target.checked)}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.25} sx={{ justifyContent: 'flex-end' }}>
                      <Tooltip title="Edit">
                        <span>
                          <IconButton
                            size="small"
                            disabled={saving}
                            aria-label={`Edit ${field.label}`}
                            onClick={() => openEdit(field)}
                            sx={{ p: 0.5 }}
                          >
                            <EditOutlinedIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={saving}
                            aria-label={`Delete ${field.label}`}
                            onClick={() => setDeleteTarget(field)}
                            sx={{ p: 0.5 }}
                          >
                            <DeleteForeverOutlinedIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </Box>
        </Box>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => !saving && setDialogOpen(false)}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: {
            width: '100%',
            maxWidth: 360,
            borderRadius: '14px',
            overflow: 'visible',
          },
        }}
      >
        <Box component="form" onSubmit={onSaveField}>
          <DialogTitle sx={{ py: 1.25, px: 2, fontSize: 17, fontWeight: 700 }}>
            {editing ? 'Edit field' : 'Add field'}
          </DialogTitle>
          <DialogContent sx={{ px: 2, pt: 0.5, pb: 0.5, overflow: 'visible' }}>
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <TextField
                label="Field name"
                value={form.label}
                required
                fullWidth
                size="small"
                autoFocus
                disabled={saving}
                error={Boolean(fieldErrors.label)}
                helperText={
                  fieldErrors.label || 'Unique name — not used by another field or built-in column'
                }
                FormHelperTextProps={{ sx: { mx: 0, wordBreak: 'break-word' } }}
                inputProps={{ maxLength: 40 }}
                InputLabelProps={{ sx: { maxWidth: 'calc(100% - 24px)' } }}
                onChange={(event) => {
                  setForm((current) => ({ ...current, label: event.target.value }))
                  if (fieldErrors.label) {
                    setFieldErrors((current) => {
                      const next = { ...current }
                      delete next.label
                      return next
                    })
                  }
                }}
              />
              <TextField
                select
                size="small"
                label={typeLocked ? 'Field type (locked)' : 'Field type'}
                value={form.field_type}
                fullWidth
                disabled={saving || typeLocked}
                InputLabelProps={{ sx: { maxWidth: 'calc(100% - 24px)' } }}
                onChange={(event) =>
                  setForm((current) => ({ ...current, field_type: event.target.value as LeadFieldType }))
                }
              >
                {FIELD_TYPE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              {needsOptions ? (
                <TextField
                  label="Options, one per line"
                  value={form.optionsText}
                  fullWidth
                  size="small"
                  multiline
                  minRows={2}
                  disabled={saving}
                  error={Boolean(fieldErrors.optionsText)}
                  helperText={fieldErrors.optionsText || 'Dropdown / Multi-select / Radio'}
                  FormHelperTextProps={{ sx: { mx: 0, wordBreak: 'break-word' } }}
                  onChange={(event) => setForm((current) => ({ ...current, optionsText: event.target.value }))}
                />
              ) : null}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 0.25,
                }}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={form.is_required}
                      disabled={saving}
                      onChange={(event) => setForm((current) => ({ ...current, is_required: event.target.checked }))}
                    />
                  }
                  label="Required"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={form.show_in_list}
                      disabled={saving}
                      onChange={(event) => setForm((current) => ({ ...current, show_in_list: event.target.checked }))}
                    />
                  }
                  label="In list"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={form.show_as_column}
                      disabled={saving}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, show_as_column: event.target.checked }))
                      }
                    />
                  }
                  label="Column"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={form.is_active}
                      disabled={saving}
                      onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                    />
                  }
                  label="Active"
                />
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 2, pb: 1.5, pt: 1 }}>
            <Button onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {editing ? 'Save field' : 'Add field'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `Delete ${deleteTarget.label}?` : 'Delete field?'}
        description="Leads will stop showing this field and any answers saved in it will be removed."
        loading={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void onDelete(deleteTarget)
        }}
      />
    </Stack>
  )
}
