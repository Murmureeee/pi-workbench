import { z } from 'zod'

import { workspaceRecordSchema } from './workspace-contracts.js'
import { workspaceEnvironmentTargetSchema } from './workspace-environment.js'

/** Availability is an observation, never an execution grant or an instruction to replay. */
export const workspaceAvailabilitySchema = z.strictObject({
  target: workspaceEnvironmentTargetSchema,
  workspace: workspaceRecordSchema,
  cwd: z.string().min(1).max(4096),
  state: z.enum(['available', 'unavailable', 'relocated']),
  diagnostic: z.string().max(2048),
  recovery: z.string().min(1).max(2048),
  resources: z
    .strictObject({
      trusted: z.number().int().nonnegative(),
      untrusted: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative(),
      execution: z.literal('disabled'),
    })
    .nullable(),
  checkedAt: z.number().int().nonnegative(),
})
export type WorkspaceAvailability = z.infer<typeof workspaceAvailabilitySchema>
