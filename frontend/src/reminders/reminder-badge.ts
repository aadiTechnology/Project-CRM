/** While Reminders is open, the sidebar uses this count instead of the all-projects total. */
type Listener = (count: number | null) => void

let override: number | null = null
const listeners = new Set<Listener>()
const refreshListeners = new Set<() => void>()

export function setReminderBadge(count: number | null) {
  override = count
  listeners.forEach((listener) => listener(count))
}

/** Ask the sidebar to reload the reminder count after a save on another page. */
export function refreshReminderBadge() {
  refreshListeners.forEach((listener) => listener())
}

export function subscribeReminderRefresh(listener: () => void) {
  refreshListeners.add(listener)
  return () => {
    refreshListeners.delete(listener)
  }
}

export function subscribeReminderBadge(listener: Listener) {
  listener(override)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
