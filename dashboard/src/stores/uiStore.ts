import { create } from 'zustand'

interface UiState {
  mobileNavOpen: boolean
  toggleMobileNav: () => void
  closeMobileNav: () => void
}

export const useUiStore = create<UiState>((set) => ({
  mobileNavOpen: false,
  toggleMobileNav: () => set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),
  closeMobileNav: () => set({ mobileNavOpen: false }),
}))
