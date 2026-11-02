import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RolePublic } from '../../auth/types'
import { roleLabel } from '../../access/role-label'
import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import { messageForError } from '../../auth/validation/errors'
import { api } from '../../services/api/client'
import { useAuth } from '../../store/auth-context'
import {
  MATRIX_COLUMNS,
  WORKS_LIKE_MENUS,
  type WorksLike,
  matrixCell,
  permissionsFromMenus,
  roleMenus,
} from '../role-menus'

export function RolesPage() {
  const { t } = useTranslation(['access', 'common'])
  const { user, refreshUser } = useAuth()
  const isSuperAdmin = Boolean(user?.roles.includes('SUPER_ADMIN'))
  const canCreate = isSuperAdmin || Boolean(user?.permissions.includes('roles.create'))
  const canUpdate = isSuperAdmin || Boolean(user?.permissions.includes('roles.update'))
  const [roles, setRoles] = useState<RolePublic[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [createName, setCreateName] = useState('')
  const [worksLike, setWorksLike] = useState<WorksLike>('SALESPERSON')
  const [menus, setMenus] = useState<string[]>([...WORKS_LIKE_MENUS.SALESPERSON])
  const [createError, setCreateError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const [, roleResult] = await Promise.all([refreshUser(), api.get<RolePublic[]>('/api/v1/roles')])
      setRoles(roleResult.data)
    } catch (requestError) {
      setError(messageForError(requestError, t))
    } finally {
      setLoading(false)
    }
  }, [refreshUser, t])

  useEffect(() => {
    void load()
  }, [load])

  const menuOptions = WORKS_LIKE_MENUS[worksLike]

  const rows = useMemo(
    () =>
      roles.map((role) => {
        const keys = role.permissions.map((item) => item.key)
        return {
          role,
          menus: roleMenus(role.name, keys, role.is_system),
        }
      }),
    [roles],
  )

  function onWorksLikeChange(value: WorksLike) {
    setWorksLike(value)
    setMenus([...WORKS_LIKE_MENUS[value]])
  }

  function toggleMenu(menu: string, on: boolean) {
    setMenus((current) => (on ? [...current, menu] : current.filter((item) => item !== menu)))
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    if (!canCreate) return
    if (createName.trim().length < 2) {
      setCreateError(t('access:roleNameRequired'))
      return
    }
    if (menus.length === 0) {
      setCreateError(t('access:tickOneMenu'))
      return
    }
    setCreating(true)
    setCreateError('')
    setNotice('')
    setError('')
    try {
      const result = await api.post<RolePublic>('/api/v1/roles', {
        name: createName.trim(),
        description:
          worksLike === 'SALESPERSON'
            ? 'Works own leads across assigned projects.'
            : 'Read-only campaign results.',
        permissions: permissionsFromMenus(menus),
      })
      setRoles((current) => [...current, result.data].sort((a, b) => a.name.localeCompare(b.name)))
      setCreateName('')
      setWorksLike('SALESPERSON')
      setMenus([...WORKS_LIKE_MENUS.SALESPERSON])
      setNotice(t('access:roleCreated'))
    } catch (requestError) {
      setCreateError(messageForError(requestError, t))
    } finally {
      setCreating(false)
    }
  }

  async function onDelete(role: RolePublic) {
    if (!canUpdate || role.is_system) return
    setDeletingId(role.id)
    setNotice('')
    setError('')
    try {
      await api.delete(`/api/v1/roles/${role.id}`)
      setRoles((current) => current.filter((item) => item.id !== role.id))
      setNotice(t('access:roleDeleted'))
    } catch (requestError) {
      setError(messageForError(requestError, t))
    } finally {
      setDeletingId(null)
    }
  }

  if (loading && roles.length === 0) return <LoadingScreen />

  return (
    <Stack spacing={2.5}>
      <Stack spacing={0.75}>
        <Typography variant="h1">{t('access:rolesTitle')}</Typography>
      </Stack>

      {notice ? <Alert severity="success">{notice}</Alert> : null}
      {error ? <ErrorAlert message={error} /> : null}

      {canCreate ? (
        <Box
          component="form"
          onSubmit={(event) => void onCreate(event)}
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '12px',
            bgcolor: '#fff',
            p: { xs: 2, sm: 2.5 },
          }}
        >
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>{t('access:createRole')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('access:createRoleHintSimple')}
          </Typography>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { sm: 'flex-end' }, mb: 1.5 }}
          >
            <TextField
              size="small"
              label={t('access:roleName')}
              value={createName}
              required
              fullWidth
              placeholder="Telecaller"
              disabled={creating}
              onChange={(event) => setCreateName(event.target.value)}
              sx={{ maxWidth: { sm: 260 } }}
            />
            <TextField
              select
              size="small"
              label={t('access:worksLike')}
              value={worksLike}
              fullWidth
              disabled={creating}
              onChange={(event) => onWorksLikeChange(event.target.value as WorksLike)}
              sx={{ maxWidth: { sm: 320 } }}
            >
              <MenuItem value="SALESPERSON">{t('access:worksLikeSalesperson')}</MenuItem>
              <MenuItem value="MARKETING">{t('access:worksLikeMarketing')}</MenuItem>
            </TextField>
          </Stack>

          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
            {menuOptions.map((menu) => (
              <FormControlLabel
                key={menu}
                control={
                  <Checkbox
                    size="small"
                    checked={menus.includes(menu)}
                    disabled={creating}
                    onChange={(event) => toggleMenu(menu, event.target.checked)}
                  />
                }
                label={<Typography variant="body2">{menu}</Typography>}
                sx={{ mr: 1.5 }}
              />
            ))}
          </Stack>

          {createError ? (
            <Typography color="error" variant="body2" sx={{ mb: 1.5 }}>
              {createError}
            </Typography>
          ) : null}

          <Button type="submit" variant="contained" disabled={creating}>
            {creating ? t('common:loading') : t('access:createRole')}
          </Button>
        </Box>
      ) : null}

      <Box
        sx={{
          overflowX: 'auto',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '12px',
          bgcolor: '#fff',
        }}
      >
        <Table
          size="small"
          sx={{
            minWidth: 1100,
            '& .MuiTableCell-root': { borderBottom: 'none' },
          }}
        >
          <TableHead>
            <TableRow sx={{ bgcolor: '#f8fafc' }}>
              <TableCell sx={{ fontWeight: 600, position: 'sticky', left: 0, bgcolor: '#f8fafc', zIndex: 1 }}>
                {t('access:role')}
              </TableCell>
              {MATRIX_COLUMNS.map((column) => (
                <TableCell key={column} sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {column}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(({ role, menus: roleMenuList }) => (
              <TableRow key={role.id} hover>
                <TableCell
                  sx={{
                    position: 'sticky',
                    left: 0,
                    bgcolor: '#fff',
                    zIndex: 1,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <span>{roleLabel(role.name, t)}</span>
                    {canUpdate && !role.is_system ? (
                      <Button
                        size="small"
                        color="error"
                        disabled={deletingId === role.id}
                        onClick={() => void onDelete(role)}
                        sx={{ minHeight: 28, px: 1 }}
                      >
                        {t('access:deleteRole')}
                      </Button>
                    ) : null}
                  </Stack>
                </TableCell>
                {MATRIX_COLUMNS.map((column) => {
                  const cell = matrixCell(role.name, roleMenuList, column)
                  return (
                    <TableCell
                      key={column}
                      sx={{
                        color: cell.yes ? '#047857' : '#94a3b8',
                        fontWeight: cell.yes ? 500 : 400,
                        whiteSpace: 'nowrap',
                        verticalAlign: 'top',
                      }}
                    >
                      {cell.yes ? t('access:yes') : t('access:no')}
                      {cell.note ? (
                        <>
                          <br />
                          <Typography component="span" variant="caption" color="text.secondary">
                            {cell.note}
                          </Typography>
                        </>
                      ) : null}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  )
}
