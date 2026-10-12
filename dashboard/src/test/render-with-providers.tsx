import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { render, type RenderResult } from 'vitest-browser-react'

type ProvidersProps = {
  children: ReactNode
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
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  return render(ui, { wrapper: Providers })
}
