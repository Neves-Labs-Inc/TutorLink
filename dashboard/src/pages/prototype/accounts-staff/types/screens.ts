// The switcher's vocabulary: which screen, role and data state.
export type Screen =
  | "families"
  | "family"
  | "child"
  | "guardian"
  | "add-account"
  | "staff"
  | "staff-archived"
  | "staff-detail"
  | "add-staff"
  | "staff-setup";

export type OfficeRole = "admin" | "manager";

export type DataState = "populated" | "loading" | "empty" | "error";

// What a page shows while its list request is in flight or failed.
export type Phase = "ready" | "loading" | "error";

export type AccountEntry = { kind: "child" | "guardian"; id: string };
