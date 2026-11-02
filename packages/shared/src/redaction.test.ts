import { describe, expect, it } from 'vitest'

import { redacted, Redactor } from './redaction.js'

describe('SEC-06 shared presentation policy', () => {
  it('redacts nested fields and common command/header/URL/key forms without changing execution input', () => {
    const scrub = new Redactor()
    const input = {
      nested: [
        {
          apiKey: 'not-a-real-key',
          refresh_token: 'refresh-fixture',
          Authorization: 'Bearer token-fixture',
        },
      ],
      plain: 'normal Unicode 👩‍💻 中文',
    }
    expect(scrub.value(input)).toEqual({
      nested: [{ apiKey: redacted, refresh_token: redacted, Authorization: redacted }],
      plain: input.plain,
    })
    expect(input.nested[0]?.apiKey).toBe('not-a-real-key')
    for (const text of [
      'Authorization: Bearer abc123-fixture',
      'FOO_KEY=abc123-fixture',
      'curl --access-token abc123-fixture',
      'curl --token abc123-fixture',
      'curl --password="abc123-fixture"',
      'https://user:abc123-fixture@example.test/?api_key=abc123-fixture',
      '{"accessToken":"abc123-fixture"}',
      "DB_PASSWORD='abc123-fixture'",
      'sk-abc123-fixture',
      '-----BEGIN PRIVATE KEY-----\nabc123-fixture\n-----END PRIVATE KEY-----',
    ]) {
      expect(scrub.text(text)).not.toContain('abc123-fixture')
      expect(scrub.text(scrub.text(text))).toBe(scrub.text(text))
    }
    expect(scrub.text('MONKEY=ordinary --output useful.txt')).toBe(
      'MONKEY=ordinary --output useful.txt',
    )
  })

  it('masks registered literal/URI/escaped values, retains rotation values, and handles cycles', () => {
    const scrub = new Redactor(),
      secret = 'fixture:unlabelled/秘密-392'
    scrub.remember(secret)
    scrub.remember('second-value-523')
    for (const value of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
      expect(scrub.text(`failed ${value}`)).toBe(`failed ${redacted}`)
    }
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    expect(scrub.value(cycle)).toEqual({ self: '[unavailable]' })
  })

  it('withholds every split of known multiword secrets until a safe boundary and flushes final text', () => {
    const scrub = new Redactor(),
      secret = 'fixture long credential 4d91'
    scrub.remember(secret)
    for (let i = 1; i <= secret.length; i++) {
      const active = scrub.text(`prefix ${secret.slice(0, i)}`, true)
      expect(active).toBe('prefix ')
    }
    expect(scrub.text(`prefix ${secret} suffix `, true)).toBe(`prefix ${redacted} suffix `)
    expect(scrub.text(`prefix ${secret}`)).toBe(`prefix ${redacted}`)
    expect(scrub.text('正常流式 中文 ', true)).toBe('正常流式 中文 ')
  })
})
