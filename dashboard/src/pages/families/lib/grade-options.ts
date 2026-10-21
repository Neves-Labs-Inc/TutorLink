// The Overall grade picker: Not set, Kindergarten, Grade 1-12. The
// value is the wire number as text ("" is not set).
import type { SelectOption } from "@/components/kit/types/select";
import { gradeName, HIGHEST_GRADE, LOWEST_GRADE } from "@/lib/grades/grades";

export const GRADE_OPTIONS: SelectOption[] = [
  { value: "", label: "Not set" },
  ...Array.from({ length: HIGHEST_GRADE - LOWEST_GRADE + 1 }, (_, index) => ({
    value: String(LOWEST_GRADE + index),
    label: gradeName(LOWEST_GRADE + index),
  })),
];
