export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'in_progress'
  | 'qualified'
  | 'won'
  | 'lost'
  | 'nurture'
  | 'unqualified'
  | (string & {})
export type LeadPriority = 'low' | 'medium' | 'high'

export interface Lead {
  id: string
  company_id: string
  project_id: string | null
  project_name: string | null
  lead_number: string
  full_name: string
  mobile: string
  alternate_mobile: string | null
  email: string | null
  company_name: string | null
  city: string | null
  address: string | null
  requirement: string | null
  expected_value: string | null
  enquiry_date: string | null
  reference_name: string | null
  call_summary: string | null
  lead_source: string | null
  owner_id: string
  created_by_id: string
  status: LeadStatus
  priority: LeadPriority
  plan_step: string
  next_followup_at: string | null
  extra_values: Record<string, unknown>
  is_deleted: boolean
  created_at: string
  updated_at: string
}

export interface LeadProjectOption {
  id: string
  name: string
  code: string
  company_id: string
  company_name: string
}

export const LEAD_SOURCES = [
  'Website',
  'WhatsApp',
  'Instagram',
  'Facebook',
  'Referral',
  'Walk-in',
  'Phone call',
  'Google',
  'Campaign',
  'Other',
] as const

export interface LeadList {
  items: Lead[]
  total: number
}

export const LEAD_STATUSES: LeadStatus[] = [
  'new',
  'contacted',
  'in_progress',
  'qualified',
  'won',
  'lost',
  'nurture',
]
export const LEAD_PRIORITIES: LeadPriority[] = ['high', 'medium', 'low']

export const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  in_progress: 'In Progress',
  qualified: 'Qualified',
  won: 'Won',
  lost: 'Lost',
  nurture: 'Nurture',
  unqualified: 'Unqualified',
}

export const PRIORITY_LABEL: Record<LeadPriority, string> = {
  high: 'Hot',
  medium: 'Warm',
  low: 'Cold',
}

export const PRIORITY_TONE: Record<LeadPriority, { bg: string; color: string }> = {
  high: { bg: '#fee2e2', color: '#b91c1c' },
  medium: { bg: '#ffedd5', color: '#c2410c' },
  low: { bg: '#dbeafe', color: '#1d4ed8' },
}

export const STATUS_TONE: Record<string, { bg: string; color: string }> = {
  new: { bg: '#e0e7ff', color: '#3730a3' },
  contacted: { bg: '#dbeafe', color: '#1d4ed8' },
  in_progress: { bg: '#ffedd5', color: '#c2410c' },
  qualified: { bg: '#d1fae5', color: '#047857' },
  won: { bg: '#a7f3d0', color: '#065f46' },
  lost: { bg: '#fee2e2', color: '#b91c1c' },
  nurture: { bg: '#ede9fe', color: '#5b21b6' },
  unqualified: { bg: '#f1f5f9', color: '#475569' },
}
