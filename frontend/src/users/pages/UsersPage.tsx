import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined'
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined'
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
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
import { useTranslation } from 'react-i18next'

import type { AccessUser, CompanyOption, RolePublic, UserListData } from '../../auth/types'
import { PasswordField } from '../../auth/components/PasswordField'
import { usePasswordPolicy } from '../../auth/hooks/usePasswordPolicy'
import { fieldMessages, messageForError } from '../../auth/validation/errors'
import { isEmail, validatePassword } from '../../auth/validation/password'
import { roleLabel } from '../../access/role-label'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'
import { useAuth } from '../../store/auth-context'

const ROLE_BADGE: Record<string, { bg: string; color: string }> = {
  SUPER_ADMIN: { bg: '#ede9fe', color: '#5b21b6' },
  BUSINESS_OWNER: { bg: '#dbeafe', color: '#1e40af' },
  MARKETING: { bg: '#fef3c7', color: '#92400e' },
  SALESPERSON: { bg: '#e2e8f0', color: '#334155' },
}

function RoleBadge({ role, label }: { role: string; label: string }) {
  const tone = ROLE_BADGE[role] ?? { bg: '#d1fae5', color: '#047857' }
  return (
    <Chip
      size="small"
      label={label}
      sx={{ bgcolor: tone.bg, color: tone.color, fontWeight: 500, height: 24 }}
    />
  )
}

