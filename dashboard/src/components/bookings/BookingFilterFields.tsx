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
import type { Staff, StaffRole } from '@/lib/queries/staff'
import type { Subject } from '@/lib/queries/subjects'
import { cn } from '@/lib/utils'

export type BookingFilterFieldsProps = {
  filters: BookingFilterState
  onChange: (next: BookingFilterState) => void
  childOption: SearchPickerOption | null
  onChildChange: (option: SearchPickerOption | null) => void
  searchChildren: (term: string) => Promise<SearchPickerOption[]>
  staff: Staff[]
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
// Group order in the Staff select; a group with nobody in it is not rendered.
const STAFF_GROUPS: { role: StaffRole; label: string }[] = [
  { role: 'tutor', label: 'Tutors' },
  { role: 'manager', label: 'Managers' },
  { role: 'admin', label: 'Admins' },
]

export const BookingFilterFields = ({
  filters,
  onChange,
  childOption,
  onChildChange,
  searchChildren,
  staff,
  subjects,
  idPrefix,
  layout,
  showDateRange = true,
}: BookingFilterFieldsProps) => {
  const isStacked = layout === 'stacked'
  const controlClassName = isStacked ? stackedControlClasses : undefined
  const statusGroupLabelId = `${idPrefix}-status-filter`
  const staffGroups = STAFF_GROUPS.map((group) => ({
    ...group,
    members: staff.filter((member) => member.role === group.role),
  })).filter((group) => group.members.length > 0)

  return (
    <div className="space-y-4">
      <div
        className={cn(
          isStacked ? 'space-y-4' : 'grid grid-cols-1 gap-4 sm:grid-cols-2',
          // Six fields with From/To fill two rows of three; the four without fill one row of
          // four, so no cell is left empty at any width.
          !isStacked && (showDateRange ? 'lg:grid-cols-3' : 'lg:grid-cols-4'),
        )}
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
          <Label htmlFor={`${idPrefix}-staff-filter`}>Staff</Label>
          <Select
            id={`${idPrefix}-staff-filter`}
            className={controlClassName}
            value={filters.staffId}
            onChange={(event) => onChange({ ...filters, staffId: event.target.value })}
          >
            <option value="">All staff</option>
            {staffGroups.map((group) => (
              <optgroup key={group.role} label={group.label}>
                {group.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-location-filter`}>Location</Label>
          <Select
            id={`${idPrefix}-location-filter`}
            className={controlClassName}
            value={filters.location}
            onChange={(event) =>
              onChange({
                ...filters,
                location: event.target.value as BookingFilterState['location'],
              })
            }
          >
            <option value="">All locations</option>
            <option value="home">At a home</option>
            <option value="in_office">In office</option>
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
