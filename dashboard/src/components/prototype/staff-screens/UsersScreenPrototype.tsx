// PROTOTYPE ONLY (ticket #112, screen `users`). Display name on Users, plus where it shows in chat.
import { useState } from 'react'

import { PrototypeControls, PrototypeToggle } from '@/components/prototype/PrototypeControls'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { GUARDIAN_NAME, HOLDING_STAFF } from '@/lib/prototype/staffScreensData'
import { ChatBubble, SystemLine } from './PrototypeChatParts'

type Viewer = 'admin' | 'developer'

type PrototypeUser = { id: string; displayName: string; email: string; role: string; status: string }

type UserForm = { displayName: string; email: string; role: string }

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  tutor: 'Tutor',
  developer: 'Developer',
}

const INITIAL_USERS: PrototypeUser[] = [
  { id: 'u1', displayName: 'Maria Lopez', email: 'maria@brightpath.example', role: 'manager', status: 'active' },
  { id: 'u2', displayName: 'Daniel Reyes', email: 'daniel@brightpath.example', role: 'admin', status: 'active' },
  { id: 'u3', displayName: 'Carlos Vega', email: 'carlos.vega@brightpath.example', role: 'tutor', status: 'active' },
  { id: 'u4', displayName: 'Franklin (dev)', email: 'dev@tutorlink.example', role: 'developer', status: 'active' },
]

const EMPTY_FORM: UserForm = { displayName: '', email: '', role: 'manager' }

const roleOptionsFor = (viewer: Viewer): string[] =>
  viewer === 'developer' ? ['admin', 'manager', 'tutor', 'developer'] : ['admin', 'manager', 'tutor']

export const UsersScreenPrototype = () => {
  const [viewer, setViewer] = useState<Viewer>('admin')
  const [users, setUsers] = useState(INITIAL_USERS)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [form, setForm] = useState<UserForm>(EMPTY_FORM)
  const [hasTriedSave, setHasTriedSave] = useState(false)

  const visibleUsers = viewer === 'developer' ? users : users.filter((user) => user.role !== 'developer')
  const isDisplayNameMissing = form.displayName.trim() === ''

  const openForm = (user: PrototypeUser | null) => {
    setEditingId(user?.id ?? null)
    setForm(user ? { displayName: user.displayName, email: user.email, role: user.role } : EMPTY_FORM)
    setHasTriedSave(false)
    setIsFormOpen(true)
  }

  const handleSave = () => {
    setHasTriedSave(true)
    if (isDisplayNameMissing) return
    setUsers((current) =>
      editingId === null
        ? [...current, { id: `u${current.length + 1}`, ...form, status: 'active' }]
        : current.map((user) => (user.id === editingId ? { ...user, ...form } : user)),
    )
    setIsFormOpen(false)
  }

  const columns: Column<PrototypeUser>[] = [
    { id: 'displayName', header: 'Display name', primary: true, cell: (user) => user.displayName },
    { id: 'email', header: 'Email', cell: (user) => user.email },
    { id: 'role', header: 'Role', cell: (user) => ROLE_LABELS[user.role] },
    { id: 'status', header: 'Status', cell: (user) => <StatusBadge status={user.status} /> },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (user) => (
        <Button type="button" variant="outline" size="sm" onClick={() => openForm(user)}>
          Edit
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PrototypeControls>
        <PrototypeToggle
          label="viewer"
          options={[
            { value: 'admin', label: 'Admin' },
            { value: 'developer', label: 'Developer' },
          ]}
          value={viewer}
          onChange={setViewer}
        />
      </PrototypeControls>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Users</h1>
        <Button type="button" onClick={() => openForm(null)}>
          Add user
        </Button>
      </div>

      <DataTable
        caption="Users"
        columns={columns}
        rows={visibleUsers}
        rowKey={(user) => user.id}
        status="ready"
        emptyMessage="No users yet."
      />

      <section className="space-y-3" aria-labelledby="display-name-chat-heading">
        <h2 id="display-name-chat-heading" className="font-heading text-lg font-semibold tracking-tight">
          Where the Display name shows
        </h2>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-4 py-2 text-sm">
            <p className="text-muted-foreground">Held by {HOLDING_STAFF}</p>
          </div>
          <div className="flex flex-col gap-3 px-4 py-4">
            <ChatBubble author="guardian" time="Oct 4, 10:02 AM">
              Can Luis do Thursday instead?
            </ChatBubble>
            <SystemLine>{HOLDING_STAFF} joined the chat · notice sent</SystemLine>
            <ChatBubble author="staff" label={HOLDING_STAFF} time="Oct 4, 10:05 AM">
              Hi {GUARDIAN_NAME.split(' ')[0]}, Thursday at 4 PM works. I&apos;ll move it now.
            </ChatBubble>
          </div>
        </div>
      </section>

      <SlideOver
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        title={editingId === null ? 'Add user' : 'Edit user'}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave}>
              {editingId === null ? 'Create user' : 'Save changes'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {hasTriedSave && isDisplayNameMissing && (
            <p role="alert" className="text-sm font-medium text-destructive">
              Display name is required.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="user-display-name">Display name</Label>
            <Input
              id="user-display-name"
              value={form.displayName}
              aria-invalid={hasTriedSave && isDisplayNameMissing}
              onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Shown to Guardians and other Staff in chats, e.g. &quot;Held by Maria Lopez&quot;.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-role-proto">Role</Label>
            <Select
              id="user-role-proto"
              value={form.role}
              onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
            >
              {roleOptionsFor(viewer).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </SlideOver>
    </div>
  )
}
