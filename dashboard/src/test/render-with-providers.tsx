import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { render, type RenderResult } from 'vitest-browser-react'

type ProvidersProps = {
  children: ReactNode
}

// A fresh client per render so cached results never leak between tests.
function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
}

export function renderWithProviders(ui: ReactNode): Promise<RenderResult> {
  const queryClient = createTestQueryClient()

  function Providers({ children }: ProvidersProps): ReactNode {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }

  return render(ui, { wrapper: Providers })
}
