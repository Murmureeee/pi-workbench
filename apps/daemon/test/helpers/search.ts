import type { createApp } from '../../dist/bootstrap/app.js'
import type { SessionConfiguration } from '@pi-workbench/shared'

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { SessionStore } from '../../dist/modules/sessions/session.store.js'
import { WorkspaceService } from '../../dist/modules/workspaces/workspace.service.js'

/** Explicit synthetic v3 JSONL plus real daemon SQLite. No SDK prompt is fabricated or sent.
 * Used for large histories, pagination and localization; real-SDK indexing is tested separately. */
export async function seedSearchSession(
  app: Awaited<ReturnType<typeof createApp>>,
  directory: string,
  title: string,
  texts: string[] = ['用户中文正文', '助手中文答复'],
  projectId: string | null = null,
) {
  const store = app.get(SessionStore),
    id = randomUUID(),
    epoch = randomUUID(),
    requestId = randomUUID()
  const workspace = await app.get(WorkspaceService).open(directory, { remember: false })
  assert(workspace.ok)
  const configuration: SessionConfiguration = {
    projectId,
    workspaceId: null,
    model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
    thinking: 'off',
  }
  const session = {
    id,
    createdAt: Date.now(),
    cwd: directory,
    workspaceId: workspace.workspace.id,
    creationRequestId: requestId,
    configuration,
    title,
    titleSource: 'local' as const,
    titleVersion: 1,
  }
  store.acceptSubmission(
    { requestId, sessionId: null, retryOf: null, text: texts[0] ?? '合成输入', configuration },
    requestId,
    session,
  )
  const submission = store.submission(requestId)
  assert(submission)
  const sessionFile = join(directory, 'kernels', id, epoch, 'sessions', 'search-fixture.jsonl')
  mkdirSync(dirname(sessionFile), { recursive: true })
  store.registerRuntime({
    sessionId: id,
    epoch,
    cwd: directory,
    nativeSessionId: id,
    sessionFile,
    source: 'synthetic-ipc-fixture',
  })
  const records = [
    { type: 'session', version: 3, id, cwd: directory },
    {
      type: 'custom',
      id: 'marker',
      parentId: null,
      customType: 'pi-workbench.turn.v1',
      data: {
        version: 1,
        sessionId: id,
        epoch,
        turnId: submission.turnId,
        messageId: `${submission.turnId}:assistant`,
      },
    },
    ...texts.map((text, index) => ({
      type: 'message',
      id: `entry-${index}`,
      parentId: index ? `entry-${index - 1}` : 'marker',
      message: {
        role: index % 2 ? 'assistant' : 'user',
        content: [{ type: 'text', text }],
        ...(index % 2 ? { stopReason: 'stop' } : {}),
      },
    })),
  ]
  writeFileSync(sessionFile, records.map((row) => JSON.stringify(row)).join('\n') + '\n')
  store.settleSubmission(requestId, 'completed')
  return { session, submission, epoch, sessionFile }
}
