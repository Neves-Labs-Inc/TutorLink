import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/components/auth/AuthProvider'
import { RouteGuard } from '@/components/layout/RouteGuard'
import { AppShell } from '@/components/layout/AppShell'
import { ADMIN_ROLES, OFFICE_ROLES } from '@/lib/auth/auth'
import { Login } from '@/pages/Login'
import ForgotPassword from '@/pages/ForgotPassword'
import SetPassword from '@/pages/SetPassword'
import { Dashboard } from '@/pages/admin/Dashboard'
import { Tutors } from '@/pages/admin/Tutors'
import { TutorDetail } from '@/pages/admin/TutorDetail'
import { Children } from '@/pages/admin/Children'
import { ChildDetail } from '@/pages/admin/ChildDetail'
import { Guardians } from '@/pages/admin/Guardians'
import { GuardianDetail } from '@/pages/admin/GuardianDetail'
import { ChatsLayout } from '@/components/chat/ChatsLayout'
import { ChatThread } from '@/pages/admin/ChatThread'
import { Bookings } from '@/pages/admin/Bookings'
import { Reminders } from '@/pages/admin/Reminders'
import { Users } from '@/pages/admin/Users'
import { Settings } from '@/pages/admin/Settings'
import { Schedule } from '@/pages/tutor/Schedule'
import { Sessions } from '@/pages/tutor/Sessions'
import { TimeOff } from '@/pages/tutor/TimeOff'
import { NotFound } from '@/pages/NotFound'
import { VisualDirectionPrototype } from '@/pages/prototype/visual-direction/VisualDirectionPrototype'
import HomePrototype from '@/pages/prototype/home/home-prototype'
import BookingsPrototype from '@/pages/prototype/bookings/bookings-prototype'
import ChatsPrototype from '@/pages/prototype/chats/chats-prototype'
import SettingsPrototype from '@/pages/prototype/settings/settings-prototype'
import TutorTimeOffPrototype from '@/pages/prototype/tutor-timeoff/tutor-timeoff-prototype'
import AuthPrototype from '@/pages/prototype/auth/auth-prototype'
import AccountsStaffPrototype from '@/pages/prototype/accounts-staff/accounts-staff-prototype'

export const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/set-password" element={<SetPassword />} />
        <Route
          path="/dashboard"
          element={
            <RouteGuard allow={OFFICE_ROLES}>
              <AppShell>
                <Dashboard />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/tutors"
          element={
            <RouteGuard allow={OFFICE_ROLES}>
              <AppShell>
                <Tutors />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/tutors/:id"
          element={
            <RouteGuard allow={OFFICE_ROLES}>
              <AppShell>
                <TutorDetail />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/children"
          element={
            <RouteGuard allow={OFFICE_ROLES}>
              <AppShell>
                <Children />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/children/:id"
          element={
            <RouteGuard allow={OFFICE_ROLES}>
              <AppShell>
                <ChildDetail />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/guardians"
          element={
            <RouteGuard allow={OFFICE_ROLES}>
              <AppShell>
                <Guardians />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/guardians/:id"
          element={
            <RouteGuard allow={OFFICE_ROLES}>
              <AppShell>
                <GuardianDetail />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/chats"
          element={
            <RouteGuard allow={OFFICE_ROLES}>
              <AppShell>
                <ChatsLayout />
              </AppShell>
            </RouteGuard>
          }
        >
          <Route path=":id" element={<ChatThread />} />
        </Route>
        <Route
          path="/bookings"
          element={
            <RouteGuard allow={OFFICE_ROLES}>
              <AppShell>
                <Bookings />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/reminders"
          element={
            <RouteGuard allow={OFFICE_ROLES}>
              <AppShell>
                <Reminders />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/users"
          element={
            <RouteGuard allow={ADMIN_ROLES}>
              <AppShell>
                <Users />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/settings"
          element={
            <RouteGuard allow={ADMIN_ROLES}>
              <AppShell>
                <Settings />
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
        <Route
          path="/sessions"
          element={
            <RouteGuard allow={['tutor']}>
              <AppShell>
                <Sessions />
              </AppShell>
            </RouteGuard>
          }
        />
        <Route
          path="/time-off"
          element={
            <RouteGuard allow={['tutor']}>
              <AppShell>
                <TimeOff />
              </AppShell>
            </RouteGuard>
          }
        />
        {import.meta.env.DEV && (
          <Route path="/prototype/visual-direction" element={<VisualDirectionPrototype />} />
        )}
        {import.meta.env.DEV && (
          <Route path="/prototype/home" element={<HomePrototype />} />
        )}
        {import.meta.env.DEV && (
          <Route path="/prototype/bookings" element={<BookingsPrototype />} />
        )}
        {import.meta.env.DEV && (
          <Route path="/prototype/chats" element={<ChatsPrototype />} />
        )}
        {import.meta.env.DEV && (
          <Route path="/prototype/settings" element={<SettingsPrototype />} />
        )}
        {import.meta.env.DEV && (
          <Route path="/prototype/tutor-timeoff" element={<TutorTimeOffPrototype />} />
        )}
        {import.meta.env.DEV && (
          <Route path="/prototype/auth" element={<AuthPrototype />} />
        )}
        {import.meta.env.DEV && (
          <Route path="/prototype/accounts-staff" element={<AccountsStaffPrototype />} />
        )}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
)
