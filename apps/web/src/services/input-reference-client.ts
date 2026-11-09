import type { InputReferenceCreate } from '@pi-workbench/shared'

import { inputReferenceSchema } from '@pi-workbench/shared'

import { sessionDraft, useSessionDrafts } from '../stores/session-drafts.js'
import { sessionJson } from './session-client.js'

/** Reserve a concrete draft revision before IO. A late result never replaces edits,
 * another pane or a reconciled submission. Host originals stay outside browser storage. */
export async function saveInputReference(
  key: string,
  csrf: string,
  input:
    | Omit<Extract<InputReferenceCreate, { kind: 'paste' }>, 'draftId'>
    | Omit<Exclude<InputReferenceCreate, { kind: 'paste' }>, 'draftId'>,
  expected = sessionDraft(key),
  replaceId: string | null = null,
  signal?: AbortSignal,
) {
  const retained = expected.references.filter((r) => r.id !== replaceId)
  if (expected.pending || retained.length >= 8) {
    throw Error('草稿正在提交或引用已达 8 项；未添加。')
  }
  const data = inputReferenceSchema.parse(
    await sessionJson(
      '/api/chat/input-references',
      signal,
      { ...input, draftId: expected.draftId },
      csrf,
    ),
  )
  signal?.throwIfAborted()
  if (sessionDraft(key) !== expected) {
    throw Error('草稿在核对期间已变化，未覆盖；请重新添加。')
  }
  if (retained.reduce((n, r) => n + r.bytes, data.bytes) > 512 * 1024) {
    throw Error('本次引用超过 512 KiB，请移除或缩小。')
  }
  useSessionDrafts.getState().update(key, { references: [...retained, data] })
  return data
}
