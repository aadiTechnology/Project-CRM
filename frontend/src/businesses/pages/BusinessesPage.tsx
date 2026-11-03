import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { FormEvent, useCallback, useEffect, useState } from 'react'

import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'

const PLANS = ['Free', 'Starter', 'Pro', 'Enterprise'] as const
const INDUSTRIES = [
  'Technology',
  'Education',
  'Food & Beverage',
  'Retail',
  'Healthcare',
  'Real Estate',
  'Manufacturing',
  'Services',
  'Other',
] as const

interface BusinessItem {
  id: string
  name: string
  status: string
  plan_label: string | null
  industry: string | null
  website: string | null
  email: string | null
  phone: string | null
  city: string | null
  address: string | null
  gst_number: string | null
  remarks: string | null
  user_count: number
  project_count: number
  team_count: number
  lead_count: number
  can_delete: boolean
}

interface BusinessList {
  can_manage: boolean
  items: BusinessItem[]
}

type FormMode = 'create' | 'edit'

type BusinessForm = {
  name: string
  industry: string
  website: string
  email: string
  phone: string
  city: string
  address: string
  gst_number: string
  remarks: string
  plan_label: string
  status: string
}

const emptyForm: BusinessForm = {
  name: '',
  industry: '',
  website: '',
  email: '',
  phone: '',
  city: '',
  address: '',
  gst_number: '',
  remarks: '',
  plan_label: 'Free',
  status: 'active',
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isPhone(value: string) {
  return /^[+\d][\d\s\-()]{6,18}$/.test(value)
}

function isWebsite(value: string) {
  return /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\/.*)?$/.test(value)
}

function isGst(value: string) {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value.toUpperCase().replace(/\s/g, ''))
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Typography
      variant="subtitle2"
      sx={{
        gridColumn: '1 / -1',
        mt: 0.5,
        mb: -0.5,
        color: 'text.secondary',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        fontSize: 11,
      }}
    >
      {children}
    </Typography>
  )
}

