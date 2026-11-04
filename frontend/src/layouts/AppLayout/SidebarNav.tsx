import {
  Avatar,
  Box,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import MenuOpenOutlinedIcon from '@mui/icons-material/MenuOpenOutlined'
import MenuOutlinedIcon from '@mui/icons-material/MenuOutlined'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useLocation } from 'react-router-dom'

import { roleLabel } from '../../access/role-label'
import type { LeadList } from '../../leads/types'
import { subscribeReminderBadge } from '../../reminders/reminder-badge'
import { api } from '../../services/api/client'
import { useAuth } from '../../store/auth-context'
import { SECTIONS, homePathForRoles, isNavActive, primaryRole, visibleNav, type NavItem } from './nav'

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'A'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

function NavButton({
  item,
  label,
  collapsed,
  active,
  badge,
  onNavigate,
}: {
  item: NavItem
  label: string
  collapsed: boolean
  active: boolean
  badge?: number
  onNavigate?: () => void
}) {
  const Icon = item.icon
  const tip = badge && badge > 0 ? `${label} (${badge})` : label
  const button = (
    <ListItemButton
      component={RouterLink}
      to={item.path}
      selected={active}
      aria-current={active ? 'page' : undefined}
      aria-label={tip}
      onClick={onNavigate}
      sx={{
        minHeight: 40,
        borderRadius: 999,
        mb: 0.25,
        px: collapsed ? 1.25 : 1.5,
        justifyContent: collapsed ? 'center' : 'flex-start',
        color: active ? '#ffffff' : '#cbd5e1',
        '&.Mui-selected': {
          bgcolor: 'rgba(255,255,255,0.14)',
          color: '#ffffff',
        },
        '&.Mui-selected:hover': { bgcolor: 'rgba(255,255,255,0.18)' },
        '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.08)' },
      }}
    >
      <ListItemIcon
        sx={{
          minWidth: collapsed ? 0 : 36,
          color: 'inherit',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <Icon fontSize="small" aria-hidden />
        {collapsed && badge && badge > 0 ? (
          <Box
            sx={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 16,
              height: 16,
              px: 0.4,
              borderRadius: 999,
              bgcolor: '#2563eb',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'grid',
              placeItems: 'center',
              lineHeight: 1,
            }}
          >
            {badge > 99 ? '99+' : badge}
          </Box>
        ) : null}
      </ListItemIcon>
      {collapsed ? null : (
        <ListItemText
          primary={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Box component="span" sx={{ fontWeight: active ? 600 : 500, fontSize: '0.875rem' }}>
                {label}
              </Box>
              {badge && badge > 0 ? (
                <Box
                  component="span"
                  sx={{
                    minWidth: 22,
                    height: 20,
                    px: 0.75,
                    borderRadius: 999,
                    bgcolor: active ? 'rgba(255,255,255,0.22)' : 'rgba(37,99,235,0.95)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {badge > 99 ? '99+' : badge}
                </Box>
              ) : null}
            </Stack>
          }
        />
      )}
    </ListItemButton>
  )

  if (!collapsed) return button
  return (
    <Tooltip title={tip} placement="right">
      {button}
    </Tooltip>
  )
}

export function SidebarNav({
  collapsed,
  showCollapse,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed: boolean
  showCollapse: boolean
  onToggleCollapse?: () => void
  onNavigate?: () => void
}) {
  const { t } = useTranslation(['navigation', 'access'])
  const { user } = useAuth()
  const { pathname } = useLocation()
  const roles = user?.roles ?? []
  const items = visibleNav(roles, user?.permissions ?? [])
  const roleNames = user?.roles.map((role) => roleLabel(role, t)).join(', ')
  const leadRole = primaryRole(roles)
  const homePath = homePathForRoles(roles)
  const [reminderCount, setReminderCount] = useState(0)
  const [reminderOverride, setReminderOverride] = useState<number | null>(null)
  const showReminders = items.some((item) => item.id === 'reminders')

  useEffect(() => subscribeReminderBadge(setReminderOverride), [])

  useEffect(() => {
    if (!showReminders) {
      setReminderCount(0)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        // Same rule as the Reminders page: a due date, and not Won or Lost.
        const result = await api.get<LeadList>(
          '/api/v1/leads?limit=1&exclude_lost=true&has_followup=true',
        )
        if (cancelled) return
        setReminderCount(result.data.total)
      } catch {
        if (!cancelled) setReminderCount(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pathname, showReminders])

  return (
    <Stack sx={{ height: '100%' }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ px: collapsed ? 1.25 : 1.5, minHeight: 64 }}>
        <Box
          aria-hidden
          sx={{
            width: 38,
            height: 38,
            borderRadius: '11px',
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'rgba(255,255,255,0.18)',
            color: '#ffffff',
            border: '1px solid rgba(255,255,255,0.3)',
            fontWeight: 600,
            fontSize: '1rem',
          }}
        >
          A
        </Box>
        {collapsed ? null : (
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              component={RouterLink}
              to={homePath}
              onClick={onNavigate}
              sx={{
                display: 'block',
                color: 'inherit',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.95rem',
                lineHeight: 1.15,
              }}
            >
              {t('navigation:brand')} {t('navigation:product')}
            </Typography>
          </Box>
        )}
        {showCollapse ? (
          <IconButton
            aria-label={collapsed ? t('navigation:expandSidebar') : t('navigation:collapseSidebar')}
            onClick={onToggleCollapse}
            sx={{ color: '#cbd5e1' }}
          >
            {collapsed ? <MenuOutlinedIcon /> : <MenuOpenOutlinedIcon />}
          </IconButton>
        ) : null}
      </Stack>

      <Box component="nav" aria-label={t('navigation:mainNavigation')} sx={{ flex: 1, overflowY: 'auto', px: 1.25, pb: 2 }}>
        {SECTIONS.map((section) => {
          const sectionItems = items.filter((item) => item.section === section)
          if (sectionItems.length === 0) return null
          const showHeading = items.some((item) => item.section !== section)
          return (
            <Box key={section} sx={{ mb: 1.5 }}>
              {collapsed || !showHeading ? null : (
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    px: 1.5,
                    pt: 1.25,
                    pb: 0.75,
                    color: '#94a3b8',
                    letterSpacing: '0.04em',
                    fontWeight: 500,
                  }}
                >
                  {t(`navigation:sections.${section}`)}
                </Typography>
              )}
              <List disablePadding>
                {sectionItems.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    label={t(`navigation:items.${item.id}`)}
                    collapsed={collapsed}
                    active={isNavActive(pathname, item)}
                    badge={item.id === 'reminders' ? (reminderOverride ?? reminderCount) : undefined}
                    onNavigate={onNavigate}
                  />
                ))}
              </List>
            </Box>
          )
        })}
      </Box>

      <Box sx={{ px: collapsed ? 1.25 : 2, py: 2, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Avatar
            sx={{
              width: 36,
              height: 36,
              bgcolor: '#e0e7ff',
              color: '#3730a3',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            {initials(user?.full_name ?? '')}
          </Avatar>
          {collapsed ? null : (
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 600, fontSize: '0.875rem' }}>
                {user?.full_name}
              </Typography>
              <Typography noWrap variant="caption" sx={{ color: '#94a3b8' }}>
                {leadRole ? roleLabel(leadRole, t) : roleNames}
              </Typography>
            </Box>
          )}
        </Stack>
      </Box>
    </Stack>
  )
}
