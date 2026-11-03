import type { SessionOrganization, SessionOrganize } from '@pi-workbench/shared'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { sessionOrganizationListSchema, sessionOrganizationSchema } from '@pi-workbench/shared'

import { sessionJson } from '../../services/session-client.js'

/** Merge by server revision so an older in-flight list cannot undo a saved action. */
function mergeOrganizations(old: unknown, next: unknown) {
  const prior = sessionOrganizationListSchema.safeParse(old)
  const incoming = sessionOrganizationListSchema.parse(next)
  return {
    organizations: incoming.organizations.map((row) => {
      const saved = prior.success
        ? prior.data.organizations.find((item) => item.sessionId === row.sessionId)
        : undefined
      return saved && saved.revision > row.revision ? saved : row
    }),
  }
}

/** Read-only polling and explicit CAS mutations. No optimistic success or automatic POST
 * retry: uncertain saves are reconciled by the next authoritative list. */
export function useSessionOrganization(enabled: boolean, csrf: string) {
  const cache = useQueryClient()
  const query = useQuery({
    queryKey: ['chat-organization'],
    queryFn: async ({ signal }) =>
      sessionOrganizationListSchema.parse(await sessionJson('/api/chat/organization', signal)),
    structuralSharing: mergeOrganizations,
    enabled,
    refetchInterval: 1000,
  })
  const change = async (
    sessionId: string,
    input: SessionOrganize,
  ): Promise<SessionOrganization> => {
    try {
      const result = sessionOrganizationSchema.parse(
        await sessionJson(
          `/api/chat/sessions/${encodeURIComponent(sessionId)}/organization`,
          undefined,
          input,
          csrf,
        ),
      )
      if (result.sessionId !== sessionId) {
        throw new Error('整理结果身份不一致，请刷新核对。')
      }
      cache.setQueryData(['chat-organization'], (old: unknown) => {
        const parsed = sessionOrganizationListSchema.safeParse(old)
        return mergeOrganizations(old, {
          organizations: [
            ...(parsed.success
              ? parsed.data.organizations.filter((row) => row.sessionId !== sessionId)
              : []),
            result,
          ],
        })
      })
      return result
    } finally {
      void cache.invalidateQueries({ queryKey: ['chat-organization'] })
      void cache.invalidateQueries({ queryKey: ['chat-activity'] })
    }
  }
  return { ...query, change }
}
