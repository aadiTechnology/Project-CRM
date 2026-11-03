/** Solid primary toolbar icon — same look on Leads, Reminders, etc. */
export const toolbarIconSx = {
  bgcolor: 'primary.main',
  color: '#fff',
  width: 32,
  height: 32,
  borderRadius: '8px',
  boxShadow: '0 4px 10px rgba(29,78,216,.2)',
  '&:hover': { bgcolor: 'primary.dark' },
  '&.Mui-disabled': { bgcolor: '#93c5fd', color: '#fff' },
} as const
