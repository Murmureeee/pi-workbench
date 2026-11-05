import type { RuntimeTool } from './tool-observation.js'

import { expect, test } from 'vitest'

import { redacted, Redactor } from './redaction.js'
import {
  interruptToolObservations,
  mergeToolObservation,
  runtimeToolSchema,
  visibleToolObservation,
} from './tool-observation.js'

const call: RuntimeTool = {
  id: 'child',
  name: 'read',
  status: 'running',
  summary: '',
  parameters: '{"path":"中文.txt"}',
  parentId: 'parent',
}

test('out-of-order results retain terminal text and late starts only fill missing call identity', () => {
  const completed: RuntimeTool = {
    id: call.id,
    name: call.name,
    status: 'completed',
    summary: '返回的正文',
  }
  const late = mergeToolObservation(completed, call)
  expect(late).toMatchObject({ ...completed, parameters: call.parameters, parentId: 'parent' })
  expect(
    mergeToolObservation(late, { ...call, status: 'error', summary: '重复失败', exitCode: 9 }),
  ).toEqual(late)
  expect(mergeToolObservation({ ...call, summary: '累计结果' }, call).summary).toBe('累计结果')
})

test('same call ID cannot be rebound to another name, parent, cwd or final parameters', () => {
  for (const changed of [
    { id: 'other' },
    { name: 'write' },
    { parentId: 'other' },
    { parameters: '{"path":"别处.txt"}' },
    { cwd: 'other' },
    { origin: 'sdk' as const },
  ]) {
    const prior = { ...call, cwd: 'original', origin: 'synthetic-fixture' as const }
    const merged = mergeToolObservation(prior, {
      ...prior,
      ...changed,
      status: 'completed',
      summary: 'wrong',
    })
    expect(merged).toMatchObject(prior)
    expect(merged.diagnostic).toContain('冲突')
  }
})

test('unconfirmed active tools end as unknown while explicit denied/cancelled results remain distinct', () => {
  const tools = [
    call,
    { ...call, id: 'denied', status: 'denied' as const },
    { ...call, id: 'cancelled', status: 'cancelled' as const },
  ]
  expect(interruptToolObservations(tools).map((item) => item.status)).toEqual([
    'interrupted',
    'denied',
    'cancelled',
  ])
  expect(tools[0]?.status).toBe('running')
  expect(runtimeToolSchema.safeParse({ ...call, durationMs: -1 }).success).toBe(false)
  expect(
    runtimeToolSchema.parse({
      id: 'legacy',
      name: 'custom',
      status: 'error',
      summary: 'old record',
    }).parentId,
  ).toBeUndefined()
})

test('structured partial output withholds split known secrets at every nested text field, without changing originals', () => {
  const redactor = new Redactor()
  redactor.remember('private-value-never-render')
  const original = {
    ...call,
    parameters: '{"apiKey":"local-value","path":"file"}',
    summary: JSON.stringify({
      content: [{ type: 'text', text: '进度 private-value-ne' }],
      details: { password: 'hidden' },
    }),
  }
  const safe = visibleToolObservation(original, redactor)
  expect(JSON.stringify(safe)).not.toContain('private-value-ne')
  expect(safe.parameters).not.toContain('local-value')
  expect(safe.summary).not.toContain('hidden')
  expect(safe.summary).toContain(redacted)
  const repeated = runtimeToolSchema.parse(redactor.value(safe))
  expect(JSON.parse(repeated.parameters ?? 'null')).toEqual({ apiKey: redacted, path: 'file' })
  expect(original.summary).toContain('private-value-ne')
  const upstreamTruncated = visibleToolObservation(
    {
      ...original,
      status: 'completed',
      summary: JSON.stringify({
        details: { truncation: { truncated: true } },
        content: [{ type: 'text', text: '截断 private-value-ne' }],
      }),
    },
    redactor,
  )
  expect(upstreamTruncated.summary).not.toContain('private-value-ne')
  expect(
    visibleToolObservation(
      { ...original, status: 'completed', summary: 'private-value-never-render' },
      redactor,
    ).summary,
  ).toBe(redacted)
})
