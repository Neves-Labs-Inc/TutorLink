import { useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'

import BrandColorField from '@/components/settings/BrandColorField'
import EmailPreview from '@/components/settings/EmailPreview'
import EmailPreviewSkeleton from '@/components/settings/EmailPreviewSkeleton'
import { CONTROL_HEIGHT, FADE_IN, SKELETON_BAR } from '@/components/settings/emailTemplateClasses'
import { useSettingsFocus } from '@/hooks/useSettingsFocus'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { errorDetail } from '@/lib/api'
import { meQueries } from '@/lib/queries/me'
import {
  sendTestEmail,
  settingQueries,
  updateSettings,
  type SettingsPage,
} from '@/lib/queries/settings'
import {
  TEMPLATE_SECTIONS,
  draftEmailPayload,
  emailTemplateUpdates,
  hasTemplateErrors,
  savedTemplateValue,
  testEmailSentMessage,
  validateBrandColor,
  validateTemplate,
  type EmailDraftPayload,
  type TemplateSectionConfig,
} from '@/lib/settings/emailTemplates'
import { createSingleFlight, type SingleFlight } from '@/lib/single-flight/singleFlight'
import { cn } from '@/lib/utils'

export type EmailTemplatesCardProps = {
  page: SettingsPage
}

type TemplateSectionProps = {
  section: TemplateSectionConfig
  subject: string
  body: string
  // Null while the draft colour is invalid; the preview and test send both need a valid one.
  brandColorValue: string
  brandColorError: string | null
  disabled: boolean
  onBrandColorChange: (value: string) => void
  onSubjectChange: (value: string) => void
  onBodyChange: (value: string) => void
  // The section's test-send row; renders after the fields/preview grid.
  actions?: ReactNode
}

const BRAND_COLOR_PRESET_SLOTS = [0, 1, 2, 3]
const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const CARD_DESCRIPTION = 'The emails TutorLink sends when you invite someone or they reset their password.'
const mono = 'font-mono text-foreground'

const idPrefix = (section: TemplateSectionConfig): string =>
  section.id === 'invite' ? 'email-invite' : 'email-reset'

const PlaceholderList = ({ placeholders }: { placeholders: readonly string[] }) => (
  <>
    {placeholders.map((name, index) => {
      const isLast = index === placeholders.length - 1
      const isSecondLast = index === placeholders.length - 2
      let separator = ', '
      if (isLast) separator = ''
      else if (isSecondLast) separator = ' and '

      return (
        <span key={name}>
          <span className={mono}>{`{${name}}`}</span>
          {separator}
        </span>
      )
    })}
  </>
)

// Swatch, hex and the four presets wrap the same way as the real row.
const BrandColorSkeleton = () => (
  <div className="space-y-1.5">
    <div className={cn(SKELETON_BAR, 'h-4 w-24')} />
    <div className="flex flex-wrap items-center gap-2">
      <div className={cn(SKELETON_BAR, CONTROL_HEIGHT, 'w-14')} />
      <div className={cn(SKELETON_BAR, CONTROL_HEIGHT, 'w-32')} />
      <div className="flex gap-2 sm:border-l sm:border-border sm:pl-2">
        {BRAND_COLOR_PRESET_SLOTS.map((slot) => (
          <div key={slot} className={cn(SKELETON_BAR, 'size-11 md:size-10')} />
        ))}
      </div>
    </div>
    <div className={cn(SKELETON_BAR, 'hidden h-3 w-80 max-w-full sm:block')} />
    <div className="space-y-1 sm:hidden">
      <div className={cn(SKELETON_BAR, 'h-3 w-full')} />
      <div className={cn(SKELETON_BAR, 'h-3 w-40')} />
    </div>
  </div>
)

// Only the sections after the first have the divider.
const SkeletonSection = ({ hasDivider }: { hasDivider: boolean }) => (
  <div className={cn('space-y-6', hasDivider && 'border-t border-border pt-6')}>
    <div className={cn(SKELETON_BAR, 'h-4 w-16')} />
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-4">
        <BrandColorSkeleton />
        <div className="space-y-1.5">
          <div className={cn(SKELETON_BAR, 'h-4 w-14')} />
          <div className={cn(SKELETON_BAR, 'h-11 w-full md:h-10')} />
        </div>
        <div className="space-y-1.5">
          <div className={cn(SKELETON_BAR, 'h-4 w-10')} />
          <div className={cn(SKELETON_BAR, 'h-[254px] w-full md:h-[214px]')} />
        </div>
        {/* The placeholder hint wraps to two lines below lg. */}
        <div className="space-y-2 py-0.5">
          <div className={cn(SKELETON_BAR, 'h-3 w-full lg:w-96')} />
          <div className={cn(SKELETON_BAR, 'h-3 w-40 lg:hidden')} />
        </div>
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className={cn(SKELETON_BAR, 'h-4 w-28')} />
        <EmailPreviewSkeleton />
      </div>
    </div>
    <div className={cn(SKELETON_BAR, 'h-11 w-44 md:h-8')} />
  </div>
)

export const EmailTemplatesSkeleton = () => (
  <Card aria-busy="true">
    <CardHeader>
      <div className={cn(SKELETON_BAR, 'h-5 w-32')} />
      {/* The description wraps to two lines below lg. */}
      <div className="space-y-1">
        <div className={cn(SKELETON_BAR, 'h-4 w-full lg:w-[32rem]')} />
        <div className={cn(SKELETON_BAR, 'h-4 w-48 lg:hidden')} />
      </div>
    </CardHeader>
    <CardContent className="space-y-6">
      {TEMPLATE_SECTIONS.map((section, index) => (
        <SkeletonSection key={section.id} hasDivider={index > 0} />
      ))}
    </CardContent>
    <CardFooter>
      <div className={cn(SKELETON_BAR, 'h-11 w-28 md:h-8')} />
    </CardFooter>
  </Card>
)

type TestEmailRowProps = {
  mutation: UseMutationResult<void, Error, EmailDraftPayload>
  isDisabled: boolean
  email: string | undefined
  onSend: () => void
}

const TestEmailRow = ({ mutation, isDisabled, email, onSend }: TestEmailRowProps) => (
  <div className="flex flex-col items-start gap-1.5">
    <Button
      type="button"
      variant="outline"
      className="h-11 md:h-8 aria-disabled:pointer-events-none aria-disabled:opacity-50"
      disabled={isDisabled}
      // aria-disabled (not disabled) while sending, so keyboard focus stays on the button.
      aria-disabled={mutation.isPending}
      onClick={() => {
        if (!mutation.isPending) onSend()
      }}
    >
      {mutation.isPending ? 'Sending…' : 'Send test email to me'}
    </Button>
    {mutation.isSuccess && (
      <p role="status" className={cn('max-w-full text-sm text-muted-foreground break-words duration-200', FADE_IN)}>
        {testEmailSentMessage(email)}
      </p>
    )}
    {mutation.isError && (
      <p role="alert" className={cn('max-w-full text-sm font-medium text-destructive break-words duration-200', FADE_IN)}>
        {errorDetail(mutation.error) ?? SAVE_FALLBACK_ERROR}
      </p>
    )}
  </div>
)

const TemplateSection = ({
  section,
  subject,
  body,
  brandColorValue,
  brandColorError,
  disabled,
  onBrandColorChange,
  onSubjectChange,
  onBodyChange,
  actions,
}: TemplateSectionProps) => {
  const prefix = idPrefix(section)
  const headingId = `${prefix}-heading`
  const hintId = `${prefix}-hint`
  const subjectErrorId = `${prefix}-subject-error`
  const bodyErrorId = `${prefix}-body-error`
  const error = validateTemplate(section, subject, body)
  const subjectError = error?.field === 'subject' ? error.message : null
  const bodyError = error?.field === 'body' ? error.message : null
  const previewPayload = error === null && brandColorError === null ? draftEmailPayload(section, subject, body, brandColorValue) : null
  const hasActions = actions !== undefined && actions !== null && actions !== false

  return (
    <section aria-labelledby={headingId} className="space-y-6">
      <h3 id={headingId} className="text-sm font-medium">
        {section.title}
      </h3>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <BrandColorField
            id={`${prefix}-brand-color`}
            name={section.brandColorKey}
            label="Button colour"
            swatchLabel={`Pick ${section.id === 'invite' ? 'invite' : 'password reset'} button colour`}
            value={brandColorValue}
            error={brandColorError}
            disabled={disabled}
            onChange={onBrandColorChange}
          />
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-subject`}>Subject</Label>
            <Input
              id={`${prefix}-subject`}
              name={section.keys.subject}
              className={CONTROL_HEIGHT}
              autoComplete="off"
              value={subject}
              disabled={disabled}
              aria-invalid={subjectError !== null}
              aria-describedby={subjectError ? `${subjectErrorId} ${hintId}` : hintId}
              onChange={(event) => onSubjectChange(event.target.value)}
            />
            {subjectError && (
              <p id={subjectErrorId} role="alert" className={cn('text-sm font-medium text-destructive duration-150', FADE_IN)}>
                {subjectError}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-body`}>Body</Label>
            <Textarea
              id={`${prefix}-body`}
              name={section.keys.body}
              rows={10}
              className="min-h-48 resize-y"
              value={body}
              disabled={disabled}
              aria-invalid={bodyError !== null}
              aria-describedby={bodyError ? `${bodyErrorId} ${hintId}` : hintId}
              onChange={(event) => onBodyChange(event.target.value)}
            />
            {bodyError && (
              <p id={bodyErrorId} role="alert" className={cn('text-sm font-medium text-destructive duration-150', FADE_IN)}>
                {bodyError}
              </p>
            )}
          </div>
          <p id={hintId} className="text-xs text-muted-foreground">
            You can use <PlaceholderList placeholders={section.placeholders} />. The body must include{' '}
            <span className={mono}>{'{link}'}</span>.
          </p>
        </div>
        <div className="min-w-0">
          <EmailPreview section={section} payload={previewPayload} />
        </div>
      </div>
      {hasActions && actions}
    </section>
  )
}

