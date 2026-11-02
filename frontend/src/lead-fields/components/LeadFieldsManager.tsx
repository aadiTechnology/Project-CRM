import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
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

import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
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
    is_active: field.is_active,
  }
}

function parseOptions(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
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
    if (form.label.trim().length < 2) next.label = 'Label must be 2 to 40 characters.'
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
      label: form.label.trim(),
      field_type: form.field_type,
      options: needsOptions ? parseOptions(form.optionsText) : null,
      is_required: form.is_required,
      show_in_list: form.show_in_list,
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

  async function toggleFlag(field: LeadField, key: 'is_required' | 'show_in_list' | 'is_active', value: boolean) {
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
                sx={{
                  bgcolor: 'primary.main',
                  color: '#fff',
                  width: 32,
                  height: 32,
                  borderRadius: '8px',
                  boxShadow: '0 4px 10px rgba(29,78,216,.2)',
                  '&:hover': { bgcolor: 'primary.dark' },
                  '&.Mui-disabled': { bgcolor: '#93c5fd', color: '#fff' },
                }}
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
                sx={{
                  bgcolor: 'primary.main',
                  color: '#fff',
                  width: 32,
                  height: 32,
                  borderRadius: '8px',
                  boxShadow: '0 4px 10px rgba(29,78,216,.2)',
                  '&:hover': { bgcolor: 'primary.dark' },
                  '&.Mui-disabled': { bgcolor: '#93c5fd', color: '#fff' },
                }}
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
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={700} noWrap>
                      {field.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                      {field.key} · {field.field_type_label}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.25}>
                    <IconButton size="small" disabled={saving} onClick={() => openEdit(field)}>
                      <EditOutlinedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                    <IconButton size="small" color="error" disabled={saving} onClick={() => void onDelete(field)}>
                      <DeleteOutlineIcon sx={{ fontSize: 18 }} />
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
          <Table
            size="small"
            sx={{
              width: '100%',
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
                <TableCell sx={{ width: 88 }}>Order</TableCell>
                <TableCell sx={{ width: '32%' }}>Field</TableCell>
                <TableCell sx={{ width: '12%' }}>Type</TableCell>
                <TableCell align="center" sx={{ width: '12%' }}>
                  Required
                </TableCell>
                <TableCell align="center" sx={{ width: '12%' }}>
                  In list
                </TableCell>
                <TableCell align="center" sx={{ width: '12%' }}>
                  Active
                </TableCell>
                <TableCell align="right" sx={{ width: 96 }}>
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
                  <TableCell sx={{ overflow: 'hidden' }}>
                    <Typography fontWeight={700} noWrap>
                      {field.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
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
                            onClick={() => void onDelete(field)}
                            sx={{ p: 0.5 }}
                          >
                            <DeleteOutlineIcon sx={{ fontSize: 18 }} />
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
      )}

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <Box component="form" onSubmit={onSaveField}>
          <DialogTitle>{editing ? 'Edit field' : 'Add field'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <TextField
                label="Field label"
                value={form.label}
                required
                fullWidth
                autoFocus
                disabled={saving}
                error={Boolean(fieldErrors.label)}
                helperText={fieldErrors.label}
                onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              />
              <TextField
                select
                label={typeLocked ? 'Field type (locked, leads already hold data)' : 'Field type'}
                value={form.field_type}
                fullWidth
                disabled={saving || typeLocked}
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
                  multiline
                  minRows={3}
                  disabled={saving}
                  error={Boolean(fieldErrors.optionsText)}
                  helperText={fieldErrors.optionsText || 'Used for Dropdown, Multi-select, and Radio.'}
                  onChange={(event) => setForm((current) => ({ ...current, optionsText: event.target.value }))}
                />
              ) : null}
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.is_required}
                    disabled={saving}
                    onChange={(event) => setForm((current) => ({ ...current, is_required: event.target.checked }))}
                  />
                }
                label="Required — must be filled to save a lead"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.show_in_list}
                    disabled={saving}
                    onChange={(event) => setForm((current) => ({ ...current, show_in_list: event.target.checked }))}
                  />
                }
                label="Lead table — show as a column in the lead table"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.is_active}
                    disabled={saving}
                    onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                  />
                }
                label="Active — shown in forms"
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {editing ? 'Save field' : 'Add field'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Stack>
  )
}
