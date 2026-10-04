// PROTOTYPE ONLY (ticket #112, screen `language`). Guardian language in the chat header and on
// the Guardian screen. Staff UI stays English; only the bot's messages follow the language.
import { useState } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GUARDIAN_NAME, GUARDIAN_PHONE, type GuardianLanguage } from '@/lib/prototype/staffScreensData'
import { ChatBubble, GuardianLanguageSelect } from './PrototypeChatParts'

const languageNote = (language: GuardianLanguage): string => {
  if (language === 'es') return 'The bot writes to this Guardian in Spanish.'
  if (language === 'en') return 'The bot writes to this Guardian in English.'
  return 'Not detected yet, so the bot writes in English.'
}

export const LanguageScreenPrototype = () => {
  const [language, setLanguage] = useState<GuardianLanguage>('es')

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="language-chat-heading">
        <p id="language-chat-heading" className="text-xs font-medium text-muted-foreground uppercase">
          In the chat thread header
        </p>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{GUARDIAN_NAME}</h1>
            <GuardianLanguageSelect id="chat-language" value={language} onChange={setLanguage} isInline />
          </div>
          <p className="text-sm text-muted-foreground">{GUARDIAN_PHONE} · 14 messages</p>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4">
          <ChatBubble author="guardian" time="Oct 4, 9:12 AM">
            Hola, quiero reservar una clase de matemáticas para Ana.
          </ChatBubble>
          <ChatBubble author="bot" label="Bot" time="Oct 4, 9:12 AM">
            ¡Claro! ¿Qué día le viene mejor?
          </ChatBubble>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="language-guardian-heading">
        <p id="language-guardian-heading" className="text-xs font-medium text-muted-foreground uppercase">
          On the Guardian screen
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-xs text-muted-foreground">Phone</dt>
                <dd className="text-sm">{GUARDIAN_PHONE}</dd>
              </div>
              <div className="space-y-1">
                <dt className="sr-only">Guardian language</dt>
                <dd className="space-y-1">
                  <GuardianLanguageSelect id="guardian-language" value={language} onChange={setLanguage} />
                  <p className="text-xs text-muted-foreground">{languageNote(language)}</p>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
