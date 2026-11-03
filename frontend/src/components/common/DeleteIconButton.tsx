import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { IconButton, Tooltip } from '@mui/material'
import type { MouseEvent } from 'react'

type DeleteIconButtonProps = {
  onClick: (e: MouseEvent) => void
  disabled?: boolean
  tooltip?: string
  size?: 'small' | 'medium'
}

/**
 * Reusable delete icon button with consistent styling across the app
 */
export function DeleteIconButton({
  onClick,
  disabled = false,
  tooltip = 'Delete',
  size = 'small',
}: DeleteIconButtonProps) {
  return (
    <Tooltip title={tooltip}>
      <span>
        <IconButton
          size={size}
          color="error"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            onClick(e)
          }}
          sx={{
            border: '1px solid',
            borderColor: disabled ? 'divider' : 'error.main',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <DeleteOutlineIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </span>
    </Tooltip>
  )
}
