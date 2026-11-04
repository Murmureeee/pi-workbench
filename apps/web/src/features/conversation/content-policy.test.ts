import { expect, test } from 'vitest'

import { closedFence, messagePrefix, messageUrl } from './content-policy.js'

test('only explicit web hyperlinks pass; local/encoded/control/credentials/image URLs remain inert', () => {
  expect(messageUrl('https://example.com/a?q=1')).toBe('https://example.com/a?q=1')
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///C:/secret',
    'C:\\secret',
    '//example.com',
    '/api/access',
    'http:\\example.com',
    'https://user:pass@example.com',
    'https://exa\nmple.com',
    'jav&#x61;script:alert(1)',
  ]) {
    expect(messageUrl(url)).toBe('')
  }
  expect(messageUrl('https://example.com/tracker', 'src')).toBe('')
})
test('preview preserves surrogate pairs; only complete parser source ranges enable highlighting', () => {
  expect(messagePrefix('a🙂b', 2)).toBe('a')
  expect(closedFence('```ts\nlet a=1\n```')).toBe(true)
  expect(closedFence('~~~ts\nlet a=1\n~~~~')).toBe(true)
  expect(closedFence('```ts\nlet a=1')).toBe(false)
  expect(closedFence('```ts\nlet a=1\n~~~')).toBe(false)
})
