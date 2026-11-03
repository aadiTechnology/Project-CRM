import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
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

/** Compact confirm — same simple style as Add field. */
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
          width: '100%',
          maxWidth: 360,
          borderRadius: '14px',
          overflow: 'visible',
        },
      }}
    >
      <DialogTitle id="confirm-dialog-title" sx={{ py: 1.25, px: 2, fontSize: 17, fontWeight: 700 }}>
        {title}
      </DialogTitle>
      {description ? (
        <DialogContent sx={{ px: 2, pt: 0.25, pb: 0.5, overflow: 'visible' }}>
          {typeof description === 'string' ? (
            <DialogContentText sx={{ color: 'text.secondary', fontSize: 14 }}>{description}</DialogContentText>
          ) : (
            description
          )}
        </DialogContent>
      ) : null}
      <DialogActions sx={{ px: 2, pb: 1.5, pt: 1 }}>
        <Button type="button" onClick={onCancel} disabled={loading}>
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
            '&:hover': { bgcolor: '#ef4444', boxShadow: 'none', filter: 'brightness(1.05)' },
            '&.Mui-disabled': { bgcolor: '#fecaca', color: '#fff' },
          }}
        >
          {confirmLabel ?? (loading ? t('common:deleting') : t('common:delete'))}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
