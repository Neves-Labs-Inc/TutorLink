import { SearchPicker, type SearchPickerOption } from '@/components/pickers/SearchPicker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  statusLabel,
  STATUS_OPTIONS,
  toggleStatus,
  type BookingFilterState,
} from '@/lib/bookings/bookings'
import type { Subject } from '@/lib/queries/subjects'
import type { Tutor } from '@/lib/queries/tutors'
import { cn } from '@/lib/utils'

export type BookingFilterFieldsProps = {
  filters: BookingFilterState
  onChange: (next: BookingFilterState) => void
  childOption: SearchPickerOption | null
  onChildChange: (option: SearchPickerOption | null) => void
  searchChildren: (term: string) => Promise<SearchPickerOption[]>
  tutors: Tutor[]
  subjects: Subject[]
  // Keeps element ids unique when the card and the slide-over are both in the DOM.
  idPrefix: string
  layout: 'grid' | 'stacked'
  showDateRange?: boolean
}

const chipClasses =
  'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
const chipIdleClasses = 'border-border text-muted-foreground hover:text-foreground'
const chipSelectedClasses = 'border-primary bg-primary text-primary-foreground'
// New stacked controls meet the 44px touch target below md (DESIGN.md R1); the card keeps its size.
const stackedChipClasses = 'min-h-11 px-4 active:translate-y-px md:min-h-0 md:px-3'
const stackedControlClasses = 'h-11 md:h-8'

export const BookingFilterFields = ({
  filters,
  onChange,
  childOption,
  onChildChange,
  searchChildren,
  tutors,
  subjects,
  idPrefix,
  layout,
  showDateRange = true,
}: BookingFilterFieldsProps) => {
  const isStacked = layout === 'stacked'
  const controlClassName = isStacked ? stackedControlClasses : undefined
  const statusGroupLabelId = `${idPrefix}-status-filter`

  return (
    <div className="space-y-4">
      <div
        className={
          isStacked ? 'space-y-4' : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5'
        }
      >
        {showDateRange && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-from`}>From</Label>
              <Input
                id={`${idPrefix}-from`}
                type="date"
                className={controlClassName}
                value={filters.from}
                onChange={(event) => onChange({ ...filters, from: event.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-to`}>To</Label>
              <Input
                id={`${idPrefix}-to`}
                type="date"
                className={controlClassName}
                value={filters.to}
                onChange={(event) => onChange({ ...filters, to: event.target.value })}
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-tutor-filter`}>Tutor</Label>
          <Select
            id={`${idPrefix}-tutor-filter`}
            className={controlClassName}
            value={filters.tutorId}
            onChange={(event) => onChange({ ...filters, tutorId: event.target.value })}
          >
            <option value="">All tutors</option>
            {tutors.map((tutor) => (
              <option key={tutor.id} value={tutor.id}>
                {tutor.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-subject-filter`}>Subject</Label>
          <Select
            id={`${idPrefix}-subject-filter`}
            className={controlClassName}
            value={filters.subjectId}
            onChange={(event) => onChange({ ...filters, subjectId: event.target.value })}
          >
            <option value="">All subjects</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-child-filter`}>Child</Label>
          <SearchPicker
            id={`${idPrefix}-child-filter`}
            queryKeyPrefix={['children', 'filter']}
            search={searchChildren}
            value={childOption}
            onChange={onChildChange}
            placeholder="All children"
            emptyMessage="No matching children."
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <span id={statusGroupLabelId} className="block text-sm font-medium text-foreground">
          Status
        </span>
        <div role="group" aria-labelledby={statusGroupLabelId} className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((status) => {
            const selected = filters.statuses.includes(status)

            return (
              <button
                key={status}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onChange({ ...filters, statuses: toggleStatus(filters.statuses, status) })
                }
                className={cn(
                  chipClasses,
                  selected ? chipSelectedClasses : chipIdleClasses,
                  isStacked && stackedChipClasses,
                )}
              >
                {statusLabel(status)}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
