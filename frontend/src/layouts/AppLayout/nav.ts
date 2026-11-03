import type { SvgIconComponent } from '@mui/icons-material'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined'
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined'
import DomainOutlinedIcon from '@mui/icons-material/DomainOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined'
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined'
import PersonSearchOutlinedIcon from '@mui/icons-material/PersonSearchOutlined'
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined'
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined'
import WorkOutlineOutlinedIcon from '@mui/icons-material/WorkOutlineOutlined'

export const SECTIONS = ['menu'] as const
export type NavSection = (typeof SECTIONS)[number]

const SUPER_ADMIN = ['SUPER_ADMIN'] as const
const OWNER = ['BUSINESS_OWNER'] as const
const SALES = ['SALESPERSON'] as const
const MARKETING = ['MARKETING'] as const

const ROLE_RANK = ['SUPER_ADMIN', 'BUSINESS_OWNER', 'SALESPERSON', 'MARKETING'] as const

export type NavItem = {
  id: string
  path: string
  section: NavSection
  roles: readonly string[]
  permission?: string
  always?: boolean
  ready?: boolean
  icon: SvgIconComponent
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'businesses', path: '/app/businesses', section: 'menu', roles: SUPER_ADMIN, ready: true, icon: DomainOutlinedIcon },
  { id: 'home', path: '/app', section: 'menu', roles: OWNER, icon: HomeOutlinedIcon },
  { id: 'projects', path: '/app/projects', section: 'menu', roles: [...SUPER_ADMIN, ...OWNER, ...SALES], ready: true, icon: WorkOutlineOutlinedIcon },
  {
    id: 'users',
    path: '/app/users',
    section: 'menu',
    roles: SUPER_ADMIN,
    ready: true,
    icon: PeopleAltOutlinedIcon,
  },
  {
    id: 'roles',
    path: '/app/roles',
    section: 'menu',
    roles: SUPER_ADMIN,
    ready: true,
    icon: ManageAccountsOutlinedIcon,
  },
  {
    id: 'team',
    path: '/app/team',
    section: 'menu',
    roles: [...SUPER_ADMIN, ...OWNER],
    ready: true,
    icon: GroupsOutlinedIcon,
  },
  { id: 'reminders', path: '/app/reminders', section: 'menu', roles: SALES, ready: true, icon: TodayOutlinedIcon },
  { id: 'leads', path: '/app/leads', section: 'menu', roles: [...OWNER, ...SALES], ready: true, icon: PersonSearchOutlinedIcon },
  { id: 'pipeline', path: '/app/pipeline', section: 'menu', roles: [...OWNER, ...SALES], ready: true, icon: AccountTreeOutlinedIcon },
  { id: 'followUps', path: '/app/follow-ups', section: 'menu', roles: [...OWNER, ...SALES], ready: true, icon: TaskAltOutlinedIcon },
  // KPIs hidden from sidebar for now (route still available)
  { id: 'kpis', path: '/app/kpis', section: 'menu', roles: [...OWNER, ...SALES], ready: false, icon: AssessmentOutlinedIcon },
  { id: 'campaigns', path: '/app/campaigns', section: 'menu', roles: MARKETING, icon: CampaignOutlinedIcon },
]

export function primaryRole(roles: readonly string[]): string | null {
  return ROLE_RANK.find((role) => roles.includes(role)) ?? roles[0] ?? null
}

/** First screen after login / brand click — not a shared Workspace for every role. */
export function homePathForRoles(roles: readonly string[]): string {
  const role = primaryRole(roles)
  switch (role) {
    case 'SUPER_ADMIN':
      return '/app/businesses'
    case 'BUSINESS_OWNER':
      return '/app'
    case 'SALESPERSON':
      return '/app/projects'
    case 'MARKETING':
      return '/app/campaigns'
    default: {
      const first = visibleNav(roles)[0]
      return first?.path ?? '/app'
    }
  }
}

export function visibleNav(roles: readonly string[], permissions: readonly string[] = []): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.ready === false) return false
    if (item.always) return true
    if (item.roles.some((role) => roles.includes(role))) return true
    return item.permission ? permissions.includes(item.permission) : false
  })
}

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.id === 'home') return pathname === '/app' || pathname === '/app/'
  return pathname === item.path || pathname.startsWith(`${item.path}/`)
}
