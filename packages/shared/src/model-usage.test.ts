import { expect, test } from 'vitest'

import { recordedTokens, sumRecordedTokens } from './model-usage.js'

test('sDK default zeros, missing, malformed and unsafe counts remain unknown', () => {
  expect(
    recordedTokens({
      input: 0,
      output: -2,
      cacheRead: NaN,
      cacheWrite: '3',
      totalTokens: Number.MAX_SAFE_INTEGER + 1,
    }),
  ).toEqual({ input: null, output: null, cacheRead: null, cacheWrite: null, total: null })
  expect(recordedTokens(null).input).toBeNull()
  expect(recordedTokens({ input: 128, output: 16, cacheRead: 32, totalTokens: 144 })).toEqual({
    input: 128,
    output: 16,
    cacheRead: 32,
    cacheWrite: null,
    total: 144,
  })
  expect(sumRecordedTokens([]).input).toEqual({ known: 0, unknown: 0 })
})
