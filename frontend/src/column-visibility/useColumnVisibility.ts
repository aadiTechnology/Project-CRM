import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAuth } from '../store/auth-context'
import {
  ColumnDef,
  ColumnScreen,
  SCREEN_COLUMNS,
  buildGridTemplateFromColumns,
  getDefaultVisibility,
  mergeLeadsColumns,
} from './definitions'
import { loadColumnVisibility, resetColumnVisibility, saveColumnVisibility } from './storage'

export function useColumnVisibility(screen: ColumnScreen, extraColumns: readonly ColumnDef[] = []) {
  const { user } = useAuth()
  const userId = user?.id

  const columns = useMemo(() => {
    if (screen === 'leads') return mergeLeadsColumns(extraColumns)
    if (!extraColumns.length) return SCREEN_COLUMNS[screen]
    return [...SCREEN_COLUMNS[screen], ...extraColumns]
  }, [extraColumns, screen])

  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => getDefaultVisibility(screen))
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    const result = loadColumnVisibility(userId, screen)
    setVisibility(result.visibility)
    setLoadError(result.loadError)
    setSaveError(false)
  }, [userId, screen])

  const persist = useCallback(
    (next: Record<string, boolean>) => {
      const ok = saveColumnVisibility(userId, screen, next)
      setSaveError(!ok && Boolean(userId))
      return ok
    },
    [userId, screen],
  )

  const toggle = useCallback(
    (key: string) => {
      const def = columns.find((col) => col.key === key)
      if (!def || !def.hideable) return
      setVisibility((current) => {
        const next = { ...current, [key]: current[key] === false }
        persist(next)
        return next
      })
    },
    [columns, persist],
  )

  const reset = useCallback(() => {
    const result = resetColumnVisibility(userId, screen)
    const next = { ...result.visibility }
    for (const col of extraColumns) {
      next[col.key] = true
    }
    setVisibility(next)
    if (extraColumns.length) persist(next)
    setSaveError(!result.ok && Boolean(userId))
  }, [extraColumns, persist, screen, userId])

  const clearSaveError = useCallback(() => setSaveError(false), [])
  const clearLoadError = useCallback(() => setLoadError(false), [])

  const isVisible = useCallback((key: string) => visibility[key] !== false, [visibility])

  const gridTemplateMd = useMemo(
    () => buildGridTemplateFromColumns(columns, visibility),
    [columns, visibility],
  )

  /** Phone layouts that keep only locked + lead tracks. */
  const gridTemplateXs = useMemo(() => {
    if (screen === 'reminders') return '22px minmax(0,1fr)'
    if (screen === 'leads') return 'minmax(0,1fr)'
    return 'minmax(0,1fr)'
  }, [screen])

  return {
    columns,
    visibility,
    isVisible,
    toggle,
    reset,
    gridTemplateMd,
    gridTemplateXs,
    loadError,
    saveError,
    clearSaveError,
    clearLoadError,
  }
}
