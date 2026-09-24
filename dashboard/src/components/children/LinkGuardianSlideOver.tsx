import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'

import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import { alreadyLinked, checkPhone, linkPayload, type PhoneCheck } from '@/lib/child-links/childLinks'
import { formatPhoneForDisplay } from '@/lib/guardians/guardians'
import { linkGuardian, type ChildDetail, type ChildRecord } from '@/lib/queries/children'

type LinkGuardianSlideOverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  child: ChildDetail
  onLinked: (child: ChildRecord) => void
}

const FALLBACK_ERROR = 'Something went wrong. Please try again.'

export const LinkGuardianSlideOver = ({
  open,
  onOpenChange,
  child,
  onLinked,
}: LinkGuardianSlideOverProps) => {
  const [phoneNumber, setPhoneNumber] = useState('')
  const [check, setCheck] = useState<PhoneCheck | null>(null)
  const [name, setName] = useState('')
  const [homeIds, setHomeIds] = useState<string[]>([])

  const lookup = useMutation({
    mutationFn: () => checkPhone(phoneNumber),
    onSuccess: (result) => setCheck(result),
  })

  const link = useMutation({
    mutationFn: () => linkGuardian(child.id, linkPayload(check as PhoneCheck, { phoneNumber, name, homeIds })),
    onSuccess: (record) => {
      onLinked(record)
      handleOpenChange(false)
    },
  })

  const activeHomes = child.homes.filter((home) => home.is_active)
  const isAlreadyLinked = check !== null && alreadyLinked(check, child)
  const isNewGuardian = check?.kind === 'free'
  const canSubmit =
    check !== null && !isAlreadyLinked && (!isNewGuardian || name.trim() !== '') && !lookup.isPending

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setPhoneNumber('')
      setCheck(null)
      setName('')
      setHomeIds([])
      lookup.reset()
      link.reset()
    }

    onOpenChange(next)
  }

  const handlePhoneChange = (value: string) => {
    setPhoneNumber(value)
    setCheck(null)
    lookup.reset()
    link.reset()
  }

  const toggleHome = (homeId: string) => {
    setHomeIds((current) =>
      current.includes(homeId) ? current.filter((id) => id !== homeId) : [...current, homeId],
    )
  }

  let resultContent: ReactNode = null

  if (check !== null) {
    const foundName = check.kind !== 'free' ? check.guardian.name : name.trim() || 'The new guardian'

    resultContent = (
      <div className="space-y-4">
        {check.kind !== 'free' && (
          <div className="space-y-1 rounded-lg border border-border p-3">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
              {check.guardian.name}
              {check.kind === 'inactive' && <StatusBadge status="inactive" />}
            </p>
            <p className="text-sm text-muted-foreground">
              {formatPhoneForDisplay(check.guardian.phone_number)}
            </p>
          </div>
        )}
        {isAlreadyLinked ? (
          <p className="text-sm text-muted-foreground">
            {foundName} is already linked to this child.
          </p>
        ) : (
          <>
            {isNewGuardian && (
              <div className="space-y-1.5">
                <Label htmlFor="link-guardian-name">Name</Label>
                <Input
                  id="link-guardian-name"
                  autoComplete="off"
                  value={name}
                  disabled={link.isPending}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{child.name}'s homes</p>
              {activeHomes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{child.name} has no active home.</p>
              ) : (
                <ul className="space-y-2">
                  {activeHomes.map((home) => (
                    <li key={home.id} className="flex items-center gap-2">
                      <input
                        id={`link-home-${home.id}`}
                        type="checkbox"
                        className="size-4 rounded-sm border-input accent-primary"
                        checked={homeIds.includes(home.id)}
                        disabled={link.isPending}
                        onChange={() => toggleHome(home.id)}
                      />
                      <Label htmlFor={`link-home-${home.id}`}>{home.label ?? home.address}</Label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                The homes checked join {foundName}'s own record. Once linked, they can book{' '}
                {child.name} at any of {child.name}'s homes over WhatsApp — a home with no label
                is shown by its street address, and the bot never sends an access code.
              </p>
              {isNewGuardian && homeIds.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {foundName} will have no home on file until one is added from their page.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <SlideOver
      open={open}
      onOpenChange={handleOpenChange}
      title="Add guardian"
      description="Look up the guardian's phone number first."
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={!canSubmit || link.isPending} onClick={() => link.mutate()}>
            {link.isPending ? 'Linking…' : 'Link guardian'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={link.isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="link-guardian-phone">Phone number</Label>
          <div className="flex gap-2">
            <Input
              id="link-guardian-phone"
              type="tel"
              autoComplete="off"
              value={phoneNumber}
              disabled={lookup.isPending || link.isPending}
              onChange={(event) => handlePhoneChange(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={phoneNumber.trim() === '' || lookup.isPending}
              onClick={() => lookup.mutate()}
            >
              {lookup.isPending ? 'Checking…' : 'Look up'}
            </Button>
          </div>
          {lookup.isError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorDetail(lookup.error) ?? FALLBACK_ERROR}
            </p>
          )}
        </div>
        {resultContent}
        {link.isError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(link.error) ?? FALLBACK_ERROR}
          </p>
        )}
      </div>
    </SlideOver>
  )
}
