/** Built-in lead fields — custom project fields with these labels/keys must not show again on forms. */
const BUILTIN_LABELS = new Set([
  'call summary',
  'contact person',
  'contact person name',
  'full name',
  'mobile',
  'mobile number',
  'email',
  'requirement',
  'lead source',
  'source',
  'priority',
  'status',
  'enquiry date',
  'location',
  'city',
  'reference',
  'next follow-up',
  'follow-up',
  'follow up',
  // Previously hidden custom fields that collide with product UI
  'selling point',
  'interested product',
  'student strength',
  'no of branch',
  'no. of branch',
  'number of branch',
  'number of branches',
])

const BUILTIN_KEYS = new Set([
  'call_summary',
  'full_name',
  'mobile',
  'email',
  'requirement',
  'lead_source',
  'priority',
  'status',
  'enquiry_date',
  'city',
  'reference_name',
  'next_followup_at',
])

export function isDuplicateBuiltinLeadField(label: string, key?: string) {
  if (key && BUILTIN_KEYS.has(key.trim().toLowerCase())) return true
  return BUILTIN_LABELS.has(label.trim().toLowerCase())
}

/** Prefer built-in call_summary; fall back to a legacy custom "Call Summary" extra value. */
export function resolveCallSummary(
  callSummary: string | null | undefined,
  extraValues?: Record<string, unknown> | null,
): string {
  const builtin = (callSummary ?? '').trim()
  if (builtin) return builtin
  if (!extraValues) return ''
  for (const [key, raw] of Object.entries(extraValues)) {
    const norm = key.trim().toLowerCase()
    if (norm !== 'call_summary' && !norm.startsWith('call_summary')) continue
    const text = Array.isArray(raw)
      ? raw.map(String).join(', ')
      : raw == null
        ? ''
        : String(raw)
    if (text.trim()) return text.trim()
  }
  return ''
}
