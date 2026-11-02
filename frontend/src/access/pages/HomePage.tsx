import ArrowForwardOutlinedIcon from '@mui/icons-material/ArrowForwardOutlined'
import { Box, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { roleLabel } from '../role-label'
import { useAuth } from '../../store/auth-context'
import { visibleNav } from '../../layouts/AppLayout/nav'

export function HomePage() {
  const { t } = useTranslation(['navigation', 'access'])
  const { user } = useAuth()
  const roles = user?.roles ?? []
  const items = visibleNav(roles, user?.permissions ?? []).filter((item) => item.id !== 'home')
  const readyCount = items.filter((item) => item.ready).length

  return (
    <Stack spacing={{ xs: 2.5, sm: 3 }}>
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '16px',
          bgcolor: 'background.paper',
          p: { xs: 2.25, sm: 3 },
          backgroundImage:
            'linear-gradient(145deg, #ffffff 0%, #f8fafc 42%, #eff6ff 100%)',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            width: 220,
            height: 220,
            borderRadius: '50%',
            right: { xs: -90, md: -40 },
            top: { xs: -110, md: -70 },
            bgcolor: 'rgba(29, 78, 216, 0.07)',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            width: 120,
            height: 120,
            borderRadius: '50%',
            right: { xs: 40, md: 120 },
            bottom: -60,
            bgcolor: 'rgba(15, 23, 42, 0.04)',
          }}
        />

        <Stack spacing={1.5} sx={{ position: 'relative', maxWidth: 640 }}>
          <Typography
            variant="overline"
            sx={{ letterSpacing: '0.08em', color: 'primary.main', fontWeight: 700 }}
          >
            {t('navigation:workspace')}
          </Typography>
          <Typography variant="h1">
            {t('navigation:homeGreeting', { name: user?.full_name ?? '' })}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', pt: 0.25 }}>
            {roles.map((role) => (
              <Box
                key={role}
                sx={{
                  px: 1.25,
                  py: 0.35,
                  borderRadius: 999,
                  bgcolor: '#e0e7ff',
                  color: '#3730a3',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {roleLabel(role, t)}
              </Box>
            ))}
            <Box
              sx={{
                px: 1.25,
                py: 0.35,
                borderRadius: 999,
                bgcolor: '#f1f5f9',
                color: '#475569',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {t('navigation:readyCount', { count: readyCount })}
            </Box>
          </Stack>
        </Stack>
      </Box>

      <Stack spacing={1.25}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={0.75}
          sx={{ alignItems: { sm: 'baseline' }, justifyContent: 'space-between' }}
        >
          <Typography variant="h2" sx={{ fontSize: '1.05rem' }}>
            {t('navigation:quickAccess')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('navigation:homeLead')}
          </Typography>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(3, minmax(0, 1fr))',
            },
          }}
        >
          {items.map((item) => {
            const Icon = item.icon
            const ready = Boolean(item.ready)
            return (
              <Box
                key={item.id}
                component={Link}
                to={item.path}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.25,
                  minHeight: { xs: 132, sm: 148 },
                  p: 2,
                  borderRadius: '16px',
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  textDecoration: 'none',
                  color: 'inherit',
                  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
                  opacity: ready ? 1 : 0.78,
                  transition: 'transform .18s, box-shadow .18s, border-color .18s',
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    borderColor: '#bfdbfe',
                    boxShadow: '0 12px 28px rgba(15, 23, 42, 0.1)',
                  },
                  '&:focus-visible': {
                    outline: '2px solid #1d4ed8',
                    outlineOffset: 2,
                  },
                  '@media (prefers-reduced-motion: reduce)': {
                    transition: 'none',
                    '&:hover': { transform: 'none' },
                  },
                }}
              >
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '12px',
                      flexShrink: 0,
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: ready ? '#eff6ff' : '#f1f5f9',
                      color: ready ? 'primary.main' : 'text.secondary',
                    }}
                  >
                    <Icon fontSize="small" aria-hidden />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                      {t(`navigation:items.${item.id}`)}
                    </Typography>
                    {!ready ? (
                      <Typography variant="caption" color="text.secondary" fontWeight={600}>
                        {t('navigation:comingSoon')}
                      </Typography>
                    ) : null}
                  </Box>
                  <ArrowForwardOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} aria-hidden />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5, flex: 1 }}>
                  {t(`navigation:hints.${item.id}`, { defaultValue: t('navigation:homeLead') })}
                </Typography>
              </Box>
            )
          })}
        </Box>
      </Stack>
    </Stack>
  )
}
