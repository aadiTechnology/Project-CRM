export type LeadFieldType =
  | 'text'
  | 'area'
  | 'number'
  | 'email'
  | 'phone'
  | 'select'
  | 'multi'
  | 'radio'
  | 'check'
  | 'date'
  | 'url'

export const FIELD_TYPE_OPTIONS: { value: LeadFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'area', label: 'Textarea' },
  { value: 'number', label: 'Number' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'select', label: 'Dropdown' },
  { value: 'multi', label: 'Multi-select' },
  { value: 'radio', label: 'Radio button' },
  { value: 'check', label: 'Checkbox (yes/no)' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
]

export const OPTION_TYPES = new Set<LeadFieldType>(['select', 'multi', 'radio'])

export interface LeadField {
  id: string
  project_id: string
  key: string
  label: string
  field_type: LeadFieldType
  field_type_label: string
  options: string[] | null
  is_required: boolean
  show_in_list: boolean
  show_as_column: boolean
  is_active: boolean
  sort_order: number
  leads_with_data: number
}

export interface LeadFieldList {
  project_id: string
  project_name: string
  project_code: string
  common_fields: string[]
  items: LeadField[]
}

export interface LeadFieldProjectOption {
  id: string
  name: string
  code: string
}
