import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined'
import { IconButton, Tooltip } from '@mui/material'
import type { MouseEvent } from 'react'

type DeleteIconButtonProps = {
  onClick: (e: MouseEvent) => void
  disabled?: boolean
  tooltip?: string
  size?: 'small' | 'medium'
}

/**
 * Soft red trash control — matches other row action icons (no heavy border box).
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
          disabled={disabled}
          aria-label={tooltip}
          onClick={(e) => {
            e.stopPropagation()
            onClick(e)
          }}
          sx={{
            width: 30,
            height: 30,
            borderRadius: '8px',
            color: '#ef4444',
            bgcolor: '#fef2f2',
            '&:hover': { bgcolor: '#fee2e2', color: '#dc2626' },
            '&.Mui-disabled': { opacity: 0.45, bgcolor: '#f8fafc', color: '#94a3b8' },
          }}
        >
          <DeleteForeverOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </span>
    </Tooltip>
  )
}
