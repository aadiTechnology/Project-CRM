import { Navigate } from 'react-router-dom'

/** Old sidebar route — field setup now lives on Leads → Manage fields. */
export function LeadFieldsPage() {
  return <Navigate to="/app/leads?manageFields=1" replace />
}
