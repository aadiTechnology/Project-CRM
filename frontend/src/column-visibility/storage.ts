import { ColumnScreen, SCREEN_COLUMNS, getDefaultVisibility } from './definitions'

const STORAGE_PREFIX = 'aaditech.columnVisibility.v1'
const STORAGE_VERSION = 1

type StoredPayload = {
  v: number
  columns: Record<string, boolean>
}

export function storageKey(userId: string, screen: ColumnScreen) {
  return `${STORAGE_PREFIX}.${userId}.${screen}`
}

function isExtraColumnKey(key: string) {
  return key.startsWith('extra:')
}

function coerceVisibility(screen: ColumnScreen, raw: Record<string, boolean> | undefined): Record<string, boolean> {
  const defaults = getDefaultVisibility(screen)
  const next = { ...defaults }
  const allowed = new Set(SCREEN_COLUMNS[screen].map((col) => col.key))

  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (isExtraColumnKey(key)) {
        next[key] = Boolean(value)
        continue
      }
      if (!allowed.has(key)) continue
      const def = SCREEN_COLUMNS[screen].find((col) => col.key === key)
      if (!def) continue
      if (!def.hideable) {
        next[key] = true
        continue
      }
      next[key] = Boolean(value)
    }
  }

  for (const col of SCREEN_COLUMNS[screen]) {
    if (!col.hideable) next[col.key] = true
  }
  return next
}

export function loadColumnVisibility(
  userId: string | null | undefined,
  screen: ColumnScreen,
): { visibility: Record<string, boolean>; loadError: boolean } {
  const defaults = getDefaultVisibility(screen)
  if (!userId) return { visibility: defaults, loadError: false }

  try {
    const raw = localStorage.getItem(storageKey(userId, screen))
    if (!raw) return { visibility: defaults, loadError: false }
    const parsed = JSON.parse(raw) as StoredPayload
    if (!parsed || parsed.v !== STORAGE_VERSION || typeof parsed.columns !== 'object') {
      return { visibility: defaults, loadError: true }
    }
    return { visibility: coerceVisibility(screen, parsed.columns), loadError: false }
  } catch {
    return { visibility: defaults, loadError: true }
  }
}

export function saveColumnVisibility(
  userId: string | null | undefined,
  screen: ColumnScreen,
  visibility: Record<string, boolean>,
): boolean {
  if (!userId) return false
  try {
    const coerced = coerceVisibility(screen, visibility)
    const columns: Record<string, boolean> = {}
    for (const col of SCREEN_COLUMNS[screen]) {
      if (!col.hideable) continue
      columns[col.key] = coerced[col.key] !== false
    }
    for (const [key, value] of Object.entries(visibility)) {
      if (!isExtraColumnKey(key)) continue
      columns[key] = value !== false
    }
    const payload: StoredPayload = { v: STORAGE_VERSION, columns }
    localStorage.setItem(storageKey(userId, screen), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function resetColumnVisibility(
  userId: string | null | undefined,
  screen: ColumnScreen,
): { visibility: Record<string, boolean>; ok: boolean } {
  const visibility = getDefaultVisibility(screen)
  const ok = saveColumnVisibility(userId, screen, visibility)
  return { visibility, ok }
}
