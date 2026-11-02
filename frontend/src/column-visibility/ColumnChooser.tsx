import ViewColumnOutlinedIcon from '@mui/icons-material/ViewColumnOutlined'
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useId, useState } from 'react'

import type { ColumnDef } from './definitions'

type ColumnChooserProps = {
  columns: ColumnDef[]
  visibility: Record<string, boolean>
  onToggle: (key: string) => void
  onReset: () => void
}

export function ColumnChooser({ columns, visibility, onToggle, onReset }: ColumnChooserProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const titleId = useId()
  const open = Boolean(anchor)

  return (
    <>
      <Tooltip title="Columns">
        <IconButton
          size="small"
          aria-label="Columns"
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{
            bgcolor: '#fff',
            color: 'text.secondary',
            width: 32,
            height: 32,
            borderRadius: '8px',
            border: '1px solid',
            borderColor: 'divider',
            '&:hover': { bgcolor: '#eef2ff', color: 'primary.main' },
          }}
        >
          <ViewColumnOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 260, p: 1.5, borderRadius: '12px' } } }}
      >
        <Typography id={titleId} variant="subtitle2" fontWeight={700} sx={{ mb: 1, px: 0.5 }}>
          Columns
        </Typography>
        <Stack spacing={0.25} role="group" aria-labelledby={titleId}>
          {columns.map((col) => {
            const checked = visibility[col.key] !== false
            const disabled = !col.hideable
            return (
              <FormControlLabel
                key={col.key}
                control={
                  <Checkbox
                    size="small"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggle(col.key)}
                  />
                }
                label={
                  <Typography variant="body2" color={disabled ? 'text.secondary' : 'text.primary'}>
                    {col.label}
                    {disabled ? ' (always on)' : ''}
                  </Typography>
                }
                sx={{ mx: 0, px: 0.5, borderRadius: '8px', '&:hover': { bgcolor: disabled ? 'transparent' : '#f8fafc' } }}
              />
            )
          })}
        </Stack>
        <Box sx={{ mt: 1.25, px: 0.5 }}>
          <Button size="small" onClick={onReset} sx={{ textTransform: 'none', fontWeight: 600 }}>
            Reset to default
          </Button>
        </Box>
      </Popover>
    </>
  )
}
