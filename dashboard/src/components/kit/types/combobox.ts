// Shapes shared by the kit Combobox and its hook.
export type ComboboxOption = {
  value: string;
  label: string;
  description?: string;
  hasAvatar?: boolean;
};

// The in-flow listbox from 672px of kit width, a bottom sheet below it.
export type ComboboxMode = "listbox" | "sheet" | null;
