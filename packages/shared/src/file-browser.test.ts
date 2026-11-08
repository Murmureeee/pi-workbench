import { expect, test } from 'vitest'

import { fileLink, fileReadInputSchema } from './file-browser.js'

test('fILE-02 local Markdown hints recognize Unicode/escaped paths and line suffixes without enabling system navigation', () => {
  expect(fileLink('src/%E4%B8%AD%E6%96%87%20file.ts#L23-L25')).toEqual({
    path: 'src/中文 file.ts',
    line: 23,
  })
  expect(fileLink('D:/Project/app.ts:7:2')).toEqual({ path: 'D:/Project/app.ts', line: 7 })
  expect(fileLink('file:///D:/Project/app.ts#L3')).toEqual({ path: 'D:/Project/app.ts', line: 3 })
  expect(fileLink('./code.ts')).toEqual({ path: './code.ts', line: 1 })
  for (const value of [
    'https://example.invalid/a.ts',
    'javascript:run()',
    'data:text/html,test',
    'file://host/share/a.ts',
    'file:///D:/a.ts?q=1',
    '\\\\server\\a.ts',
    'code.ts#L0',
    'code.ts#L10001',
    'code.ts%0a',
    '%ZZ',
  ]) {
    expect(fileLink(value)).toBeNull()
  }
})
test('fILE-02 read boundary requires exactly one target, one hint source and a valid expected version', () => {
  const target = { workspaceId: '11111111-1111-4111-8111-111111111111' }
  expect(fileReadInputSchema.safeParse({ target, source: { path: 'src/main.ts' } }).success).toBe(
    true,
  )
  expect(
    fileReadInputSchema.safeParse({ target, source: { path: 'x', file: target.workspaceId } })
      .success,
  ).toBe(false)
  expect(
    fileReadInputSchema.safeParse({ target, source: { path: 'x' }, version: 'stale' }).success,
  ).toBe(false)
})
