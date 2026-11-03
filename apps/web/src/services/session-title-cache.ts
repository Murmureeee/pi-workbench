import type { ManagedSession, SessionTitle } from '@pi-workbench/shared'
import type { QueryClient } from '@tanstack/react-query'

import { sessionListSchema, sessionTitleListSchema } from '@pi-workbench/shared'

function newer(a: SessionTitle | undefined, b: SessionTitle): SessionTitle {
  return a && a.titleVersion > b.titleVersion ? a : b
}
/** Retain newer committed versions while a snapshot taken before a notification is in flight.
 * This index contains managed identities only; deletion will require explicit tombstones. */
export function mergeTitles(old: unknown, next: unknown) {
  const prior = sessionTitleListSchema.safeParse(old)
  const rows = new Map((prior.success ? prior.data.titles : []).map((row) => [row.sessionId, row]))
  for (const row of sessionTitleListSchema.parse(next).titles) {
    rows.set(row.sessionId, newer(rows.get(row.sessionId), row))
  }
  return { titles: [...rows.values()] }
}

/** Server versions protect against older polls, delayed command receipts and old first-send
 * responses. The metadata cache also covers notifications arriving before the session list. */
export function mergeSessions(old: unknown, next: unknown, metadata: unknown) {
  const prior = sessionListSchema.safeParse(old)
  const titles = sessionTitleListSchema.safeParse(metadata)
  return {
    sessions: sessionListSchema.parse(next).sessions.map((row): ManagedSession => {
      const saved = prior.success
        ? prior.data.sessions.find((item) => item.id === row.id)
        : undefined
      const title = titles.success
        ? titles.data.titles.find((item) => item.sessionId === row.id)
        : undefined
      const candidate = newer(saved && { ...saved, sessionId: saved.id }, {
        ...row,
        sessionId: row.id,
      })
      const latest = title ? newer(candidate, title) : candidate
      return Object.assign({}, row, {
        title: latest.title,
        titleSource: latest.titleSource,
        titleVersion: latest.titleVersion,
      })
    }),
  }
}

/** Apply only committed server metadata. This does not select a view or change draft/task state. */
export function applySessionTitle(cache: QueryClient, title: SessionTitle): void {
  cache.setQueryData(['session-titles'], (old: unknown) => mergeTitles(old, { titles: [title] }))
  cache.setQueryData(['chat-sessions'], (old: unknown) => {
    const list = sessionListSchema.safeParse(old)
    return list.success
      ? mergeSessions(old, list.data, cache.getQueryData(['session-titles']))
      : old
  })
}
