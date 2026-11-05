import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readNativeHistory, readNativeMessage, readNativeRange } from './native-history.js'

describe('CORE-06 read-only native v3 history parser (synthetic file fixtures)', () => {
  it('oBS-06 excludes thinking and opaque payloads from reply/full-text while retaining only public reasoning separately', () => {
    for (const mode of ['public', 'filtered', 'unknown']) {
      const redacted = mode === 'filtered'
      const bytes = Buffer.from(
        [
          { type: 'session', version: 3, id: 'native', cwd: 'unused' },
          {
            type: 'message',
            id: 'a',
            parentId: null,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'thinking',
                  thinking: 'THINKING_ONLY',
                  thinkingSignature: 'OPAQUE',
                  redacted,
                },
                { type: 'text', text: '普通回答' },
                ...(mode === 'unknown' ? [{ type: 'redacted_thinking', data: 'OPAQUE' }] : []),
              ],
            },
          },
        ]
          .map((record) => JSON.stringify(record))
          .join('\n') + '\n',
      )
      const record = readNativeHistory(bytes, 'native').records[0]
      if (!record) {
        throw new Error('Missing native record')
      }
      expect(record.message?.text).toBe('普通回答')
      expect(readNativeMessage(bytes, record)).toBe('普通回答')
      expect(record.message?.reasoning).toEqual(
        mode !== 'public'
          ? { status: 'unavailable' }
          : { status: 'provided', text: 'THINKING_ONLY', truncated: false },
      )
    }
  })
  it('bounds traversal of corrupt cyclic parents in an external read snapshot', () => {
    const bytes = Buffer.from(
      [
        { type: 'session', version: 3, id: 'native', cwd: 'unused' },
        {
          type: 'message',
          id: 'self',
          parentId: 'self',
          message: { role: 'user', content: '可读原文' },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join('\n') + '\n',
    )
    const result = readNativeHistory(bytes, 'native')
    expect(result.diagnostics.some((item) => item.code === 'cyclic-parent')).toBe(true)
    expect(result.records[0]?.message?.text).toBe('可读原文')
  })
  it('follows native parent IDs rather than file order and ignores system metadata in displayed messages', () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-native-branch-')),
      path = join(directory, 'session.jsonl')
    try {
      writeFileSync(
        path,
        [
          { type: 'session', version: 3, id: 'native', cwd: directory },
          {
            type: 'message',
            id: 'system',
            parentId: null,
            message: { role: 'system', content: 'system metadata' },
          },
          {
            type: 'message',
            id: 'one',
            parentId: 'system',
            message: { role: 'user', content: '第一分支' },
          },
          {
            type: 'message',
            id: 'two',
            parentId: 'one',
            message: { role: 'assistant', content: '不在当前分支' },
          },
          {
            type: 'message',
            id: 'fork',
            parentId: 'one',
            message: { role: 'assistant', content: '当前分支👩‍💻' },
          },
        ]
          .map((record) => JSON.stringify(record))
          .join('\n') + '\n',
      )
      const before = readFileSync(path),
        result = readNativeHistory(path, 'native')
      expect(result.diagnostics).toEqual([])
      expect(
        result.records.flatMap((entry) => (entry.message ? [entry.message.text] : [])),
      ).toEqual(['第一分支', '当前分支👩‍💻'])
      const last = result.records.at(-1)
      if (!last) {
        throw new Error('Missing native entry')
      }
      expect(readNativeMessage(path, last)).toBe('当前分支👩‍💻')
      expect(readFileSync(path)).toEqual(before)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('preserves exact malformed UTF-8 bytes for export and retains valid descendants after a corrupt message', () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-native-corrupt-')),
      path = join(directory, 'session.jsonl')
    try {
      const header =
        JSON.stringify({ type: 'session', version: 3, id: 'native', cwd: directory }) + '\n'
      const invalid = Buffer.from([0xff, 0xfe, 0x0a])
      const broken =
        JSON.stringify({ type: 'message', id: 'broken', parentId: null, message: {} }) + '\n'
      const valid =
        JSON.stringify({
          type: 'message',
          id: 'readable',
          parentId: 'broken',
          message: { role: 'user', content: '仍可读取' },
        }) + '\n'
      writeFileSync(
        path,
        Buffer.concat([Buffer.from(header), invalid, Buffer.from(broken + valid)]),
      )
      const result = readNativeHistory(path, 'native'),
        diagnostic = result.diagnostics[0]
      if (!diagnostic) {
        throw new Error('Expected diagnostic')
      }
      expect(readNativeRange(path, diagnostic.offset, diagnostic.length)).toEqual(invalid)
      expect(result.records.at(-1)?.message?.text).toBe('仍可读取')
      expect(result.diagnostics).toHaveLength(2)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('rejects future native versions and identity mismatch without migrating or repairing the original', () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-native-version-')),
      path = join(directory, 'session.jsonl')
    try {
      const original =
        JSON.stringify({ type: 'session', version: 999, id: 'native', cwd: directory }) + '\n'
      writeFileSync(path, original)
      expect(readNativeHistory(path, 'native')).toMatchObject({
        records: [],
        diagnostics: [{ code: 'incompatible-header' }],
      })
      expect(readFileSync(path, 'utf8')).toBe(original)
      writeFileSync(path, original.replace('999', '3'))
      expect(readNativeHistory(path, 'another-native').diagnostics).toMatchObject([
        { code: 'incompatible-header' },
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
