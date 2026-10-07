import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'

import { GuardianBookingsSection } from '@/components/guardians/GuardianBookingsSection'
import { GuardianChildrenSection } from '@/components/guardians/GuardianChildrenSection'
import { GuardianLanguageSelect } from '@/components/guardians/GuardianLanguageSelect'
import {
  GuardianRemindersSection,
  GuardianRemindersSkeleton,
} from '@/components/guardians/GuardianRemindersSection'
import { HomesSection } from '@/components/guardians/HomesSection'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import { NO_CHAT_NOTE, isLanguageEditable, languageNote } from '@/lib/guardians/language'
import { updateConversationLanguage } from '@/lib/queries/conversations'
import { guardianQueries, updateGuardian, type GuardianUpdate } from '@/lib/queries/guardians'
import type { Language } from '@/lib/reminders/reminders'
import { cn } from '@/lib/utils'

type GuardianDraft = Required<GuardianUpdate>

type DetailFieldProps = {
  label: string
  children: ReactNode
}

const EMPTY_DRAFT: GuardianDraft = { name: '', phone_number: '', is_active: true }
const FALLBACK_ERROR = 'Something went wrong. Please try again.'
const LOADING_PAIRS = [0, 1, 2]
const LANGUAGE_ERROR_FALLBACK = 'Could not change the language.'
const LANGUAGE_SELECT_ID = 'guardian-language'
const bar = 'animate-pulse rounded-lg bg-muted motion-reduce:animate-none'
const GUARDIAN_FORM_ID = 'guardian-form'

export const GuardianDetail = () => {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(guardianQueries.detail(id))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<GuardianDraft>(EMPTY_DRAFT)

  const changeLanguage = useMutation({
    mutationFn: (language: Language | null) =>
      updateConversationLanguage(data?.language_conversation_id ?? '', language),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: guardianQueries.detail(id).queryKey }),
  })

  const save = useMutation({
    mutationFn: (values: GuardianDraft) => updateGuardian(id, values),
    onSuccess: (updated) => {
      queryClient.setQueryData(guardianQueries.detail(id).queryKey, updated)
      setEditing(false)
    },
  })

  let content: ReactNode

  const handleEdit = (values: GuardianDraft) => {
    setDraft(values)
    save.reset()
    setEditing(true)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      save.reset()
    }

    setEditing(open)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate(draft)
  }

  if (isPending) {
    content = (
      <>
        <Card aria-busy="true">
          <span className="sr-only">Loading guardian…</span>
          <CardHeader>
            <div className={cn(bar, 'h-5 w-24')} />
            <CardAction>
              <div className={cn(bar, 'h-7 w-12')} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {LOADING_PAIRS.map((pair) => (
                <div key={pair} className="space-y-1">
                  <div className={cn(bar, 'h-3 w-20')} />
                  <div
                    className={cn(
                      bar,
                      pair === 2 ? 'h-11 w-full max-w-64 md:h-8' : 'h-4 w-40',
                    )}
                  />
                  {pair === 2 && <div className={cn(bar, 'h-3 w-56 max-w-full')} />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <GuardianRemindersSkeleton />
      </>
    )
  } else if (isError) {
    content = (
      <Card>
        <CardContent className="space-y-4">
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(error) ?? FALLBACK_ERROR}
          </p>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  } else {
    content = (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Guardian</CardTitle>
            <CardAction>
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  handleEdit({
                    name: data.name,
                    phone_number: data.phone_number,
                    is_active: data.is_active,
                  })
                }
              >
                Edit
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DetailField label="Name">{data.name}</DetailField>
              <DetailField label="Phone number">{data.phone_number}</DetailField>
              {isLanguageEditable(data.language_conversation_id) ? (
                <div className="space-y-1">
                  <dt className="sr-only">Guardian language</dt>
                  <dd className="space-y-1">
                    <GuardianLanguageSelect
                      id={LANGUAGE_SELECT_ID}
                      variant="stacked"
                      value={changeLanguage.isPending ? changeLanguage.variables : data.language}
                      disabled={changeLanguage.isPending}
                      onChange={(language) => changeLanguage.mutate(language)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {changeLanguage.isPending ? 'Saving…' : languageNote(data.language)}
                    </p>
                    {changeLanguage.isError && (
                      <p
                        role="alert"
                        className="animate-in text-sm font-medium text-destructive duration-150 ease-out fade-in-0 motion-reduce:animate-none"
                      >
                        {errorDetail(changeLanguage.error) ?? LANGUAGE_ERROR_FALLBACK}
                      </p>
                    )}
                  </dd>
                </div>
              ) : (
                <DetailField label="Language">{NO_CHAT_NOTE}</DetailField>
              )}
            </dl>
          </CardContent>
        </Card>

        <GuardianRemindersSection guardianId={id} guardianName={data.name} />

        <HomesSection guardianId={id} guardian={data} />

        <GuardianChildrenSection guardianId={id} />
        <GuardianBookingsSection guardianId={id} />

        <SlideOver
          open={editing}
          onOpenChange={handleOpenChange}
          title="Edit guardian"
          description="Homes and children are managed on this page."
          footer={
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" form={GUARDIAN_FORM_ID} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
            </div>
          }
        >
          <form id={GUARDIAN_FORM_ID} onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="guardian-name">Name</Label>
              <Input
                id="guardian-name"
                name="name"
                required
                autoComplete="off"
                value={draft.name}
                disabled={save.isPending}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guardian-phone">Phone number</Label>
              <Input
                id="guardian-phone"
                name="phone_number"
                type="tel"
                required
                autoComplete="off"
                value={draft.phone_number}
                disabled={save.isPending}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, phone_number: event.target.value }))
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="guardian-active"
                name="is_active"
                type="checkbox"
                className="size-4 rounded-sm border-input accent-primary"
                checked={draft.is_active}
                disabled={save.isPending}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, is_active: event.target.checked }))
                }
              />
              <Label htmlFor="guardian-active">Active</Label>
            </div>
            {save.isError && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {errorDetail(save.error) ?? FALLBACK_ERROR}
              </p>
            )}
          </form>
        </SlideOver>
      </>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          to="/guardians"
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Back to guardians
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {data?.name ?? 'Guardian'}
          </h1>
          {data && <StatusBadge status={data.is_active ? 'active' : 'inactive'} />}
        </div>
      </div>
      {content}
    </div>
  )
}

const DetailField = ({ label, children }: DetailFieldProps) => (
  <div className="space-y-1">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm text-foreground">{children}</dd>
  </div>
)
