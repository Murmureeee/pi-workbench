import { useQuery } from '@tanstack/react-query'

import { inputQueueSchema } from '@pi-workbench/shared'

import { sessionJson } from '../../services/session-client.js'

/** One pane-owned poll shares the durable queue with its editor and current-stage display. */
export function useInputQueue(sessionId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['input-queue', sessionId],
    queryFn: async ({ signal }) =>
      inputQueueSchema.parse(
        await sessionJson(
          `/api/chat/sessions/${encodeURIComponent(sessionId ?? '')}/queue`,
          signal,
        ),
      ),
    enabled: enabled && Boolean(sessionId),
    refetchInterval: 600,
    gcTime: 0,
  })
}
