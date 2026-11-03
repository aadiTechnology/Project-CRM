import AddOutlinedIcon from '@mui/icons-material/AddOutlined'
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'

import {
  DEFAULT_FOLLOWUP_PLAN,
  FollowupPlanStep,
  loadFollowupPlan,
  saveFollowupPlan,
} from './plan'

type Props = {
  open: boolean
  companyId: string | null | undefined
  onClose: () => void
  onSaved: (steps: FollowupPlanStep[]) => void
}

export function FollowupPlanSettingsDialog({ open, companyId, onClose, onSaved }: Props) {
  const [steps, setSteps] = useState<FollowupPlanStep[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setSteps(loadFollowupPlan(companyId))
    setError('')
  }, [companyId, open])

  function save() {
    const labels = steps.map((step) => step.label.trim().toLowerCase())
    if (steps.some((step) => !step.label.trim())) {
      setError('Every step needs a name.')
      return
    }
    if (new Set(labels).size !== labels.length) {
      setError('Step names must be unique.')
      return
    }
    const saved = saveFollowupPlan(companyId, steps)
    onSaved(saved)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Default follow-up plan (all leads)</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This is not for one lead. It sets the default for every lead: after Call 1 wait X days → Day 3,
          then Y days → Day 7, and so on. When you Mark connected on any reminder, these days are used.
          To change only one lead’s date, use Reschedule on that lead.
        </Typography>
        <Stack spacing={1.5}>
          {steps.map((step, index) => {
            const nextLabel = steps[index + 1]?.label
            return (
              <Box
                key={`step-${index}`}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  p: 1.5,
                  bgcolor: '#fafbfc',
                }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <TextField
                    label="Step name"
                    value={step.label}
                    fullWidth
                    helperText={index === 0 ? 'First call / first follow-up' : `Call ${index + 1}`}
                    onChange={(event) => {
                      const next = [...steps]
                      next[index] = { ...step, label: event.target.value }
                      setSteps(next)
                    }}
                  />
                  <IconButton
                    aria-label={`Remove ${step.label || `step ${index + 1}`}`}
                    disabled={steps.length <= 1}
                    onClick={() => setSteps(steps.filter((_, i) => i !== index))}
                    sx={{ mt: 0.5 }}
                  >
                    <DeleteForeverOutlinedIcon fontSize="small" />
                  </IconButton>
                </Stack>
                {nextLabel ? (
                  <TextField
                    label={`Days until next (${nextLabel})`}
                    type="number"
                    value={step.gapDays}
                    fullWidth
                    sx={{ mt: 1.25 }}
                    helperText={`After finishing ${step.label || 'this step'}, wait this many days, then remind for ${nextLabel}.`}
                    inputProps={{ min: 1, max: 365 }}
                    onChange={(event) => {
                      const next = [...steps]
                      next[index] = { ...step, gapDays: Number(event.target.value) || 1 }
                      setSteps(next)
                    }}
                  />
                ) : (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    Last step — no next reminder after this one is completed.
                  </Typography>
                )}
              </Box>
            )
          })}
        </Stack>
        {error ? (
          <Typography color="error" variant="body2" sx={{ mt: 1.5 }}>
            {error}
          </Typography>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button
            startIcon={<AddOutlinedIcon />}
            disabled={steps.length >= 12}
            onClick={() =>
              setSteps([
                ...steps,
                {
                  label: `Day ${steps.length + 1}`,
                  gapDays: 7,
                },
              ])
            }
          >
            Add step
          </Button>
          <Button onClick={() => setSteps(DEFAULT_FOLLOWUP_PLAN.map((item) => ({ ...item })))}>
            Reset defaults
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>
          Save days
        </Button>
      </DialogActions>
    </Dialog>
  )
}
