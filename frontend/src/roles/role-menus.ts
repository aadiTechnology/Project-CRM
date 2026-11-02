/** Friendly menu labels used on the Roles screen (matches the product demo). */

export type WorksLike = 'SALESPERSON' | 'MARKETING'

export const WORKS_LIKE_MENUS: Record<WorksLike, string[]> = {
  SALESPERSON: ['Reminders', 'Leads', 'Pipeline', 'Follow-ups', 'KPIs'],
  MARKETING: ['Campaigns'],
}

export const MATRIX_COLUMNS = [
  'Businesses',
  'Create businesses',
  'Plans',
  'Users',
  'Create users',
  'Roles',
  'Create roles',
  'Home',
  'Projects',
  'Team',
  'Campaigns',
  'Leads',
  'Pipeline',
  'Reminders',
  'Follow-ups',
  'KPIs',
  'Import',
  'Create projects',
  'Assign projects',
  'Assign salespeople',
] as const

export type MatrixColumn = (typeof MATRIX_COLUMNS)[number]

/** Fixed menus for the four product roles. */
export const SYSTEM_ROLE_MENUS: Record<string, string[]> = {
  SUPER_ADMIN: ['Businesses', 'Plans', 'Projects', 'Users', 'Roles', 'Team'],
  BUSINESS_OWNER: ['Home', 'Projects', 'Team', 'Leads', 'Pipeline', 'Follow-ups', 'KPIs'],
  MARKETING: ['Campaigns'],
  SALESPERSON: ['Projects', 'Reminders', 'Leads', 'Pipeline', 'Follow-ups', 'KPIs'],
}

/** Map a friendly menu tick to API permission keys when creating a custom role. */
export const MENU_TO_PERMISSIONS: Record<string, string[]> = {
  Reminders: ['features.read'],
  Leads: ['features.read', 'leads.read', 'leads.create', 'leads.update'],
  Pipeline: ['features.read', 'leads.read', 'leads.update'],
  'Follow-ups': ['features.read'],
  KPIs: ['features.read'],
  Campaigns: ['features.read'],
}

export function menusFromPermissions(keys: readonly string[]): string[] {
  const set = new Set(keys)
  const menus: string[] = []
  if (set.has('leads.create') || set.has('leads.read')) menus.push('Leads')
  if (set.has('leads.read') && set.has('leads.update')) menus.push('Pipeline')
  if (set.has('leads.read')) {
    for (const menu of ['Reminders', 'Follow-ups', 'KPIs']) menus.push(menu)
  }
  if (set.has('features.read') && !set.has('leads.read')) menus.push('Campaigns')
  return [...new Set(menus)]
}

export function permissionsFromMenus(menus: string[]): string[] {
  const keys = new Set<string>(['features.read'])
  for (const menu of menus) {
    for (const key of MENU_TO_PERMISSIONS[menu] ?? []) keys.add(key)
  }
  return [...keys]
}

export function roleMenus(roleName: string, permissionKeys: readonly string[], isSystem?: boolean): string[] {
  if (isSystem || roleName in SYSTEM_ROLE_MENUS) {
    return SYSTEM_ROLE_MENUS[roleName] ?? menusFromPermissions(permissionKeys)
  }
  return menusFromPermissions(permissionKeys)
}

export type CellValue = { yes: boolean; note?: string }

export function matrixCell(roleName: string, menus: string[], column: MatrixColumn): CellValue {
  if (column === 'Import') {
    return { yes: menus.includes('Leads') }
  }
  if (['Create businesses', 'Create projects', 'Create users', 'Create roles'].includes(column)) {
    return { yes: roleName === 'SUPER_ADMIN' }
  }
  if (column === 'Assign projects') {
    return { yes: roleName === 'BUSINESS_OWNER' || roleName === 'SUPER_ADMIN' }
  }
  if (column === 'Assign salespeople') {
    return { yes: roleName === 'BUSINESS_OWNER' }
  }
  const yes = menus.includes(column)
  if (yes && roleName === 'BUSINESS_OWNER' && ['Leads', 'Pipeline', 'Follow-ups', 'KPIs'].includes(column)) {
    return { yes: true, note: 'View only' }
  }
  return { yes }
}
