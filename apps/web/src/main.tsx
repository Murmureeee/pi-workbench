import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'

import { App } from './app/app.js'
import '@pi-workbench/ui/styles.css'

import './app/workbench.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: false },
  },
})
const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing app root')
}
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
)
