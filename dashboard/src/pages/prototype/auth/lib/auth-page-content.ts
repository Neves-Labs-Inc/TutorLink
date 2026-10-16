// What every auth screen hands its frame (the brand panel layout).
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type AuthPageContent = {
  icon?: LucideIcon;
  iconTone?: "primary" | "success" | "warning" | "danger";
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  // Under the form: "Back to sign in", help lines.
  footer?: ReactNode;
  // Prototype-only asides, rendered apart from the design.
  notes?: ReactNode;
};
