import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { useNavigate } from 'react-router-dom'

import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { DeleteIconButton } from '../../components/common/DeleteIconButton'
import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'
import { useAuth } from '../../store/auth-context'

interface CompanyOption {
  id: string
  name: string
  status: string
}

interface ProjectItem {
  id: string
  company_id: string
  company_name: string
  name: string
  code: string
  template: string
  description: string
  status: string
  lead_count: number
  next_lead_number: string
}

interface ProjectList {
  can_create: boolean
  companies: CompanyOption[]
  items: ProjectItem[]
}

function cleanCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12)
}

function codeIsValid(code: string) {
  return /^[A-Z][A-Z0-9-]{1,11}$/.test(code) && !code.endsWith('-') && !code.includes('--')
}

export function ProjectsPage() {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const navigate = useNavigate()
  const { user } = useAuth()
  const canOpenLeads = Boolean(user?.roles.some((role) => role === 'BUSINESS_OWNER' || role === 'SALESPERSON'))
  const [data, setData] = useState<ProjectList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectItem | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('active')
  const [companyId, setCompanyId] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [deleteTarget, setDeleteTarget] = useState<ProjectItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const result = await api.get<ProjectList>('/api/v1/projects')
      setData(result.data)
      setCompanyId((current) => current || result.data.companies[0]?.id || '')
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selectedCompany = data?.companies.find((company) => company.id === companyId)
  const duplicate = useMemo(
    () =>
      !editing &&
      Boolean(data?.items.some((project) => project.company_id === companyId && project.code === code)),
    [code, companyId, data?.items, editing],
  )
  const preview = codeIsValid(code) ? `${code}-0001` : 'Enter a short code'

  function resetForm() {
    setEditing(null)
    setName('')
    setCode('')
    setDescription('')
    setStatus('active')
    setFieldErrors({})
  }

  function openCreate() {
    resetForm()
    setOpen(true)
  }

  function openEdit(project: ProjectItem) {
    setEditing(project)
    setName(project.name)
    setCode(project.code)
    setDescription(project.description)
    setStatus(project.status === 'inactive' ? 'inactive' : 'active')
    setCompanyId(project.company_id)
    setFieldErrors({})
    setOpen(true)
  }

  function closeForm() {
    if (saving) return
    setOpen(false)
    setFieldErrors({})
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (name.trim().length < 2) next.name = 'Project name must be at least 2 characters.'
    if (editing) {
      if (description.trim().length > 500) next.description = 'Description must be 500 characters or fewer.'
    } else {
      if (!codeIsValid(code)) next.code = 'Use 2 to 12 letters, numbers, or hyphens, starting with a letter.'
      else if (duplicate) next.code = 'This business already has a project with that short code.'
      if (!companyId) next.company_id = 'Choose a business.'
    }
    setFieldErrors(next)
    if (Object.keys(next).length > 0) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = editing
        ? await api.patch<ProjectList>(`/api/v1/projects/${editing.id}`, {
            name: name.trim(),
            description: description.trim(),
            status,
          })
        : await api.post<ProjectList>('/api/v1/projects', {
            name: name.trim(),
            code,
            company_id: companyId,
            template: 'GENERIC',
          })
      setData(result.data)
      resetForm()
      setOpen(false)
      setNotice(result.message)
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.details.length > 0) {
        const mapped: Record<string, string> = {}
        for (const detail of requestError.details) mapped[detail.field] = detail.message
        setFieldErrors(mapped)
      }
      setError(requestError instanceof ApiError ? requestError.message : 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setError('')
    setNotice('')
    try {
      const result = await api.delete<ProjectList>(`/api/v1/projects/${deleteTarget.id}`)
      setData(result.data)
      setNotice(result.message)
      setDeleteTarget(null)
    } catch (requestError) {
      setDeleteTarget(null)
      setError(requestError instanceof ApiError ? requestError.message : 'Could not delete this project.')
    } finally {
      setDeleting(false)
    }
  }

  if (loading && !data) return <LoadingScreen />

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' }, justifyContent: 'space-between' }}
      >
        <Typography variant="h1" sx={{ minWidth: 0 }}>
          Projects
        </Typography>
        {data?.can_create ? (
          <Button variant="contained" onClick={openCreate} sx={{ flexShrink: 0 }}>
            Create project
          </Button>
        ) : null}
      </Stack>
      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {error ? <ErrorAlert message={error} /> : null}

      {data && data.items.length === 0 ? (
        <Typography color="text.secondary">
          {data.can_create
            ? 'No project yet. The first one you create will appear here.'
            : 'No project assigned to you yet. Ask your business owner to tick you on Team.'}
        </Typography>
      ) : null}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
        }}
      >
        {data?.items.map((project) => (
          <Box
            key={project.id}
            sx={{
              p: { xs: 2, sm: 2.5 },
              borderRadius: '18px',
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              minWidth: 0,
              transition: 'transform .18s, box-shadow .18s',
              '&:hover': { transform: 'translateY(-3px)', boxShadow: '0 14px 30px rgba(15,23,42,.12)' },
              '@media (prefers-reduced-motion: reduce)': {
                transition: 'none',
                '&:hover': { transform: 'none' },
              },
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
              <Typography sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{project.name}</Typography>
              <Chip size="small" label={project.code} sx={{ bgcolor: '#f1f5f9', color: '#334155' }} />
              <Chip
                size="small"
                label={project.status === 'active' ? 'Active' : 'Inactive'}
                sx={{
                  bgcolor: project.status === 'active' ? '#d1fae5' : '#f1f5f9',
                  color: project.status === 'active' ? '#047857' : '#64748b',
                }}
              />
            </Stack>
            {data.can_create ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                {project.company_name}
              </Typography>
            ) : null}
            <Typography color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {project.description}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1.5 }}>
              {project.lead_count} {project.lead_count === 1 ? 'lead' : 'leads'} · Next {project.next_lead_number}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'center', justifyContent: 'flex-end' }}>
              {canOpenLeads ? (
                <Button size="small" variant="outlined" onClick={() => navigate(`/app/leads?project=${project.id}`)}>
                  Open leads
                </Button>
              ) : null}
              {data.can_create ? (
                <Tooltip title="Edit project">
                  <IconButton
                    size="small"
                    aria-label={`Edit ${project.name}`}
                    onClick={() => openEdit(project)}
                    sx={{ border: '1px solid', borderColor: 'divider' }}
                  >
                    <EditOutlinedIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              ) : null}
              {data.can_create ? (
                <DeleteIconButton
                  onClick={() => {
                    if (project.lead_count > 0) {
                      setNotice('')
                      setError('This project still has leads. Mark it inactive instead of deleting it.')
                      return
                    }
                    setError('')
                    setDeleteTarget(project)
                  }}
                  disabled={deleting}
                  tooltip={
                    project.lead_count > 0
                      ? 'This project has leads. Mark it inactive instead.'
                      : `Delete ${project.name}`
                  }
                />
              ) : null}
            </Stack>
          </Box>
        ))}
      </Box>

      <Dialog
        open={open}
        onClose={closeForm}
        fullScreen={phone}
        fullWidth
        maxWidth="sm"
        aria-labelledby="project-form-title"
      >
        <Box component="form" onSubmit={(event) => void onSubmit(event)} sx={{ display: 'flex', flexDirection: 'column', minHeight: phone ? '100%' : undefined }}>
          <DialogTitle id="project-form-title">{editing ? 'Edit project' : 'Create project'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <Typography color="text.secondary">
                {editing
                  ? 'Rename the project, update the description, or mark it inactive. The short code stays the same because lead numbers already use it.'
                  : 'Pick the business first. Creating the project assigns it to that business owner automatically.'}
              </Typography>
              <TextField
                id="project-name"
                label="Project name"
                value={name}
                required
                fullWidth
                autoFocus
                placeholder="Preschool"
                error={Boolean(fieldErrors.name)}
                helperText={fieldErrors.name}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
              <TextField
                id="project-code"
                label="Short code"
                value={code}
                required
                fullWidth
                placeholder="PRESCHOOL"
                error={Boolean(fieldErrors.code)}
                helperText={fieldErrors.code || 'Used in the lead number. Letters, numbers, and hyphens.'}
                disabled={saving || Boolean(editing)}
                slotProps={{ htmlInput: { maxLength: 12, style: { textTransform: 'uppercase' } } }}
                onChange={(event) => setCode(cleanCode(event.target.value))}
              />
              {editing ? (
                <>
                  <TextField
                    id="project-description"
                    label="Description"
                    value={description}
                    fullWidth
                    multiline
                    minRows={2}
                    error={Boolean(fieldErrors.description)}
                    helperText={fieldErrors.description || 'Shown on the project card.'}
                    disabled={saving}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                  <TextField
                    id="project-status"
                    select
                    label="Status"
                    value={status}
                    required
                    fullWidth
                    disabled={saving}
                    helperText="Inactive projects stay off Leads, Pipeline, and Team until you turn them back on."
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="inactive">Inactive</MenuItem>
                  </TextField>
                </>
              ) : null}
              <TextField
                id="project-business"
                select
                label="Assign to business"
                value={companyId}
                required
                fullWidth
                error={Boolean(fieldErrors.company_id)}
                helperText={fieldErrors.company_id || 'The Business Owner of this organisation will see the project.'}
                disabled={saving || Boolean(editing) || !data || data.companies.length === 0}
                onChange={(event) => setCompanyId(event.target.value)}
              >
                {(data?.companies ?? []).map((company) => (
                  <MenuItem key={company.id} value={company.id}>
                    {company.name}
                  </MenuItem>
                ))}
              </TextField>
              {editing ? null : (
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: duplicate ? '#fef2f2' : codeIsValid(code) ? '#ecfdf5' : '#f8fafc',
                  color: duplicate ? 'error.main' : codeIsValid(code) ? 'success.main' : 'text.primary',
                }}
              >
                <Typography sx={{ fontWeight: 700, mb: 0.75 }}>What this creates</Typography>
                <Typography>
                  First lead number: <b>{preview}</b>
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                  {selectedCompany ? selectedCompany.name : 'Choose a business.'}
                </Typography>
                {duplicate ? (
                  <Typography color="error" sx={{ mt: 0.75 }}>
                    This business already has a project with that short code.
                  </Typography>
                ) : null}
              </Box>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1 }}>
            <Button type="button" onClick={closeForm} disabled={saving} fullWidth={phone}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={saving || !data || (!editing && data.companies.length === 0)}
              fullWidth={phone}
            >
              {saving ? 'Saving…' : editing ? 'Save project' : 'Create project'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : 'Delete project?'}
        description={
          deleteTarget && deleteTarget.lead_count > 0
            ? 'This project still has leads, so it cannot be deleted. Mark it inactive instead.'
            : 'This removes the project. It only works when the project has no leads.'
        }
        confirmLabel="Delete"
        loading={deleting}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null)
        }}
        onConfirm={() => void confirmDelete()}
      />
    </Stack>
  )
}
