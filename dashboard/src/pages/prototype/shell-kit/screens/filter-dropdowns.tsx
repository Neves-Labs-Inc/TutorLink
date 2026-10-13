import type { ReactNode } from "react";
import { MultiSelectFilter } from "@/pages/prototype/shell-kit/kit/components/multi-select-filter";
import type { FilterOption } from "@/pages/prototype/shell-kit/kit/components/multi-select-filter";

type Field<K extends string> = {
  key: K;
  label: string;
  options: readonly FilterOption[];
};

type FilterDropdownsProps<K extends string> = {
  fields: readonly Field<K>[];
  selected: Record<K, string[]>;
  onChange: (key: K, values: string[]) => void;
};

// One MultiSelectFilter per field.
export default function FilterDropdowns<K extends string>({
  fields,
  selected,
  onChange,
}: FilterDropdownsProps<K>): ReactNode {
  return (
    <>
      {fields.map((field) => (
        <MultiSelectFilter
          key={field.key}
          label={field.label}
          options={[...field.options]}
          selected={selected[field.key]}
          onChange={(values) => onChange(field.key, values)}
        />
      ))}
    </>
  );
}
