import {
  workspaceMetadataResultSchema,
  workspaceRecentSchema,
  workspaceResultSchema,
} from '@pi-workbench/shared'

import { sessionJson } from './session-client.js'

/** Selection is local to the view. An interrupted fetch never aborts a daemon task or
 * claims that registration failed: retries are safe because the host deduplicates identity.
 */
export async function workspaceCommand(
  operation: 'open' | 'validate' | 'activate',
  body: unknown,
  csrf: string,
) {
  const response = await fetch(`/api/workspaces/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-piw-csrf': csrf },
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify(body),
  })
  if (response.status === 401) {
    window.dispatchEvent(new Event('piw-auth-required'))
  }
  if (!response.ok && response.status !== 400) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? '客户端未授权。请重新配对后重试；没有创建会话。'
        : '本地服务暂不可用。请检查连接后重试；目录注册结果可通过重新打开核对。',
    )
  }
  const value: unknown = await response.json()
  return workspaceResultSchema.parse(value)
}

/** Metadata reads have no directory probes. Query cancellation releases only this fetch. */
export async function readRecentWorkspaces(signal: AbortSignal) {
  return workspaceRecentSchema.parse(await sessionJson('/api/workspaces/recent', signal))
}

/** Explicit, versioned metadata edits; an uncertain receipt is never automatically retried. */
export async function editWorkspace(
  operation: 'rename' | 'remove' | 'relocate',
  body: unknown,
  csrf: string,
) {
  return workspaceMetadataResultSchema.parse(
    await sessionJson(`/api/workspaces/${operation}`, undefined, body, csrf),
  )
}
