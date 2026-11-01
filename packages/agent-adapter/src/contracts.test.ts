import type { Projection, WorkbenchEvent } from '@pi-workbench/shared'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { emptyProjection, eventSchema, reduceEvent, restoreProjection } from '@pi-workbench/shared'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  sdk: z.literal('1.4.0'),
  mode: z.literal('read-only-replay'),
  newProviderRequests: z.literal(0),
  envelopeSource: z.string(),
  samples: z
    .array(
      z.object({
        id: z.string(),
        file: z.string(),
        kind: z.enum(['core01', 'core02']),
        origin: z.enum([
          'real-sdk/local-http-fixture',
          'real-sdk/local-fixtures',
          'real-sdk/configured-provider',
        ]),
        sha256: z.string().length(64),
        expected: z.object({
          rows: z.number(),
          text: z.string(),
          phase: z.enum(['review', 'error', 'stopped']),
          final: z.object({ status: z.string(), result: z.string().nullable() }),
          sdkTypes: z.array(z.string()),
          hostTypes: z.array(z.string()),
        }),
      }),
    )
    .min(14),
})
const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(new URL('../test/contracts/recordings.json', import.meta.url), 'utf8')),
)
const eventObject = z.looseObject({ type: z.string() })
const rowSchema = z.object({
  sequence: z.number().int().positive(),
  source: z.string(),
  event: eventObject,
  visible: z.object({ status: z.string(), result: z.string().nullable() }),
})
const messageSchema = z.looseObject({
  role: z.string(),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
})

/** Read archived bytes only; never import/run spike SDK, auth, tools or provider scripts. */
function readRecording(sample: z.infer<typeof manifestSchema>['samples'][number]) {
  const bytes = readFileSync(resolve(root, sample.file))
  expect(
    createHash('sha256').update(bytes).digest('hex'),
    `${sample.id}: archived bytes changed (${sample.file})`,
  ).toBe(sample.sha256)
  return bytes
    .toString('utf8')
    .trim()
    .split('\n')
    .map((line, index) => {
      try {
        return rowSchema.parse(JSON.parse(line))
      } catch (failure) {
        throw new Error(`${sample.id}: ${sample.file}:${index + 1}: invalid recorded row`, {
          cause: failure,
        })
      }
    })
}

/** Test-only bridge into today's presentation reducer, not the production CORE-05 adapter.
 * SDK/provider origin remains in the manifest. Session/turn IDs and transport seq are synthetic.
 */
function replay(rows: ReturnType<typeof readRecording>, id: string) {
  let state = emptyProjection()
  let turn = 0
  let failure: string | null = null
  let seq = 0
  const normalized: WorkbenchEvent[] = []
  const states: Projection[] = []
  const push = (payload: WorkbenchEvent['payload']) => {
    const event = eventSchema.parse({
      version: 1,
      source: 'fake-kernel',
      sessionId: id,
      turnId: `turn-${turn}`,
      epoch: 'recording-replay',
      seq: ++seq,
      payload,
    })
    normalized.push(event)
    state = reduceEvent(state, event)
    states.push(state)
  }
  for (const [index, row] of rows.entries()) {
    const raw = row.event.type === 'sdk.event' ? eventObject.parse(row.event.event) : row.event
    try {
      switch (raw.type) {
        case 'agent_start':
          failure = null
          // A retry starts another SDK run inside the same product turn.
          if (!state.sessionId || ['review', 'error', 'stopped'].includes(state.phase)) {
            turn += 1
            push({ type: 'started', prompt: 'Read-only recorded SDK replay' })
          }
          break
        case 'message_update': {
          const delta = z
            .looseObject({ type: z.string(), delta: z.string().optional() })
            .parse(raw.assistantMessageEvent)
          if (delta.type === 'text_delta') {
            push({ type: 'delta', text: z.string().parse(delta.delta) })
          }
          break
        }
        case 'message_end': {
          const message = messageSchema.parse(raw.message)
          if (message.role === 'assistant') {
            if (message.stopReason === 'error') {
              failure = message.errorMessage ?? 'Recorded SDK error'
            }
            if (message.stopReason === 'aborted') {
              push({ type: 'stopped' })
            }
          }
          break
        }
        case 'agent_end':
          if (raw.willRetry !== true) {
            push(failure ? { type: 'error', message: failure } : { type: 'model-ended' })
          } else {
            failure = null
          }
          break
        case 'agent_settled':
          push(raw.aborted === true ? { type: 'stopped' } : { type: 'settled' })
          break
        case 'approval.requested':
          push({
            type: 'approval',
            command: z.string().parse(raw.toolName),
            cwd: 'recorded workspace (read-only replay)',
          })
          break
        case 'approval.invalidated':
        case 'tool.blocked-or-failed':
          push({ type: 'denied' })
          break
      }
      expect(
        state.needsSync,
        `${id}: normalized transition from raw line ${index + 1} (${raw.type})`,
      ).toBe(false)
    } catch (error) {
      throw new Error(
        `${id}: raw line ${index + 1}, SDK/host event ${raw.type}, presentation seq ${seq}`,
        { cause: error },
      )
    }
  }
  return { state, states, normalized }
}

