import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CurrencyRupeeIcon from '@mui/icons-material/CurrencyRupee'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import FiberNewOutlinedIcon from '@mui/icons-material/FiberNewOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import StarOutlineIcon from '@mui/icons-material/StarOutline'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined'
import { Box, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import type { LeadProjectOption } from '../../leads/types'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'

type KpiMetric = { key: string; label: string; value: string; badge: string }
type StageShare = { status: string; label: string; count: number; percent: number }
type QuickPulse = {
  due_today: number
  overdue: number
  conversion_rate: number
  top_source: string | null
  top_source_count: number
}
type KpiOverview = { metrics: KpiMetric[]; stages: StageShare[]; pulse: QuickPulse }

const CARD_META: Record<string, { icon: typeof GroupsOutlinedIcon; tint: string; to: string }> = {
  total: { icon: GroupsOutlinedIcon, tint: '#dbeafe', to: '/app/leads' },
  new: { icon: FiberNewOutlinedIcon, tint: '#e0e7ff', to: '/app/leads' },
  qualified: { icon: CheckCircleOutlineIcon, tint: '#d1fae5', to: '/app/pipeline' },
  followups_due: { icon: TodayOutlinedIcon, tint: '#fef3c7', to: '/app/reminders' },
  won: { icon: StarOutlineIcon, tint: '#d1fae5', to: '/app/pipeline' },
  won_value: { icon: CurrencyRupeeIcon, tint: '#ede9fe', to: '/app/pipeline' },
  pipeline_value: { icon: TrendingUpIcon, tint: '#dbeafe', to: '/app/pipeline' },
  overdue: { icon: ErrorOutlineIcon, tint: '#fee2e2', to: '/app/reminders' },
}

const STAGE_COLOR: Record<string, string> = {
  new: '#3b82f6',
  contacted: '#60a5fa',
  in_progress: '#ca8a04',
  qualified: '#1d4ed8',
  nurture: '#7c3aed',
  won: '#059669',
  lost: '#dc2626',
}

export function KpisPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<KpiOverview | null>(null)
  const [projects, setProjects] = useState<LeadProjectOption[]>([])
  const [projectId, setProjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const result = await api.get<{ items: LeadProjectOption[] }>('/api/v1/projects')
        setProjects(result.data.items)
        setProjectId((current) => current || result.data.items[0]?.id || '')
      } catch {
        setProjects([])
      }
    })()
  }, [])

  const load = useCallback(async () => {
    setError('')
    try {
      const params = new URLSearchParams()
      if (projectId) params.set('project_id', projectId)
      const query = params.toString()
      const result = await api.get<KpiOverview>(`/api/v1/kpis${query ? `?${query}` : ''}`)
      setData(result.data)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Could not load KPIs.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  if (loading && !data) return <LoadingScreen />

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}
      >
        <Typography variant="h1" sx={{ minWidth: 0 }}>
          KPIs Overview
        </Typography>
        <TextField
          select
          size="small"
          label="Project"
          required
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          disabled={projects.length === 0}
          sx={{ minWidth: { xs: '100%', sm: 260 }, flexShrink: 0 }}
        >
          {projects.length === 0 ? <MenuItem value="">No projects</MenuItem> : null}
          {projects.map((project) => (
            <MenuItem key={project.id} value={project.id}>
              {project.name}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {error ? <ErrorAlert message={error} /> : null}

      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, minmax(0, 1fr))' },
        }}
      >
        {(data?.metrics ?? []).map((metric) => {
          const meta = CARD_META[metric.key] ?? { icon: AssessmentOutlinedIcon, tint: '#f1f5f9', to: '/app/leads' }
          const Icon = meta.icon
          return (
            <Box
              key={metric.key}
              role="button"
              tabIndex={0}
              onClick={() => navigate(meta.to)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  navigate(meta.to)
                }
              }}
              sx={{
                p: 2,
                borderRadius: '16px',
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
                transition: 'transform .15s, box-shadow .15s',
                '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 10px 24px rgba(15,23,42,0.08)' },
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                  '&:hover': { transform: 'none' },
                },
              }}
            >
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '10px',
                    bgcolor: meta.tint,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'primary.main',
                  }}
                >
                  <Icon fontSize="small" />
                </Box>
                <Box
                  sx={{
                    px: 1,
                    py: 0.25,
                    borderRadius: 999,
                    bgcolor: metric.badge === 'Needs attention' ? '#fef3c7' : '#f1f5f9',
                    color: metric.badge === 'Needs attention' ? '#92400e' : '#475569',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {metric.badge}
                </Box>
              </Stack>
              <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                {metric.value}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {metric.label}
              </Typography>
            </Box>
          )
        })}
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', lg: '1.6fr 1fr' },
        }}
      >
        <Box
          sx={{
            p: { xs: 2, sm: 2.5 },
            borderRadius: '16px',
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Typography fontWeight={700} sx={{ mb: 0.5 }}>
            Lead stage overview
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Distribution of {(data?.metrics.find((m) => m.key === 'total')?.value ?? '0')} leads across the current
            pipeline.
          </Typography>
          <Stack spacing={1.25}>
            {(data?.stages ?? []).map((stage) => (
              <Box key={stage.status}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {stage.label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {stage.count} · {stage.percent}%
                  </Typography>
                </Stack>
                <Box sx={{ height: 8, borderRadius: 999, bgcolor: '#f1f5f9', overflow: 'hidden' }}>
                  <Box
                    sx={{
                      height: '100%',
                      width: `${Math.min(100, stage.percent)}%`,
                      bgcolor: STAGE_COLOR[stage.status] ?? '#64748b',
                      borderRadius: 999,
                    }}
                  />
                </Box>
              </Box>
            ))}
          </Stack>
        </Box>

        <Box
          sx={{
            p: { xs: 2, sm: 2.5 },
            borderRadius: '16px',
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Typography fontWeight={700} sx={{ mb: 0.5 }}>
            Quick pulse
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A few useful numbers to guide your next action.
          </Typography>
          <Stack spacing={1.5}>
            <PulseRow label="Due today" value={String(data?.pulse.due_today ?? 0)} hint="Follow-ups scheduled for today" />
            <PulseRow
              label="Overdue follow-ups"
              value={String(data?.pulse.overdue ?? 0)}
              hint="Prioritize these first"
              emphasize
            />
            <PulseRow
              label="Conversion rate"
              value={`${data?.pulse.conversion_rate ?? 0}%`}
              hint="Won ÷ total leads"
            />
            <PulseRow
              label="Top lead source"
              value={
                data?.pulse.top_source
                  ? `${data.pulse.top_source_count} · ${data.pulse.top_source}`
                  : '—'
              }
              hint="Most common source in your scope"
            />
          </Stack>
        </Box>
      </Box>
    </Stack>
  )
}

function PulseRow({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string
  value: string
  hint: string
  emphasize?: boolean
}) {
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: '12px',
        bgcolor: emphasize ? '#fef2f2' : '#f8fafc',
        border: '1px solid',
        borderColor: emphasize ? '#fecaca' : 'divider',
      }}
    >
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
        <Typography fontWeight={700} color={emphasize ? 'error.main' : 'text.primary'}>
          {label}
        </Typography>
        <Typography fontWeight={800} color={emphasize ? 'error.main' : 'text.primary'}>
          {value}
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    </Box>
  )
}
