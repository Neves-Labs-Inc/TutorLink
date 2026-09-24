import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { nextHighlight, optionId as buildOptionId } from '@/lib/search-picker/searchPicker'

export type SearchPickerOption = { id: string; label: string; description?: string }

type SearchPickerProps = {
  id: string
  queryKeyPrefix: readonly unknown[]
  search: (term: string) => Promise<SearchPickerOption[]>
  value: SearchPickerOption | null
  onChange: (next: SearchPickerOption | null) => void
  placeholder?: string
  disabled?: boolean
  emptyMessage?: string
}

const SEARCH_DEBOUNCE_MS = 300
const optionRowClasses = 'cursor-pointer px-3 py-1.5'
const statusRowClasses = 'px-3 py-2 text-sm text-muted-foreground'

export const SearchPicker = ({
  id,
  queryKeyPrefix,
  search,
  value,
  onChange,
  placeholder,
  disabled,
  emptyMessage,
}: SearchPickerProps) => {
  const listboxId = `${id}-listbox`
  const [inputValue, setInputValue] = useState(value?.label ?? '')
  const [term, setTerm] = useState<string | null>(null)
  const [debouncedTerm, setDebouncedTerm] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [syncedValue, setSyncedValue] = useState(value)
  const skipNextBlurRevert = useRef(false)

  if (syncedValue !== value) {
    setSyncedValue(value)
    setInputValue(value?.label ?? '')
  }

  useEffect(() => {
    if (term === null) return

    const timer = setTimeout(() => setDebouncedTerm(term), SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [term])

  const query = useQuery({
    queryKey: [...queryKeyPrefix, debouncedTerm ?? ''],
    queryFn: () => search(debouncedTerm ?? ''),
    enabled: open && debouncedTerm !== null,
  })

  const options = query.data ?? []

  const startSearchIfNeeded = () => {
    if (term === null) {
      setTerm('')
      setDebouncedTerm('')
    }
  }

  const revertToValue = () => {
    setInputValue(value?.label ?? '')
    setTerm(null)
    setDebouncedTerm(null)
  }

  const selectOption = (option: SearchPickerOption) => {
    onChange(option)
    setInputValue(option.label)
    setOpen(false)
    setHighlighted(-1)
  }

  const handleFocus = () => {
    setOpen(true)
    startSearchIfNeeded()
  }

  const handleBlur = () => {
    if (skipNextBlurRevert.current) {
      skipNextBlurRevert.current = false
      return
    }

    setOpen(false)
    setHighlighted(-1)
    revertToValue()
  }

  const handleInputChange = (next: string) => {
    setInputValue(next)
    setOpen(true)
    setHighlighted(-1)
    setTerm(next)
  }

  const handleClear = () => {
    onChange(null)
    setInputValue('')
    setTerm('')
    setDebouncedTerm('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      startSearchIfNeeded()
      setHighlighted((current) => nextHighlight(current, event.key as 'ArrowDown' | 'ArrowUp', options.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()

      if (highlighted >= 0 && options[highlighted]) {
        selectOption(options[highlighted])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
      setHighlighted(-1)
      revertToValue()
    }
  }

  const activeOptionId =
    highlighted >= 0 && options[highlighted] ? buildOptionId(id, options[highlighted].id) : undefined

  let listboxContent: ReactNode

  if (query.isFetching) {
    listboxContent = <div className={statusRowClasses}>Searching…</div>
  } else if (query.isError) {
    listboxContent = <div className={cn(statusRowClasses, 'text-destructive')}>Couldn't load options.</div>
  } else if (options.length === 0) {
    listboxContent = <div className={statusRowClasses}>{emptyMessage ?? 'No matches.'}</div>
  } else {
    listboxContent = options.map((option, index) => (
      <div
        key={option.id}
        id={buildOptionId(id, option.id)}
        role="option"
        aria-selected={index === highlighted}
        onMouseDown={() => {
          skipNextBlurRevert.current = true
        }}
        onMouseEnter={() => setHighlighted(index)}
        onClick={() => selectOption(option)}
        className={cn(optionRowClasses, index === highlighted && 'bg-accent text-accent-foreground')}
      >
        <div className="text-sm">{option.label}</div>
        {option.description && <div className="text-xs text-muted-foreground">{option.description}</div>}
      </div>
    ))
  }

  return (
    <div className="relative">
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          value={inputValue}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(event) => handleInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          className={value ? 'pr-8' : undefined}
        />
        {value && (
          <button
            type="button"
            aria-label="Clear"
            disabled={disabled}
            onMouseDown={() => {
              skipNextBlurRevert.current = true
            }}
            onClick={handleClear}
            className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-popover py-1 shadow-md"
        >
          {listboxContent}
        </div>
      )}
    </div>
  )
}
