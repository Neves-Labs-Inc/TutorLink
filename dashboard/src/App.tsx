import type { ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { AuthProvider } from "@/components/auth/AuthProvider";
import AppLayout from "@/components/layout/app-layout";
import LegacyPage from "@/components/layout/legacy-page";
import { RouteGuard } from "@/components/layout/RouteGuard";
import { OFFICE_ROLES, ROLES } from "@/lib/auth/auth";
import type { Role } from "@/lib/auth/auth";
import SignInPage from "@/pages/auth/sign-in-page";
import ForgotPasswordPage from "@/pages/auth/forgot-password-page";
import SetPasswordPage from "@/pages/set-password/set-password-page";
import { Dashboard } from "@/pages/admin/Dashboard";
import { Bookings } from "@/pages/admin/Bookings";
import ChatsPage from "@/pages/chats/chats-page";
import { TimeOff } from "@/pages/tutor/TimeOff";
import NotFoundPage from "@/pages/not-found/not-found-page";
import ProfilePage from "@/pages/profile/profile-page";
import SettingsPage from "@/pages/settings/settings-page";
import FamiliesPage from "@/pages/families/families-page";
import FamilyPage from "@/pages/families/family-page";
import LegacyRedirect from "@/pages/families/legacy-redirect";
import AvailabilityPage from "@/pages/availability/availability-page";
import StaffPage from "@/pages/staff/staff-page";
import TutorRedirect from "@/pages/staff/tutor-redirect";
import MySessionsPage from "@/pages/sessions/my-sessions-page";
import { VisualDirectionPrototype } from "@/pages/prototype/visual-direction/VisualDirectionPrototype";
import HomePrototype from "@/pages/prototype/home/home-prototype";
import BookingsPrototype from "@/pages/prototype/bookings/bookings-prototype";
import ChatsPrototype from "@/pages/prototype/chats/chats-prototype";
import TutorTimeOffPrototype from "@/pages/prototype/tutor-timeoff/tutor-timeoff-prototype";
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

// The old Reminders URL, keeping ?week=.
function RedirectToReminders(): ReactNode {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/chats/reminders", search }} replace />;
}

export const App = (): ReactNode => (
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<SignInPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
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
            path="/home"
            element={renderLegacy(OFFICE_ROLES, <Dashboard />)}
          />
          <Route path="/dashboard" element={<Navigate to="/home" replace />} />
          <Route
            path="/bookings"
            element={renderLegacy(OFFICE_ROLES, <Bookings />)}
          />
          <Route
            path="/chats"
            element={
              <RouteGuard allow={OFFICE_ROLES}>
                <ChatsPage tab="conversations" />
              </RouteGuard>
            }
          />
          <Route
            path="/chats/reminders"
            element={
              <RouteGuard allow={OFFICE_ROLES}>
                <ChatsPage tab="reminders" />
              </RouteGuard>
            }
          />
          <Route
            path="/chats/:id"
            element={
              <RouteGuard allow={OFFICE_ROLES}>
                <ChatsPage tab="conversations" />
              </RouteGuard>
            }
          />
          <Route
            path="/reminders"
            element={
              <RouteGuard allow={OFFICE_ROLES}>
                <RedirectToReminders />
              </RouteGuard>
            }
          />
          <Route
            path="/families"
            element={
              <RouteGuard allow={OFFICE_ROLES}>
                <FamiliesPage />
              </RouteGuard>
            }
          />
          <Route
            path="/families/:memberId"
            element={
              <RouteGuard allow={OFFICE_ROLES}>
                <FamilyPage />
              </RouteGuard>
            }
          />
          {/* Old Children and Guardians URLs live on in Families. */}
          <Route path="/children" element={<LegacyRedirect kind="child" />} />
          <Route
            path="/children/:id"
            element={<LegacyRedirect kind="child" />}
          />
          <Route
            path="/guardians"
            element={<LegacyRedirect kind="guardian" />}
          />
          <Route
            path="/guardians/:id"
            element={<LegacyRedirect kind="guardian" />}
          />
          <Route
            path="/staff/:id?"
            element={
              <RouteGuard allow={OFFICE_ROLES}>
                <StaffPage />
              </RouteGuard>
            }
          />
          {/* Users and Tutors became Staff. */}
          <Route path="/users" element={<Navigate to="/staff" replace />} />
          <Route path="/tutors" element={<Navigate to="/staff" replace />} />
          <Route
            path="/tutors/:id"
            element={
              <RouteGuard allow={OFFICE_ROLES}>
                <TutorRedirect />
              </RouteGuard>
            }
          />
          {/* Office roles: a Manager gets "Settings are for Admins". */}
          <Route
            path="/settings"
            element={
              <RouteGuard allow={OFFICE_ROLES}>
                <SettingsPage />
              </RouteGuard>
            }
          />
          <Route
            path="/sessions"
            element={
              <RouteGuard allow={TUTOR_ONLY}>
                <MySessionsPage />
              </RouteGuard>
            }
          />
          <Route
            path="/sessions/:id"
            element={
              <RouteGuard allow={TUTOR_ONLY}>
                <MySessionsPage />
              </RouteGuard>
            }
          />
          <Route
            path="/availability"
            element={
              <RouteGuard allow={TUTOR_ONLY}>
                <AvailabilityPage />
              </RouteGuard>
            }
          />
          <Route
            path="/schedule"
            element={<Navigate to="/availability" replace />}
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
          <Route
            path="/prototype/tutor-timeoff"
            element={<TutorTimeOffPrototype />}
          />
        )}
        {import.meta.env.DEV && (
          <Route
            path="/prototype/accounts-staff"
            element={<AccountsStaffPrototype />}
          />
        )}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);