const TemplateSectionWithTest = ({
  section,
  subject,
  body,
  brandColorValue,
  brandColorError,
  disabled,
  email,
  onBrandColorChange,
  onSubjectChange,
  onBodyChange,
  mutation,
  flight,
}: Omit<TemplateSectionProps, 'actions'> & {
  email: string | undefined
  flight: RefObject<SingleFlight>
  mutation: UseMutationResult<void, Error, EmailDraftPayload>
}) => (
  <TemplateSection
    section={section}
    subject={subject}
    body={body}
    brandColorValue={brandColorValue}
    brandColorError={brandColorError}
    disabled={disabled}
    onBrandColorChange={onBrandColorChange}
    onSubjectChange={onSubjectChange}
    onBodyChange={onBodyChange}
    actions={
      <TestEmailRow
        mutation={mutation}
        isDisabled={brandColorError !== null || validateTemplate(section, subject, body) !== null}
        email={email}
        onSend={() => {
          // The ref guard is synchronous; mutation.isPending lags a tick behind a double activation.
          if (brandColorError === null && flight.current.tryStart()) mutation.mutate(draftEmailPayload(section, subject, body, brandColorValue))
        }}
      />
    }
  />
)

export const EmailTemplatesCard = ({ page }: EmailTemplatesCardProps) => {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (updated) => {
      queryClient.setQueryData(settingQueries.page().queryKey, updated)
      setDraft({})
    },
  })

  // One mutation per section so their sending/result states stay independent.
  const me = useQuery(meQueries.detail())
  const inviteFlight = useRef(createSingleFlight())
  const resetFlight = useRef(createSingleFlight())
  const inviteTest = useMutation({ mutationFn: sendTestEmail, onSettled: () => inviteFlight.current.finish() })
  const resetTest = useMutation({ mutationFn: sendTestEmail, onSettled: () => resetFlight.current.finish() })
  const testMutations = { invite: inviteTest, password_reset: resetTest }
  const testFlights = { invite: inviteFlight, password_reset: resetFlight }

  const updates = emailTemplateUpdates(page.items, draft)
  const hasErrors = hasTemplateErrors(page.items, draft)
  const canSave = updates.length > 0 && !hasErrors
  const valueOf = (key: string) => draft[key] ?? savedTemplateValue(page.items, key)
  const setValue = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }))

  const { saveRef, savedRef, focusSave, markDiscarded } = useSettingsFocus({
    status: save.status,
    isSaveEnabled: canSave,
    firstFieldId: 'email-invite-brand-color',
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave || save.isPending) return
    focusSave()
    save.mutate(updates)
  }

  const handleDiscard = () => {
    setDraft({})
    save.reset()
    inviteTest.reset()
    resetTest.reset()
    markDiscarded()
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Email templates</CardTitle>
          <CardDescription>{CARD_DESCRIPTION}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {TEMPLATE_SECTIONS.map((section, index) => (
            <div key={section.id} className={cn(index > 0 && 'border-t border-border pt-6')}>
              <TemplateSectionWithTest
                section={section}
                email={me.data?.email}
                mutation={testMutations[section.id]}
                flight={testFlights[section.id]}
                subject={valueOf(section.keys.subject)}
                body={valueOf(section.keys.body)}
                brandColorValue={valueOf(section.brandColorKey)}
                brandColorError={validateBrandColor(valueOf(section.brandColorKey))}
                disabled={save.isPending}
                onBrandColorChange={(value) => setValue(section.brandColorKey, value)}
                onSubjectChange={(value) => setValue(section.keys.subject, value)}
                onBodyChange={(value) => setValue(section.keys.body, value)}
              />
            </div>
          ))}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          {save.isError && (
            <p role="alert" className={cn('text-sm font-medium text-destructive duration-150', FADE_IN)}>
              {errorDetail(save.error) ?? SAVE_FALLBACK_ERROR}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              ref={saveRef}
              type="submit"
              className="h-11 md:h-8 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              disabled={!canSave}
              // aria-disabled (not disabled) while saving, so keyboard focus stays on the button.
              aria-disabled={save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-8"
              disabled={updates.length === 0 || save.isPending}
              onClick={handleDiscard}
            >
              Discard changes
            </Button>
            {updates.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {updates.length === 1 ? '1 change' : `${updates.length} changes`}
              </span>
            )}
            {save.isSuccess && updates.length === 0 && (
              <span
                ref={savedRef}
                role="status"
                tabIndex={-1}
                className={cn('text-sm text-muted-foreground outline-none duration-150', FADE_IN)}
              >
                Saved.
              </span>
            )}
          </div>
        </CardFooter>
      </Card>
    </form>
  )
}
