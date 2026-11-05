import { expect, test } from 'vitest'

import {
  mergeReasoning,
  publicReasoning,
  reasoningSchema,
  visibleReasoning,
} from './reasoning-observation.js'
import { Redactor } from './redaction.js'

test('oBS-06 public completed content is separate from opaque signatures and filtered/malformed blocks', () => {
  expect(
    publicReasoning([{ type: 'thinking', thinking: '公开🙂', thinkingSignature: 'opaque' }]),
  ).toEqual({ status: 'provided', text: '公开🙂', truncated: false })
  for (const block of [
    { type: 'thinking', thinking: 'FORBIDDEN', redacted: true, thinkingSignature: 'encrypted' },
    { type: 'thinking', thinking: 12 },
    { type: 'redacted_thinking', data: 'OPAQUE' },
  ]) {
    expect(publicReasoning([{ type: 'thinking', thinking: '公开' }, block])).toEqual({
      status: 'unavailable',
    })
  }
  expect(publicReasoning([], false)).toEqual({ status: 'unsupported' })
  expect(publicReasoning([])).toEqual({ status: 'not-provided' })
  expect(reasoningSchema.safeParse({ status: 'unavailable', text: 'FORBIDDEN' }).success).toBe(
    false,
  )
})

test('oBS-06 bounded multi-message aggregation never weakens a filtered result', () => {
  const first = publicReasoning([{ type: 'thinking', thinking: 'a'.repeat(65000) }])
  const second = publicReasoning([{ type: 'thinking', thinking: 'b'.repeat(1000) }])
  const result = mergeReasoning(first, second)
  expect(result.status === 'provided' && result.text.length).toBe(65536)
  expect(result).toMatchObject({ status: 'provided', truncated: true })
  expect(mergeReasoning(result, { status: 'unavailable' })).toEqual({ status: 'unavailable' })
  expect(mergeReasoning({ status: 'unavailable' }, second)).toEqual({ status: 'unavailable' })
})

test('oBS-06 display and diagnostic export share redaction and withhold incomplete tokens/filtered bodies', () => {
  const redactor = new Redactor()
  redactor.remember('private-value-123')
  const text = visibleReasoning(
    { status: 'provided', text: '公开 private-value-123 api_key=unsafe sk-', truncated: false },
    redactor,
  )
  expect(text).toMatchObject({ status: 'provided', text: '公开 «redacted» api_key=«redacted» ' })
  const safe = redactor.value({
    content: [
      { type: 'thinking', thinking: 'FORBIDDEN', redacted: true, thinkingSignature: 'OPAQUE' },
      { type: 'thinking', thinking: '公开', thinkingSignature: 'OPAQUE' },
    ],
  })
  expect(JSON.stringify(safe)).not.toMatch(/FORBIDDEN|OPAQUE/)
  expect(JSON.stringify(safe)).toContain('公开')
  expect(
    JSON.stringify(
      redactor.value({
        role: 'assistant',
        content: [
          { type: 'private_payload', data: 'OPAQUE' },
          { type: 'redacted_thinking', data: 'OPAQUE' },
        ],
      }),
    ),
  ).not.toContain('OPAQUE')
})
