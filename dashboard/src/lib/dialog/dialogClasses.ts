import { cn } from '@/lib/utils'

// The centred dialog look, shared by ConfirmDialog and MyProfileDialog. Lives outside both
// component files because react-refresh wants component files to export components only.
export const dialogOverlayClasses = cn(
  'fixed inset-0 z-50 bg-black/60',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'motion-reduce:animate-none',
)

export const dialogContentClasses = cn(
  'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2',
  'space-y-4 rounded-lg border border-border bg-card p-5 outline-none',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
  'motion-reduce:animate-none',
)
