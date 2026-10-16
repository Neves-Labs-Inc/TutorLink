// The switcher's vocabulary: which screen, role and data state.
export type Screen =
  | "families"
  | "family"
  | "child"
  | "child-tutors-edit"
  | "child-no-tutor"
  | "mark-evaluated"
  | "mark-evaluated-admin"
  | "guardian"
  | "add-account"
  | "staff"
  | "staff-archived"
  | "staff-detail"
  | "staff-children"
  | "add-staff"
  | "staff-setup";

export type OfficeRole = "admin" | "manager";

export type DataState = "populated" | "loading" | "empty" | "error";

// What a page shows while its list request is in flight or failed.
export type Phase = "ready" | "loading" | "error";

// A sheet a switcher screen opens on top of Child details.
export type ChildSheet = "mark-evaluated" | "tutors";

export type AccountEntry = {
  kind: "child" | "guardian";
  id: string;
  sheet?: ChildSheet;
};
