import { lazy, Suspense, useState } from 'react'

import { ResourceObserver } from '../features/conversation/resource-observer.js'
import { RuntimeObserver } from '../features/conversation/runtime-observer.js'
import { SessionHistory } from '../features/conversation/session-history.js'
import { ClientAccess, ClientSettings } from '../features/settings/client-access.js'
import { CredentialStatus } from '../features/settings/credential-status.js'
import { ResourceTrust } from '../features/settings/resource-trust.js'
import { readPairingFragment } from '../services/client-access.js'
import { Workbench } from './workbench.js'

const WorkspaceManager = lazy(async () => {
  const module = await import('../features/workspaces/workspace-manager.js')
  return { default: module.WorkspaceManager }
})

/** Private views mount only after SEC-08 pairing. Workspace code is loaded on demand so
 * its desktop picker UI does not add to the initial offline conversation bundle.
 */
export function App() {
  const [initialCode] = useState(readPairingFragment)
  const query = new URLSearchParams(location.search)
  const observedSession = query.get('observe'),
    historySession = query.get('history')
  const resourcesView = query.has('resources'),
    credentialsView = query.has('credentials')
  const clientsView = query.has('clients'),
    trustView = query.has('trust'),
    workspaceView = query.has('workspaces')
  const sensitive =
    clientsView ||
    workspaceView ||
    trustView ||
    credentialsView ||
    resourcesView ||
    Boolean(historySession) ||
    Boolean(observedSession)
  const content = workspaceView ? (
    <Suspense
      fallback={
        <main className="p-6">
          <output>正在加载工作区…</output>
        </main>
      }
    >
      <WorkspaceManager />
    </Suspense>
  ) : trustView ? (
    <ResourceTrust />
  ) : clientsView ? (
    <ClientSettings />
  ) : credentialsView ? (
    <CredentialStatus />
  ) : resourcesView ? (
    <ResourceObserver />
  ) : historySession ? (
    <SessionHistory key={historySession} sessionId={historySession} />
  ) : observedSession ? (
    <RuntimeObserver key={observedSession} sessionId={observedSession} />
  ) : (
    <Workbench />
  )
  return sensitive ? <ClientAccess initialCode={initialCode}>{content}</ClientAccess> : content
}
