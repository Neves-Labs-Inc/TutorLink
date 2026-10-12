import { useState, type ReactNode } from 'react'
import { QueryClient, queryOptions } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ManageSubjectsSlideOver } from '@/components/tutors/ManageSubjectsSlideOver'
import type { Subject } from '@/lib/queries/subjects'
import { createTestQueryClient, renderWithProviders } from '@/test/render-with-providers'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: Error) => void = () => {}
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

const BIOLOGY: Subject = {
  id: 'subject-a',
  name: 'Biology',
  name_es: 'Biología',
  description: null,
  is_active: true,
  tutor_count: 2,
}
const CHEMISTRY: Subject = {
  id: 'subject-b',
  name: 'Chemistry',
  name_es: null,
  description: 'Labs included',
  is_active: true,
  tutor_count: 1,
}
const DESKTOP_WIDTH = 1280
const DESKTOP_HEIGHT = 800

const subjectsApi = vi.hoisted(() => ({
  listSubjects: vi.fn(),
  createSubject: vi.fn(),
  updateSubject: vi.fn(),
  deactivateSubject: vi.fn(),
}))

vi.mock('@/lib/queries/subjects', () => ({
  subjectQueries: {
    list: (params: object) =>
      queryOptions({
        queryKey: ['subjects', 'list', params],
        queryFn: subjectsApi.listSubjects,
      }),
  },
  createSubject: subjectsApi.createSubject,
  updateSubject: subjectsApi.updateSubject,
  deactivateSubject: subjectsApi.deactivateSubject,
}))

let queryClient: QueryClient

function renderSlideOver(onSubjectDeactivated = vi.fn()) {
  return renderWithProviders(
    <ManageSubjectsSlideOver
      open
      onOpenChange={() => {}}
      onSubjectDeactivated={onSubjectDeactivated}
    />,
    queryClient,
  )
}

// The panel's open state lives here, so a test can close it with the X and reopen it.
function ClosableSlideOver(): ReactNode {
  const [open, setOpen] = useState(true)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open subjects
      </button>
      <ManageSubjectsSlideOver open={open} onOpenChange={setOpen} />
    </>
  )
}

// A mutation stays pending until its onSuccess/onError handler has finished, refresh included.
async function waitForSavesToSettle(): Promise<void> {
  await expect.poll(() => queryClient.isMutating()).toBe(0)
}

// Samples the focused element on every DOM mutation and every frame; stop() says whether
// focus was ever on <body>.
function trackBodyFocus(): { stop: () => boolean } {
  let sawBody = false
  const sample = () => {
    if (document.activeElement === document.body) sawBody = true
  }
  const observer = new MutationObserver(sample)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true })
  let frame = requestAnimationFrame(function tick() {
    sample()
    frame = requestAnimationFrame(tick)
  })

  return {
    stop: () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      return sawBody
    },
  }
}

// Chromium moves focus off a disabled element while rendering, so a save has to stay
// pending across a few frames for a focus drop to show up.
async function renderFrames(count = 3): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise(requestAnimationFrame)
  }
}

async function stubSubjectList(): Promise<void> {
  vi.clearAllMocks()
  queryClient = createTestQueryClient()
  await page.viewport(DESKTOP_WIDTH, DESKTOP_HEIGHT)
  subjectsApi.listSubjects.mockResolvedValue({
    items: [BIOLOGY, CHEMISTRY],
    total: 2,
    page: 1,
    page_size: 20,
  })
}

const title = (name: string) => page.getByRole('heading', { name, exact: true })
const nameInput = () => page.getByLabelText('Name', { exact: true })
const saveButton = () => page.getByRole('button', { name: 'Save', exact: true })
const savingButton = () => page.getByRole('button', { name: 'Saving…' })
const backButton = () => page.getByRole('button', { name: 'Back to subjects' })
const addButton = () => page.getByRole('button', { name: 'Add subject' })
const closeButton = () => page.getByRole('button', { name: 'Close' })
const descriptionInput = () => page.getByLabelText('Description (optional)')
const subjectRow = (name: string) => page.getByRole('row', { name: new RegExp(name) })
const confirmDialog = () => page.getByRole('dialog', { name: 'Deactivate subject' })

