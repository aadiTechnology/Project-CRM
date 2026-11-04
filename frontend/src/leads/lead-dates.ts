export type FollowWhen = 'o' | 't' | 'u'

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

export function parseFollowup(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function followWhen(value: string | null | undefined, now = new Date()): FollowWhen | null {
  const due = parseFollowup(value)
  if (!due) return null
  const today = startOfDay(now).getTime()
  const day = startOfDay(due).getTime()
  if (day < today) return 'o'
  if (day === today) return 't'
  return 'u'
}

/** Date-only display that does not shift the calendar day across time zones. */
export function formatEnquiryDate(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value.slice(0, 10)
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDueLabel(value: string | null | undefined, now = new Date()): string {
  const due = parseFollowup(value)
  if (!due) return '—'
  const today = startOfDay(now).getTime()
  const day = startOfDay(due).getTime()
  const diff = Math.round((day - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function toDatetimeLocalValue(value: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
}

export function defaultFollowupLocal() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(10, 30, 0, 0)
  return toDatetimeLocalValue(date)
}

export function localInputToIso(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function addDaysIso(value: string | null | undefined, days: number) {
  const base = parseFollowup(value) ?? new Date()
  base.setDate(base.getDate() + days)
  return base.toISOString()
}

export function dateInputToIsoNoon(value: string) {
  const date = new Date(`${value}T10:30:00`)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function isoToDateInput(value: string | null | undefined) {
  const due = parseFollowup(value)
  if (!due) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`
}
