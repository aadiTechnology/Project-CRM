import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
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
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import { DeleteIconButton } from '../../components/common/DeleteIconButton'

import { ErrorAlert } from '../../components/common/ErrorAlert'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import { formatDueLabel, followWhen } from '../../leads/lead-dates'
import {
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  Lead,
  LeadList,
  LeadPriority,
  LeadProjectOption,
  PRIORITY_LABEL,
  PRIORITY_TONE,
} from '../../leads/types'
import { ApiError } from '../../services/api/errors'
import { api } from '../../services/api/client'
import { useAuth } from '../../store/auth-context'
import { PipelineStage, PipelineStageList, STAGE_COLOR_PRESETS } from '../types'

function dayAge(createdAt: string) {
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime())) return null
  const days = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000))
  return `Day ${Math.max(1, days + 1)}`
}

type StageForm = {
  label: string
  color: string
  is_won: boolean
  is_lost: boolean
}

function blankStageForm(): StageForm {
  return { label: '', color: '#64748b', is_won: false, is_lost: false }
}

export function PipelinePage() {
  const { user } = useAuth()
  const canManage = Boolean(
    user?.roles.includes('BUSINESS_OWNER') || user?.roles.includes('SUPER_ADMIN'),
  )
  const canMove = Boolean(user?.permissions.includes('leads.update'))

  const [stages, setStages] = useState<PipelineStage[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [projects, setProjects] = useState<LeadProjectOption[]>([])
  const [booting, setBooting] = useState(true)
  const [boardLoading, setBoardLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [projectId, setProjectId] = useState('')
  const [source, setSource] = useState('')
  const [priority, setPriority] = useState('')
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
  const [menuLead, setMenuLead] = useState<Lead | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [stageForm, setStageForm] = useState<StageForm>(blankStageForm())
  const [editStage, setEditStage] = useState<PipelineStage | null>(null)
  const [deleteStage, setDeleteStage] = useState<PipelineStage | null>(null)
  const [moveToKey, setMoveToKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2200)
    return () => window.clearTimeout(timer)
  }, [notice])

  function closeManageDialog() {
    if (saving) return
    setManageOpen(false)
    setEditStage(null)
    setStageForm(blankStageForm())
  }

  function closeDeleteStageDialog() {
    if (saving) return
    setDeleteStage(null)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const loadStages = useCallback(async (selectedProjectId: string) => {
    if (!selectedProjectId) {
      setStages([])
      return []
    }
    const result = await api.get<PipelineStageList>(
      `/api/v1/pipeline-stages?project_id=${encodeURIComponent(selectedProjectId)}`,
    )
    setStages(result.data.items)
    return result.data.items
  }, [])

  const loadBoard = useCallback(
    async (selectedProjectId: string, filters: { search: string; source: string; priority: string }) => {
      if (!selectedProjectId) {
        setStages([])
        setLeads([])
        return
      }
      const params = new URLSearchParams({ limit: '500', project_id: selectedProjectId })
      if (filters.search) params.set('search', filters.search)
      if (filters.source) params.set('source', filters.source)
      if (filters.priority) params.set('priority', filters.priority)
      const [stageResult, leadResult] = await Promise.all([
        api.get<PipelineStageList>(
          `/api/v1/pipeline-stages?project_id=${encodeURIComponent(selectedProjectId)}`,
        ),
        api.get<LeadList>(`/api/v1/leads?${params}`),
      ])
      setStages(stageResult.data.items)
      setLeads(leadResult.data.items)
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    async function boot() {
      setBooting(true)
      setError(null)
      try {
        const result = await api.get<{ items: LeadProjectOption[] }>('/api/v1/projects')
        if (cancelled) return
        setProjects(result.data.items)
        setProjectId((current) => current || result.data.items[0]?.id || '')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load projects.')
        }
      } finally {
        if (!cancelled) setBooting(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!projectId) {
      setStages([])
      setLeads([])
      return
    }
    let cancelled = false
    async function refresh() {
      setError(null)
      setBoardLoading(true)
      try {
        await loadBoard(projectId, {
          search: debouncedSearch,
          source,
          priority,
        })
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load the pipeline.')
        }
      } finally {
        if (!cancelled) setBoardLoading(false)
      }
    }
    void refresh()
    return () => {
      cancelled = true
    }
  }, [projectId, debouncedSearch, source, priority, loadBoard])

  const selectedProject = projects.find((project) => project.id === projectId)

  const byStage = useMemo(() => {
    const map = new Map<string, Lead[]>()
    for (const stage of stages) map.set(stage.key, [])
    for (const lead of leads) {
      const list = map.get(lead.status)
      if (list) list.push(lead)
    }
    return map
  }, [stages, leads])

  async function moveLead(leadId: string, status: string) {
    if (!canMove) return
    setError(null)
    try {
      await api.patch<Lead>(`/api/v1/leads/${leadId}`, { status })
      setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, status } : lead)))
      setMenuAnchor(null)
      setMenuLead(null)
      await loadStages(projectId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not move the lead.')
    }
  }

  async function reloadBoard() {
    if (!projectId) return
    await loadBoard(projectId, { search: debouncedSearch, source, priority })
  }

  async function saveStage(event: FormEvent) {
    event.preventDefault()
    if (!projectId) return
    setSaving(true)
    setError(null)
    try {
      if (editStage) {
        const body = editStage.is_locked
          ? { color: stageForm.color }
          : {
              label: stageForm.label,
              color: stageForm.color,
              is_won: stageForm.is_won,
              is_lost: stageForm.is_lost,
            }
        await api.patch(`/api/v1/pipeline-stages/${editStage.id}`, body)
      } else {
        await api.post('/api/v1/pipeline-stages', {
          project_id: projectId,
          label: stageForm.label,
          color: stageForm.color,
          is_won: stageForm.is_won,
          is_lost: stageForm.is_lost,
        })
      }
      setEditStage(null)
      setStageForm(blankStageForm())
      await loadStages(projectId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the stage.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteStage || deleteStage.is_locked) return
    const stageName = deleteStage.label
    setSaving(true)
    setError(null)
    setNotice('')
    try {
      const q = moveToKey ? `?move_to_stage_key=${encodeURIComponent(moveToKey)}` : ''
      await api.delete(`/api/v1/pipeline-stages/${deleteStage.id}${q}`)
      setDeleteStage(null)
      setMoveToKey('')
      setNotice(`Stage "${stageName}" removed successfully.`)
      await reloadBoard()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the stage.')
    } finally {
      setSaving(false)
    }
  }

  async function moveStage(stageId: string, direction: -1 | 1) {
    const index = stages.findIndex((stage) => stage.id === stageId)
    const swap = index + direction
    if (index < 0 || swap < 0 || swap >= stages.length) return
    if (stages[index]?.is_locked || stages[swap]?.is_locked) return
    if (index === 0 || swap === 0) return
    const next = [...stages]
    ;[next[index], next[swap]] = [next[swap], next[index]]
    setSaving(true)
    try {
      await api.post('/api/v1/pipeline-stages/reorder', {
        project_id: projectId,
        stage_ids: next.map((stage) => stage.id),
      })
      setStages(next.map((stage, order) => ({ ...stage, sort_order: order + 1 })))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reorder stages.')
      await loadStages(projectId)
    } finally {
      setSaving(false)
    }
  }

  if (booting && projects.length === 0) return <LoadingScreen />

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minHeight: 0, height: '100%' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
        <Box>
          <Typography variant="h1">Sales Pipeline</Typography>
        </Box>
        {canManage ? (
          <Button
            variant="outlined"
            disabled={!projectId}
            onClick={() => setManageOpen(true)}
            sx={{ alignSelf: 'flex-start' }}
          >
            Manage stages
          </Button>
        ) : null}
      </Stack>

      {notice ? <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert> : null}
      {error ? <ErrorAlert message={error} /> : null}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} useFlexGap flexWrap="wrap">
        <TextField
          select
          size="small"
          label="Project"
          required
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          sx={{ width: { xs: '100%', md: 200 } }}
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
          placeholder="Search name, mobile, location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', md: 260 } }}
          disabled={!projectId}
        />
        <TextField
          select
          size="small"
          label="Source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          sx={{ width: { xs: '100%', md: 150 } }}
          disabled={!projectId}
        >
          <MenuItem value="">All sources</MenuItem>
          {LEAD_SOURCES.map((item) => (
            <MenuItem key={item} value={item}>
              {item}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          sx={{ width: { xs: '100%', md: 140 } }}
          disabled={!projectId}
        >
          <MenuItem value="">All priorities</MenuItem>
          {LEAD_PRIORITIES.map((item) => (
            <MenuItem key={item} value={item}>
              {PRIORITY_LABEL[item]}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {!projectId ? (
        <Box sx={{ p: 4, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: '#fff' }}>
          <Typography fontWeight={600}>Choose a project</Typography>
          <Typography color="text.secondary">
            Each project has its own pipeline columns. New is always the first column.
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'flex',
            gap: 1.5,
            overflowX: 'auto',
            pb: 1,
            flex: 1,
            alignItems: 'stretch',
            minHeight: 420,
            opacity: boardLoading ? 0.65 : 1,
            transition: 'opacity 0.15s ease',
          }}
        >
          {stages.map((stage) => {
            const column = byStage.get(stage.key) ?? []
            return (
              <Box
                key={stage.id}
                onDragOver={(e) => {
                  if (!canMove) return
                  e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const leadId = e.dataTransfer.getData('text/lead-id') || draggingId
                  if (leadId) void moveLead(leadId, stage.key)
                  setDraggingId(null)
                }}
                sx={{
                  minWidth: 260,
                  maxWidth: 300,
                  flex: '0 0 280px',
                  bgcolor: '#fff',
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderTop: `4px solid ${stage.color}`,
                  display: 'flex',
                  flexDirection: 'column',
                  maxHeight: '100%',
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1.25 }}>
                  <Chip
                    size="small"
                    label={stage.label}
                    sx={{ bgcolor: `${stage.color}33`, color: '#0f172a', fontWeight: 700 }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {column.length}
                  </Typography>
                </Stack>
                <Stack spacing={1} sx={{ px: 1, pb: 1, overflowY: 'auto', flex: 1 }}>
                  {column.map((lead) => {
                    const when = followWhen(lead.next_followup_at)
                    const pTone = PRIORITY_TONE[lead.priority as LeadPriority] ?? PRIORITY_TONE.medium
                    return (
                      <Box
                        key={lead.id}
                        draggable={canMove}
                        onDragStart={(e) => {
                          setDraggingId(lead.id)
                          e.dataTransfer.setData('text/lead-id', lead.id)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        onDragEnd={() => setDraggingId(null)}
                        sx={{
                          p: 1.25,
                          borderRadius: 1.5,
                          border: '1px solid',
                          borderColor: 'divider',
                          bgcolor: '#fff',
                          cursor: canMove ? 'grab' : 'default',
                          opacity: draggingId === lead.id ? 0.6 : 1,
                          '&:hover': { borderColor: stage.color },
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                          <Box sx={{ minWidth: 0 }}>
                            <Typography fontWeight={700} noWrap>
                              {lead.full_name}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }} noWrap>
                              {lead.requirement || lead.lead_number}
                            </Typography>
                          </Box>
                          {canMove ? (
                            <IconButton
                              size="small"
                              aria-label="Move lead"
                              onClick={(e) => {
                                setMenuAnchor(e.currentTarget)
                                setMenuLead(lead)
                              }}
                            >
                              <MoreVertIcon fontSize="small" />
                            </IconButton>
                          ) : null}
                        </Stack>
                        <Typography
                          variant="caption"
                          sx={{
                            display: 'block',
                            mt: 0.75,
                            color: when === 'o' ? 'error.main' : 'text.secondary',
                            fontWeight: when === 'o' ? 700 : 500,
                          }}
                        >
                          Follow-up: {formatDueLabel(lead.next_followup_at)}
                          {when === 'o' ? ' · overdue' : ''}
                        </Typography>
                        <Stack direction="row" spacing={0.75} sx={{ mt: 1 }} useFlexGap flexWrap="wrap">
                          <Chip
                            size="small"
                            label={PRIORITY_LABEL[lead.priority as LeadPriority] ?? lead.priority}
                            sx={{ height: 22, bgcolor: pTone.bg, color: pTone.color, fontWeight: 700 }}
                          />
                          {dayAge(lead.created_at) ? (
                            <Chip size="small" label={dayAge(lead.created_at)} sx={{ height: 22 }} />
                          ) : null}
                        </Stack>
                      </Box>
                    )
                  })}
                </Stack>
              </Box>
            )
          })}
        </Box>
      )}

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        {stages.map((stage) => (
          <MenuItem
            key={stage.id}
            disabled={menuLead?.status === stage.key}
            onClick={() => menuLead && void moveLead(menuLead.id, stage.key)}
          >
            Move to {stage.label}
          </MenuItem>
        ))}
      </Menu>

      <Dialog open={manageOpen} onClose={closeManageDialog} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
          <Box component="span" sx={{ flex: 1 }}>
            Manage stages · {selectedProject?.name ?? 'Project'}
          </Box>
          <IconButton
            type="button"
            aria-label="Close"
            color="error"
            onClick={(event) => {
              event.preventDefault()
              closeManageDialog()
            }}
            edge="end"
            size="small"
            disabled={saving}
          >
            <CloseOutlinedIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            New is fixed for every project. Add or change the other columns for this project only.
          </Typography>
          <Stack spacing={1.25} sx={{ mb: 2 }}>
            {stages.map((stage, index) => (
              <Stack
                key={stage.id}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
              >
                <Box sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: stage.color, flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={700} noWrap>
                    {stage.label}
                    {stage.is_locked ? ' (fixed)' : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {stage.key}
                    {stage.is_entry ? ' · entry' : ''}
                    {stage.is_won ? ' · won' : ''}
                    {stage.is_lost ? ' · lost' : ''}
                    {` · ${stage.lead_count} leads`}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  disabled={stage.is_locked || index <= 1 || saving}
                  onClick={() => void moveStage(stage.id, -1)}
                >
                  Up
                </Button>
                <Button
                  size="small"
                  disabled={stage.is_locked || index === stages.length - 1 || saving}
                  onClick={() => void moveStage(stage.id, 1)}
                >
                  Down
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setEditStage(stage)
                    setStageForm({
                      label: stage.label,
                      color: stage.color,
                      is_won: stage.is_won,
                      is_lost: stage.is_lost,
                    })
                  }}
                >
                  {stage.is_locked ? 'Color' : 'Edit'}
                </Button>
                <DeleteIconButton
                  onClick={() => {
                    setDeleteStage(stage)
                    setMoveToKey(stages.find((item) => item.id !== stage.id)?.key ?? '')
                  }}
                  disabled={stage.is_locked}
                  tooltip={stage.is_locked ? 'Cannot remove locked stage' : 'Remove stage'}
                />
              </Stack>
            ))}
          </Stack>

          <Box component="form" onSubmit={(e) => void saveStage(e)}>
            <Typography fontWeight={700} sx={{ mb: 1 }}>
              {editStage
                ? editStage.is_locked
                  ? `Recolor ${editStage.label}`
                  : `Edit ${editStage.label}`
                : 'Add stage'}
            </Typography>
            <Stack spacing={1.5}>
              {!editStage?.is_locked ? (
                <TextField
                  required
                  label="Label"
                  value={stageForm.label}
                  onChange={(e) => setStageForm((prev) => ({ ...prev, label: e.target.value }))}
                  fullWidth
                  disabled={Boolean(editStage?.is_locked)}
                />
              ) : null}
              <TextField
                select
                label="Color"
                value={stageForm.color}
                onChange={(e) => setStageForm((prev) => ({ ...prev, color: e.target.value }))}
                fullWidth
              >
                {STAGE_COLOR_PRESETS.map((color) => (
                  <MenuItem key={color} value={color}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ width: 16, height: 16, bgcolor: color, borderRadius: 0.5 }} />
                      <span>{color}</span>
                    </Stack>
                  </MenuItem>
                ))}
              </TextField>
              {!editStage?.is_locked ? (
                <>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={stageForm.is_won}
                        onChange={(e) => setStageForm((prev) => ({ ...prev, is_won: e.target.checked }))}
                      />
                    }
                    label="Won stage"
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={stageForm.is_lost}
                        onChange={(e) => setStageForm((prev) => ({ ...prev, is_lost: e.target.checked }))}
                      />
                    }
                    label="Lost stage"
                  />
                </>
              ) : null}
              <Stack direction="row" spacing={1}>
                <Button type="submit" variant="contained" disabled={saving || (!editStage && !stageForm.label.trim())}>
                  {editStage ? 'Save' : 'Add stage'}
                </Button>
                {editStage ? (
                  <Button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault()
                      setEditStage(null)
                      setStageForm(blankStageForm())
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              closeManageDialog()
            }}
            disabled={saving}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteStage)} onClose={closeDeleteStageDialog} fullWidth maxWidth="xs">
        <DialogTitle>Remove {deleteStage?.label}?</DialogTitle>
        <DialogContent>
          {(deleteStage?.lead_count ?? 0) > 0 ? (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <Typography>
                {deleteStage?.lead_count} lead(s) are in this stage. Move them to another stage first.
              </Typography>
              <TextField
                select
                label="Move leads to"
                value={moveToKey}
                onChange={(e) => setMoveToKey(e.target.value)}
                fullWidth
              >
                {stages
                  .filter((stage) => stage.id !== deleteStage?.id)
                  .map((stage) => (
                    <MenuItem key={stage.id} value={stage.key}>
                      {stage.label}
                    </MenuItem>
                  ))}
              </TextField>
            </Stack>
          ) : (
            <Typography sx={{ mt: 1 }}>This stage has no leads. It can be removed safely.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              closeDeleteStageDialog()
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            color="error"
            variant="contained"
            disabled={saving || ((deleteStage?.lead_count ?? 0) > 0 && !moveToKey)}
            onClick={() => void confirmDelete()}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
