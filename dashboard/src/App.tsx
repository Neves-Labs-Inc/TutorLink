import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/components/auth/AuthProvider";
import AppLayout from "@/components/layout/app-layout";
import LegacyPage from "@/components/layout/legacy-page";
import { RouteGuard } from "@/components/layout/RouteGuard";
import { ADMIN_ROLES, OFFICE_ROLES, ROLES } from "@/lib/auth/auth";
import type { Role } from "@/lib/auth/auth";
import { Login } from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import SetPassword from "@/pages/SetPassword";
import { Dashboard } from "@/pages/admin/Dashboard";
import { Tutors } from "@/pages/admin/Tutors";
import { TutorDetail } from "@/pages/admin/TutorDetail";
import { Children } from "@/pages/admin/Children";
import { ChildDetail } from "@/pages/admin/ChildDetail";
import { Guardians } from "@/pages/admin/Guardians";
import { GuardianDetail } from "@/pages/admin/GuardianDetail";
import { ChatsLayout } from "@/components/chat/ChatsLayout";
import { ChatThread } from "@/pages/admin/ChatThread";
import { Bookings } from "@/pages/admin/Bookings";
import { Reminders } from "@/pages/admin/Reminders";
import { Users } from "@/pages/admin/Users";
import { Settings } from "@/pages/admin/Settings";
import { Schedule } from "@/pages/tutor/Schedule";
import { Sessions } from "@/pages/tutor/Sessions";
import { TimeOff } from "@/pages/tutor/TimeOff";
import { NotFound } from "@/pages/NotFound";
import ProfilePage from "@/pages/profile/profile-page";
import { VisualDirectionPrototype } from "@/pages/prototype/visual-direction/VisualDirectionPrototype";
import HomePrototype from "@/pages/prototype/home/home-prototype";
import BookingsPrototype from "@/pages/prototype/bookings/bookings-prototype";
import ChatsPrototype from "@/pages/prototype/chats/chats-prototype";
import SettingsPrototype from "@/pages/prototype/settings/settings-prototype";
import TutorTimeOffPrototype from "@/pages/prototype/tutor-timeoff/tutor-timeoff-prototype";
import AuthPrototype from "@/pages/prototype/auth/auth-prototype";
import AccountsStaffPrototype from "@/pages/prototype/accounts-staff/accounts-staff-prototype";

const TUTOR_ONLY: readonly Role[] = ["tutor"];

// An old screen, for the roles that may open it.
function renderLegacy(allow: readonly Role[], screen: ReactNode): ReactNode {
  return (
    <RouteGuard allow={allow}>
      <LegacyPage>{screen}</LegacyPage>
    </RouteGuard>
  );
}

export const App = (): ReactNode => (
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/set-password" element={<SetPassword />} />
        {/* Every signed-in screen renders inside the one shell; each
            route below still guards its own roles. */}
        <Route
          element={
            <RouteGuard allow={ROLES}>
              <AppLayout />
            </RouteGuard>
          }
        >
          <Route
            path="/dashboard"
            element={renderLegacy(OFFICE_ROLES, <Dashboard />)}
          />
          <Route
            path="/bookings"
            element={renderLegacy(OFFICE_ROLES, <Bookings />)}
          />
          <Route
            path="/chats"
            element={renderLegacy(OFFICE_ROLES, <ChatsLayout />)}
          >
            <Route path=":id" element={<ChatThread />} />
          </Route>
          <Route
            path="/reminders"
            element={renderLegacy(OFFICE_ROLES, <Reminders />)}
          />
          <Route
            path="/children"
            element={renderLegacy(OFFICE_ROLES, <Children />)}
          />
          <Route
            path="/children/:id"
            element={renderLegacy(OFFICE_ROLES, <ChildDetail />)}
          />
          <Route
            path="/guardians"
            element={renderLegacy(OFFICE_ROLES, <Guardians />)}
          />
          <Route
            path="/guardians/:id"
            element={renderLegacy(OFFICE_ROLES, <GuardianDetail />)}
          />
          <Route
            path="/tutors"
            element={renderLegacy(OFFICE_ROLES, <Tutors />)}
          />
          <Route
            path="/tutors/:id"
            element={renderLegacy(OFFICE_ROLES, <TutorDetail />)}
          />
          <Route path="/users" element={renderLegacy(ADMIN_ROLES, <Users />)} />
          <Route
            path="/settings"
            element={renderLegacy(ADMIN_ROLES, <Settings />)}
          />
          <Route
            path="/sessions"
            element={renderLegacy(TUTOR_ONLY, <Sessions />)}
          />
          <Route
            path="/schedule"
            element={renderLegacy(TUTOR_ONLY, <Schedule />)}
          />
          <Route
            path="/time-off"
            element={renderLegacy(TUTOR_ONLY, <TimeOff />)}
          />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        {import.meta.env.DEV && (
          <Route
            path="/prototype/visual-direction"
            element={<VisualDirectionPrototype />}
          />
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
          <Route
            path="/prototype/tutor-timeoff"
            element={<TutorTimeOffPrototype />}
          />
        )}
        {import.meta.env.DEV && (
          <Route path="/prototype/auth" element={<AuthPrototype />} />
        )}
        {import.meta.env.DEV && (
          <Route
            path="/prototype/accounts-staff"
            element={<AccountsStaffPrototype />}
          />
        )}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);
