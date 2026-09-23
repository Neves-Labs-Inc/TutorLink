import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SlideOver } from '@/components/shared/SlideOver'
import { errorDetail } from '@/lib/api'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'
import { tutorQueries } from '@/lib/queries/tutors'
import { createUser, deactivateUser, updateUser, userQueries, type User } from '@/lib/queries/users'
import {
  createUserPayload,
  editRoleOptions,
  requiresTutorLink,
  roleOptions,
  updateUserPayload,
  userFormErrors,
  type UserDraft,
} from '@/lib/users/users'
import { useAuthStore } from '@/stores/authStore'

type FormState = UserDraft & { isActive: boolean }

const EMPTY_NEW_TUTOR = { name: '', phoneNumber: '', bio: '' }
const EMPTY_FORM: FormState = {
  email: '',
  password: '',
  role: 'admin',
  tutorId: null,
  tutorMode: 'link',
  newTutor: EMPTY_NEW_TUTOR,
  isActive: true,
}
const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const DEACTIVATE_FALLBACK_ERROR = 'Something went wrong. Please try again.'

export const Users = () => {
  const queryClient = useQueryClient()
  const viewerRole = useAuthStore((state) => state.role) ?? ''

  const [page, setPage] = useState(1)
  const [showInactive, setShowInactive] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null)

  const usersQuery = useQuery(
    userQueries.list({ is_active: !showInactive, page, page_size: DEFAULT_PAGE_SIZE }),
  )
  const tutorsQuery = useQuery(tutorQueries.list({ page_size: 100 }))

  const tutorNames = new Map((tutorsQuery.data?.items ?? []).map((tutor) => [tutor.id, tutor.name]))

  const invalidateUsers = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      invalidateUsers()
      // A `tutor` payload creates a profile as well as an account, so the tutor list this page
      // reads for `tutorNames` and the "Link existing tutor" options is stale too. Only `create`
      // can do that: `PATCH` offers neither tutor field.
      queryClient.invalidateQueries({ queryKey: ['tutors'] })
      closeForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: (vars: { userId: string; data: ReturnType<typeof updateUserPayload> }) =>
      updateUser(vars.userId, vars.data),
    onSuccess: () => {
      invalidateUsers()
      closeForm()
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: deactivateUser,
    onSuccess: () => {
      invalidateUsers()
      setDeactivateTarget(null)
    },
  })

  const closeForm = () => {
    setFormMode(null)
    setEditingUser(null)
    setForm(EMPTY_FORM)
    setValidationErrors([])
    createMutation.reset()
    updateMutation.reset()
  }

  const openCreateForm = () => {
    setForm(EMPTY_FORM)
    setValidationErrors([])
    setEditingUser(null)
    setFormMode('create')
  }

  const openEditForm = (user: User) => {
    setForm({
      email: user.email,
      password: '',
      role: user.role,
      tutorId: null,
      tutorMode: 'link',
      newTutor: EMPTY_NEW_TUTOR,
      isActive: user.is_active,
    })
    setValidationErrors([])
    setEditingUser(user)
    setFormMode('edit')
  }

  // Leaving the tutor role clears the whole tutor sub-form, not just `tutorId`. A half-typed new
  // tutor that survived a detour through Admin would come back already filled in when the admin
  // switches to Tutor again, and `createUserPayload` would post it — the stale name is submittable,
  // not merely visible.
  const handleRoleChange = (role: string) => {
    setForm((current) =>
      requiresTutorLink(role)
        ? { ...current, role }
        : { ...current, role, tutorId: null, tutorMode: 'link', newTutor: EMPTY_NEW_TUTOR },
    )
  }

  const handleSubmit = () => {
    const mode = formMode ?? 'create'
    const errors = userFormErrors(form, mode)

    if (errors.length > 0) {
      setValidationErrors(errors)
    } else {
      setValidationErrors([])

      if (mode === 'create') {
        createMutation.mutate(createUserPayload(form))
      } else if (editingUser !== null) {
        updateMutation.mutate({ userId: editingUser.id, data: updateUserPayload(form) })
      }
    }
  }

  const columns: Column<User>[] = [
    { id: 'email', header: 'Email', primary: true, cell: (user) => user.email },
    { id: 'role', header: 'Role', cell: (user) => user.role },
    {
      id: 'tutor',
      header: 'Linked tutor',
      cell: (user) => (user.tutor_id === null ? '' : (tutorNames.get(user.tutor_id) ?? '')),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (user) => <StatusBadge status={user.is_active ? 'active' : 'inactive'} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (user) =>
        user.is_active && (
          <Button type="button" variant="outline" size="sm" onClick={() => setDeactivateTarget(user)}>
            Deactivate
          </Button>
        ),
    },
  ]

  const mutation = formMode === 'edit' ? updateMutation : createMutation
  const saveErrorMessage = mutation.isError ? (errorDetail(mutation.error) ?? SAVE_FALLBACK_ERROR) : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Users</h1>
        <Button type="button" onClick={openCreateForm}>
          Add User
        </Button>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(event) => {
            setShowInactive(event.target.checked)
            setPage(1)
          }}
        />
        Show inactive users
      </label>

      <DataTable
        caption="Users"
        columns={columns}
        rows={usersQuery.data?.items ?? []}
        rowKey={(user) => user.id}
        status={usersQuery.isPending ? 'pending' : usersQuery.isError ? 'error' : 'ready'}
        errorMessage={errorDetail(usersQuery.error) ?? LOAD_FALLBACK_ERROR}
        onRetry={() => usersQuery.refetch()}
        emptyMessage="No users found."
        onRowSelect={openEditForm}
      />

      <Pager
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={usersQuery.data?.total ?? 0}
        onPageChange={setPage}
        disabled={usersQuery.isPending}
      />

      <SlideOver
        open={formMode !== null}
        onOpenChange={(open) => {
          if (!open) closeForm()
        }}
        title={formMode === 'edit' ? 'Edit user' : 'Add user'}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={closeForm}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        }
      >
        <UserForm
          mode={formMode ?? 'create'}
          form={form}
          onChange={setForm}
          onRoleChange={handleRoleChange}
          viewerRole={viewerRole}
          editingRole={editingUser?.role ?? null}
          tutorOptions={tutorsQuery.data?.items ?? []}
          validationErrors={validationErrors}
          saveErrorMessage={saveErrorMessage}
        />
      </SlideOver>

      <ConfirmDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeactivateTarget(null)
            deactivateMutation.reset()
          }
        }}
        title="Deactivate user"
        body={`Deactivate ${deactivateTarget?.email ?? ''}? They will no longer be able to sign in.`}
        confirmLabel="Deactivate"
        destructive
        pending={deactivateMutation.isPending}
        errorMessage={
          deactivateMutation.isError
            ? (errorDetail(deactivateMutation.error) ?? DEACTIVATE_FALLBACK_ERROR)
            : null
        }
        onConfirm={() => {
          if (deactivateTarget !== null) deactivateMutation.mutate(deactivateTarget.id)
        }}
      />
    </div>
  )
}

