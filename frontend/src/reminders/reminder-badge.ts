/** While Reminders is open, the sidebar uses this count instead of the all-projects total. */
type Listener = (count: number | null) => void

let override: number | null = null
const listeners = new Set<Listener>()

export function setReminderBadge(count: number | null) {
  override = count
  listeners.forEach((listener) => listener(count))
}

export function subscribeReminderBadge(listener: Listener) {
  listener(override)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
