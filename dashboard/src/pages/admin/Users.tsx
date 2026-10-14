import { useRef, useState, type ReactNode } from 'react'
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
import { useClampedPage } from '@/hooks/useClampedPage'
import { errorDetail } from '@/lib/api'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'
import {
  createUser,
  deactivateUser,
  sendInvite,
  sendPasswordReset,
  updateUser,
  userQueries,
  type User,
} from '@/lib/queries/users'
import {
  createUserPayload,
  displayNameError,
  editRoleOptions,
  accessBadge,
  inviteExpiryTooltip,
  PHONE_REQUIRED_ERROR,
  requiresProfile,
  roleLabel,
  roleOptions,
  rowPermissions,
  updateUserPayload,
  userFormErrors,
  type UserDraft,
} from '@/lib/users/users'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
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
const INVITE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const RESET_FALLBACK_ERROR = 'Could not send the reset email. Try again.'
// Every slide-over control is a 44px touch target on phones and the compact h-8 from md up.
const CONTROL_HEIGHT_CLASSES = 'h-11 md:h-8'
const TAP_ROW_CLASSES = 'min-h-11 md:min-h-0'
const SELF_HELP_TEXT = "You can't change your own role or deactivate your own account."
// A permission-locked button stays hoverable (for its title) and focusable, but looks and acts inert.
const LOCKED_BUTTON_CLASSES =
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-background aria-disabled:active:translate-y-0 dark:aria-disabled:hover:bg-transparent'

const inviteRowKey = (user: User): string =>
  `${user.is_active}|${user.has_password}|${user.invite_expires_at}`

const lockedReasonId = (user: User): string => `user-${user.id}-locked-reason`

const lockedButtonProps = (user: User, isLocked: boolean, reason: string | null) =>
  isLocked
    ? {
        'aria-disabled': true,
        'aria-describedby': lockedReasonId(user),
        title: reason ?? undefined,
      }
    : {}

const omitKey = <T,>(record: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key))

