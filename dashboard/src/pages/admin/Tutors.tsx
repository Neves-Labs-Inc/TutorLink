import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { errorDetail } from '@/lib/api'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'
import { subjectQueries } from '@/lib/queries/subjects'
import { tutorQueries, type Tutor } from '@/lib/queries/tutors'
import {
  ALL_SUBJECTS,
  subjectSummary,
  tutorListParams,
  // type TutorDraft,
} from '@/lib/tutors'

// const EMPTY_DRAFT: TutorDraft = { name: '', email: '', phone: '', bio: '' }
const SEARCH_DEBOUNCE_MS = 300
const SUBJECT_OPTIONS_PAGE_SIZE = 100
const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'

const columns: Column<Tutor>[] = [
  { id: 'name', header: 'Name', primary: true, cell: (tutor) => tutor.name },
  { id: 'email', header: 'Email', cell: (tutor) => tutor.email },
  { id: 'phone', header: 'Phone', hideOnMobile: true, cell: (tutor) => tutor.phone_number },
  { id: 'subjects', header: 'Subjects', cell: (tutor) => subjectSummary(tutor.subjects) },
  {
    id: 'status',
    header: 'Status',
    cell: (tutor) => <StatusBadge status={tutor.is_active ? 'active' : 'inactive'} />,
  },
]

export const Tutors = () => {
  const navigate = useNavigate()
  // const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [subjectId, setSubjectId] = useState(ALL_SUBJECTS)
  const [showInactive, setShowInactive] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search), SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [search])

  const tutorsQuery = useQuery(
    tutorQueries.list(
      tutorListParams({
        q: appliedSearch,
        subjectId,
        isActive: !showInactive,
        page,
        pageSize: DEFAULT_PAGE_SIZE,
      }),
    ),
  )
  const subjectsQuery = useQuery(subjectQueries.list({ page_size: SUBJECT_OPTIONS_PAGE_SIZE }))

  // const createMutation = useMutation({
  //   mutationFn: createTutor,
  //   onSuccess: () => {
  //     queryClient.invalidateQueries({ queryKey: ['tutors'] })
  //     // closeForm()
  //   },
  // })

  // const closeForm = () => {
  //   setFormOpen(false)
  //   setDraft(EMPTY_DRAFT)
  //   setValidationErrors([])
  //   createMutation.reset()
  // }

  const handleSearchChange = (nextSearch: string) => {
    setSearch(nextSearch)
    setPage(1)
  }

  const handleSubjectChange = (nextSubjectId: string) => {
    setSubjectId(nextSubjectId)
    setPage(1)
  }

  const handleShowInactiveChange = (nextShowInactive: boolean) => {
    setShowInactive(nextShowInactive)
    setPage(1)
  }

  // const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
  //   event.preventDefault()
  //   const errors = tutorFormErrors(draft)

  //   if (errors.length > 0) {
  //     setValidationErrors(errors)
  //     createMutation.reset()
  //   } else {
  //     setValidationErrors([])
  //     createMutation.mutate(tutorCreatePayload(draft))
  //   }
  // }

  // const saveError = createMutation.isError
  //   ? (errorDetail(createMutation.error) ?? SAVE_FALLBACK_ERROR)
  //   : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Tutors</h1>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full space-y-1.5 sm:w-64">
          <Label htmlFor="tutor-search">Search by name</Label>
          <Input
            id="tutor-search"
            type="search"
            value={search}
            placeholder="Name"
            onChange={(event) => handleSearchChange(event.target.value)}
          />
        </div>

        <div className="w-full space-y-1.5 sm:w-56">
          <Label htmlFor="tutor-subject-filter">Subject</Label>
          <Select
            id="tutor-subject-filter"
            value={subjectId}
            onChange={(event) => handleSubjectChange(event.target.value)}
          >
            <option value={ALL_SUBJECTS}>All subjects</option>
            {(subjectsQuery.data?.items ?? []).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </div>

        <Label className="w-fit">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => handleShowInactiveChange(event.target.checked)}
            className="size-4 rounded border-input"
          />
          Show inactive tutors
        </Label>
      </div>

      <DataTable
        caption="Tutors"
        columns={columns}
        rows={tutorsQuery.data?.items ?? []}
        rowKey={(tutor) => tutor.id}
        status={tutorsQuery.isPending ? 'pending' : tutorsQuery.isError ? 'error' : 'ready'}
        errorMessage={errorDetail(tutorsQuery.error) ?? LOAD_FALLBACK_ERROR}
        onRetry={() => tutorsQuery.refetch()}
        emptyMessage="No tutors match these filters."
        onRowSelect={(tutor) => navigate(`/tutors/${tutor.id}`)}
      />

      <Pager
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={tutorsQuery.data?.total ?? 0}
        onPageChange={setPage}
        disabled={tutorsQuery.isPending}
      />

      {/* <SlideOver
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeForm()
        }}
        title="Add Tutor"
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={closeForm}>
              Cancel
            </Button>
            <Button type="submit" form={TUTOR_FORM_ID} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        }
      >
        <TutorForm
          draft={draft}
          onChange={setDraft}
          disabled={createMutation.isPending}
          messages={saveError === null ? validationErrors : [...validationErrors, saveError]}
          onSubmit={handleSubmit}
        />
      </SlideOver> */}
    </div>
  )
}

// type TutorFormProps = {
//   draft: TutorDraft
//   onChange: (draft: TutorDraft) => void
//   disabled: boolean
//   messages: string[]
//   onSubmit: (event: FormEvent<HTMLFormElement>) => void
// }

// const TutorForm = ({ draft, onChange, disabled, messages, onSubmit }: TutorFormProps) => {
//   let alert: ReactNode = null

//   if (messages.length > 0) {
//     alert = (
//       <ul role="alert" className="space-y-1 text-sm font-medium text-destructive">
//         {messages.map((message) => (
//           <li key={message}>{message}</li>
//         ))}
//       </ul>
//     )
//   }

//   return (
//     <form id={TUTOR_FORM_ID} onSubmit={onSubmit} className="space-y-4">
//       {alert}

//       <div className="space-y-1.5">
//         <Label htmlFor="tutor-name">Name</Label>
//         <Input
//           id="tutor-name"
//           value={draft.name}
//           disabled={disabled}
//           onChange={(event) => onChange({ ...draft, name: event.target.value })}
//         />
//       </div>

//       <div className="space-y-1.5">
//         <Label htmlFor="tutor-email">Email</Label>
//         <Input
//           id="tutor-email"
//           type="email"
//           value={draft.email}
//           disabled={disabled}
//           onChange={(event) => onChange({ ...draft, email: event.target.value })}
//         />
//       </div>

//       <div className="space-y-1.5">
//         <Label htmlFor="tutor-phone">Phone</Label>
//         <Input
//           id="tutor-phone"
//           type="tel"
//           value={draft.phone}
//           disabled={disabled}
//           placeholder="+1 555 123 4567"
//           onChange={(event) => onChange({ ...draft, phone: event.target.value })}
//         />
//       </div>

//       <div className="space-y-1.5">
//         <Label htmlFor="tutor-bio">Bio</Label>
//         <Textarea
//           id="tutor-bio"
//           value={draft.bio}
//           disabled={disabled}
//           onChange={(event) => onChange({ ...draft, bio: event.target.value })}
//         />
//       </div>
//     </form>
//   )
// }
