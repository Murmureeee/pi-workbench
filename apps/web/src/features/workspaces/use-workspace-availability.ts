import type { WorkspaceEnvironmentTarget } from '@pi-workbench/shared'

import { useQuery } from '@tanstack/react-query'

import { workspaceAvailabilitySchema } from '@pi-workbench/shared'

import { sessionJson } from '../../services/session-client.js'

/** Target-scoped observations only; unloading cancels reads, never real daemon work. */
export function useWorkspaceAvailability(
  target: WorkspaceEnvironmentTarget | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['workspace-availability', target],
    queryFn: async ({ signal }) =>
      workspaceAvailabilitySchema.parse(
        await sessionJson(
          `/api/workspaces/availability?${new URLSearchParams(target ?? {})}`,
          signal,
        ),
      ),
    enabled: enabled && Boolean(target),
    refetchInterval: 2000,
    refetchOnMount: 'always',
    staleTime: 0,
    retry: false,
  })
}
