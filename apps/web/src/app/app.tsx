import { lazy, Suspense, useState } from 'react'

import { ResourceObserver } from '../features/conversation/resource-observer.js'
import { RuntimeObserver } from '../features/conversation/runtime-observer.js'
import { SessionHistory } from '../features/conversation/session-history.js'
import { SessionTitleSync } from '../features/conversation/session-title-sync.js'
import { AppearanceSettings } from '../features/settings/appearance.js'
import { ClientAccess, ClientSettings } from '../features/settings/client-access.js'
import { CredentialStatus } from '../features/settings/credential-status.js'
import { ResourceTrust } from '../features/settings/resource-trust.js'
import { SettingsShell } from '../features/settings/settings-shell.js'
import { readPairingFragment } from '../services/client-access.js'
import { useNavigation } from '../services/navigation.js'
import { AppFrame } from './app-frame.js'
import { Workbench } from './workbench.js'

const WorkspaceManager = lazy(async () => {
  const module = await import('../features/workspaces/workspace-manager.js')
  return { default: module.WorkspaceManager }
})
const ModelDiscovery = lazy(async () => {
  const module = await import('../features/settings/model-discovery.js')
  return { default: module.ModelDiscovery }
})
const OperationAudit = lazy(async () => ({
  default: (await import('../features/settings/operation-audit.js')).OperationAudit,
}))
const SessionWorkbench = lazy(async () => {
  const module = await import('../features/conversation/session-workbench.js')
  return { default: module.SessionWorkbench }
})
const LegacyHistory = lazy(async () => {
  const module = await import('../features/conversation/legacy-history.js')
  return { default: module.LegacyHistory }
})

/** Private views mount only after SEC-08 pairing. Workspace code is loaded on demand so
 * its desktop picker UI does not add to the initial offline conversation bundle.
 */
export function App() {
  const [initialCode] = useState(readPairingFragment)
  const { search } = useNavigation()
  const query = new URLSearchParams(search)
  const observedSession = query.get('observe'),
    historySession = query.get('history')
  const resourcesView = query.has('resources'),
    credentialsView = query.has('credentials')
  const clientsView = query.has('clients'),
    trustView = query.has('trust'),
    workspaceView = query.has('workspaces'),
    modelsView = query.has('models')
  const legacyView = query.has('legacy'),
    auditView = query.has('audit')
  const settingsSection = auditView
    ? 'audit'
    : modelsView
      ? 'models'
      : trustView
        ? 'trust'
        : clientsView
          ? 'clients'
          : credentialsView
            ? 'credentials'
            : resourcesView
              ? 'resources'
              : query.has('settings')
                ? 'appearance'
                : null
  const sensitive =
    auditView ||
    clientsView ||
    modelsView ||
    workspaceView ||
    trustView ||
    credentialsView ||
    resourcesView ||
    Boolean(historySession) ||
    Boolean(observedSession) ||
    legacyView
  const content = auditView ? (
    <Suspense fallback={<output>正在加载操作审计…</output>}>
      <OperationAudit />
    </Suspense>
  ) : legacyView ? (
    <Suspense
      fallback={
        <main className="p-6">
          <output>正在加载旧历史…</output>
        </main>
      }
    >
      <LegacyHistory />
    </Suspense>
  ) : modelsView ? (
    <Suspense
      fallback={
        <main className="p-6">
          <output>正在加载模型目录…</output>
        </main>
      }
    >
      <ModelDiscovery />
    </Suspense>
  ) : workspaceView ? (
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
    <AppearanceSettings />
  )
  const hasView =
    settingsSection || workspaceView || historySession || observedSession || legacyView
  const protectedContent = sensitive ? (
    <ClientAccess initialCode={initialCode}>{content}</ClientAccess>
  ) : (
    content
  )
  return (
    <AppFrame settings={Boolean(settingsSection)}>
      <SessionTitleSync />
      <div className="retained-workbench" hidden={Boolean(hasView)}>
        {window.piWorkbench && !query.has('samples') ? (
          <Suspense
            fallback={
              <main className="p-6">
                <output>正在加载会话工作台…</output>
              </main>
            }
          >
            <SessionWorkbench />
          </Suspense>
        ) : (
          <Workbench />
        )}
      </div>
      {hasView ? (
        settingsSection ? (
          <SettingsShell section={settingsSection}>{protectedContent}</SettingsShell>
        ) : (
          <div className="standalone-view">{protectedContent}</div>
        )
      ) : null}
    </AppFrame>
  )
}