export const Users = () => {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  // The row's data when its invite was sent, so a failure can be tied to that exact state.
  const inviteRowKeys = useRef<Record<string, string>>({})
  // Same for a reset link: the same row fields decide whether its failure still applies.
  const resetRowKeys = useRef<Record<string, string>>({})
  const viewerRole = useAuthStore((state) => state.role) ?? ''
  const viewerId = useAuthStore((state) => state.userId)

  const [page, setPage] = useState(1)
  const [showInactive, setShowInactive] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null)
  const [pendingInviteIds, setPendingInviteIds] = useState<ReadonlySet<string>>(new Set())
  // Keyed by user id; `rowKey` ties each message to the row data it was raised against.
  const [inviteErrors, setInviteErrors] = useState<Record<string, { message: string; rowKey: string }>>({})
  const [pendingResetIds, setPendingResetIds] = useState<ReadonlySet<string>>(new Set())
  const [resetErrors, setResetErrors] = useState<Record<string, { message: string; rowKey: string }>>({})

  const usersQuery = useQuery(
    userQueries.list({ is_active: !showInactive, page, page_size: DEFAULT_PAGE_SIZE }),
  )
  const { pagerPage, pagerTotal, outOfRange } = useClampedPage({
    page,
    setPage,
    data: usersQuery.data,
    isPlaceholderData: usersQuery.isPlaceholderData,
    isFetching: usersQuery.isFetching,
  })

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

  const inviteMutation = useMutation({
    mutationFn: sendInvite,
    onSuccess: (invited, userId) => {
      invalidateUsers()
      setInviteErrors((current) => omitKey(current, userId))
      toast(`Invite sent to ${invited.email}.`)
    },
    onError: (error, userId) => {
      setInviteErrors((current) => ({
        ...current,
        [userId]: {
          message: errorDetail(error) ?? INVITE_FALLBACK_ERROR,
          rowKey: inviteRowKeys.current[userId] ?? '',
        },
      }))
    },
    onSettled: (_data, _error, userId) =>
      setPendingInviteIds((current) => {
        const next = new Set(current)
        next.delete(userId)
        return next
      }),
  })

  // The API answers 204, so the toast names the address from the row that was clicked.
  const resetMutation = useMutation({
    mutationFn: (user: User) => sendPasswordReset(user.id),
    onSuccess: (_data, user) => {
      setResetErrors((current) => omitKey(current, user.id))
      toast(`Reset link sent to ${user.email}.`)
    },
    onError: (error, user) => {
      setResetErrors((current) => ({
        ...current,
        [user.id]: {
          message: errorDetail(error) ?? RESET_FALLBACK_ERROR,
          rowKey: resetRowKeys.current[user.id] ?? '',
        },
      }))
    },
    onSettled: (_data, _error, user) =>
      setPendingResetIds((current) => {
        const next = new Set(current)
        next.delete(user.id)
        return next
      }),
  })

  const handleSendInvite = (user: User) => {
    inviteRowKeys.current[user.id] = inviteRowKey(user)
    setInviteErrors((current) => omitKey(current, user.id))
    setPendingInviteIds((current) => new Set(current).add(user.id))
    inviteMutation.mutate(user.id)
  }

  const handleSendReset = (user: User) => {
    resetRowKeys.current[user.id] = inviteRowKey(user)
    setResetErrors((current) => omitKey(current, user.id))
    setPendingResetIds((current) => new Set(current).add(user.id))
    resetMutation.mutate(user)
  }

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
        <div className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start lg:flex-nowrap">
          <StatusBadge status={user.is_active ? 'active' : 'inactive'} />
          {accessBadge(user) === 'no_login' && <StatusBadge status="no_login" />}
          {accessBadge(user) === 'invited' && (
            <span className="inline-flex cursor-default" title={inviteExpiryTooltip(user)}>
              <StatusBadge status="invited" />
              <span className="sr-only">{inviteExpiryTooltip(user)}</span>
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (user) => {
        const permissions = rowPermissions(viewerRole, viewerId, user)
        const showInvite = accessBadge(user) !== null
        const showReset = user.has_password
        // Your own row never offers Deactivate: the server refuses it, so it isn't worth a locked button.
        const showDeactivate = !permissions.isSelf
        const isInviteLocked = !permissions.canInvite
        const isResetLocked = !permissions.canReset
        const isDeactivateLocked = !permissions.canDeactivate
        const hasLockedButton =
          (showInvite && isInviteLocked) ||
          (showReset && isResetLocked) ||
          (showDeactivate && isDeactivateLocked)

        return (
          user.is_active && (
            <div>
              <div className="flex flex-wrap items-center justify-end gap-2 lg:flex-nowrap">
                {showInvite && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn('h-11 md:h-7', isInviteLocked && LOCKED_BUTTON_CLASSES)}
                    disabled={!isInviteLocked && pendingInviteIds.has(user.id)}
                    aria-busy={pendingInviteIds.has(user.id)}
                    {...lockedButtonProps(user, isInviteLocked, permissions.lockedReason)}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (!isInviteLocked) handleSendInvite(user)
                    }}
                  >
                    {pendingInviteIds.has(user.id)
                      ? 'Sending…'
                      : accessBadge(user) === 'invited'
                        ? 'Resend'
                        : 'Send invite'}
                  </Button>
                )}
                {showReset && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    // The label may wrap between md and lg, where the table is too narrow for it
                    // on one line.
                    className={cn(
                      'h-11 md:h-auto md:min-h-7 md:whitespace-normal md:py-1 lg:h-7 lg:whitespace-nowrap',
                      isResetLocked
                        ? LOCKED_BUTTON_CLASSES
                        : 'aria-disabled:pointer-events-none aria-disabled:opacity-50',
                    )}
                    // aria-disabled (not disabled) while sending, so keyboard focus stays on the button.
                    aria-disabled={pendingResetIds.has(user.id)}
                    aria-busy={pendingResetIds.has(user.id)}
                    {...lockedButtonProps(user, isResetLocked, permissions.lockedReason)}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (!isResetLocked && !pendingResetIds.has(user.id)) handleSendReset(user)
                    }}
                  >
                    {pendingResetIds.has(user.id) ? 'Sending…' : 'Send reset link'}
                  </Button>
                )}
                {showDeactivate && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn('h-11 md:h-7', isDeactivateLocked && LOCKED_BUTTON_CLASSES)}
                    {...lockedButtonProps(user, isDeactivateLocked, permissions.lockedReason)}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (!isDeactivateLocked) setDeactivateTarget(user)
                    }}
                  >
                    Deactivate
                  </Button>
                )}
              </div>
              {hasLockedButton && permissions.lockedReason !== null && (
                // Visible on cards, where a title never shows on touch; screen-reader only in the table.
                <p
                  id={lockedReasonId(user)}
                  className="ml-auto mt-1.5 max-w-[18rem] text-end text-xs text-muted-foreground md:sr-only"
                >
                  {permissions.lockedReason}
                </p>
              )}
              {inviteErrors[user.id]?.rowKey === inviteRowKey(user) && (
                <p role="alert" className="ml-auto mt-1.5 max-w-[18rem] text-end text-sm font-medium text-destructive">
                  {inviteErrors[user.id].message}
                </p>
              )}
              {resetErrors[user.id]?.rowKey === inviteRowKey(user) && (
                <p role="alert" className="ml-auto mt-1.5 max-w-[18rem] text-end text-sm font-medium text-destructive">
                  {resetErrors[user.id].message}
                </p>
              )}
            </div>
          )
        )
      },
    },
  ]

  const editPermissions =
    editingUser === null ? null : rowPermissions(viewerRole, viewerId, editingUser)
  const isReadOnly = formMode === 'edit' && editPermissions !== null && !editPermissions.canEdit
  const isSelfEdit = formMode === 'edit' && editPermissions?.isSelf === true
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
        status={
          usersQuery.isPending || outOfRange ? 'pending' : usersQuery.isError ? 'error' : 'ready'
        }
        errorMessage={errorDetail(usersQuery.error) ?? LOAD_FALLBACK_ERROR}
        onRetry={() => usersQuery.refetch()}
        emptyMessage={showInactive ? 'No inactive users.' : 'No users yet.'}
        onRowSelect={openEditForm}
      />

      <Pager
        page={pagerPage}
        pageSize={DEFAULT_PAGE_SIZE}
        total={pagerTotal}
        onPageChange={setPage}
        disabled={usersQuery.isPending || outOfRange}
      />

      <SlideOver
        open={formMode !== null}
        onOpenChange={(open) => {
          if (!open) closeForm()
        }}
        title={isReadOnly ? 'View user' : formMode === 'edit' ? 'Edit user' : 'Add user'}
        description={isReadOnly ? (editPermissions?.lockedReason ?? undefined) : undefined}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={closeForm}>
              {isReadOnly ? 'Close' : 'Cancel'}
            </Button>
            {!isReadOnly && (
              <Button type="button" onClick={handleSubmit} disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
        }
      >
        <UserForm
          mode={formMode ?? 'create'}
          form={form}
          onChange={handleFormChange}
          onRoleChange={handleRoleChange}
          viewerRole={viewerRole}
          readOnly={isReadOnly}
          isSelf={isSelfEdit}
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
  readOnly: boolean
  isSelf: boolean
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
  readOnly,
  isSelf,
  editingRole,
  validationErrors,
  saveErrorMessage,
}: UserFormProps) => {
  const showProfileFields = mode === 'create' && requiresProfile(form.role)
  const roleSelectOptions =
    editingRole === null ? roleOptions(viewerRole) : editRoleOptions(viewerRole, editingRole)
  const nameError = displayNameError(form.displayName)
  const isDisplayNameInvalid = nameError !== null && validationErrors.includes(nameError)
  const isRoleLocked = readOnly || isSelf
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
          disabled={readOnly}
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
          disabled={readOnly}
          onChange={(event) => onChange({ ...form, email: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="user-role">Role</Label>
        <Select
          id="user-role"
          className={CONTROL_HEIGHT_CLASSES}
          value={form.role}
          disabled={isRoleLocked}
          aria-describedby={isSelf && !readOnly ? 'user-self-help' : undefined}
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
        <>
          <label
            className={cn(
              'flex items-center gap-2 text-sm text-foreground has-disabled:cursor-not-allowed has-disabled:opacity-50',
              TAP_ROW_CLASSES,
            )}
          >
            <input
              type="checkbox"
              checked={form.isActive}
              disabled={isRoleLocked}
              aria-describedby={isSelf && !readOnly ? 'user-self-help' : undefined}
              onChange={(event) => onChange({ ...form, isActive: event.target.checked })}
            />
            Active
          </label>
          {isSelf && !readOnly && (
            <p id="user-self-help" className="text-xs text-muted-foreground">
              {SELF_HELP_TEXT}
            </p>
          )}
        </>
      )}
    </div>
  )
}
