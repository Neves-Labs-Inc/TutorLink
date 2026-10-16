// Shapes shared by the kit Select, its hook and SelectField.
export type SelectOption = { value: string; label: string };

// What onChange receives: shaped like a change event, so callers that
// read `event.target.value` keep working, but it is a plain object.
export type SelectChange = { target: { value: string; name?: string } };

// Popover from 672px of kit width, bottom sheet below it.
export type SelectOpenMode = "popover" | "sheet" | null;
