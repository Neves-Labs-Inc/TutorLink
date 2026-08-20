import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/components/auth/AuthProvider'
import { RouteGuard } from '@/components/layout/RouteGuard'
import { AppShell } from '@/components/layout/AppShell'
import { ADMIN_ROLES } from '@/lib/auth'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/admin/Dashboard'
import { Schedule } from '@/pages/tutor/Schedule'
import { NotFound } from '@/pages/NotFound'

export const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <RouteGuard allow={ADMIN_ROLES}>
              <AppShell>
                <Dashboard />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/schedule"
          element={
            <RouteGuard allow={['tutor']}>
              <AppShell>
                <Schedule />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
)
