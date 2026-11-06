import { z } from 'zod'

/** Presentation of a host decision, never an executable permission or a read-only hint. */
export const toolRiskSchema = z.strictObject({
  level: z.enum(['L0', 'L1', 'L2', 'L3']),
  reasons: z.array(z.string().min(1).max(500)).min(1).max(16),
  policyVersion: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  automatic: z.boolean(),
})
export type ToolRisk = z.infer<typeof toolRiskSchema>

/** Private host request: the final executor supplies the immutable JSON snapshot. */
export const executionRequestSchema = z.strictObject({
  id: z.uuid(),
  callId: z.string().min(1).max(256),
  parentId: z.string().max(256).nullable(),
  tool: z.string().min(1).max(256),
  parameters: z.string().min(2).max(65536),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
})
export type ExecutionRequest = z.infer<typeof executionRequestSchema>
export const executionDecisionSchema = z.strictObject({
  id: z.uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  allowed: z.boolean(),
  reason: z.string().max(2000),
  risk: toolRiskSchema,
  /** Verified read bytes are captured by the host; SDK never reopens the path. */
  readText: z.string().max(262144).optional(),
})
export type ExecutionDecision = z.infer<typeof executionDecisionSchema>
