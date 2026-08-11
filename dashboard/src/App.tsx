import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RouteGuard } from '@/components/layout/RouteGuard'
import { AppShell } from '@/components/layout/AppShell'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/admin/Dashboard'
import { Schedule } from '@/pages/tutor/Schedule'
import { NotFound } from '@/pages/NotFound'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <RouteGuard allow={['admin']}>
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
    </BrowserRouter>
  )
}

export default App
