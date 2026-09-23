import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export type MessageComposerProps = {
  disabled: boolean
  onSend: (body: string) => void
}

export const MessageComposer = ({ disabled, onSend }: MessageComposerProps) => {
  const [body, setBody] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmed = body.trim()

    if (trimmed !== '') {
      onSend(trimmed)
      setBody('')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-border p-3">
      <Textarea
        value={body}
        disabled={disabled}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a reply…"
        rows={2}
        className="min-h-0 flex-1 resize-none"
      />
      <Button type="submit" disabled={disabled || body.trim() === ''}>
        Send
      </Button>
    </form>
  )
}
