import { useState, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import {
  SearchPicker,
  type SearchPickerOption,
} from '@/components/pickers/SearchPicker'
import { renderWithProviders } from '@/test/render-with-providers'

const COMMITTED_OPTION: SearchPickerOption = { id: '1', label: 'Ada Lovelace' }
const OPTIONS: SearchPickerOption[] = [
  COMMITTED_OPTION,
  { id: '2', label: 'Grace Hopper' },
]
const DIALOG_CONTENT_ID = 'picker-dialog'

function searchStub(): Promise<SearchPickerOption[]> {
  return Promise.resolve(OPTIONS)
}

type PickerInDialogProps = {
  initialValue: SearchPickerOption | null
}

// The same composition the Filters and Create Booking dialogs use: a picker inside
// a Radix Dialog, with another focusable control after it.
function PickerInDialog({ initialValue }: PickerInDialogProps): ReactNode {
  const [value, setValue] = useState(initialValue)

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Content id={DIALOG_CONTENT_ID} aria-describedby={undefined}>
          <Dialog.Title>Filters</Dialog.Title>
          <label htmlFor="child-picker">Child</label>
          <SearchPicker
            id="child-picker"
            queryKeyPrefix={['test-children']}
            search={searchStub}
            value={value}
            onChange={setValue}
          />
          <button type="button">Apply</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

describe('SearchPicker inside a dialog', () => {
  it('moves focus to the next control when tabbing out', async () => {
    // No committed value, so no Clear button sits between the input and Apply.
    await renderWithProviders(<PickerInDialog initialValue={null} />)
    const input = page.getByRole('combobox', { name: 'Child' })

    await userEvent.click(input)
    await expect
      .element(page.getByRole('option', { name: 'Grace Hopper' }))
      .toBeVisible()
    await userEvent.tab()

    await expect
      .element(page.getByRole('button', { name: 'Apply' }))
      .toHaveFocus()
    await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
  })

  it('reverts unmatched text to the committed value when tabbing out', async () => {
    await renderWithProviders(
      <PickerInDialog initialValue={COMMITTED_OPTION} />,
    )
    const input = page.getByRole('combobox', { name: 'Child' })

    await userEvent.click(input)
    await userEvent.type(input, 'zzz')
    await userEvent.tab()

    await expect.element(input).toHaveValue(COMMITTED_OPTION.label)
    const dialog = document.getElementById(DIALOG_CONTENT_ID)
    expect(dialog?.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(dialog)
  })
})
