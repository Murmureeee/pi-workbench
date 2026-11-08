import { useQuery } from '@tanstack/react-query'

import { changeCoverageSchema } from '@pi-workbench/shared'

import { sessionJson } from './session-client.js'

/** Keyed scope observation; query failure disables restoration and never grants a permit. */
export function useChangeCoverage(sessionId: string, turnId: string) {
  return useQuery({
    queryKey: ['change-coverage', sessionId, turnId],
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async ({ signal }) => {
      const value = changeCoverageSchema.parse(
        await sessionJson(
          `/api/changes/coverage?${new URLSearchParams({ sessionId, turnId })}`,
          signal,
        ),
      )
      if (value.sessionId !== sessionId || value.turnId !== turnId) {
        throw new Error('回滚范围的会话或轮次不一致。')
      }
      return value
    },
  })
}
