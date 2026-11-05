import { Navigate, Route, Routes } from 'react-router-dom'

import { GuestRoute, PermissionRoute, ProtectedRoute, RoleRoute } from '../../access/components/RouteGuards'
import { AccessDeniedPage } from '../../access/pages/AccessDeniedPage'
import { HomePage } from '../../access/pages/HomePage'
import { BusinessesPage } from '../../businesses/pages/BusinessesPage'
import { FollowUpsPage } from '../../follow-ups/pages/FollowUpsPage'
import { LeadFieldsPage } from '../../lead-fields/pages/LeadFieldsPage'
import { LeadsPage } from '../../leads/pages/LeadsPage'
import { KpisPage } from '../../kpis/pages/KpisPage'
import { PipelinePage } from '../../pipeline/pages/PipelinePage'
import { ProjectsPage } from '../../projects/pages/ProjectsPage'
import { RemindersPage } from '../../reminders/pages/RemindersPage'
import { RolesPage } from '../../roles/pages/RolesPage'
import { TeamPage } from '../../team/pages/TeamPage'
import { UsersPage } from '../../users/pages/UsersPage'
import { ForgotPasswordPage } from '../../auth/pages/ForgotPasswordPage'
import { LoginPage } from '../../auth/pages/LoginPage'
import { RegisterPage } from '../../auth/pages/RegisterPage'
import { ResetPasswordPage } from '../../auth/pages/ResetPasswordPage'
import { LoadingScreen } from '../../components/common/LoadingScreen'
import { NotFoundPage } from '../../components/common/NotFoundPage'
import { AppLayout } from '../../layouts/AppLayout/AppLayout'
import { AuthLayout } from '../../layouts/AuthLayout/AuthLayout'
import { NAV_ITEMS, homePathForRoles } from '../../layouts/AppLayout/nav'
import { NavPlaceholder } from '../../layouts/AppLayout/NavPlaceholder'
import { useAuth } from '../../store/auth-context'

function RootRedirect() {
  const { status, user } = useAuth()
  if (status === 'loading') {
    return <LoadingScreen />
  }
  if (status === 'authenticated') {
    return <Navigate to={homePathForRoles(user?.roles ?? [])} replace />
  }
  return <Navigate to="/login" replace />
}

function HomeIndex() {
  const { user } = useAuth()
  const roles = user?.roles ?? []
  if (!roles.includes('BUSINESS_OWNER')) {
    return <Navigate to={homePathForRoles(roles)} replace />
  }
  return <HomePage />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
        <Route path="/forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<HomeIndex />} />
        <Route path="access-denied" element={<AccessDeniedPage />} />
        <Route
          path="businesses"
          element={
            <RoleRoute roles={['SUPER_ADMIN']}>
              <BusinessesPage />
            </RoleRoute>
          }
        />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="lead-fields" element={<LeadFieldsPage />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="follow-ups" element={<FollowUpsPage />} />
        <Route
          path="kpis"
          element={
            <PermissionRoute permission="leads.read">
              <KpisPage />
            </PermissionRoute>
          }
        />
        <Route
          path="users"
          element={
            <PermissionRoute permission="users.read">
              <UsersPage />
            </PermissionRoute>
          }
        />
        <Route
          path="roles"
          element={
            <PermissionRoute permission="roles.read">
              <RolesPage />
            </PermissionRoute>
          }
        />
        <Route path="admin/access" element={<Navigate to="/app/users" replace />} />
        {NAV_ITEMS.filter(
          (item) =>
            item.id !== 'home' &&
            item.id !== 'users' &&
            item.id !== 'roles' &&
            item.id !== 'projects' &&
            item.id !== 'team' &&
            item.id !== 'leads' &&
            item.id !== 'pipeline' &&
            item.id !== 'reminders' &&
            item.id !== 'followUps' &&
            item.id !== 'kpis' &&
            item.id !== 'businesses',
        ).map((item) => (
          <Route key={item.id} path={item.path.replace('/app/', '')} element={<NavPlaceholder id={item.id} />} />
        ))}
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
