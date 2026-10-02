import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { shouldSubmitOnKey } from '@/lib/message-composer/shouldSubmitOnKey'

export type MessageComposerProps = {
  disabled: boolean
  onSend: (body: string) => void
}

export const MessageComposer = ({ disabled, onSend }: MessageComposerProps) => {
  const [body, setBody] = useState('')

  const hintId = useId()

  const submit = () => {
    const trimmed = body.trim()

    if (trimmed !== '') {
      onSend(trimmed)
      setBody('')
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSubmitOnKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return

    // Also stops Enter from inserting a newline when the reply is empty.
    event.preventDefault()
    if (!disabled) submit()
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-border p-3 md:space-y-1.5">
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          disabled={disabled}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-describedby={hintId}
          placeholder="Write a reply…"
          rows={2}
          className="min-h-0 flex-1 resize-none"
        />
        <Button type="submit" disabled={disabled || body.trim() === ''}>
          Send
        </Button>
      </div>
      <p id={hintId} className="sr-only text-xs text-muted-foreground md:not-sr-only">
        Enter to send · Shift+Enter for a new line
      </p>
    </form>
  )
}
