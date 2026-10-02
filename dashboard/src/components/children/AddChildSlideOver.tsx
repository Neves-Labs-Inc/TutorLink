import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'

import { ChildFields } from '@/components/children/ChildFields'
import { SearchPicker, type SearchPickerOption } from '@/components/pickers/SearchPicker'
import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import { GRADE_LEVEL_ERROR, childDraftErrors, childInput, homesToOffer, EMPTY_CHILD_DRAFT, type ChildDraft } from '@/lib/children/children'
import { formatPhoneForDisplay } from '@/lib/guardians/guardians'
import { createChild, type ChildRecord } from '@/lib/queries/children'
import { guardianQueries, type GuardianDetail } from '@/lib/queries/guardians'
import { cn } from '@/lib/utils'

type ChosenGuardian = { id: string; name: string }

type AddChildSlideOverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  fixedGuardian?: { id: string; name: string }
  onCreated: (child: ChildRecord) => void
}

const FORM_ID = 'add-child-form'
const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const GUARDIAN_PICKER_PAGE_SIZE = 20
const checkboxClasses = 'size-4 rounded border-input'
const alertClasses = 'text-sm font-medium text-destructive'

const initialGuardiansFor = (fixedGuardian?: { id: string; name: string }): ChosenGuardian[] =>
  fixedGuardian ? [{ id: fixedGuardian.id, name: fixedGuardian.name }] : []

