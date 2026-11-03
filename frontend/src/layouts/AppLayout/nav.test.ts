import { describe, expect, it } from 'vitest'

import { homePathForRoles, visibleNav } from './nav'

function ids(roles: string[], permissions: string[] = []) {
  return visibleNav(roles, permissions).map((item) => item.id)
}

describe('homePathForRoles', () => {
  it('sends each role to their working screen, not a shared workspace', () => {
    expect(homePathForRoles(['SUPER_ADMIN'])).toBe('/app/businesses')
    expect(homePathForRoles(['BUSINESS_OWNER'])).toBe('/app')
    expect(homePathForRoles(['SALESPERSON'])).toBe('/app/projects')
    expect(homePathForRoles(['MARKETING'])).toBe('/app/campaigns')
  })

  it('prefers the highest-ranked role when several are present', () => {
    expect(homePathForRoles(['SALESPERSON', 'SUPER_ADMIN'])).toBe('/app/businesses')
  })
})

describe('visibleNav', () => {
  it('gives a salesperson their lead menu and hides setup', () => {
    expect(ids(['SALESPERSON'])).toEqual([
      'projects',
      'reminders',
      'leads',
      'pipeline',
      'followUps',
    ])
  })

  it('gives a business owner the team and a view of every lead', () => {
    expect(ids(['BUSINESS_OWNER'])).toEqual([
      'home',
      'projects',
      'team',
      'leads',
      'pipeline',
      'followUps',
    ])
  })

  it('gives a super admin businesses, projects, users, roles, and team', () => {
    expect(ids(['SUPER_ADMIN'])).toEqual(['businesses', 'projects', 'users', 'roles', 'team'])
  })

  it('gives marketing campaigns only', () => {
    expect(ids(['MARKETING'])).toEqual(['campaigns'])
  })

  it('does not add setup menus because a salesperson can read users', () => {
    expect(ids(['SALESPERSON'], ['users.read'])).not.toContain('users')
    expect(ids(['SALESPERSON'], ['users.read'])).not.toContain('businesses')
  })
})
