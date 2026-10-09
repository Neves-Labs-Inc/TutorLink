import type { ToastOptions } from "@/lib/toast/toast";
import { useToastStore } from "@/stores/toastStore";

type UseToast = {
  toast: (message: string, options?: ToastOptions) => void;
};

export function useToast(): UseToast {
  const toast = useToastStore((state) => state.add);
  return { toast };
}