export function UsersPage() {
  const { t } = useTranslation(['access', 'auth', 'validation', 'common'])
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const { user } = useAuth()
  const { policy } = usePasswordPolicy()
  const [data, setData] = useState<UserListData | null>(null)
  const [roles, setRoles] = useState<RolePublic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [orgFilter, setOrgFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [createOpen, setCreateOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [role, setRole] = useState('SALESPERSON')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [roleTarget, setRoleTarget] = useState<AccessUser | null>(null)
  const [selectedRole, setSelectedRole] = useState('SALESPERSON')
  const [statusTarget, setStatusTarget] = useState<AccessUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AccessUser | null>(null)
  const canDelete = Boolean(user?.permissions.includes('users.delete') || user?.roles.includes('SUPER_ADMIN'))

  const load = useCallback(async () => {
    setError('')
    try {
      const [userResult, roleResult] = await Promise.all([
        api.get<UserListData>('/api/v1/users?limit=100'),
        api.get<RolePublic[]>('/api/v1/roles'),
      ])
      setData(userResult.data)
      setRoles(roleResult.data)
      setCompanyId((current) => current || userResult.data.companies[0]?.id || '')
      setRole((current) => {
        if (roleResult.data.some((item) => item.name === current)) return current
        return roleResult.data.find((item) => item.name === 'SALESPERSON')?.name ?? roleResult.data[0]?.name ?? ''
      })
    } catch (requestError) {
      setError(messageForError(requestError, t))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const organisations = useMemo(() => {
    const map = new Map<string, string>()
    for (const account of data?.items ?? []) {
      if (account.company_id && account.company_name) map.set(account.company_id, account.company_name)
    }
    for (const company of data?.companies ?? []) map.set(company.id, company.name)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.items ?? []).filter((account) => {
      if (roleFilter !== 'ALL' && !account.roles.includes(roleFilter)) return false
      if (orgFilter === 'PLATFORM' && account.company_id) return false
      if (orgFilter !== 'ALL' && orgFilter !== 'PLATFORM' && account.company_id !== orgFilter) return false
      if (statusFilter === 'ACTIVE' && !account.is_active) return false
      if (statusFilter === 'INACTIVE' && account.is_active) return false
      if (!q) return true
      const haystack = [
        account.full_name,
        account.email,
        account.company_name ?? 'Platform',
        ...account.roles.map((item) => roleLabel(item, t)),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [data?.items, orgFilter, roleFilter, search, statusFilter, t])

  function closeCreate() {
    if (saving) return
    setCreateOpen(false)
    setFieldErrors({})
  }

  function closeRoleDialog() {
    setRoleTarget(null)
  }

  function closeStatusDialog() {
    setStatusTarget(null)
  }

  function closeDeleteDialog() {
    setDeleteTarget(null)
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    const next: Record<string, string> = {}
    if (fullName.trim().length < 2) next.full_name = t('validation:fullNameMin')
    if (!isEmail(email)) next.email = t('validation:email')
    if (policy) {
      const code = validatePassword(password, policy)
      if (code) next.password = t(`validation:${code}`, { count: policy.min_length })
    } else if (!password) {
      next.password = t('validation:required')
    }
    if (!role) next.role = t('access:selectRole')
    if (data?.companies.length && !companyId && role !== 'SUPER_ADMIN') {
      next.company_id = t('access:chooseOrganisation')
    }
    setFieldErrors(next)
    if (Object.keys(next).length > 0) return
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const payload: Record<string, unknown> = {
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        role,
        preferred_language: 'en',
      }
      if (companyId) payload.company_id = companyId
      await api.post<AccessUser>('/api/v1/users', payload)
      setNotice(t('access:userCreated'))
      setFullName('')
      setEmail('')
      setPassword('')
      setCreateOpen(false)
      setFieldErrors({})
      await load()
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.details.length > 0) {
        setFieldErrors(fieldMessages(requestError, t, policy))
      }
      setError(messageForError(requestError, t))
    } finally {
      setSaving(false)
    }
  }

  async function saveRole() {
    if (!roleTarget) return
    setBusyId(roleTarget.id)
    setNotice('')
    try {
      await api.patch(`/api/v1/users/${roleTarget.id}/role`, { role: selectedRole })
      setNotice(t('access:roleUpdated'))
      setRoleTarget(null)
      await load()
    } catch (requestError) {
      setError(messageForError(requestError, t))
    } finally {
      setBusyId(null)
    }
  }

  async function saveStatus() {
    if (!statusTarget) return
    setBusyId(statusTarget.id)
    setNotice('')
    try {
      await api.patch(`/api/v1/users/${statusTarget.id}/status`, { is_active: !statusTarget.is_active })
      setNotice(statusTarget.is_active ? t('access:userDeactivated') : t('access:userActivated'))
      setStatusTarget(null)
      await load()
    } catch (requestError) {
      setError(messageForError(requestError, t))
    } finally {
      setBusyId(null)
    }
  }

  async function deleteUser() {
    if (!deleteTarget) return
    setBusyId(deleteTarget.id)
    setNotice('')
    setError('')
    try {
      await api.delete(`/api/v1/users/${deleteTarget.id}`)
      setNotice(t('access:userDeleted'))
      setDeleteTarget(null)
      await load()
    } catch (requestError) {
      setError(messageForError(requestError, t))
    } finally {
      setBusyId(null)
    }
  }

  if (loading && !data) return <LoadingScreen />

  const companies: CompanyOption[] = data?.companies ?? []

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' }, justifyContent: 'space-between' }}
      >
        <Stack spacing={0.75} sx={{ minWidth: 0 }}>
          <Typography variant="h1">{t('access:usersTitle')}</Typography>
        </Stack>
        {data?.can_create ? (
          <Button variant="contained" onClick={() => setCreateOpen(true)} sx={{ flexShrink: 0 }}>
            {t('access:createUser')}
          </Button>
        ) : null}
      </Stack>

      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {error ? <ErrorAlert message={error} /> : null}

      <Box
        sx={{
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns: { xs: '1fr', sm: '1.4fr 1fr 1fr 1fr' },
        }}
      >
        <TextField
          size="small"
          label={t('access:searchUsers')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('access:searchUsersPlaceholder')}
        />
        <TextField
          select
          size="small"
          label={t('access:filterRole')}
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
        >
          <MenuItem value="ALL">{t('access:allRoles')}</MenuItem>
          {roles.map((item) => (
            <MenuItem key={item.id} value={item.name}>
              {roleLabel(item.name, t)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t('access:filterOrganisation')}
          value={orgFilter}
          onChange={(event) => setOrgFilter(event.target.value)}
        >
          <MenuItem value="ALL">{t('access:allOrganisations')}</MenuItem>
          <MenuItem value="PLATFORM">{t('access:platform')}</MenuItem>
          {organisations.map(([id, name]) => (
            <MenuItem key={id} value={id}>
              {name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t('access:filterStatus')}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <MenuItem value="ALL">{t('access:allStatuses')}</MenuItem>
          <MenuItem value="ACTIVE">{t('access:active')}</MenuItem>
          <MenuItem value="INACTIVE">{t('access:inactive')}</MenuItem>
        </TextField>
      </Box>

      <Typography variant="body2" color="text.secondary">
        {t('access:showingUsers', { count: filtered.length, total: data?.total ?? 0 })}
      </Typography>

      {filtered.length === 0 ? <Typography color="text.secondary">{t('access:noUsers')}</Typography> : null}

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '12px', bgcolor: '#fff', overflow: 'hidden' }}>
        <Table
          size="small"
          sx={{
            tableLayout: 'fixed',
            width: '100%',
            '& .MuiTableCell-root': { borderBottom: 'none' },
          }}
        >
          <TableHead>
            <TableRow sx={{ bgcolor: '#f8fafc' }}>
              <TableCell sx={{ fontWeight: 700, width: '28%' }}>{t('access:name')}</TableCell>
              <TableCell sx={{ fontWeight: 700, width: '18%' }}>{t('access:organisation')}</TableCell>
              <TableCell sx={{ fontWeight: 700, width: '18%' }}>{t('access:role')}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t('access:status')}</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 120 }} align="right">
                {t('access:actions')}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((account) => {
              const isSelf = account.id === user?.id
              const primaryRole = account.roles[0] ?? ''
              return (
                <TableRow key={account.id} hover>
                  <TableCell sx={{ maxWidth: 0 }}>
                    <Typography fontWeight={700} noWrap>
                      {account.full_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">
                      {account.email}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {account.company_name ?? t('access:platform')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {account.roles.map((item) => (
                        <RoleBadge key={item} role={item} label={roleLabel(item, t)} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={account.is_active ? t('access:active') : t('access:inactive')}
                      sx={{
                        bgcolor: account.is_active ? '#d1fae5' : '#f1f5f9',
                        color: account.is_active ? '#047857' : '#64748b',
                        fontWeight: 600,
                        borderRadius: '999px',
                      }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.25} sx={{ justifyContent: 'flex-end' }}>
                      <Tooltip title={t('access:changeRole')}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={isSelf || busyId === account.id}
                            aria-label={t('access:changeRole')}
                            onClick={() => {
                              setSelectedRole(primaryRole || 'SALESPERSON')
                              setRoleTarget(account)
                            }}
                          >
                            <ManageAccountsOutlinedIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={account.is_active ? t('access:deactivate') : t('access:activate')}>
                        <span>
                          <IconButton
                            size="small"
                            color={account.is_active ? 'error' : 'primary'}
                            disabled={isSelf || busyId === account.id}
                            aria-label={account.is_active ? t('access:deactivate') : t('access:activate')}
                            onClick={() => setStatusTarget(account)}
                          >
                            {account.is_active ? (
                              <PersonOffOutlinedIcon sx={{ fontSize: 18 }} />
                            ) : (
                              <PersonOutlineIcon sx={{ fontSize: 18 }} />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                      {canDelete ? (
                        <Tooltip title={t('access:deleteUser')}>
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              disabled={isSelf || busyId === account.id}
                              aria-label={t('access:deleteUser')}
                              onClick={() => setDeleteTarget(account)}
                            >
                              <DeleteForeverOutlinedIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : null}
                    </Stack>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>

      <Dialog open={createOpen} onClose={closeCreate} fullScreen={phone} fullWidth maxWidth="sm" aria-labelledby="create-user-title">
        <Box component="form" onSubmit={(event) => void onCreate(event)}>
          <DialogTitle id="create-user-title">{t('access:createUser')}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <Typography color="text.secondary">{t('access:createUserHint')}</Typography>
              <TextField
                label={t('auth:fullName')}
                value={fullName}
                required
                fullWidth
                autoFocus
                error={Boolean(fieldErrors.full_name)}
                helperText={fieldErrors.full_name}
                disabled={saving}
                onChange={(event) => setFullName(event.target.value)}
              />
              <TextField
                label={t('auth:email')}
                type="email"
                value={email}
                required
                fullWidth
                error={Boolean(fieldErrors.email)}
                helperText={fieldErrors.email}
                disabled={saving}
                onChange={(event) => setEmail(event.target.value)}
              />
              <PasswordField
                id="create-user-password"
                label={t('auth:password')}
                autoComplete="new-password"
                value={password}
                error={fieldErrors.password}
                disabled={saving}
                onChange={setPassword}
              />
              <TextField
                select
                label={t('access:organisation')}
                value={companyId}
                required={companies.length > 0 && role !== 'SUPER_ADMIN'}
                fullWidth
                error={Boolean(fieldErrors.company_id)}
                helperText={fieldErrors.company_id || t('access:organisationHint')}
                disabled={saving || companies.length === 0}
                onChange={(event) => setCompanyId(event.target.value)}
              >
                {companies.map((company) => (
                  <MenuItem key={company.id} value={company.id}>
                    {company.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={t('access:selectRole')}
                value={role}
                required
                fullWidth
                error={Boolean(fieldErrors.role)}
                helperText={fieldErrors.role}
                disabled={saving}
                onChange={(event) => setRole(event.target.value)}
              >
                {roles.map((item) => (
                  <MenuItem key={item.id} value={item.name}>
                    {roleLabel(item.name, t)}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1 }}>
            <Button type="button" onClick={closeCreate} disabled={saving} fullWidth={phone}>
              {t('common:cancel')}
            </Button>
            <Button type="submit" variant="contained" disabled={saving} fullWidth={phone}>
              {saving ? t('auth:submitting') : t('access:createUser')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog open={Boolean(roleTarget)} onClose={closeRoleDialog} aria-labelledby="change-role-title">
        <DialogTitle id="change-role-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
          <Box component="span" sx={{ flex: 1 }}>
            {t('access:confirmRole')}
          </Box>
          <IconButton
            type="button"
            aria-label={t('common:close')}
            color="error"
            onClick={closeRoleDialog}
            edge="end"
            size="small"
          >
            <CloseOutlinedIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {roleTarget ? (
            <Typography color="text.secondary" sx={{ mb: 1.5 }}>
              {roleTarget.full_name} · {roleTarget.company_name ?? t('access:platform')}
            </Typography>
          ) : null}
          <TextField
            select
            fullWidth
            label={t('access:selectRole')}
            value={selectedRole}
            onChange={(event) => setSelectedRole(event.target.value)}
            sx={{ mt: 0.5, minWidth: { xs: '100%', sm: 280 } }}
          >
            {roles.map((item) => (
              <MenuItem key={item.id} value={item.name}>
                {roleLabel(item.name, t)}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              closeRoleDialog()
            }}
          >
            {t('common:cancel')}
          </Button>
          <Button type="button" variant="contained" onClick={() => void saveRole()}>
            {t('common:save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(statusTarget)} onClose={closeStatusDialog} aria-labelledby="status-title">
        <DialogTitle id="status-title">
          {statusTarget?.is_active ? t('access:confirmDeactivate') : t('access:confirmActivate')}
        </DialogTitle>
        <DialogActions>
          <Button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              closeStatusDialog()
            }}
          >
            {t('common:cancel')}
          </Button>
          <Button type="button" variant="contained" onClick={() => void saveStatus()}>
            {t('common:save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('access:confirmDeleteUser')}
        description={
          deleteTarget ? (
            <Typography color="text.secondary">
              {deleteTarget.full_name} · {deleteTarget.email}
            </Typography>
          ) : undefined
        }
        confirmLabel={t('access:deleteUser')}
        loading={Boolean(deleteTarget && busyId === deleteTarget.id)}
        onCancel={closeDeleteDialog}
        onConfirm={() => void deleteUser()}
      />
    </Stack>
  )
}
