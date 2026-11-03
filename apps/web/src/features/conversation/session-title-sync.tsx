import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { accessSnapshotSchema, sessionTitleListSchema } from '@pi-workbench/shared'

import { useNavigation } from '../../services/navigation.js'
import { sessionJson } from '../../services/session-client.js'
import { applySessionTitle, mergeTitles } from '../../services/session-title-cache.js'
import { SessionTitleClient } from '../../services/session-title-client.js'

/** Global app observer, including paired read-only browser history. Every reconnect reads
 * SQLite truth; missed notifications never imply a successful rename or a model execution. */
export function SessionTitleSync() {
  const cache = useQueryClient()
  const { search } = useNavigation()
  const access = useQuery({
    queryKey: ['client-access'],
    queryFn: async ({ signal }) =>
      accessSnapshotSchema.parse(await sessionJson('/api/access', signal)),
    refetchInterval: 2000,
  })
  const route = new URLSearchParams(search)
  const hasTitleView = Boolean(window.piWorkbench || route.has('history') || route.has('observe'))
  const enabled = Boolean(hasTitleView && access.data?.authenticated && !access.isError)
  const titles = useQuery({
    queryKey: ['session-titles'],
    queryFn: async ({ signal }) =>
      sessionTitleListSchema.parse(await sessionJson('/api/session-titles', signal)),
    structuralSharing: mergeTitles,
    enabled,
    refetchInterval: 10000,
  })
  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    const client = new SessionTitleClient(
      (title) => {
        applySessionTitle(cache, title)
        void cache.invalidateQueries({ queryKey: ['chat-sessions'] })
      },
      () => {
        void cache.invalidateQueries({ queryKey: ['session-titles'] })
        void cache.invalidateQueries({ queryKey: ['chat-sessions'] })
      },
      (incompatible) => {
        if (incompatible) {
          void cache.invalidateQueries({ queryKey: ['client-access'] })
        }
      },
    )
    client.connect()
    return () => client.disconnect()
  }, [cache, enabled])
  useEffect(() => {
    const query = new URLSearchParams(search)
    const id = query.get('session') ?? query.get('history') ?? query.get('observe')
    const title = enabled
      ? titles.data?.titles.find((row) => row.sessionId === id)?.title
      : undefined
    document.title = title ? `${title} · Pi Workbench` : 'Pi Workbench'
  }, [search, titles.data, enabled])
  return null
}
