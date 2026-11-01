import { z } from 'zod'

export const budgetSchema = z.looseObject({
  limits: z.looseObject({
    maxNewProviderRequestsPerMilestone: z.literal(2),
    maxOutputTokensPerRequest: z.literal(512),
    automaticRetry: z.literal(false),
  }),
  milestones: z.array(
    z.looseObject({
      id: z.string().min(1),
      scopeAuthorization: z.string().optional(),
      requests: z.array(
        z.looseObject({
          requestId: z.string().min(1),
          purpose: z.string().min(1),
          outputLimit: z.number().int().min(1).max(512),
          status: z.enum(['reserved', 'succeeded', 'failed', 'aborted']),
          reservedAt: z.iso.datetime(),
        }),
      ),
    }),
  ),
})
