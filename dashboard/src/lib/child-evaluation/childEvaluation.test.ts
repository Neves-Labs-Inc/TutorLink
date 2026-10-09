import { describe, expect, it } from 'vitest'

import {
  addableSubjects,
  awaitingRow,
  awaitingTabLabel,
  canMarkEvaluated,
  canRemoveLevel,
  childTabFrom,
  clearEvaluatedBody,
  evaluatedCell,
  evaluatedStatusLabel,
  isLevelMuted,
  DEFAULT_LEVEL,
  LEVEL_OPTIONS,
  levelLabel,
  noLevelHint,
  notEvaluatedConsequence,
} from './childEvaluation'
import type { ChildDetail, ChildLevel, ChildSummary, Evaluated } from '@/lib/queries/children'
import type { Subject } from '@/lib/queries/subjects'

const STAFF = { id: 'staff-1', name: 'Maria Lopez' }
const EVALUATED: Evaluated = { at: '2026-10-02T12:00:00Z', by: STAFF }

const level = (overrides: Partial<ChildLevel> = {}): ChildLevel => ({
  subject_id: 'math',
  name: 'Math',
  is_active: true,
  level: 4,
  set_by: STAFF,
  updated_at: '2026-10-02T12:00:00Z',
  ...overrides,
})

const subject = (id: string, overrides: Partial<Subject> = {}): Subject => ({
  id,
  name: id,
  name_es: null,
  description: null,
  is_active: true,
  tutor_count: 0,
  ...overrides,
})

const child = (overrides: Partial<ChildDetail> = {}): ChildDetail => ({
  id: 'child-1',
  name: 'Ana Torres',
  date_of_birth: '2015-03-14',
  grade_level: 5,
  school_name: 'Lincoln',
  notes: null,
  is_active: true,
  upcoming_session_count: 0,
  guardians: [],
  homes: [],
  levels: [level()],
  evaluated: null,
  ...overrides,
})

const summary = (overrides: Partial<ChildSummary> = {}): ChildSummary => ({
  id: 'child-2',
  name: 'Luis Torres',
  grade_level: 3,
  school_name: 'Lincoln',
  is_active: true,
  guardians: [{ id: 'g1', name: 'Rosa Torres' }],
  homes: [],
  next_session: null,
  evaluated: null,
  created_at: '2026-09-28T12:00:00Z',
  ...overrides,
})

describe('levelLabel', () => {
  it.each([
    [0, 'K'],
    [1, '1'],
    [12, '12'],
  ])('shows level %s as %s', (value, label) => {
    expect(levelLabel(value)).toBe(label)
  })

  it('offers K to 12 as options', () => {
    expect(LEVEL_OPTIONS.map((option) => option.label)).toEqual([
      'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
    ])
    expect(LEVEL_OPTIONS[0].value).toBe(0)
  })
})

describe('DEFAULT_LEVEL', () => {
  it('starts the add-level form at K, the select value for 0', () => {
    expect(DEFAULT_LEVEL).toBe('0')
  })
})

describe('canRemoveLevel', () => {
  it('refuses the last level of an Evaluated child', () => {
    expect(canRemoveLevel(child({ evaluated: EVALUATED }))).toBe(false)
  })

  it('allows removing one of several levels of an Evaluated child', () => {
    const levels = [level(), level({ subject_id: 'sci', name: 'Science' })]

    expect(canRemoveLevel(child({ evaluated: EVALUATED, levels }))).toBe(true)
  })

  it('allows removing the last level of a child who is not Evaluated', () => {
    expect(canRemoveLevel(child())).toBe(true)
  })
})

describe('canMarkEvaluated', () => {
  it('is refused without a level', () => {
    expect(canMarkEvaluated(child({ levels: [] }))).toBe(false)
  })

  it('is allowed with a level', () => {
    expect(canMarkEvaluated(child())).toBe(true)
  })
})

describe('addableSubjects', () => {
  it('lists active subjects the child has no level for', () => {
    const subjects = [subject('math'), subject('sci'), subject('art', { is_active: false })]

    expect(addableSubjects(subjects, [level()]).map((entry) => entry.id)).toEqual(['sci'])
  })
})

describe('isLevelMuted', () => {
  it('mutes a level on an inactive subject only', () => {
    expect(isLevelMuted(level({ is_active: false }))).toBe(true)
    expect(isLevelMuted(level())).toBe(false)
  })
})

describe('Evaluated copy', () => {
  it('says who and when', () => {
    expect(evaluatedStatusLabel(EVALUATED)).toBe('Evaluated by Maria Lopez, 2 Oct 2026')
  })

  it('says Not evaluated without a mark', () => {
    expect(evaluatedStatusLabel(null)).toBe('Not evaluated')
  })

  it('fills the list column with who and when, or a dash', () => {
    expect(evaluatedCell(EVALUATED)).toBe('Maria Lopez, 2 Oct 2026')
    expect(evaluatedCell(null)).toBe('—')
  })

  it('names the Child by first name in the consequence line', () => {
    expect(notEvaluatedConsequence('Ana Torres')).toBe(
      'The bot sends any booking for Ana to the office as the evaluation session.',
    )
  })

  it('names the subject in the no-level hint', () => {
    expect(noLevelHint('Science')).toBe(
      'Science · No level: the bot hands bookings for this subject to the office.',
    )
  })

  it('says the levels stay in the clear confirmation', () => {
    expect(clearEvaluatedBody('Ana Torres')).toBe(
      "Ana Torres's Subject levels stay. Until Staff mark Evaluated again, the bot sends any booking to the office as the evaluation session.",
    )
  })
})

describe('awaitingTabLabel', () => {
  it('shows the count once known', () => {
    expect(awaitingTabLabel(4)).toBe('Awaiting evaluation (4)')
    expect(awaitingTabLabel(0)).toBe('Awaiting evaluation (0)')
  })

  it('drops the count while loading or failed', () => {
    expect(awaitingTabLabel(null)).toBe('Awaiting evaluation')
  })
})

describe('awaitingRow', () => {
  it('maps a summary to the tab columns', () => {
    expect(awaitingRow(summary())).toEqual({
      id: 'child-2',
      name: 'Luis Torres',
      guardians: 'Rosa Torres',
      grade: 'Grade 3',
      since: '28 Sep 2026',
    })
  })

  it('uses a dash for no guardians and a named phrase for no grade', () => {
    expect(awaitingRow(summary({ guardians: [], grade_level: null }))).toMatchObject({
      guardians: '—',
      grade: 'Grade not set',
    })
  })
})

describe('childTabFrom', () => {
  it('reads awaiting from the URL and defaults to all', () => {
    expect(childTabFrom('awaiting')).toBe('awaiting')
    expect(childTabFrom(null)).toBe('all')
    expect(childTabFrom('nonsense')).toBe('all')
  })
})
