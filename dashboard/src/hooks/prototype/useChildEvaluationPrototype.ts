// PROTOTYPE ONLY. Local, in-memory Child evaluation state shared by the three child variants.
import { useState } from 'react'

import {
  ACTIVE_SUBJECTS,
  INACTIVE_SUBJECT_LEVEL,
  TODAY_LABEL,
  type PrototypeChild,
  type PrototypeSubject,
} from '@/lib/prototype/staffScreensData'

const CURRENT_STAFF_SHORT = 'Daniel'

export const MARK_NEEDS_LEVEL_REASON = 'Add at least one Subject level before marking Evaluated.'
export const LAST_LEVEL_REASON =
  'An Evaluated Child needs at least one Subject level. Clear Evaluated first.'
export const NO_LEVEL_CONSEQUENCE = 'No level: the bot hands bookings for this subject to the office.'
export const NOT_EVALUATED_CONSEQUENCE =
  'Not evaluated: the bot sends any booking to the office as the evaluation session.'

export const useChildEvaluationPrototype = (initial: PrototypeChild, showInactiveLevel: boolean) => {
  const [child, setChild] = useState<PrototypeChild>(() =>
    showInactiveLevel && initial.levels.length > 0
      ? { ...initial, levels: [...initial.levels, INACTIVE_SUBJECT_LEVEL] }
      : initial,
  )

  const levelFor = (subjectId: string) => child.levels.find((level) => level.subjectId === subjectId)
  const subjectsWithoutLevel: PrototypeSubject[] = ACTIVE_SUBJECTS.filter(
    (subject) => levelFor(subject.id) === undefined,
  )
  const canMarkEvaluated = child.levels.length > 0
  const isLastLevelLocked = child.evaluated !== null && child.levels.length === 1

  const setLevel = (subjectId: string, level: number) =>
    setChild((current) => {
      const others = current.levels.filter((entry) => entry.subjectId !== subjectId)
      return { ...current, levels: [...others, { subjectId, level, setBy: CURRENT_STAFF_SHORT }] }
    })

  const removeLevel = (subjectId: string) =>
    setChild((current) => ({
      ...current,
      levels: current.levels.filter((entry) => entry.subjectId !== subjectId),
    }))

  const setOverallGrade = (overallGrade: number | null) =>
    setChild((current) => ({ ...current, overallGrade }))

  const markEvaluated = () =>
    setChild((current) => ({ ...current, evaluated: { by: CURRENT_STAFF_SHORT, on: TODAY_LABEL } }))

  // Clearing keeps the levels on purpose.
  const clearEvaluated = () => setChild((current) => ({ ...current, evaluated: null }))

  const replaceChild = (next: PrototypeChild) => setChild(next)

  return {
    child,
    levelFor,
    subjectsWithoutLevel,
    canMarkEvaluated,
    isLastLevelLocked,
    setLevel,
    removeLevel,
    setOverallGrade,
    markEvaluated,
    clearEvaluated,
    replaceChild,
  }
}

export type ChildEvaluationPrototype = ReturnType<typeof useChildEvaluationPrototype>
