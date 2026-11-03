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
    { key: 'lead', label: 'Lead', hideable: false, track: 'minmax(0,1.4fr)' },
    { key: 'project', label: 'Project', hideable: true, track: '120px' },
    { key: 'phone', label: 'Phone', hideable: true, track: '120px' },
    { key: 'status', label: 'Status', hideable: true, track: '104px' },
    { key: 'priority', label: 'Priority', hideable: true, track: '84px' },
    { key: 'follow_up', label: 'Follow-up', hideable: true, track: '100px' },
    { key: 'source', label: 'Source', hideable: true, track: '96px' },
    { key: 'actions', label: 'Actions', hideable: false, track: '44px' },
  ],
  reminders: [
    { key: 'checkbox', label: 'Select', hideable: false, track: '22px' },
    { key: 'lead', label: 'Lead', hideable: false, track: 'minmax(0,1fr)' },
    { key: 'project', label: 'Project', hideable: true, track: '120px' },
    { key: 'phone', label: 'Phone', hideable: true, track: '120px' },
    { key: 'priority', label: 'Priority', hideable: true, track: '84px' },
    { key: 'due', label: 'Due', hideable: true, track: '100px' },
    { key: 'status', label: 'Status', hideable: true, track: '108px' },
    { key: 'actions', label: 'Actions', hideable: false, track: '210px' },
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

/** Append custom lead-field columns after the base Leads columns. */
export function mergeLeadsColumns(extraColumns: readonly ColumnDef[]): ColumnDef[] {
  const base = SCREEN_COLUMNS.leads
  if (!extraColumns.length) return [...base]
  return [...base, ...extraColumns]
}
