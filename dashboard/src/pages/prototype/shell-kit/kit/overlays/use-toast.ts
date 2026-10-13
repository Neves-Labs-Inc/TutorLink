import { createContext, useContext } from "react";

export type ToastTone = "success" | "error" | "info";

export type ToastInput = {
  tone: ToastTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type ToastApi = { showToast: (toast: ToastInput) => void };

export const ToastContext = createContext<ToastApi | null>(null);

// Fires a toast from anywhere under <KitRoot>.
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a <KitRoot> above it");
  return api;
}
