import type { Redactor } from './redaction.js'

import { z } from 'zod'

import { toolRiskSchema } from './execution-policy.js'

/** Read-only tool observations. Parameters are the producer's final JSON/text snapshot,
 * not an executable request. Optional fields keep older persisted observations readable. */
export const runtimeToolSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  status: z.enum([
    'pending',
    'running',
    'completed',
    'error',
    'denied',
    'cancelled',
    'interrupted',
  ]),
  summary: z.string(),
  parameters: z.string().optional(),
  parentId: z.string().min(1).nullable().optional(),
  cwd: z.string().optional(),
  durationMs: z.number().finite().nonnegative().optional(),
  exitCode: z.number().int().nullable().optional(),
  mcp: z.strictObject({ server: z.string().min(1), tool: z.string().min(1) }).optional(),
  origin: z.enum(['sdk', 'synthetic-fixture']).optional(),
  diagnostic: z.string().optional(),
  risk: toolRiskSchema.optional(),
})
export type RuntimeTool = z.infer<typeof runtimeToolSchema>

const truncatedResultSchema = z.object({
  details: z.object({ truncation: z.object({ truncated: z.literal(true) }) }),
})

export function toolOutputTruncated(value: unknown): boolean {
  return truncatedResultSchema.safeParse(value).success
}

export function toolIsActive(tool: RuntimeTool): boolean {
  return tool.status === 'pending' || tool.status === 'running'
}

/** Stable call identity wins over arrival order. A late start may supply missing identity
 * metadata after a result, but cannot replace a terminal result or rebind final parameters.
 * Conflicting producers retain the first association and expose a diagnostic, never execute. */
export function mergeToolObservation(
  prior: RuntimeTool | undefined,
  incoming: RuntimeTool,
): RuntimeTool {
  if (!prior) {
    return incoming
  }
  if (
    prior.id !== incoming.id ||
    prior.name !== incoming.name ||
    (prior.parameters !== undefined &&
      incoming.parameters !== undefined &&
      prior.parameters !== incoming.parameters) ||
    (prior.parentId !== undefined &&
      incoming.parentId !== undefined &&
      prior.parentId !== incoming.parentId) ||
    (prior.cwd !== undefined && incoming.cwd !== undefined && prior.cwd !== incoming.cwd) ||
    (prior.origin !== undefined &&
      incoming.origin !== undefined &&
      prior.origin !== incoming.origin) ||
    (prior.risk &&
      incoming.risk &&
      (prior.risk.digest !== incoming.risk.digest ||
        prior.risk.policyVersion !== incoming.risk.policyVersion ||
        prior.risk.level !== incoming.risk.level ||
        prior.risk.automatic !== incoming.risk.automatic)) ||
    (prior.mcp &&
      incoming.mcp &&
      (prior.mcp.server !== incoming.mcp.server || prior.mcp.tool !== incoming.mcp.tool))
  ) {
    return { ...prior, diagnostic: '调用身份或最终参数冲突；已保留原调用，未关联冲突结果。' }
  }
  if (!toolIsActive(prior)) {
    return {
      ...prior,
      ...(prior.parameters === undefined && incoming.parameters !== undefined
        ? { parameters: incoming.parameters }
        : {}),
      ...(prior.parentId === undefined && incoming.parentId !== undefined
        ? { parentId: incoming.parentId }
        : {}),
      ...(prior.cwd === undefined && incoming.cwd !== undefined ? { cwd: incoming.cwd } : {}),
      ...(prior.mcp === undefined && incoming.mcp !== undefined ? { mcp: incoming.mcp } : {}),
      ...(prior.origin === undefined && incoming.origin !== undefined
        ? { origin: incoming.origin }
        : {}),
      ...(prior.risk === undefined && incoming.risk !== undefined ? { risk: incoming.risk } : {}),
      ...(incoming.diagnostic ? { diagnostic: incoming.diagnostic } : {}),
    }
  }
  return {
    ...prior,
    ...incoming,
    status:
      prior.status === 'running' && incoming.status === 'pending' ? 'running' : incoming.status,
    summary: toolIsActive(incoming) && !incoming.summary ? prior.summary : incoming.summary,
  }
}

/** A turn ending or a runtime restart does not prove how an unresolved tool exited. */
export function interruptToolObservations(tools: readonly RuntimeTool[]): RuntimeTool[] {
  return tools.map((tool) =>
    toolIsActive(tool)
      ? {
          ...tool,
          status: 'interrupted',
          diagnostic: '轮次已结束但工具终态未确认；执行结果未知，未自动重放。',
        }
      : tool,
  )
}

/** Redact cumulative tool output before snapshots, live delivery, replay and history. JSON
 * strings are filtered by field as well as content, including unfinished token suffixes.
 * Malformed/unknown output remains safe text; authoritative parameters/history stay intact. */
export function visibleToolObservation(tool: RuntimeTool, redactor: Redactor): RuntimeTool {
  const text = (value: string, streaming: boolean, output = false): string => {
    try {
      const parsed: unknown = JSON.parse(value)
      return JSON.stringify(
        redactor.value(parsed, streaming || (output && toolOutputTruncated(parsed))),
      )
    } catch {
      return redactor.text(value, streaming)
    }
  }
  return runtimeToolSchema.parse(
    redactor.value({
      ...tool,
      ...(tool.parameters !== undefined ? { parameters: text(tool.parameters, false) } : {}),
      summary: text(tool.summary, tool.status !== 'completed', true),
    }),
  )
}
