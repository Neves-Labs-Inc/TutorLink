import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { BookingOverlaysContext } from '@/hooks/use-booking-overlays'
import type { BookingOverlays } from '@/hooks/use-booking-overlays'
import { render, type RenderResult } from 'vitest-browser-react'

type ProvidersProps = {
  children: ReactNode
}

// Screens that open Bookings (a family page's New booking) read these;
// assert on them to see what a screen asked for.
export const bookingOverlaysSpy: BookingOverlays = {
  openBooking: vi.fn(),
  openNewBooking: vi.fn(),
  openChangeBooking: vi.fn(),
}

// A fresh client per render so cached results never leak between tests.
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
}

// Pass a client to observe it from the test (e.g. wait until no mutation is in flight).
export function renderWithProviders(
  ui: ReactNode,
  queryClient: QueryClient = createTestQueryClient(),
): Promise<RenderResult> {
  function Providers({ children }: ProvidersProps): ReactNode {
    return (
      <QueryClientProvider client={queryClient}>
        <BookingOverlaysContext.Provider value={bookingOverlaysSpy}>
          {children}
        </BookingOverlaysContext.Provider>
      </QueryClientProvider>
    )
  }

  return render(ui, { wrapper: Providers })
}