type UserFormProps = {
  mode: 'create' | 'edit'
  form: FormState
  onChange: (form: FormState) => void
  onRoleChange: (role: string) => void
  viewerRole: string
  editingRole: string | null
  tutorOptions: { id: string; name: string }[]
  validationErrors: string[]
  saveErrorMessage: string | null
}

const UserForm = ({
  mode,
  form,
  onChange,
  onRoleChange,
  viewerRole,
  editingRole,
  tutorOptions,
  validationErrors,
  saveErrorMessage,
}: UserFormProps) => {
  const showTutorFields = mode === 'create' && requiresTutorLink(form.role)
  const roleSelectOptions =
    editingRole === null ? roleOptions(viewerRole) : editRoleOptions(viewerRole, editingRole)
  let content: ReactNode = null

  if (validationErrors.length > 0 || saveErrorMessage !== null) {
    content = (
      <ul role="alert" className="space-y-1 text-sm font-medium text-destructive">
        {validationErrors.map((message) => (
          <li key={message}>{message}</li>
        ))}
        {saveErrorMessage !== null && <li>{saveErrorMessage}</li>}
      </ul>
    )
  }

  return (
    <div className="space-y-4">
      {content}

      <div className="space-y-1.5">
        <Label htmlFor="user-email">Email</Label>
        <Input
          id="user-email"
          type="email"
          value={form.email}
          onChange={(event) => onChange({ ...form, email: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="user-password">{mode === 'edit' ? 'New password (optional)' : 'Temporary password'}</Label>
        <Input
          id="user-password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(event) => onChange({ ...form, password: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="user-role">Role</Label>
        <Select
          id="user-role"
          value={form.role}
          onChange={(event) => onRoleChange(event.target.value)}
        >
          {roleSelectOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {showTutorFields && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tutor profile</Label>
            <div className="flex gap-4 text-sm text-foreground">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="tutor-mode"
                  checked={form.tutorMode === 'link'}
                  onChange={() => onChange({ ...form, tutorMode: 'link' })}
                />
                Link existing tutor
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="tutor-mode"
                  checked={form.tutorMode === 'new'}
                  onChange={() => onChange({ ...form, tutorMode: 'new' })}
                />
                Create new tutor
              </label>
            </div>
          </div>

          {form.tutorMode === 'link' ? (
            <div className="space-y-1.5">
              <Label htmlFor="user-tutor">Linked tutor</Label>
              <Select
                id="user-tutor"
                value={form.tutorId ?? ''}
                onChange={(event) => onChange({ ...form, tutorId: event.target.value || null })}
              >
                <option value="">Select a tutor…</option>
                {tutorOptions.map((tutor) => (
                  <option key={tutor.id} value={tutor.id}>
                    {tutor.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="user-tutor-name">Tutor name</Label>
                <Input
                  id="user-tutor-name"
                  value={form.newTutor.name}
                  onChange={(event) =>
                    onChange({ ...form, newTutor: { ...form.newTutor, name: event.target.value } })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="user-tutor-phone">Phone number</Label>
                <Input
                  id="user-tutor-phone"
                  value={form.newTutor.phoneNumber}
                  onChange={(event) =>
                    onChange({
                      ...form,
                      newTutor: { ...form.newTutor, phoneNumber: event.target.value },
                    })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="user-tutor-bio">Bio (optional)</Label>
                <Input
                  id="user-tutor-bio"
                  value={form.newTutor.bio}
                  onChange={(event) =>
                    onChange({ ...form, newTutor: { ...form.newTutor, bio: event.target.value } })
                  }
                />
              </div>
            </>
          )}
        </div>
      )}

      {mode === 'edit' && (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => onChange({ ...form, isActive: event.target.checked })}
          />
          Active
        </label>
      )}
    </div>
  )
}
