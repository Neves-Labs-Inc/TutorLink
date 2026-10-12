import { QueryClient, queryOptions } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ManageSubjectsSlideOver } from '@/components/tutors/ManageSubjectsSlideOver'
import type { Subject } from '@/lib/queries/subjects'
import { renderWithProviders } from '@/test/render-with-providers'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
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
// Time for the save's success handler to finish after the list refetch lands.
const SETTLE_MS = 100

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

function renderSlideOver(onSubjectDeactivated = vi.fn()) {
  return renderWithProviders(
    <ManageSubjectsSlideOver
      open
      onOpenChange={() => {}}
      onSubjectDeactivated={onSubjectDeactivated}
    />,
  )
}

// Waits until a save's refresh has refetched the list and its success handler has run.
async function waitForRefresh(): Promise<void> {
  await expect.poll(() => subjectsApi.listSubjects.mock.calls.length).toBeGreaterThan(1)
  await new Promise((settle) => setTimeout(settle, SETTLE_MS))
}

const title = (name: string) => page.getByRole('heading', { name, exact: true })
const nameInput = () => page.getByLabelText('Name', { exact: true })
const saveButton = () => page.getByRole('button', { name: 'Save', exact: true })
const backButton = () => page.getByRole('button', { name: 'Back to subjects' })
const addButton = () => page.getByRole('button', { name: 'Add subject' })
const descriptionInput = () => page.getByLabelText('Description (optional)')
const subjectRow = (name: string) => page.getByRole('row', { name: new RegExp(name) })

describe('ManageSubjectsSlideOver late saves', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await page.viewport(DESKTOP_WIDTH, DESKTOP_HEIGHT)
    subjectsApi.listSubjects.mockResolvedValue({
      items: [BIOLOGY, CHEMISTRY],
      total: 2,
      page: 1,
      page_size: 20,
    })
  })

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

    await waitForRefresh()
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

    await waitForRefresh()
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

    await waitForRefresh()
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
    await expect.element(page.getByRole('button', { name: 'Saving…' })).toBeDisabled()
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

    await waitForRefresh()
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

    await waitForRefresh()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['subjects'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tutors'] })
    expect(onSubjectDeactivated).toHaveBeenCalledWith(BIOLOGY.id)
    invalidate.mockRestore()
  })

  it('reports a late deactivate without closing a newer form', async () => {
    const onSubjectDeactivated = vi.fn()
    const deactivation = createDeferred<Subject>()
    subjectsApi.deactivateSubject.mockReturnValue(deactivation.promise)
    await renderSlideOver(onSubjectDeactivated)

    await userEvent.click(subjectRow('Biology'))
    await userEvent.click(page.getByRole('button', { name: 'Deactivate' }))
    const dialog = page.getByRole('dialog', { name: 'Deactivate subject' })
    await userEvent.click(dialog.getByRole('button', { name: 'Deactivate' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(backButton())
    await userEvent.click(subjectRow('Chemistry'))
    deactivation.resolve({ ...BIOLOGY, is_active: false })

    await waitForRefresh()
    expect(onSubjectDeactivated).toHaveBeenCalledWith(BIOLOGY.id)
    await expect.element(title('Edit subject')).toBeVisible()
    await expect.element(nameInput()).toHaveValue('Chemistry')
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
    let rejectSave: (reason: Error) => void = () => {}
    subjectsApi.updateSubject.mockReturnValue(
      new Promise<Subject>((_resolve, reject) => {
        rejectSave = reject
      }),
    )
    await renderSlideOver()

    await userEvent.click(subjectRow('Biology'))
    await userEvent.click(saveButton())
    await userEvent.click(backButton())
    await userEvent.click(subjectRow('Chemistry'))
    rejectSave(new Error('Network down'))
    await new Promise((settle) => setTimeout(settle, SETTLE_MS))

    await expect.element(page.getByRole('alert')).not.toBeInTheDocument()
    await expect.element(nameInput()).toHaveValue('Chemistry')
  })
})
