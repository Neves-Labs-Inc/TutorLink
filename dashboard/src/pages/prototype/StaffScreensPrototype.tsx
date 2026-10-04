// PROTOTYPE ONLY (ticket #112, map #102). Throwaway route /prototype/staff-screens: the Staff
// screens for evaluation, Guardian language, reminders and Display name, in the real AppShell.
// `?screen=<key>` picks the screen, `?variant=A|B|C` the variant where one exists. Hard-coded
// data, no API calls. Delete this file, components/prototype/, hooks/prototype/ and
// lib/prototype/ once the designs are decided.
import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ClipboardList, UserRound } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import type { AdminSidebarProps } from '@/components/layout/AdminSidebar'
import { PrototypeControls, PrototypeToggle } from '@/components/prototype/PrototypeControls'
import { PrototypeSwitcher } from '@/components/prototype/PrototypeSwitcher'
import { AwaitingScreenPrototype } from '@/components/prototype/staff-screens/AwaitingScreenPrototype'
import { ChatScreenPrototype } from '@/components/prototype/staff-screens/ChatScreenPrototype'
import { ChildScreenPrototype } from '@/components/prototype/staff-screens/ChildScreenPrototype'
import { GuardianScreenPrototype } from '@/components/prototype/staff-screens/GuardianScreenPrototype'
import { LanguageScreenPrototype } from '@/components/prototype/staff-screens/LanguageScreenPrototype'
import {
  ProfileScreenPrototype,
  type ProfileViewer,
} from '@/components/prototype/staff-screens/ProfileScreenPrototype'
import { SettingsScreenPrototype } from '@/components/prototype/staff-screens/SettingsScreenPrototype'
import { UsersScreenPrototype } from '@/components/prototype/staff-screens/UsersScreenPrototype'
import { CHILDREN } from '@/lib/prototype/staffScreensData'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

type ScreenDefinition = { key: string; label: string; variants: { key: string; name: string }[] }

const PROTOTYPE_PATH = '/prototype/staff-screens'
const DEFAULT_CHILD = 'ana'

const SCREENS: ScreenDefinition[] = [
  {
    key: 'child',
    label: '1. Child',
    variants: [
      { key: 'A', name: 'Inline section' },
      { key: 'B', name: 'Summary + slide-over' },
      { key: 'C', name: 'Subject matrix' },
    ],
  },
  {
    key: 'awaiting',
    label: '2. Awaiting evaluation',
    variants: [
      { key: 'A', name: 'Own sidebar page' },
      { key: 'B', name: 'Dashboard card' },
      { key: 'C', name: 'Children list tab' },
    ],
  },
  { key: 'language', label: '3. Guardian language', variants: [] },
  { key: 'settings', label: '4. Reminder settings', variants: [] },
  { key: 'users', label: '5. Display name', variants: [] },
  { key: 'guardian', label: '6. Guardian reminders', variants: [] },
  { key: 'chat', label: '7. Chat changes', variants: [] },
  { key: 'profile', label: '8. My profile + Spanish name', variants: [] },
]

const ON_OFF = [
  { value: 'off' as const, label: 'off' },
  { value: 'on' as const, label: 'on' },
]

const prototypeUrl = (params: Record<string, string>): string =>
  `${PROTOTYPE_PATH}?${new URLSearchParams(params).toString()}`

// Fakes an Admin for this route only so the real chrome renders without the API. The bootstrap
// refresh fails with no API and clears the store, so re-seed whenever the role drops to null.
const useFakeAdminSession = () => {
  useEffect(() => {
    const seed = () => useAuthStore.setState({ status: 'authenticated', role: 'admin' })
    seed()
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.role === null) seed()
    })
    return () => {
      unsubscribe()
      useAuthStore.getState().clearSession()
    }
  }, [])
}

