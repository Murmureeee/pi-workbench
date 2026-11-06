import { z } from 'zod'

import { toolRiskSchema } from './execution-policy.js'

/** Display-only approval snapshot. The digest binds the original final parameters even when
 * the host redacts the displayed JSON. No client receives an executable permit. */
export const executionApprovalSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.uuid(),
  epoch: z.uuid(),
  turnId: z.uuid(),
  callId: z.string().min(1).max(256),
  parentId: z.string().nullable(),
  tool: z.string().min(1),
  cwd: z.string().min(1),
  parameters: z.string().max(65536),
  risk: toolRiskSchema,
  createdAt: z.number().int().nonnegative(),
  irreversible: z.literal(true),
})
export const executionApprovalListSchema = z.strictObject({
  approvals: z.array(executionApprovalSchema).max(64),
})
export const executionApprovalCommandSchema = z.strictObject({
  sessionId: z.uuid(),
  epoch: z.uuid(),
  turnId: z.uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  policyVersion: z.number().int().positive(),
  action: z.enum(['allow-once', 'deny', 'cancel']),
  reason: z.string().trim().max(500),
  acceptIrreversible: z.boolean(),
})
export type ExecutionApproval = z.infer<typeof executionApprovalSchema>
export type ExecutionApprovalCommand = z.infer<typeof executionApprovalCommandSchema>
