import type { ChangeToolObservation } from './change-provenance.js'

import { expect, test } from 'vitest'

import { reconcileChangeSource } from './change-provenance.js'

const fileId = 'a'.repeat(64),
  a = 'b'.repeat(64),
  b = 'c'.repeat(64),
  c = 'd'.repeat(64)
const call = (patch: Partial<ChangeToolObservation> = {}): ChangeToolObservation => ({
  id: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  turnId: crypto.randomUUID(),
  epoch: crypto.randomUUID(),
  callId: 'call',
  digest: 'e'.repeat(64),
  tool: 'write',
  fileId,
  path: 'file.txt',
  status: 'completed',
  before: { status: 'ready', sha256: a },
  after: { status: 'ready', sha256: b },
  expected: b,
  startedAt: 1,
  endedAt: 2,
  diagnostic: null,
  ...patch,
})
test('cHANGE-02 exact complete byte chain confirms only observed invocation sections and never grants rollback', () => {
  expect(reconcileChangeSource(fileId, 'file.txt', a, b, [call()], true)).toMatchObject({
    source: 'tool-observed',
    tools: [{ confirmed: true }],
    automaticRollback: false,
  })
})
test.each(['pre', 'post', 'opaque', 'incomplete'] as const)(
  'cHANGE-02 %s uncertainty remains visible alongside a verified tool segment',
  (mode) => {
    const observations = [call()]
    if (mode === 'opaque') {
      observations.push(call({ fileId: null, tool: 'powershell', expected: null }))
    }
    expect(
      reconcileChangeSource(
        fileId,
        'file.txt',
        mode === 'pre' ? c : a,
        mode === 'post' ? c : b,
        observations,
        mode !== 'incomplete',
      ).source,
    ).toBe('mixed')
  },
)
test('cHANGE-02 failed/interrupted/unavailable observations never turn external bytes into a tool authorship claim', () => {
  for (const status of ['failed', 'interrupted'] as const) {
    expect(reconcileChangeSource(fileId, 'file.txt', a, b, [call({ status })], true).source).toBe(
      'unknown',
    )
  }
  expect(
    reconcileChangeSource(
      fileId,
      'file.txt',
      a,
      b,
      [call({ before: { status: 'unavailable', sha256: null } })],
      true,
    ).source,
  ).toBe('unknown')
  expect(reconcileChangeSource(fileId, 'file.txt', a, c, [], true).source).toBe('unknown')
})
