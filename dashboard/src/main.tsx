import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import '@fontsource/lato/300.css'
import '@fontsource/lato/700.css'
import '@fontsource-variable/inter'
import { queryClient } from '@/lib/queryClient.ts'
import { startThemeSync } from '@/stores/theme-store'
import { App } from './App.tsx'
import './index.css'

startThemeSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