export const StaffScreensPrototype = () => {
  useFakeAdminSession()
  const navigate = useNavigate()
  const { search } = useLocation()
  const params = new URLSearchParams(search)

  const screen = SCREENS.find((entry) => entry.key === params.get('screen')) ?? SCREENS[0]
  const variantKeys = screen.variants.map((variant) => variant.key)
  const requestedVariant = params.get('variant') ?? ''
  const variant = variantKeys.includes(requestedVariant) ? requestedVariant : (variantKeys[0] ?? '')
  const childId = params.get('child') ?? DEFAULT_CHILD
  const child = CHILDREN[childId] ?? CHILDREN[DEFAULT_CHILD]

  const [showInactiveLevel, setShowInactiveLevel] = useState<'off' | 'on'>('off')
  const [profileViewer, setProfileViewer] = useState<ProfileViewer>('staff')
  const [isProfileOpen, setIsProfileOpen] = useState(false)

  const go = (next: Record<string, string>) => navigate(prototypeUrl(next), { replace: true })

  const changeScreen = (key: string) => {
    const nextScreen = SCREENS.find((entry) => entry.key === key) ?? SCREENS[0]
    go(nextScreen.variants.length > 0 ? { screen: key, variant: 'A' } : { screen: key })
  }

  const changeVariant = (nextVariant: string) =>
    go({ screen: screen.key, variant: nextVariant, ...(screen.key === 'child' ? { child: childId } : {}) })

  const openChild = (nextChildId: string) => go({ screen: 'child', variant: 'A', child: nextChildId })

  let sidebar: AdminSidebarProps = {}
  if (screen.key === 'awaiting' && variant === 'A') {
    sidebar = {
      extraNavItems: [
        { to: prototypeUrl({ screen: 'awaiting', variant: 'A' }), label: 'Awaiting evaluation', icon: ClipboardList },
      ],
    }
  }
  if (screen.key === 'profile' && profileViewer === 'staff') {
    sidebar = { footerAction: { label: 'My profile', icon: UserRound, onClick: () => setIsProfileOpen(true) } }
  }

  let content: ReactNode = null
  if (screen.key === 'child') {
    content = (
      <div className="space-y-6">
        <PrototypeControls>
          <PrototypeToggle
            label="child"
            options={[
              { value: 'ana', label: 'Ana (Evaluated)' },
              { value: 'luis', label: 'Luis (not Evaluated, no levels)' },
            ]}
            value={child.id}
            onChange={(nextChildId) => go({ screen: 'child', variant, child: nextChildId })}
          />
          <PrototypeToggle
            label="level on an inactive subject"
            options={ON_OFF}
            value={showInactiveLevel}
            onChange={setShowInactiveLevel}
          />
          <span>State is local; reload or switch child to reset.</span>
        </PrototypeControls>
        <ChildScreenPrototype
          key={`${child.id}-${showInactiveLevel}`}
          variant={variant}
          child={child}
          showInactiveLevel={showInactiveLevel === 'on'}
        />
      </div>
    )
  }
  if (screen.key === 'awaiting') {
    content = (
      <AwaitingScreenPrototype
        variant={variant}
        onOpenChild={openChild}
        onSeeAll={() => go({ screen: 'awaiting', variant: 'C' })}
      />
    )
  }
  if (screen.key === 'language') content = <LanguageScreenPrototype />
  if (screen.key === 'settings') content = <SettingsScreenPrototype />
  if (screen.key === 'users') content = <UsersScreenPrototype />
  if (screen.key === 'guardian') content = <GuardianScreenPrototype />
  if (screen.key === 'chat') content = <ChatScreenPrototype />
  if (screen.key === 'profile') {
    content = (
      <ProfileScreenPrototype
        viewer={profileViewer}
        onViewerChange={setProfileViewer}
        isProfileOpen={isProfileOpen}
        onProfileOpenChange={setIsProfileOpen}
      />
    )
  }

  return (
    <AppShell sidebar={sidebar}>
      <div className="space-y-6 pb-20">
        <nav
          aria-label="Prototype screens"
          className="flex flex-wrap items-center gap-1.5 rounded-lg border-2 border-dashed border-muted-foreground/40 p-2 font-mono text-xs"
        >
          <span className="px-1 font-semibold text-muted-foreground uppercase">Screen</span>
          {SCREENS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-current={entry.key === screen.key ? 'page' : undefined}
              onClick={() => changeScreen(entry.key)}
              className={cn(
                'rounded border border-dashed border-muted-foreground/40 px-2 py-1',
                entry.key === screen.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {entry.label}
              {entry.variants.length > 0 && ' (A/B/C)'}
            </button>
          ))}
        </nav>
        {content}
      </div>
      <PrototypeSwitcher
        screenLabel={screen.key}
        variants={screen.variants}
        current={variant}
        onChange={changeVariant}
      />
    </AppShell>
  )
}
