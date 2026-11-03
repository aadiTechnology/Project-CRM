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

/**
 * One shared confirmation popup for destructive actions (delete, remove, deactivate).
 * Reuse it instead of building a Dialog per page.
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
    >
      <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
      {description ? (
        <DialogContent>
          {typeof description === 'string' ? <DialogContentText>{description}</DialogContentText> : description}
        </DialogContent>
      ) : null}
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button type="button" onClick={onCancel} disabled={loading}>
          {cancelLabel ?? t('common:cancel')}
        </Button>
        <Button type="button" color="error" variant="contained" onClick={onConfirm} disabled={loading}>
          {confirmLabel ?? (loading ? t('common:deleting') : t('common:delete'))}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
