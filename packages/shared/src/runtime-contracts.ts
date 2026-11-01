import { z } from 'zod'

export const runtimeCapabilities = ['snapshots', 'replay', 'tool-observation'] as const
export const runtimeHelloSchema = z.strictObject({
  type: z.literal('hello'),
  protocolVersion: z.number().int(),
  daemonId: z.uuid(),
  capabilities: z.array(z.string()),
  mutations: z.boolean(),
  realProviderEnabled: z.boolean(),
})
const toolSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  status: z.enum(['running', 'completed', 'error']),
  summary: z.string(),
})
const approvalSchema = z.strictObject({ id: z.string(), command: z.string(), cwd: z.string() })
const outcomeSchema = z.enum(['completed', 'aborted', 'error'])
const turnSchema = z.strictObject({
  id: z.uuid(),
  messageId: z.string().min(1),
  prompt: z.string(),
  text: z.string(),
  phase: z.enum(['running', 'stopping', 'completed', 'aborted', 'error', 'interrupted']),
  tools: z.array(toolSchema),
  approval: approvalSchema.nullable(),
  error: z.string().nullable(),
})
export const runtimeSnapshotSchema = z
  .strictObject({
    version: z.literal(1),
    daemonId: z.uuid(),
    sessionId: z.uuid(),
    epoch: z.uuid(),
    seq: z.number().int().nonnegative(),
    source: z.enum(['real-sdk/local-fixture', 'synthetic-ipc-fixture']),
    turns: z.array(turnSchema),
  })
  .superRefine((snapshot, context) => {
    const ids = snapshot.turns.map((turn) => turn.id)
    const messages = snapshot.turns.map((turn) => turn.messageId)
    if (
      new Set(ids).size !== ids.length ||
      new Set(messages).size !== messages.length ||
      snapshot.turns.some(
        (turn, index) =>
          new Set(turn.tools.map((tool) => tool.id)).size !== turn.tools.length ||
          (index < snapshot.turns.length - 1 && ['running', 'stopping'].includes(turn.phase)),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Duplicate identities or overlapping active turns',
      })
    }
  })
export const runtimeEventSchema = z
  .strictObject({
    version: z.literal(1),
    daemonId: z.uuid(),
    sessionId: z.uuid(),
    epoch: z.uuid(),
    seq: z.number().int().positive(),
    id: z.string().min(1),
    turnId: z.uuid(),
    payload: z.discriminatedUnion('type', [
      z.strictObject({
        type: z.literal('turn.started'),
        prompt: z.string(),
        messageId: z.string().min(1),
      }),
      z.strictObject({ type: z.literal('message.delta'), messageId: z.string(), text: z.string() }),
      z.strictObject({ type: z.literal('tool.updated'), tool: toolSchema }),
      z.strictObject({ type: z.literal('approval.requested'), approval: approvalSchema }),
      z.strictObject({ type: z.literal('approval.resolved'), approvalId: z.string() }),
      z.strictObject({ type: z.literal('turn.stopping') }),
      z.strictObject({
        type: z.literal('turn.finished'),
        outcome: outcomeSchema,
        error: z.string().optional(),
      }),
    ]),
  })
  .refine(
    (event) => event.id === `${event.epoch}:${event.seq}`,
    'Event ID must match epoch and seq',
  )
export const runtimeSubscribeSchema = z.strictObject({
  type: z.literal('subscribe'),
  protocolVersion: z.literal(1),
  requiredCapabilities: z.array(z.string()).max(16),
  sessionId: z.uuid(),
  epoch: z.uuid(),
  since: z.number().int().nonnegative(),
  daemonId: z.uuid(),
})
export const runtimeFrameSchema = z.discriminatedUnion('type', [
  runtimeHelloSchema,
  z.strictObject({ type: z.literal('event'), event: runtimeEventSchema }),
  z.strictObject({
    type: z.literal('caught-up'),
    epoch: z.uuid(),
    seq: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal('resync-required'), reason: z.string() }),
  z.strictObject({ type: z.literal('incompatible'), message: z.string() }),
])
export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>
export type RuntimeHello = z.infer<typeof runtimeHelloSchema>
export type RuntimeSubscribe = z.infer<typeof runtimeSubscribeSchema>
export type RuntimeFrame = z.infer<typeof runtimeFrameSchema>

/** Versions and advertised observation capabilities are checked before any subscription.
 * Mutation permission remains false until the daemon's separate authenticated API exists.
 */
export function compatibleRuntime(hello: RuntimeHello): boolean {
  return (
    hello.protocolVersion === 1 &&
    runtimeCapabilities.every((cap) => hello.capabilities.includes(cap))
  )
}

/** Applies an ordered session stream. Gaps require a complete authoritative snapshot.
 * This function never selects another session/epoch or performs IO; original text is untruncated.
 */
export function applyRuntimeEvent(state: RuntimeSnapshot, event: RuntimeEvent): RuntimeSnapshot {
  if (
    event.daemonId !== state.daemonId ||
    event.sessionId !== state.sessionId ||
    event.epoch !== state.epoch ||
    event.seq <= state.seq
  ) {
    return state
  }
  if (event.seq !== state.seq + 1) {
    throw new Error('Runtime event sequence gap')
  }
  const next = { ...state, seq: event.seq }
  const payload = event.payload
  const active = state.turns.at(-1)
  if (payload.type === 'turn.started') {
    if (
      state.turns.some(
        (turn) => turn.id === event.turnId || turn.messageId === payload.messageId,
      ) ||
      (active && ['running', 'stopping'].includes(active.phase))
    ) {
      throw new Error('Invalid turn start')
    }
    return {
      ...next,
      turns: [
        ...state.turns,
        {
          id: event.turnId,
          messageId: payload.messageId,
          prompt: payload.prompt,
          text: '',
          phase: 'running',
          tools: [],
          approval: null,
          error: null,
        },
      ],
    }
  }
  if (!active) {
    throw new Error('Event has no turn')
  }
  // A delayed old turn or second terminal consumes its cursor without changing current content.
  if (event.turnId !== active.id || !['running', 'stopping'].includes(active.phase)) {
    return next
  }
  let turn = { ...active }
  switch (payload.type) {
    case 'message.delta':
      if (payload.messageId !== active.messageId) {
        throw new Error('Message identity mismatch')
      }
      turn.text += payload.text
      break
    case 'tool.updated': {
      const prior = turn.tools.find((tool) => tool.id === payload.tool.id)
      if (prior && prior.status !== 'running') {
        break
      }
      turn.tools = prior
        ? turn.tools.map((tool) => (tool.id === payload.tool.id ? payload.tool : tool))
        : [...turn.tools, payload.tool]
      break
    }
    case 'approval.requested':
      turn.approval = payload.approval
      break
    case 'approval.resolved':
      if (turn.approval?.id === payload.approvalId) {
        turn.approval = null
      }
      break
    case 'turn.stopping':
      turn.phase = 'stopping'
      break
    case 'turn.finished':
      turn = { ...turn, phase: payload.outcome, error: payload.error ?? null, approval: null }
      break
  }
  return { ...next, turns: [...state.turns.slice(0, -1), turn] }
}
