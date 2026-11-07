import { z } from 'zod'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const fileObservationSchema = z.strictObject({
  status: z.enum(['ready', 'missing', 'unavailable']),
  sha256: hash.nullable(),
})
export const changeToolObservationSchema = z.strictObject({
  id: z.uuid(),
  sessionId: z.uuid(),
  epoch: z.uuid(),
  turnId: z.uuid(),
  callId: z.string().min(1),
  digest: hash,
  tool: z.string().min(1),
  fileId: hash.nullable(),
  path: z.string().nullable(),
  status: z.enum(['running', 'completed', 'failed', 'interrupted']),
  before: fileObservationSchema,
  after: fileObservationSchema,
  expected: hash.nullable(),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable(),
  diagnostic: z.string().nullable(),
})
export const changeSourceSchema = z.strictObject({
  fileId: hash,
  path: z.string(),
  source: z.enum(['tool-observed', 'mixed', 'unknown']),
  netChanged: z.boolean(),
  inSnapshot: z.boolean(),
  tools: z
    .array(
      z.strictObject({
        id: z.uuid(),
        callId: z.string(),
        tool: z.string(),
        status: changeToolObservationSchema.shape.status,
        confirmed: z.boolean(),
      }),
    )
    .max(128),
  reasons: z.array(z.string()).max(8),
  automaticRollback: z.literal(false),
})
export const changeSourcesQuerySchema = z.strictObject({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  offset: z.coerce.number().int().min(0).max(8192).default(0),
})
export const changeSourcesSchema = z.strictObject({
  sessionId: z.uuid(),
  turnId: z.uuid(),
  files: z.array(changeSourceSchema).max(100),
  total: z.number().int().nonnegative(),
  next: z.number().int().nonnegative().nullable(),
  complete: z.boolean(),
  observations: z.number().int().nonnegative(),
  diagnostic: z.string().nullable(),
  automaticRollback: z.literal(false),
})
export type FileObservation = z.infer<typeof fileObservationSchema>
export type ChangeToolObservation = z.infer<typeof changeToolObservationSchema>
export type ChangeSource = z.infer<typeof changeSourceSchema>

/** Pure byte-chain reconciliation. Tool observations are bounded evidence of an invocation,
 * never an OS exclusion guarantee. A command, incomplete record or gap cannot become a
 * positive authorship claim, including when a failed tool left a partial file behind. */
export function reconcileChangeSource(
  fileId: string,
  path: string,
  before: string | null,
  after: string | null,
  observations: ChangeToolObservation[],
  complete: boolean,
): ChangeSource {
  const calls = observations.filter((item) => item.fileId === fileId)
  let cursor: string | null | undefined = before,
    uncertain = !complete,
    observed = false
  const opaque = observations.some((item) => item.fileId === null)
  const tools = calls.map((item) => {
    const previous = item.before.status === 'unavailable' ? undefined : item.before.sha256,
      next = item.after.status === 'unavailable' ? undefined : item.after.sha256
    if (previous === undefined || previous !== cursor) {
      uncertain = true
    }
    const confirmed =
      item.status === 'completed' &&
      item.expected !== null &&
      item.after.status === 'ready' &&
      item.expected === next &&
      previous !== undefined &&
      previous !== next
    if (confirmed) {
      observed = true
    } else if (next !== previous || next === undefined) {
      uncertain = true
    }
    cursor = next
    return { id: item.id, callId: item.callId, tool: item.tool, status: item.status, confirmed }
  })
  if (cursor !== after) {
    uncertain = true
  }
  uncertain ||= opaque
  const source = observed ? (uncertain ? 'mixed' : 'tool-observed') : 'unknown'
  return changeSourceSchema.parse({
    fileId,
    path,
    source,
    netChanged: before !== after,
    inSnapshot: before !== null || after !== null,
    tools,
    automaticRollback: false,
    reasons: [
      ...(observed ? ['已关联最终参数及真实工具前后字节；观察一致不代表 OS 排他证明。'] : []),
      ...(uncertain ? ['基线、工具观察或收尾之间存在未解释区段／证据缺失，来源不确定。'] : []),
      ...(opaque ? ['本轮包含不能限定文件影响的命令或未知目标，不作独占归属。'] : []),
      ...(!observed ? ['没有足以确认本文件修改的完整工具证据。'] : []),
    ],
  })
}