describe('ManageSubjectsSlideOver late saves', () => {
  beforeEach(stubSubjectList)

  it('keeps a newer edit form open when an older update resolves', async () => {
    const save = createDeferred<Subject>()
    subjectsApi.updateSubject.mockReturnValue(save.promise)
    await renderSlideOver()

    await userEvent.click(subjectRow('Biology'))
    await userEvent.fill(nameInput(), 'Biology II')
    await userEvent.click(saveButton())
    await userEvent.click(backButton())
    await userEvent.click(subjectRow('Chemistry'))
    save.resolve({ ...BIOLOGY, name: 'Biology II' })

    await waitForSavesToSettle()
    await expect.element(title('Edit subject')).toBeVisible()
    await expect.element(nameInput()).toHaveValue('Chemistry')
    await expect.element(page.getByLabelText('Description (optional)')).toHaveValue('Labs included')
  })

  it('keeps a second create form draft when the first create resolves', async () => {
    const save = createDeferred<Subject>()
    subjectsApi.createSubject.mockReturnValue(save.promise)
    await renderSlideOver()

    await userEvent.click(addButton())
    await userEvent.fill(nameInput(), 'Physics')
    await userEvent.click(saveButton())
    await userEvent.click(backButton())
    await userEvent.click(addButton())
    await userEvent.fill(nameInput(), 'Geology')
    save.resolve({ ...CHEMISTRY, id: 'subject-c', name: 'Physics' })

    await waitForSavesToSettle()
    await expect.element(title('Add subject')).toBeVisible()
    await expect.element(nameInput()).toHaveValue('Geology')
    await expect.element(nameInput()).toHaveFocus()
  })

  it('keeps edits in a reopened form of the same subject', async () => {
    const save = createDeferred<Subject>()
    subjectsApi.updateSubject.mockReturnValue(save.promise)
    await renderSlideOver()

    await userEvent.click(subjectRow('Biology'))
    await userEvent.fill(descriptionInput(), 'First pass')
    await userEvent.click(saveButton())
    await userEvent.click(backButton())
    await userEvent.click(subjectRow('Biology'))
    await userEvent.fill(descriptionInput(), 'Second pass')
    save.resolve({ ...BIOLOGY, description: 'First pass' })

    await waitForSavesToSettle()
    await expect.element(title('Edit subject')).toBeVisible()
    await expect.element(descriptionInput()).toHaveValue('Second pass')
    await expect.element(descriptionInput()).toHaveFocus()
  })

  it('returns to the list with focus on Add subject when the user stayed on the form', async () => {
    const save = createDeferred<Subject>()
    subjectsApi.createSubject.mockReturnValue(save.promise)
    await renderSlideOver()

    await userEvent.click(addButton())
    await userEvent.fill(nameInput(), 'Physics')
    await userEvent.click(saveButton())
    await expect.element(savingButton()).toHaveAttribute('aria-disabled', 'true')
    save.resolve({ ...CHEMISTRY, id: 'subject-c', name: 'Physics' })

    await expect.element(title('Subjects')).toBeVisible()
    await expect.element(addButton()).toHaveFocus()
    await userEvent.click(addButton())
    await expect.element(nameInput()).toHaveValue('')
  })

  it('leaves the list and focus alone when the user went back before the save resolved', async () => {
    const save = createDeferred<Subject>()
    subjectsApi.createSubject.mockReturnValue(save.promise)
    await renderSlideOver()

    await userEvent.click(addButton())
    await userEvent.fill(nameInput(), 'Physics')
    await userEvent.click(saveButton())
    await userEvent.click(backButton())
    const filter = page.getByLabelText('Show inactive subjects')
    filter.element().focus()
    save.resolve({ ...CHEMISTRY, id: 'subject-c', name: 'Physics' })

    await waitForSavesToSettle()
    await expect.element(title('Subjects')).toBeVisible()
    await expect.element(filter).toHaveFocus()
  })

  it('refreshes subjects and tutors and reports a deactivation after a late update', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    const onSubjectDeactivated = vi.fn()
    const save = createDeferred<Subject>()
    subjectsApi.updateSubject.mockReturnValue(save.promise)
    await renderSlideOver(onSubjectDeactivated)

    await userEvent.click(subjectRow('Biology'))
    await userEvent.click(page.getByLabelText('Active'))
    await userEvent.click(saveButton())
    await userEvent.click(backButton())
    save.resolve({ ...BIOLOGY, is_active: false })

    await waitForSavesToSettle()
    expect(subjectsApi.listSubjects.mock.calls.length).toBeGreaterThan(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['subjects'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tutors'] })
    expect(onSubjectDeactivated).toHaveBeenCalledWith(BIOLOGY.id)
    invalidate.mockRestore()
  })

  it('keeps the deactivate dialog open on Esc mid-request, then ends focus on Add subject', async () => {
    const onSubjectDeactivated = vi.fn()
    const deactivation = createDeferred<Subject>()
    subjectsApi.deactivateSubject.mockReturnValue(deactivation.promise)
    await renderSlideOver(onSubjectDeactivated)

    await userEvent.click(subjectRow('Biology'))
    await userEvent.click(page.getByRole('button', { name: 'Deactivate' }))
    const focus = trackBodyFocus()
    await userEvent.click(confirmDialog().getByRole('button', { name: 'Deactivate' }))
    await expect.element(confirmDialog().getByRole('button', { name: 'Working…' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await renderFrames()
    await expect.element(confirmDialog()).toHaveAttribute('data-state', 'open')
    deactivation.resolve({ ...BIOLOGY, is_active: false })

    await expect.element(confirmDialog()).not.toBeInTheDocument()
    await expect.element(addButton()).toHaveFocus()
    expect(focus.stop()).toBe(false)
    expect(onSubjectDeactivated).toHaveBeenCalledWith(BIOLOGY.id)
  })

  it('opens a newer form idle while an older save is in flight', async () => {
    subjectsApi.updateSubject.mockReturnValue(createDeferred<Subject>().promise)
    await renderSlideOver()

    await userEvent.click(subjectRow('Biology'))
    await userEvent.click(saveButton())
    await userEvent.click(backButton())
    await userEvent.click(subjectRow('Chemistry'))

    await expect.element(nameInput()).toBeEnabled()
    await expect.element(saveButton()).toBeEnabled()
  })

  it('shows nothing in a newer form when an older save fails', async () => {
    const save = createDeferred<Subject>()
    subjectsApi.updateSubject.mockReturnValue(save.promise)
    await renderSlideOver()

    await userEvent.click(subjectRow('Biology'))
    await userEvent.click(saveButton())
    await userEvent.click(backButton())
    await userEvent.click(subjectRow('Chemistry'))
    save.reject(new Error('Network down'))

    await waitForSavesToSettle()
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(nameInput()).toHaveValue('Chemistry')
  })

  it('stays closed when a save from before the close resolves', async () => {
    const save = createDeferred<Subject>()
    subjectsApi.createSubject.mockReturnValue(save.promise)
    await renderWithProviders(<ClosableSlideOver />, queryClient)

    await userEvent.click(addButton())
    await userEvent.fill(nameInput(), 'Physics')
    await userEvent.click(saveButton())
    await userEvent.click(closeButton())
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    save.resolve({ ...CHEMISTRY, id: 'subject-c', name: 'Physics' })

    await waitForSavesToSettle()
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('leaves a reopened session alone when a save from before the close resolves', async () => {
    const save = createDeferred<Subject>()
    subjectsApi.createSubject.mockReturnValue(save.promise)
    await renderWithProviders(<ClosableSlideOver />, queryClient)

    await userEvent.click(addButton())
    await userEvent.fill(nameInput(), 'Physics')
    await userEvent.click(saveButton())
    await userEvent.click(closeButton())
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: 'Open subjects' }))
    await userEvent.click(addButton())
    await userEvent.fill(nameInput(), 'Geology')
    save.resolve({ ...CHEMISTRY, id: 'subject-c', name: 'Physics' })

    await waitForSavesToSettle()
    await expect.element(title('Add subject')).toBeVisible()
    await expect.element(nameInput()).toHaveValue('Geology')
    await expect.element(nameInput()).toHaveFocus()
  })
})

describe('ManageSubjectsSlideOver focus during saves', () => {
  beforeEach(stubSubjectList)

  it('never drops focus to <body> during a clicked save and ends on Add subject', async () => {
    const save = createDeferred<Subject>()
    subjectsApi.createSubject.mockReturnValue(save.promise)
    await renderSlideOver()

    await userEvent.click(addButton())
    await userEvent.fill(nameInput(), 'Physics')
    const focus = trackBodyFocus()
    await userEvent.click(saveButton())
    await expect.element(savingButton()).toHaveFocus()
    await expect.element(savingButton()).toHaveAttribute('aria-disabled', 'true')
    await renderFrames()
    save.resolve({ ...CHEMISTRY, id: 'subject-c', name: 'Physics' })

    await expect.element(addButton()).toHaveFocus()
    expect(focus.stop()).toBe(false)
  })

  it('moves focus to Save on Enter in a field and ignores a second Enter', async () => {
    const save = createDeferred<Subject>()
    subjectsApi.updateSubject.mockReturnValue(save.promise)
    await renderSlideOver()

    await userEvent.click(subjectRow('Biology'))
    await userEvent.fill(nameInput(), 'Biology II')
    const focus = trackBodyFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(savingButton()).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(subjectsApi.updateSubject).toHaveBeenCalledTimes(1)
    await renderFrames()
    save.resolve({ ...BIOLOGY, name: 'Biology II' })

    await expect.element(addButton()).toHaveFocus()
    expect(focus.stop()).toBe(false)
  })

  it('keeps focus on Save and re-enables the fields when the save fails', async () => {
    const save = createDeferred<Subject>()
    subjectsApi.createSubject.mockReturnValue(save.promise)
    await renderSlideOver()

    await userEvent.click(addButton())
    await userEvent.fill(nameInput(), 'Physics')
    await userEvent.click(saveButton())
    await renderFrames()
    save.reject(new Error('Network down'))

    await expect.element(page.getByRole('alert')).toBeVisible()
    await expect.element(saveButton()).toHaveFocus()
    await expect.element(nameInput()).toBeEnabled()
  })
})
