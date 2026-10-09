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
import { createUser, deactivateUser, updateUser, userQueries, type User } from '@/lib/queries/users'
import {
  createUserPayload,
  displayNameError,
  editRoleOptions,
  accessBadge,
  PHONE_REQUIRED_ERROR,
  requiresProfile,
  roleLabel,
  roleOptions,
  updateUserPayload,
  userFormErrors,
  type UserDraft,
} from '@/lib/users/users'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

type FormState = UserDraft & { isActive: boolean }

const EMPTY_PROFILE = { phoneNumber: '', bio: '' }
const EMPTY_FORM: FormState = {
  displayName: '',
  email: '',
  role: 'admin',
  profile: EMPTY_PROFILE,
  isActive: true,
}
const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const DEACTIVATE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
// Every slide-over control is a 44px touch target on phones and the compact h-8 from md up.
const CONTROL_HEIGHT_CLASSES = 'h-11 md:h-8'
const TAP_ROW_CLASSES = 'min-h-11 md:min-h-0'

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

  const invalidateUsers = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      invalidateUsers()
      // A `tutor` payload creates a profile as well as an account, so the tutor list is stale
      // too. Only `create` can do that: `PATCH` offers no profile fields.
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
      displayName: user.name,
      email: user.email,
      role: user.role,
      profile: EMPTY_PROFILE,
      isActive: user.is_active,
    })
    setValidationErrors([])
    setEditingUser(user)
    setFormMode('edit')
  }

  // Leaving a profile role clears the profile sub-form. A half-typed phone number that survived a
  // detour through Admin would come back already filled in when the admin switches to Tutor or
  // Manager again — stale, not merely visible.
  // Once a submit has failed, the alert list follows every edit, so a fixed field drops its
  // message at the same moment it drops `aria-invalid`. Before that, editing stays quiet.
  const handleFormChange = (next: FormState) => {
    setForm(next)
    if (validationErrors.length > 0) {
      setValidationErrors(userFormErrors(next, formMode ?? 'create'))
    }
  }

  const handleRoleChange = (role: string) => {
    handleFormChange(
      requiresProfile(role) ? { ...form, role } : { ...form, role, profile: EMPTY_PROFILE },
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
    { id: 'displayName', header: 'Display name', primary: true, cell: (user) => user.name },
    { id: 'email', header: 'Email', cell: (user) => (
        // Cards at 375 must wrap a long email anywhere; the desktop table only when it has to.
        <span className="break-all md:break-normal md:[overflow-wrap:anywhere]">{user.email}</span>
      ), },
    { id: 'role', header: 'Role', cell: (user) => roleLabel(user.role) },
    {
      id: 'status',
      header: 'Status',
      cell: (user) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
          <StatusBadge status={user.is_active ? 'active' : 'inactive'} />
          {/* 'invited' renders in ticket 07 */}
          {accessBadge(user) === 'no_login' && <StatusBadge status="no_login" />}
        </div>
      ),
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
          Add user
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
        emptyMessage={showInactive ? 'No inactive users.' : 'No users yet.'}
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
          onChange={handleFormChange}
          onRoleChange={handleRoleChange}
          viewerRole={viewerRole}
          editingRole={editingUser?.role ?? null}
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
        body={
          deactivateTarget === null
            ? ''
            : `Deactivate ${deactivateTarget.name} (${deactivateTarget.email})? They will no longer be able to sign in.`
        }
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
  validationErrors,
  saveErrorMessage,
}: UserFormProps) => {
  const showProfileFields = mode === 'create' && requiresProfile(form.role)
  const roleSelectOptions =
    editingRole === null ? roleOptions(viewerRole) : editRoleOptions(viewerRole, editingRole)
  const nameError = displayNameError(form.displayName)
  const isDisplayNameInvalid = nameError !== null && validationErrors.includes(nameError)
  const isPhoneInvalid = validationErrors.includes(PHONE_REQUIRED_ERROR)
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
        <Label htmlFor="user-display-name">Display name</Label>
        <Input
          id="user-display-name"
          autoComplete="off"
          className={CONTROL_HEIGHT_CLASSES}
          value={form.displayName}
          aria-invalid={isDisplayNameInvalid}
          aria-describedby="user-display-name-help"
          onChange={(event) => onChange({ ...form, displayName: event.target.value })}
        />
        <p id="user-display-name-help" className="text-xs text-muted-foreground">
          Shown instead of the email, e.g. "Held by Maria Lopez".
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="user-email">Email</Label>
        <Input
          id="user-email"
          className={CONTROL_HEIGHT_CLASSES}
          type="email"
          value={form.email}
          onChange={(event) => onChange({ ...form, email: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="user-role">Role</Label>
        <Select
          id="user-role"
          className={CONTROL_HEIGHT_CLASSES}
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

      {showProfileFields && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="user-phone">Phone number</Label>
            <Input
              id="user-phone"
              className={CONTROL_HEIGHT_CLASSES}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={form.profile.phoneNumber}
              aria-invalid={isPhoneInvalid}
              onChange={(event) =>
                onChange({ ...form, profile: { ...form.profile, phoneNumber: event.target.value } })
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="user-bio">Bio (optional)</Label>
            <Input
              id="user-bio"
              className={CONTROL_HEIGHT_CLASSES}
              value={form.profile.bio}
              onChange={(event) =>
                onChange({ ...form, profile: { ...form.profile, bio: event.target.value } })
              }
            />
          </div>
        </>
      )}

      {mode === 'edit' && (
        <label className={cn('flex items-center gap-2 text-sm text-foreground', TAP_ROW_CLASSES)}>
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