export function BusinessesPage() {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const [data, setData] = useState<BusinessList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<FormMode>('create')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<BusinessItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BusinessItem | null>(null)
  const [form, setForm] = useState<BusinessForm>(emptyForm)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setError('')
    async function fetchList() {
      return api.get<BusinessList>('/api/v1/businesses')
    }
    try {
      const result = await fetchList()
      setData(result.data)
    } catch (requestError) {
      // Backend --reload can drop one request; retry once before showing the banner.
      if (requestError instanceof ApiError && requestError.code === 'NETWORK_ERROR') {
        try {
          await new Promise((resolve) => window.setTimeout(resolve, 600))
          const result = await fetchList()
          setData(result.data)
          return
        } catch (retryError) {
          setError(retryError instanceof ApiError ? retryError.message : 'Something went wrong. Please try again.')
          return
        }
      }
      setError(requestError instanceof ApiError ? requestError.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function setField<K extends keyof BusinessForm>(key: K, value: BusinessForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function openCreate() {
    setMode('create')
    setEditing(null)
    setForm(emptyForm)
    setFieldErrors({})
    setOpen(true)
  }

  function openEdit(item: BusinessItem) {
    setMode('edit')
    setEditing(item)
    setForm({
      name: item.name,
      industry: item.industry ?? '',
      website: item.website ?? '',
      email: item.email ?? '',
      phone: item.phone ?? '',
      city: item.city ?? '',
      address: item.address ?? '',
      gst_number: item.gst_number ?? '',
      remarks: item.remarks ?? '',
      plan_label: item.plan_label && PLANS.includes(item.plan_label as (typeof PLANS)[number]) ? item.plan_label : 'Free',
      status: item.status === 'inactive' ? 'inactive' : 'active',
    })
    setFieldErrors({})
    setOpen(true)
  }

  function closeForm() {
    if (saving) return
    setOpen(false)
    setFieldErrors({})
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {}
    if (form.name.trim().length < 2) next.name = 'Business name must be at least 2 characters.'
    if (form.industry && !INDUSTRIES.includes(form.industry as (typeof INDUSTRIES)[number])) {
      next.industry = 'Choose an industry from the list.'
    }
    if (form.email.trim() && !isEmail(form.email.trim())) next.email = 'Enter a valid business email.'
    if (form.phone.trim() && !isPhone(form.phone.trim())) next.phone = 'Enter a valid phone number.'
    if (form.website.trim() && !isWebsite(form.website.trim())) next.website = 'Enter a valid website such as example.com.'
    if (form.gst_number.trim() && !isGst(form.gst_number.trim())) next.gst_number = 'Enter a valid 15-character GSTIN.'
    if (!PLANS.includes(form.plan_label as (typeof PLANS)[number])) next.plan_label = 'Choose a plan.'
    return next
  }

  function payloadFromForm() {
    return {
      name: form.name.trim(),
      industry: form.industry.trim() || null,
      website: form.website.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      gst_number: form.gst_number.trim() || null,
      remarks: form.remarks.trim() || null,
      plan_label: form.plan_label,
      status: form.status,
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next = validate()
    setFieldErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    setError('')
    setNotice('')
    const body = payloadFromForm()
    try {
      if (mode === 'create') {
        const result = await api.post<BusinessItem>('/api/v1/businesses', body)
        setNotice(result.message)
      } else if (editing) {
        const result = await api.patch<BusinessItem>(`/api/v1/businesses/${editing.id}`, body)
        setNotice(result.message)
      }
      setOpen(false)
      await load()
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
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await api.delete<Record<string, never>>(`/api/v1/businesses/${deleteTarget.id}`)
      setNotice(result.message)
      setDeleteTarget(null)
      await load()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Something went wrong. Please try again.')
      setDeleteTarget(null)
    } finally {
      setSaving(false)
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
        <Stack spacing={0.75} sx={{ minWidth: 0 }}>
          <Typography variant="h1">Businesses</Typography>
        </Stack>
        {data?.can_manage ? (
          <Button variant="contained" onClick={openCreate} sx={{ flexShrink: 0 }}>
            Create business
          </Button>
        ) : null}
      </Stack>

      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {error ? <ErrorAlert message={error} /> : null}

      {data && data.items.length === 0 ? (
        <Typography color="text.secondary">No business yet. Create the first one with full contact details.</Typography>
      ) : null}

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
        }}
      >
        {data?.items.map((item) => (
          <Box
            key={item.id}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              bgcolor: 'background.paper',
              p: 2.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
              minWidth: 0,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                  {item.name}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  {[item.industry, item.city].filter(Boolean).join(' · ') || 'No industry / city yet'}
                </Typography>
              </Stack>
              <Chip
                size="small"
                label={item.status === 'active' ? 'Active' : 'Inactive'}
                sx={{
                  bgcolor: item.status === 'active' ? '#d1fae5' : '#e2e8f0',
                  color: item.status === 'active' ? '#047857' : '#475569',
                  fontWeight: 500,
                }}
              />
            </Stack>
            <Typography color="text.secondary" variant="body2">
              {[item.email, item.phone].filter(Boolean).join(' · ') || 'No contact yet'}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Plan: {item.plan_label || '—'}
              {item.gst_number ? ` · GST ${item.gst_number}` : ''}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {item.user_count} users · {item.project_count} projects · {item.lead_count} leads
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 'auto', pt: 1 }}>
              <Button size="small" variant="outlined" onClick={() => openEdit(item)} fullWidth={phone}>
                Edit
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                disabled={!item.can_delete}
                onClick={() => setDeleteTarget(item)}
                fullWidth={phone}
                title={
                  item.can_delete
                    ? 'Delete this empty business'
                    : 'Remove users, projects, teams, and leads first, or set inactive'
                }
              >
                Delete
              </Button>
            </Stack>
          </Box>
        ))}
      </Box>

      <Dialog open={open} onClose={closeForm} fullWidth maxWidth="md" fullScreen={phone}>
        <DialogTitle>{mode === 'create' ? 'Create business' : 'Edit business'}</DialogTitle>
        <Box component="form" onSubmit={onSubmit} noValidate>
          <DialogContent
            sx={{
              display: 'grid',
              gap: 2,
              pt: 1,
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            }}
          >
            <Typography color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
              Fill what a salesperson needs to call and follow up: who they are, how to reach them, where they sit, and
              GST if billed.
            </Typography>

            <SectionTitle>Identity</SectionTitle>
            <TextField
              label="Business name"
              value={form.name}
              required
              fullWidth
              error={Boolean(fieldErrors.name)}
              helperText={fieldErrors.name}
              disabled={saving}
              onChange={(event) => setField('name', event.target.value)}
              sx={{ gridColumn: { xs: '1 / -1', sm: '1 / -1' } }}
            />
            <TextField
              select
              label="Industry"
              value={form.industry}
              fullWidth
              error={Boolean(fieldErrors.industry)}
              helperText={fieldErrors.industry || 'Optional — helps segment accounts'}
              disabled={saving}
              onChange={(event) => setField('industry', event.target.value)}
            >
              <MenuItem value="">
                <em>Not set</em>
              </MenuItem>
              {INDUSTRIES.map((industry) => (
                <MenuItem key={industry} value={industry}>
                  {industry}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Website"
              value={form.website}
              fullWidth
              placeholder="https://company.com"
              error={Boolean(fieldErrors.website)}
              helperText={fieldErrors.website}
              disabled={saving}
              onChange={(event) => setField('website', event.target.value)}
            />

            <SectionTitle>Contact</SectionTitle>
            <TextField
              label="Business email"
              type="email"
              value={form.email}
              fullWidth
              error={Boolean(fieldErrors.email)}
              helperText={fieldErrors.email}
              disabled={saving}
              onChange={(event) => setField('email', event.target.value)}
            />
            <TextField
              label="Phone"
              value={form.phone}
              fullWidth
              placeholder="+91 98XXXXXXXX"
              error={Boolean(fieldErrors.phone)}
              helperText={fieldErrors.phone}
              disabled={saving}
              onChange={(event) => setField('phone', event.target.value)}
            />
            <TextField
              label="City"
              value={form.city}
              fullWidth
              error={Boolean(fieldErrors.city)}
              helperText={fieldErrors.city}
              disabled={saving}
              onChange={(event) => setField('city', event.target.value)}
            />
            <TextField
              label="GSTIN"
              value={form.gst_number}
              fullWidth
              placeholder="27AAAAA0000A1Z5"
              error={Boolean(fieldErrors.gst_number)}
              helperText={fieldErrors.gst_number || 'Optional for invoicing'}
              disabled={saving}
              onChange={(event) => setField('gst_number', event.target.value)}
            />
            <TextField
              label="Address"
              value={form.address}
              fullWidth
              multiline
              minRows={2}
              error={Boolean(fieldErrors.address)}
              helperText={fieldErrors.address}
              disabled={saving}
              onChange={(event) => setField('address', event.target.value)}
              sx={{ gridColumn: '1 / -1' }}
            />

            <SectionTitle>Account notes</SectionTitle>
            <TextField
              label="Remarks"
              value={form.remarks}
              fullWidth
              multiline
              minRows={3}
              placeholder="Decision maker, buying cycle, competitor, or handoff notes…"
              error={Boolean(fieldErrors.remarks)}
              helperText={fieldErrors.remarks}
              disabled={saving}
              onChange={(event) => setField('remarks', event.target.value)}
              sx={{ gridColumn: '1 / -1' }}
            />

            <SectionTitle>Subscription</SectionTitle>
            <TextField
              select
              label="Plan"
              value={form.plan_label}
              fullWidth
              error={Boolean(fieldErrors.plan_label)}
              helperText={fieldErrors.plan_label}
              disabled={saving}
              onChange={(event) => setField('plan_label', event.target.value)}
            >
              {PLANS.map((plan) => (
                <MenuItem key={plan} value={plan}>
                  {plan}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Status"
              value={form.status}
              fullWidth
              disabled={saving}
              onChange={(event) => setField('status', event.target.value)}
            >
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </TextField>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? 'Saving…' : mode === 'create' ? 'Create business' : 'Save changes'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete business?"
        description={
          <>
            Delete <strong>{deleteTarget?.name}</strong>? This only works when the business has no users, projects,
            teams, or leads.
          </>
        }
        loading={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Stack>
  )
}
