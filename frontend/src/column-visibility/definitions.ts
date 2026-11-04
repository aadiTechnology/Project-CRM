export type ColumnScreen = 'leads' | 'reminders' | 'follow-ups'

export type ColumnDef = {
  key: string
  label: string
  hideable: boolean
  /** CSS grid track used on md+ desktop layouts */
  track: string
}

export const SCREEN_COLUMNS: Record<ColumnScreen, ColumnDef[]> = {
  leads: [
    { key: 'lead', label: 'Lead', hideable: false, track: 'minmax(180px,1.1fr)' },
    { key: 'project', label: 'Project', hideable: true, track: '120px' },
    { key: 'phone', label: 'Mobile', hideable: true, track: '130px' },
    { key: 'requirement', label: 'Requirement', hideable: true, track: 'minmax(160px,1fr)' },
    { key: 'status', label: 'Status', hideable: true, track: '104px' },
    { key: 'priority', label: 'Priority', hideable: true, track: '88px' },
    { key: 'enquiry_date', label: 'Enquiry Date', hideable: true, track: '124px' },
    { key: 'follow_up', label: 'Next Follow-up', hideable: true, track: '124px' },
    { key: 'source', label: 'Lead Source', hideable: true, track: '130px' },
    { key: 'call_summary', label: 'Call Summary', hideable: true, track: 'minmax(200px,1.3fr)' },
    { key: 'actions', label: 'Actions', hideable: false, track: '52px' },
  ],
  reminders: [
    { key: 'checkbox', label: 'Select', hideable: false, track: '32px' },
    { key: 'lead', label: 'Lead', hideable: false, track: 'minmax(180px,1.3fr)' },
    { key: 'project', label: 'Project', hideable: true, track: 'minmax(110px,1fr)' },
    { key: 'phone', label: 'Phone', hideable: true, track: 'minmax(120px,1fr)' },
    { key: 'priority', label: 'Priority', hideable: true, track: 'minmax(88px,1fr)' },
    { key: 'due', label: 'Due', hideable: true, track: 'minmax(108px,1fr)' },
    { key: 'status', label: 'Status', hideable: true, track: 'minmax(100px,1fr)' },
    { key: 'actions', label: 'Actions', hideable: false, track: '168px' },
  ],
  'follow-ups': [
    { key: 'customer', label: 'Customer', hideable: false, track: 'minmax(220px,1.4fr)' },
    { key: 'remark', label: 'Last Remark', hideable: false, track: 'minmax(160px,1fr)' },
    { key: 'next', label: 'Next Follow-up', hideable: false, track: '170px' },
  ],
}

export function getDefaultVisibility(screen: ColumnScreen): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const col of SCREEN_COLUMNS[screen]) {
    out[col.key] = true
  }
  return out
}

export function buildGridTemplateFromColumns(
  columns: readonly ColumnDef[],
  visibility: Record<string, boolean>,
): string {
  return columns
    .filter((col) => visibility[col.key] !== false)
    .map((col) => col.track)
    .join(' ')
}

export function buildGridTemplate(screen: ColumnScreen, visibility: Record<string, boolean>): string {
  return buildGridTemplateFromColumns(SCREEN_COLUMNS[screen], visibility)
}

function trackMinPx(track: string): number {
  const minmax = /minmax\((\d+)px/.exec(track)
  if (minmax) return Number(minmax[1])
  const px = /^(\d+)px$/.exec(track)
  if (px) return Number(px[1])
  return 120
}

/** Minimum table width so extra columns scroll instead of squeezing. */
export function gridMinWidthPx(
  columns: readonly ColumnDef[],
  visibility: Record<string, boolean>,
  gapPx = 10,
): number {
  const visible = columns.filter((col) => visibility[col.key] !== false)
  const tracks = visible.reduce((sum, col) => sum + trackMinPx(col.track), 0)
  const gaps = Math.max(0, visible.length - 1) * gapPx
  return tracks + gaps + 32
}

/** Insert custom lead-field columns before Actions so the grid matches the row. */
export function mergeLeadsColumns(extraColumns: readonly ColumnDef[]): ColumnDef[] {
  const base = SCREEN_COLUMNS.leads
  if (!extraColumns.length) return [...base]
  const actionsAt = base.findIndex((col) => col.key === 'actions')
  if (actionsAt < 0) return [...base, ...extraColumns]
  return [...base.slice(0, actionsAt), ...extraColumns, ...base.slice(actionsAt)]
}
