import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type ConfirmDialogProps = {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Destructive confirm popup — light red surface (not dark).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation(['common'])

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!loading) onCancel()
      }}
      fullWidth
      maxWidth="xs"
      aria-labelledby="confirm-dialog-title"
      PaperProps={{
        sx: {
          borderRadius: '14px',
          border: '1px solid #fecaca',
          overflow: 'hidden',
          boxShadow: '0 12px 28px rgba(185, 28, 28, 0.12)',
        },
      }}
    >
      <DialogTitle
        id="confirm-dialog-title"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: '#fef2f2',
          color: '#b91c1c',
          fontWeight: 700,
          py: 1.75,
        }}
      >
        <WarningAmberOutlinedIcon sx={{ color: '#ef4444' }} />
        <Box component="span" sx={{ flex: 1 }}>
          {title}
        </Box>
      </DialogTitle>
      {description ? (
        <DialogContent sx={{ pt: 2, pb: 0.5 }}>
          {typeof description === 'string' ? (
            <DialogContentText sx={{ color: '#7f1d1d' }}>{description}</DialogContentText>
          ) : (
            description
          )}
        </DialogContent>
      ) : null}
      <DialogActions sx={{ px: 2.5, py: 2, bgcolor: '#fffafa' }}>
        <Button type="button" onClick={onCancel} disabled={loading} sx={{ color: '#64748b' }}>
          {cancelLabel ?? t('common:cancel')}
        </Button>
        <Button
          type="button"
          variant="contained"
          onClick={onConfirm}
          disabled={loading}
          sx={{
            bgcolor: '#ef4444',
            color: '#fff',
            boxShadow: 'none',
            '&:hover': { bgcolor: '#dc2626', boxShadow: 'none' },
            '&.Mui-disabled': { bgcolor: '#fecaca', color: '#fff' },
          }}
        >
          {confirmLabel ?? (loading ? t('common:deleting') : t('common:delete'))}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
