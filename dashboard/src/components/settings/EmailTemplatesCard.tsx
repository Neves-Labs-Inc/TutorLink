import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'

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
  type TestEmailPayload,
} from '@/lib/queries/settings'
import {
  TEMPLATE_SECTIONS,
  emailTemplateUpdates,
  hasTemplateErrors,
  previewSampleValues,
  renderPreview,
  savedTemplateValue,
  testEmailSentMessage,
  validateTemplate,
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
  disabled: boolean
  onSubjectChange: (value: string) => void
  onBodyChange: (value: string) => void
  // The section's test-send row; renders after the fields/preview grid.
  actions?: ReactNode
}

const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const CARD_DESCRIPTION = 'The emails TutorLink sends when you invite someone or they reset their password.'
const BLANK_PREVIEW = '—'
const FADE_IN = 'animate-in fade-in-0 ease-out motion-reduce:animate-none'
const bar = 'animate-pulse rounded-lg bg-muted motion-reduce:animate-none'
const controlClasses = 'h-11 md:h-10'
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

const SkeletonSection = ({ hasDivider }: { hasDivider: boolean }) => (
  <div className={cn('space-y-6', hasDivider && 'border-t border-border pt-6')}>
    <div className={cn(bar, 'h-4 w-16')} />
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className={cn(bar, 'h-4 w-14')} />
          <div className={cn(bar, 'h-11 w-full md:h-10')} />
        </div>
        <div className="space-y-1.5">
          <div className={cn(bar, 'h-4 w-10')} />
          <div className={cn(bar, 'h-[254px] w-full md:h-[214px]')} />
        </div>
        <div className={cn(bar, 'h-3 w-64 max-w-full')} />
      </div>
      <div className={cn(bar, 'h-48 w-full')} />
    </div>
    <div className={cn(bar, 'h-11 w-44 md:h-8')} />
  </div>
)

export const EmailTemplatesSkeleton = () => (
  <Card aria-busy="true">
    <CardHeader>
      <div className={cn(bar, 'h-5 w-32')} />
      <div className={cn(bar, 'h-4 w-80 max-w-full')} />
    </CardHeader>
    <CardContent className="space-y-6">
      {TEMPLATE_SECTIONS.map((section, index) => (
        <SkeletonSection key={section.id} hasDivider={index > 0} />
      ))}
    </CardContent>
    <CardFooter>
      <div className={cn(bar, 'h-11 w-28 md:h-8')} />
    </CardFooter>
  </Card>
)

type TestEmailRowProps = {
  mutation: UseMutationResult<void, Error, TestEmailPayload>
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
  const values = previewSampleValues(window.location.origin)
  const previewSubject = renderPreview(section, subject, values)
  const previewBody = renderPreview(section, body, values)
  const hasActions = actions !== undefined && actions !== null && actions !== false

  return (
    <section aria-labelledby={headingId} className="space-y-6">
      <h3 id={headingId} className="text-sm font-medium">
        {section.title}
      </h3>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-subject`}>Subject</Label>
            <Input
              id={`${prefix}-subject`}
              name={section.keys.subject}
              className={controlClasses}
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
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Preview <span className="font-normal">· Sample values</span>
          </p>
          <div
            aria-label={`${section.title} preview`}
            role="group"
            className="rounded-lg border border-border bg-muted px-3 py-2 text-sm"
          >
            <p className={cn('font-medium wrap-anywhere', previewSubject === '' && 'text-muted-foreground')}>
              {previewSubject || BLANK_PREVIEW}
            </p>
            <p
              className={cn('mt-2 whitespace-pre-wrap wrap-anywhere', previewBody === '' && 'text-muted-foreground')}
            >
              {previewBody || BLANK_PREVIEW}
            </p>
          </div>
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
  disabled,
  email,
  onSubjectChange,
  onBodyChange,
  mutation,
}: Omit<TemplateSectionProps, 'actions'> & {
  email: string | undefined
  mutation: UseMutationResult<void, Error, TestEmailPayload>
}) => (
  <TemplateSection
    section={section}
    subject={subject}
    body={body}
    disabled={disabled}
    onSubjectChange={onSubjectChange}
    onBodyChange={onBodyChange}
    actions={
      <TestEmailRow
        mutation={mutation}
        isDisabled={validateTemplate(section, subject, body) !== null}
        email={email}
        onSend={() => mutation.mutate({ template: section.id, subject, body })}
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
          {TEMPLATE_SECTIONS.map((section, index) => (
            <div key={section.id} className={cn(index > 0 && 'border-t border-border pt-6')}>
              <TemplateSectionWithTest
                section={section}
                email={me.data?.email}
                mutation={testMutations[section.id]}
                subject={valueOf(section.keys.subject)}
                body={valueOf(section.keys.body)}
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
