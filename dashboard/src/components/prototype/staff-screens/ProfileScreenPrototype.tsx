// PROTOTYPE ONLY (ticket #112, screen `profile`). "My profile" dialog opened from the sidebar
// footer, plus the optional Spanish name on Subjects.
import { useState } from 'react'
import { Dialog } from 'radix-ui'

import { PrototypeControls, PrototypeToggle } from '@/components/prototype/PrototypeControls'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CURRENT_STAFF, SUBJECTS, type PrototypeSubject } from '@/lib/prototype/staffScreensData'
import { cn } from '@/lib/utils'

export type ProfileViewer = 'staff' | 'developer'

type ProfileScreenPrototypeProps = {
  viewer: ProfileViewer
  onViewerChange: (viewer: ProfileViewer) => void
  isProfileOpen: boolean
  onProfileOpenChange: (open: boolean) => void
}

const overlayClasses = cn(
  'fixed inset-0 z-40 bg-black/60',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'motion-reduce:animate-none',
)

const contentClasses = cn(
  'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2',
  'space-y-4 rounded-lg border border-border bg-card p-5 outline-none',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
  'motion-reduce:animate-none',
)

export const ProfileScreenPrototype = ({
  viewer,
  onViewerChange,
  isProfileOpen,
  onProfileOpenChange,
}: ProfileScreenPrototypeProps) => {
  const [subjects, setSubjects] = useState(SUBJECTS)
  const [editing, setEditing] = useState<PrototypeSubject | null>(null)
  const [displayName, setDisplayName] = useState(CURRENT_STAFF)
  const [draftName, setDraftName] = useState(CURRENT_STAFF)

  const columns: Column<PrototypeSubject>[] = [
    { id: 'name', header: 'Name', primary: true, cell: (subject) => subject.name },
    {
      id: 'spanishName',
      header: 'Spanish name',
      cell: (subject) =>
        subject.spanishName ?? <span className="text-muted-foreground">— (English name used)</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (subject) => <StatusBadge status={subject.isActive ? 'active' : 'inactive'} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (subject) => (
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(subject)}>
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
            { value: 'staff', label: 'Staff (Admin/Manager)' },
            { value: 'developer', label: 'Developer' },
          ]}
          value={viewer}
          onChange={onViewerChange}
        />
        <span>
          {viewer === 'staff'
            ? `"My profile" is in the sidebar footer, above Logout. Display name: ${displayName}.`
            : 'Developers have no Display name, so no "My profile" entry.'}
        </span>
      </PrototypeControls>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Subjects</h1>
        <Button type="button">Add subject</Button>
      </div>

      <DataTable
        caption="Subjects"
        columns={columns}
        rows={subjects}
        rowKey={(subject) => subject.id}
        status="ready"
        emptyMessage="No subjects yet."
      />

      {editing && (
        <SubjectSlideOver
          subject={editing}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            setSubjects((current) => current.map((subject) => (subject.id === next.id ? next : subject)))
            setEditing(null)
          }}
        />
      )}

      <Dialog.Root
        open={isProfileOpen}
        onOpenChange={(open) => {
          setDraftName(displayName)
          onProfileOpenChange(open)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={overlayClasses} />
          <Dialog.Content className={contentClasses}>
            <div className="space-y-1.5">
              <Dialog.Title className="font-heading text-lg font-semibold tracking-tight">My profile</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                Guardians and other Staff see your Display name in chats.
              </Dialog.Description>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-display-name">Display name</Label>
              <Input
                id="profile-display-name"
                value={draftName}
                aria-invalid={draftName.trim() === ''}
                onChange={(event) => setDraftName(event.target.value)}
              />
              {draftName.trim() === '' && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  Display name is required.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="button"
                disabled={draftName.trim() === ''}
                onClick={() => {
                  setDisplayName(draftName.trim())
                  onProfileOpenChange(false)
                }}
              >
                Save
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

const SubjectSlideOver = ({
  subject,
  onClose,
  onSave,
}: {
  subject: PrototypeSubject
  onClose: () => void
  onSave: (subject: PrototypeSubject) => void
}) => {
  const [name, setName] = useState(subject.name)
  const [spanishName, setSpanishName] = useState(subject.spanishName ?? '')

  return (
    <SlideOver
      open
      onOpenChange={(open) => !open && onClose()}
      title="Edit subject"
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onSave({ ...subject, name, spanishName: spanishName.trim() === '' ? null : spanishName.trim() })}
          >
            Save changes
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="subject-name">Name</Label>
          <Input id="subject-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="subject-spanish-name">Spanish name (optional)</Label>
          <Input id="subject-spanish-name" value={spanishName} onChange={(event) => setSpanishName(event.target.value)} />
          <p className="text-xs text-muted-foreground">
            Used in messages to Spanish-speaking Guardians. Blank = the English name is used.
          </p>
        </div>
      </div>
    </SlideOver>
  )
}
