// PROTOTYPE ONLY (ticket #112, screen `chat`). Holder bar with Transfer to me, system lines,
// and the composer closed outside the Guardian's 24-hour window.
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'

import { PrototypeControls, PrototypeToggle } from '@/components/prototype/PrototypeControls'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  CURRENT_STAFF,
  GUARDIAN_NAME,
  GUARDIAN_PHONE,
  HOLDING_STAFF,
  type GuardianLanguage,
} from '@/lib/prototype/staffScreensData'
import { ChatBubble, GuardianLanguageSelect, SystemLine } from './PrototypeChatParts'

type Holder = 'bot' | 'other' | 'me'

type WindowState = 'open' | 'closed'

type RetryState = 'failed' | 'retrying' | 'sent'

const HOURS_SINCE_LAST_MESSAGE = 26

const backLinkClasses =
  'inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export const ChatScreenPrototype = () => {
  const [holder, setHolder] = useState<Holder>('other')
  const [windowState, setWindowState] = useState<WindowState>('open')
  const [language, setLanguage] = useState<GuardianLanguage>('es')
  const [isTransferOpen, setIsTransferOpen] = useState(false)
  const [retry, setRetry] = useState<RetryState>('failed')

  const isWindowClosed = windowState === 'closed'

  const handleRetry = () => {
    setRetry('retrying')
    // Fake latency so the pending label is visible.
    window.setTimeout(() => setRetry('sent'), 800)
  }

  return (
    <div className="space-y-4">
      <PrototypeControls>
        <PrototypeToggle
          label="held by"
          options={[
            { value: 'bot', label: 'bot' },
            { value: 'other', label: HOLDING_STAFF },
            { value: 'me', label: 'me' },
          ]}
          value={holder}
          onChange={setHolder}
        />
        <PrototypeToggle
          label="24h window"
          options={[
            { value: 'open', label: 'open' },
            { value: 'closed', label: 'closed' },
          ]}
          value={windowState}
          onChange={setWindowState}
        />
      </PrototypeControls>

      <div className="space-y-2">
        <a href="#" className={backLinkClasses} onClick={(event) => event.preventDefault()}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to chats
        </a>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{GUARDIAN_NAME}</h1>
          <GuardianLanguageSelect id="chat-screen-language" value={language} onChange={setLanguage} isInline />
        </div>
        <p className="text-sm text-muted-foreground">{GUARDIAN_PHONE} · 18 messages</p>
      </div>

      <div className="flex h-[calc(100dvh-14rem)] min-h-[24rem] flex-col overflow-hidden rounded-lg border border-border bg-card">
        {holder !== 'bot' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-4 py-2 text-sm">
            <p className="text-muted-foreground">
              {holder === 'other' ? `Held by ${HOLDING_STAFF}` : 'Held by you'}
            </p>
            {holder === 'other' ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setIsTransferOpen(true)}>
                Transfer to me
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setHolder('bot')}>
                Hand back to bot
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          <SystemLine>Weekly reminder sent: Ana and Luis · delivered</SystemLine>
          <ChatBubble author="guardian" time="Oct 3, 7:40 AM">
            Hola, ¿puede Luis cambiar al jueves?
          </ChatBubble>
          <ChatBubble author="bot" label="Bot" time="Oct 3, 7:40 AM">
            Le paso con la oficina para el cambio.
          </ChatBubble>
          <SystemLine>{HOLDING_STAFF} joined the chat · notice sent</SystemLine>
          <ChatBubble author="staff" label={HOLDING_STAFF} time="Oct 3, 8:02 AM">
            Hola Rosa, sí, el jueves a las 4 PM está libre.
          </ChatBubble>
          <SystemLine>Hand-back notice not sent (window closed)</SystemLine>
          {retry === 'sent' ? (
            <SystemLine>Takeover notice sent · delivered</SystemLine>
          ) : (
            <SystemLine
              isFailed
              action={
                <Button type="button" variant="outline" size="xs" disabled={retry === 'retrying'} onClick={handleRetry}>
                  {retry === 'retrying' ? 'Retrying…' : 'Retry'}
                </Button>
              }
            >
              Takeover notice not delivered (template not approved)
            </SystemLine>
          )}
        </div>

        {holder === 'me' &&
          (isWindowClosed ? (
            <div className="space-y-2 border-t border-border p-3">
              <p className="text-sm text-muted-foreground">
                {GUARDIAN_NAME} last wrote {HOURS_SINCE_LAST_MESSAGE} hours ago. WhatsApp only allows
                replies within 24 hours of their last message.
              </p>
              <div className="flex items-end gap-2">
                <Textarea disabled rows={2} placeholder="Replies are closed" className="min-h-0 flex-1 resize-none" />
                <Button type="button" disabled>
                  Send
                </Button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(event) => event.preventDefault()}
              className="flex items-end gap-2 border-t border-border p-3"
            >
              <Textarea rows={2} placeholder="Write a reply…" className="min-h-0 flex-1 resize-none" />
              <Button type="submit">Send</Button>
            </form>
          ))}

        {holder === 'bot' && (
          <div className="flex flex-col items-start gap-2 border-t border-border p-3">
            <Button type="button" onClick={() => setHolder('me')}>
              Take over
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={isTransferOpen}
        onOpenChange={setIsTransferOpen}
        title="Transfer to me"
        body={`${HOLDING_STAFF} is holding this chat. Take it over as ${CURRENT_STAFF}? ${HOLDING_STAFF} can no longer reply here.`}
        confirmLabel="Transfer to me"
        onConfirm={() => {
          setHolder('me')
          setIsTransferOpen(false)
        }}
      />
    </div>
  )
}
