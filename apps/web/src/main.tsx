import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'

import { Workbench } from './app/workbench.js'
import { RuntimeObserver } from './features/conversation/runtime-observer.js'
import { SessionHistory } from './features/conversation/session-history.js'
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
const observedSession = new URLSearchParams(location.search).get('observe')
const historySession = new URLSearchParams(location.search).get('history')
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    {historySession ? (
      <SessionHistory key={historySession} sessionId={historySession} />
    ) : observedSession ? (
      <RuntimeObserver key={observedSession} sessionId={observedSession} />
    ) : (
      <Workbench />
    )}
  </QueryClientProvider>,
)
