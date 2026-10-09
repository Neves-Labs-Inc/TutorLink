import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'

import BrandColorField from '@/components/settings/BrandColorField'
import EmailPreview from '@/components/settings/EmailPreview'
import EmailPreviewSkeleton from '@/components/settings/EmailPreviewSkeleton'
import { CONTROL_HEIGHT, FADE_IN, SKELETON_BAR } from '@/components/settings/emailTemplateClasses'
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
  BRAND_COLOR_KEY,
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
import { cn } from '@/lib/utils'

export type EmailTemplatesCardProps = {
  page: SettingsPage
}

type TemplateSectionProps = {
  section: TemplateSectionConfig
  subject: string
  body: string
  // Null while the draft colour is invalid; the preview and test send both need a valid one.
  brandColor: string | null
  disabled: boolean
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

// Every section sits under the brand colour block, so each has the divider.
const SkeletonSection = () => (
  <div className="space-y-6 border-t border-border pt-6">
    <div className={cn(SKELETON_BAR, 'h-4 w-16')} />
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-4">
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
      <BrandColorSkeleton />
      {TEMPLATE_SECTIONS.map((section) => (
        <SkeletonSection key={section.id} />
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
  brandColor,
  disabled,
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
  const previewPayload = error === null && brandColor !== null ? draftEmailPayload(section, subject, body, brandColor) : null
  const hasActions = actions !== undefined && actions !== null && actions !== false

  return (
    <section aria-labelledby={headingId} className="space-y-6">
      <h3 id={headingId} className="text-sm font-medium">
        {section.title}
      </h3>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
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
  brandColor,
  disabled,
  email,
  onSubjectChange,
  onBodyChange,
  mutation,
}: Omit<TemplateSectionProps, 'actions'> & {
  email: string | undefined
  mutation: UseMutationResult<void, Error, EmailDraftPayload>
}) => (
  <TemplateSection
    section={section}
    subject={subject}
    body={body}
    brandColor={brandColor}
    disabled={disabled}
    onSubjectChange={onSubjectChange}
    onBodyChange={onBodyChange}
    actions={
      <TestEmailRow
        mutation={mutation}
        isDisabled={brandColor === null || validateTemplate(section, subject, body) !== null}
        email={email}
        onSend={() => {
          if (brandColor !== null) mutation.mutate(draftEmailPayload(section, subject, body, brandColor))
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
  const inviteTest = useMutation({ mutationFn: sendTestEmail })
  const resetTest = useMutation({ mutationFn: sendTestEmail })
  const testMutations = { invite: inviteTest, password_reset: resetTest }

  const updates = emailTemplateUpdates(page.items, draft)
  const hasErrors = hasTemplateErrors(page.items, draft)
  const canSave = updates.length > 0 && !hasErrors && !save.isPending
  const valueOf = (key: string) => draft[key] ?? savedTemplateValue(page.items, key)
  const setValue = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const brandColor = valueOf(BRAND_COLOR_KEY)
  const brandColorError = validateBrandColor(brandColor)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (canSave) save.mutate(updates)
  }

  const handleDiscard = () => {
    setDraft({})
    save.reset()
    inviteTest.reset()
    resetTest.reset()
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Email templates</CardTitle>
          <CardDescription>{CARD_DESCRIPTION}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <BrandColorField
            value={brandColor}
            error={brandColorError}
            disabled={save.isPending}
            onChange={(value) => setValue(BRAND_COLOR_KEY, value)}
          />
          {TEMPLATE_SECTIONS.map((section) => (
            <div key={section.id} className="border-t border-border pt-6">
              <TemplateSectionWithTest
                section={section}
                email={me.data?.email}
                mutation={testMutations[section.id]}
                subject={valueOf(section.keys.subject)}
                body={valueOf(section.keys.body)}
                brandColor={brandColorError === null ? brandColor : null}
                disabled={save.isPending}
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
            <Button type="submit" className="h-11 md:h-8" disabled={!canSave}>
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
              <span className={cn('text-sm text-muted-foreground duration-150', FADE_IN)}>Saved.</span>
            )}
          </div>
        </CardFooter>
      </Card>
    </form>
  )
}