export const AddChildSlideOver = ({
  open,
  onOpenChange,
  fixedGuardian,
  onCreated,
}: AddChildSlideOverProps) => {
  const queryClient = useQueryClient()
  const [guardians, setGuardians] = useState<ChosenGuardian[]>(() => initialGuardiansFor(fixedGuardian))
  const [pickerValue, setPickerValue] = useState<SearchPickerOption | null>(null)
  const [uncheckedHomeIds, setUncheckedHomeIds] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<ChildDraft>(EMPTY_CHILD_DRAFT)
  const [submitted, setSubmitted] = useState(false)

  const guardianDetailQueries = useQueries({
    queries: guardians.map((guardian) => guardianQueries.detail(guardian.id)),
  })
  const guardianDetails = guardianDetailQueries
    .map((query) => query.data)
    .filter((detail): detail is GuardianDetail => detail !== undefined)
  const detailsLoaded = guardianDetailQueries.every((query) => query.data !== undefined)
  const detailsErrored = guardianDetailQueries.some((query) => query.isError)
  const homes = homesToOffer(guardianDetails)
  const selectedHomeIds = homes
    .filter((home) => !uncheckedHomeIds.has(home.id))
    .map((home) => home.id)
  const noActiveHomes = detailsLoaded && homes.length === 0

  const create = useMutation({ mutationFn: createChild })
  const busy = create.isPending

  const localErrors = childDraftErrors(draft, new Date())
  const guardianErrors = guardians.length === 0 ? ['Choose at least one guardian.'] : []
  const homeErrors =
    detailsLoaded && homes.length > 0 && selectedHomeIds.length === 0
      ? ['Choose at least one home.']
      : []
  const errors = [...guardianErrors, ...homeErrors, ...localErrors]
  const saveDisabled = busy || guardians.length === 0 || !detailsLoaded || noActiveHomes

  const resetAndClose = () => {
    setGuardians(initialGuardiansFor(fixedGuardian))
    setPickerValue(null)
    setUncheckedHomeIds(new Set())
    setDraft(EMPTY_CHILD_DRAFT)
    setSubmitted(false)
    create.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true)
    } else {
      resetAndClose()
    }
  }

  const searchGuardians = async (term: string): Promise<SearchPickerOption[]> => {
    const chosenIds = new Set(guardians.map((guardian) => guardian.id))
    const page = await queryClient.fetchQuery(
      guardianQueries.list({ q: term, is_active: true, page_size: GUARDIAN_PICKER_PAGE_SIZE }),
    )

    return page.items
      .filter((guardian) => !chosenIds.has(guardian.id))
      .map((guardian) => ({
        id: guardian.id,
        label: guardian.name,
        description: formatPhoneForDisplay(guardian.phone_number),
      }))
  }

  const handlePickGuardian = (option: SearchPickerOption | null) => {
    if (option !== null) {
      setGuardians((current) => [...current, { id: option.id, name: option.label }])
    }

    setPickerValue(null)
  }

  const handleRemoveGuardian = (guardianId: string) => {
    setGuardians((current) => current.filter((guardian) => guardian.id !== guardianId))
  }

  const toggleHome = (homeId: string) => {
    setUncheckedHomeIds((current) => {
      const next = new Set(current)

      if (next.has(homeId)) {
        next.delete(homeId)
      } else {
        next.add(homeId)
      }

      return next
    })
  }

  const handleSubmit = () => {
    setSubmitted(true)

    if (errors.length === 0) {
      create.mutate(
        {
          ...childInput(draft),
          guardian_ids: guardians.map((guardian) => guardian.id),
          home_ids: selectedHomeIds,
        },
        {
          onSuccess: (child) => {
            queryClient.invalidateQueries({ queryKey: ['children'] })
            queryClient.invalidateQueries({ queryKey: ['guardians'] })
            queryClient.invalidateQueries({ queryKey: ['households'] })
            onCreated(child)
            resetAndClose()
          },
        },
      )
    } else {
      create.reset()
    }
  }

  let homesContent: ReactNode

  if (detailsErrored) {
    homesContent = (
      <p role="alert" className="text-sm font-medium text-destructive">
        Could not load the selected guardians' homes. Try again.
      </p>
    )
  } else if (!detailsLoaded) {
    homesContent = <p className="text-sm text-muted-foreground">Loading homes…</p>
  } else if (noActiveHomes) {
    homesContent = (
      <p className="text-sm text-muted-foreground">
        None of the selected guardians has an active home. Add one on a guardian's page first.{' '}
        {guardians.map((guardian, index) => (
          <span key={guardian.id}>
            {index > 0 && ', '}
            <Link to={`/guardians/${guardian.id}`} className="underline">
              {guardian.name}
            </Link>
          </span>
        ))}
      </p>
    )
  } else {
    homesContent = (
      <ul className="space-y-1.5">
        {homes.map((home) => (
          <li key={home.id} className="flex items-center gap-2">
            <input
              id={`add-child-home-${home.id}`}
              type="checkbox"
              className={checkboxClasses}
              checked={!uncheckedHomeIds.has(home.id)}
              disabled={busy}
              onChange={() => toggleHome(home.id)}
            />
            <Label htmlFor={`add-child-home-${home.id}`}>
              {home.label === null ? home.address : `${home.label} — ${home.address}`}
            </Label>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <SlideOver
      open={open}
      onOpenChange={handleOpenChange}
      title="Add child"
      footer={
        <div className="space-y-3">
          {submitted && errors.length > 0 && (
            <ul role="alert" className={cn(alertClasses, 'space-y-1')}>
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          {create.isError && (
            <p role="alert" className={alertClasses}>
              {errorDetail(create.error) ?? SAVE_FALLBACK_ERROR}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" form={FORM_ID} disabled={saveDisabled}>
              {busy ? 'Adding…' : 'Add child'}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={resetAndClose}>
              Cancel
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          handleSubmit()
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label>Guardians</Label>
          <ul className="space-y-2">
            {guardians.map((guardian, index) => {
              const detail = guardianDetailQueries[index]?.data
              const isFixed = fixedGuardian !== undefined && guardian.id === fixedGuardian.id

              return (
                <li
                  key={guardian.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium">{guardian.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {detail ? formatPhoneForDisplay(detail.phone_number) : 'Loading…'}
                    </div>
                  </div>
                  {!isFixed && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleRemoveGuardian(guardian.id)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          <SearchPicker
            id="add-child-guardian-picker"
            queryKeyPrefix={['guardians', 'picker']}
            search={searchGuardians}
            value={pickerValue}
            onChange={handlePickGuardian}
            disabled={busy}
            placeholder="Search guardians by name"
          />
        </div>

        <div className="space-y-2">
          <Label>Homes</Label>
          {homesContent}
        </div>

        <ChildFields
          idPrefix="add-child"
          value={draft}
          onChange={setDraft}
          disabled={busy}
          isGradeInvalid={submitted && localErrors.includes(GRADE_LEVEL_ERROR)}
          today={new Date()}
        />
      </form>
    </SlideOver>
  )
}
