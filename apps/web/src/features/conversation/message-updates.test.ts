import { expect, test } from 'vitest'

import { messageStamp, updatedMessages } from './message-updates.js'

test('one reply remains one new message across Chinese/emoji deltas and authoritative replacement', () => {
  const seen = { user: messageStamp('问题', ''), reply: messageStamp('中文', 'running') }
  for (const text of ['中文🙂', '中文🙂继续', '中文🙂继续\n完成']) {
    expect(updatedMessages({ ...seen, reply: messageStamp(text, 'running') }, seen)).toBe(1)
  }
  const committed = { ...seen, reply: messageStamp('中文🙂继续\n完成', 'completed') }
  expect(updatedMessages(committed, committed)).toBe(0)
  expect(
    updatedMessages(
      { ...committed, reply: messageStamp('替换🙂相同长度', 'completed') },
      committed,
    ),
  ).toBe(1)
})

test('first discovery, removed old entries and separate new messages have distinct counts', () => {
  expect(updatedMessages({ old: '1' }, null)).toBe(0)
  expect(updatedMessages({ old: '1' }, { old: '1', removed: '2' })).toBe(0)
  expect(updatedMessages({ old: '1', user: '2', reply: '3' }, { old: '1' })).toBe(2)
  expect(messageStamp('private-marker', 'completed')).not.toContain('private-marker')
})
