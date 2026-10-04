// PROTOTYPE ONLY (ticket #112, screen `guardian`). Weekly reminders block on the Guardian screen.
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'

import { PrototypeControls, PrototypeToggle } from '@/components/prototype/PrototypeControls'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  CURRENT_STAFF,
  GUARDIAN_NAME,
  GUARDIAN_PHONE,
  TODAY_LABEL,
  type GuardianLanguage,
} from '@/lib/prototype/staffScreensData'
import { GuardianLanguageSelect } from './PrototypeChatParts'

type ConsentState = 'in' | 'out' | 'never'

type ConsentSource = 'Intake' | 'Message' | 'Staff' | 'System'

type ConsentEvent = { id: string; date: string; action: 'Opted in' | 'Opted out'; source: ConsentSource; who: string }

type LastReminderCase =
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'undeliverable'
  | 'skipped_takeover'
  | 'skipped_template'

const LAST_REMINDER_DETAIL: Record<LastReminderCase, { status: string; detail: string | null }> = {
  sent: { status: 'Sent', detail: null },
  delivered: { status: 'Delivered', detail: null },
  read: { status: 'Read', detail: null },
  failed: { status: 'Failed', detail: 'Error 63016: outside the allowed window.' },
  undeliverable: { status: 'Undeliverable', detail: 'Error 63024: number not on WhatsApp.' },
  skipped_takeover: { status: 'Skipped', detail: 'A Staff member held the chat (takeover).' },
  skipped_template: { status: 'Skipped', detail: 'Template not approved.' },
}

const HISTORY_BY_STATE: Record<ConsentState, ConsentEvent[]> = {
  in: [{ id: 'h1', date: 'Sep 30', action: 'Opted in', source: 'Intake', who: 'Bot' }],
  out: [
    { id: 'h2', date: 'Oct 3', action: 'Opted out', source: 'Message', who: GUARDIAN_NAME },
    { id: 'h1', date: 'Sep 30', action: 'Opted in', source: 'Intake', who: 'Bot' },
  ],
  never: [],
}

const historyColumns: Column<ConsentEvent>[] = [
  { id: 'date', header: 'Date', primary: true, cell: (row) => row.date },
  { id: 'action', header: 'Action', cell: (row) => row.action },
  { id: 'source', header: 'Source', cell: (row) => row.source },
  { id: 'who', header: 'Who', cell: (row) => row.who },
]

const backLinkClasses =
  'inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const describeState = (history: ConsentEvent[]): string => {
  const latest = history[0]
  if (latest === undefined) return 'Never opted in'
  const verb = latest.action === 'Opted in' ? 'Opted in since' : 'Opted out'
  const from = latest.source === 'System' ? 'WhatsApp reported the number blocked us' : `from ${latest.source === 'Message' ? 'a message' : latest.source}`
  return `${verb} ${latest.date}, ${from}`
}

export const GuardianScreenPrototype = () => {
  const [initialState, setInitialState] = useState<ConsentState>('in')
  const [history, setHistory] = useState<ConsentEvent[]>(HISTORY_BY_STATE.in)
  const [lastReminder, setLastReminder] = useState<LastReminderCase>('delivered')
  const [language, setLanguage] = useState<GuardianLanguage>('es')
  const [pendingAction, setPendingAction] = useState<'Opted in' | 'Opted out' | null>(null)

  const isOptedIn = history[0]?.action === 'Opted in'
  const reminder = LAST_REMINDER_DETAIL[lastReminder]

  const handleStateChange = (state: ConsentState) => {
    setInitialState(state)
    setHistory(HISTORY_BY_STATE[state])
  }

  const handleBlocked = () =>
    setHistory((current) => [
      { id: `h${current.length + 1}`, date: TODAY_LABEL, action: 'Opted out', source: 'System', who: 'WhatsApp' },
      ...current,
    ])

  const handleConfirm = () => {
    if (pendingAction === null) return
    setHistory((current) => [
      { id: `h${current.length + 1}`, date: TODAY_LABEL, action: pendingAction, source: 'Staff', who: CURRENT_STAFF },
      ...current,
    ])
    setPendingAction(null)
  }

  return (
    <div className="space-y-6">
      <PrototypeControls>
        <PrototypeToggle
          label="consent"
          options={[
            { value: 'in', label: 'opted in' },
            { value: 'out', label: 'opted out' },
            { value: 'never', label: 'never' },
          ]}
          value={initialState}
          onChange={handleStateChange}
        />
        <button
          type="button"
          className="rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 hover:bg-muted"
          onClick={handleBlocked}
        >
          simulate System opt-out (blocked)
        </button>
        <PrototypeToggle
          label="last reminder"
          options={(Object.keys(LAST_REMINDER_DETAIL) as LastReminderCase[]).map((key) => ({
            value: key,
            label: key.replace('_', ' '),
          }))}
          value={lastReminder}
          onChange={setLastReminder}
        />
      </PrototypeControls>

      <div className="space-y-2">
        <a href="#" className={backLinkClasses} onClick={(event) => event.preventDefault()}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to guardians
        </a>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{GUARDIAN_NAME}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardAction>
            <Button type="button" size="sm">
              Edit
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">Phone</dt>
              <dd className="text-sm">{GUARDIAN_PHONE}</dd>
            </div>
            <div className="space-y-1">
              <dt className="sr-only">Guardian language</dt>
              <dd>
                <GuardianLanguageSelect id="guardian-screen-language" value={language} onChange={setLanguage} />
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">Children</dt>
              <dd className="text-sm">Ana Torres, Luis Torres</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">Notes</dt>
              <dd className="text-sm">—</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly reminders</CardTitle>
          <CardAction>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPendingAction(isOptedIn ? 'Opted out' : 'Opted in')}
            >
              {isOptedIn ? 'Record opt-out' : 'Record opt-in'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">Current state</dt>
              <dd className="text-sm font-medium">{describeState(history)}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">Last reminder</dt>
              <dd className="text-sm">
                Week of Sep 28 · <span className="font-medium">{reminder.status}</span>
                {reminder.detail && (
                  <span
                    className={
                      lastReminder === 'failed' || lastReminder === 'undeliverable'
                        ? 'block text-sm font-medium text-destructive'
                        : 'block text-xs text-muted-foreground'
                    }
                  >
                    {reminder.detail}
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Consent history</h3>
            <DataTable
              caption="Consent history"
              columns={historyColumns}
              rows={history}
              rowKey={(row) => row.id}
              status="ready"
              emptyMessage="No consent recorded yet."
            />
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title={pendingAction === 'Opted in' ? 'Record opt-in' : 'Record opt-out'}
        body={
          pendingAction === 'Opted in'
            ? `Only record this if ${GUARDIAN_NAME} asked for weekly reminders. It is saved with source Staff and your name.`
            : `${GUARDIAN_NAME} stops getting weekly reminders. It is saved with source Staff and your name.`
        }
        confirmLabel={pendingAction === 'Opted in' ? 'Record opt-in' : 'Record opt-out'}
        onConfirm={handleConfirm}
      />
    </div>
  )
}
