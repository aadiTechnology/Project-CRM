import { createTheme } from '@mui/material/styles'

const sans = '"IBM Plex Sans", "Noto Sans Devanagari", system-ui, sans-serif'

const focusRing = {
  '&:focus-visible': {
    outline: '2px solid #1d4ed8',
    outlineOffset: '2px',
  },
}

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1d4ed8', dark: '#1e40af', light: '#60a5fa', contrastText: '#ffffff' },
    secondary: { main: '#3730a3', dark: '#312e81', light: '#e0e7ff' },
    background: { default: '#f4f6f8', paper: '#ffffff' },
    text: { primary: '#0f172a', secondary: '#64748b' },
    divider: '#e6e8ec',
    error: { main: '#b91c1c', light: '#fee2e2' },
    success: { main: '#047857', light: '#d1fae5' },
    warning: { main: '#b45309', light: '#fef3c7' },
    info: { main: '#1d4ed8', light: '#dbeafe' },
  },
  typography: {
    fontFamily: sans,
    h1: { fontFamily: sans, fontSize: 'clamp(1.375rem, 2.4vw, 1.75rem)', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2 },
    h2: { fontFamily: sans, fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.01em' },
    h6: { fontFamily: sans, fontWeight: 600 },
    body1: { fontSize: '0.875rem', lineHeight: 1.45 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.45 },
    button: { fontFamily: sans, fontWeight: 600, fontSize: '0.875rem' },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          margin: 0,
          backgroundColor: '#f4f6f8',
          color: '#0f172a',
          fontFamily: sans,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          minHeight: 36,
          borderRadius: 8,
          boxShadow: 'none',
          ...focusRing,
        },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        outlined: {
          borderColor: '#cbd5e1',
          color: '#0f172a',
          '&:hover': { borderColor: '#1d4ed8', backgroundColor: '#ffffff' },
        },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 8, ...focusRing } } },
    MuiLink: { styleOverrides: { root: { fontWeight: 500, ...focusRing } } },
    MuiListItemButton: { styleOverrides: { root: focusRing } },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        rounded: { borderRadius: 12 },
        outlined: { borderColor: '#e6e8ec' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 12, boxShadow: 'none' },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 12 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 999, fontWeight: 500, fontSize: 12 },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'medium', variant: 'outlined' },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: '#ffffff',
          minHeight: 48,
          alignItems: 'center',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#cbd5e1' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#94a3b8' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#1d4ed8', borderWidth: 1 },
        },
        input: {
          padding: '13px 14px',
          lineHeight: 1.5,
          boxSizing: 'border-box',
        },
        // Keep placeholder/value vertically centered when size="small" (theme minHeight is 48).
        inputSizeSmall: {
          padding: '13px 14px',
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        select: {
          display: 'flex',
          alignItems: 'center',
          minHeight: '1.4375em',
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          lineHeight: 1.4,
        },
        outlined: {
          '&.MuiInputLabel-shrink': {
            transform: 'translate(14px, -9px) scale(0.75)',
          },
        },
        asterisk: {
          color: '#b91c1c',
        },
      },
    },
    MuiFormLabel: {
      styleOverrides: {
        asterisk: {
          color: '#b91c1c',
        },
      },
    },
    MuiFormControlLabel: {
      styleOverrides: {
        root: {
          marginLeft: -2,
          marginRight: 0,
          alignItems: 'center',
        },
        label: {
          fontSize: '0.875rem',
          color: '#334155',
        },
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: {
          padding: 6,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        standardSuccess: { backgroundColor: '#ecfdf5', color: '#047857' },
        standardError: { backgroundColor: '#fef2f2', color: '#b91c1c' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 800,
          fontSize: 13,
          color: '#0f172a',
          letterSpacing: '0.01em',
          backgroundColor: '#f8fafc',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          border: '1px solid #e6e8ec',
          boxShadow: '0 14px 30px rgba(15, 23, 42, 0.18)',
        },
      },
    },
  },
})