describe('OPS-08 pinned recorded SDK contracts (read-only, no new provider requests)', () => {
  it.each(manifest.samples)('$id [$origin]', (sample) => {
    const rows = readRecording(sample)
    expect(rows).toHaveLength(sample.expected.rows)
    for (const [index, row] of rows.entries()) {
      expect(row.sequence, `${sample.file}:${index + 1}: raw sequence`).toBe(index + 1)
      expect(row.source, `${sample.file}:${index + 1}: source label`).toBe(sample.origin)
    }
    const events = rows.map((row) =>
      row.event.type === 'sdk.event' ? eventObject.parse(row.event.event) : row.event,
    )
    expect([
      ...new Set(
        events
          .filter((_value, i) => sample.kind === 'core01' || rows[i]?.event.type === 'sdk.event')
          .map((value) => value.type),
      ),
    ]).toEqual(sample.expected.sdkTypes)
    expect(rows.at(-1)?.visible).toEqual(sample.expected.final)
    const { state, normalized } = replay(rows, sample.id)
    expect(state.phase).toBe(sample.expected.phase)
    // Queue recordings have multiple product turns: compare their complete, untruncated delta stream.
    expect(
      normalized
        .flatMap((value) => (value.payload.type === 'delta' ? [value.payload.text] : []))
        .join(''),
    ).toBe(sample.expected.text)
    const duplicated = normalized
      .flatMap((value) => [value, value])
      .reduce(reduceEvent, emptyProjection())
    expect(duplicated).toEqual(state)
  })

  it.each(manifest.samples.filter((value) => value.kind === 'core02'))(
    '$id retains approval and denial without replaying execution',
    (sample) => {
      const rows = readRecording(sample)
      const { states } = replay(rows, sample.id)
      const host = rows.filter((row) => row.event.type !== 'sdk.event')
      expect([...new Set(host.map((row) => row.event.type))]).toEqual(sample.expected.hostTypes)
      expect(states.some((value) => value.phase === 'approval')).toBe(true)
      expect(states.some((value) => value.phase === 'denied')).toBe(true)
      expect(host.some((row) => row.event.type === 'tool.execute.enter')).toBe(false)
      expect(
        host
          .filter((row) => row.event.type === 'pending.checked')
          .map((row) => row.event.sideEffectAbsent),
      ).toEqual([true])
    },
  )

  it.each(manifest.samples)(
    '$id restores a complete snapshot after a synthetic dropped envelope',
    (sample) => {
      const { state, normalized } = replay(readRecording(sample), sample.id)
      const first = normalized[0]
      const third = normalized[2]
      if (!first || !third) {
        throw new Error('Expected a nonempty replay')
      }
      const gap = reduceEvent(reduceEvent(emptyProjection(), first), third)
      expect(gap.needsSync).toBe(true)
      expect(
        restoreProjection(gap, state, { sessionId: sample.id, epoch: 'recording-replay' }),
      ).toEqual(state)
    },
  )
})
