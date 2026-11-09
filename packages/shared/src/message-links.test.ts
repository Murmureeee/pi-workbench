import { expect, test } from 'vitest'

import { messageLink, parseMessageLink } from './message-links.js'

test('portable message/tool links encode persisted identities and reject mixed origins, keys and protocols', () => {
  const sessionId = crypto.randomUUID(),
    turnId = crypto.randomUUID(),
    origin = 'http://127.0.0.1:5173'
  const link = messageLink({
    sessionId,
    messageId: 'native:中文/1',
    turnId,
    toolId: 'call+one',
    archived: true,
  })
  expect(parseMessageLink(link, origin)).toBe(link)
  expect(parseMessageLink(`${origin}${link}`, origin)).toBe(link)
  expect(parseMessageLink(`/?session=${sessionId}`, origin)).toBe(`/?session=${sessionId}`)
  for (const bad of [
    link + '&credentials',
    link + '&session=' + sessionId,
    link + '#approval',
    'https://elsewhere.example' + link,
    'javascript:alert(1)',
    `/?session=${sessionId}&tool=call`,
    `/?session=${sessionId}&message=%00`,
    `/?session=${sessionId}&turn=${turnId}`,
    '/?session=../file',
  ]) {
    expect(parseMessageLink(bad, origin)).toBeNull()
  }
})
