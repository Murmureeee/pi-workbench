import { execFileSync } from 'node:child_process'
/* oxlint-disable no-await-in-loop -- Physical mutations and permissions must settle sequentially within one isolated fixture. */
import { randomUUID } from 'node:crypto'
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { expect, test, vi } from 'vitest'

import { Redactor } from '@pi-workbench/shared'

import {
  codeCandidates,
  editorArguments,
  ExternalEditor,
} from '../../desktop/src/external-editor.js'
import { externalFailure, verifyExternalTarget } from '../../desktop/src/external-target.js'
import { resolveHostFile } from '../dist/modules/files/file-host.js'
import { FileService } from '../dist/modules/files/file.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { setupChangeFixture } from './helpers/change-fixture.js'
import { externalProgram } from './helpers/external-program.js'

async function fixture() {
  const f = await setupChangeFixture(),
    ws = await f.app.get(WorkspaceService).open(f.cwd)
  if (!ws.ok) {
    throw Error('external scope rejected')
  }
  return { ...f, target: { workspaceId: ws.workspace.id }, files: f.app.get(FileService) }
}
const active = () => true
const noop = () => undefined

test('fILE-06 isolated native executable permission denial fails with recovery and never alters the selected program', async () => {
  const f = await fixture()
  let restore: () => void = noop
  try {
    const program = externalProgram(f.root),
      editor = new ExternalEditor(join(f.root, 'profile'))
    writeFileSync(join(f.cwd, 'safe.txt'), 'safe')
    await editor.select(program.path, 'path', active)
    if (process.platform === 'win32') {
      const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
        encoding: 'utf8',
        windowsHide: true,
      }).match(/S-1-5-[\d-]+/)?.[0]
      if (!sid) {
        throw Error('Current isolated ACL principal unavailable')
      }
      execFileSync('icacls', [program.path, '/deny', '*' + sid + ':(X)'], { windowsHide: true })
      restore = () => {
        execFileSync('icacls', [program.path, '/remove:d', '*' + sid], { windowsHide: true })
      }
    } else {
      const { chmodSync } = await import('node:fs')
      chmodSync(program.path, 0o600)
      restore = () => chmodSync(program.path, 0o700)
    }
    await editor.select(program.path, 'path', active)
    const proof = await f.files.externalTarget({
      target: f.target,
      source: { path: 'safe.txt' },
      action: 'ide',
      line: 1,
    })
    await expect(
      editor.open(proof, active).catch((error: unknown) => {
        throw Error(externalFailure(error))
      }),
    ).rejects.toThrow('权限不足')
    restore()
    restore = noop
    // ACL changes update the executable stamp; recovery requires a fresh explicit choice.
    await editor.select(program.path, 'path', active)
    expect(
      await editor.open(
        await f.files.externalTarget({
          target: f.target,
          source: { path: 'safe.txt' },
          action: 'ide',
          line: 1,
        }),
        active,
      ),
    ).toBe(true)
  } finally {
    restore()
    await f.close()
  }
})

test('fILE-06 four real proof operations retain admission until IO settles and shutdown drains before closing SQLite', async () => {
  const f = await fixture()
  let release: () => void = noop
  try {
    writeFileSync(join(f.cwd, 'code.ts'), 'safe')
    const ws = f.app.get(WorkspaceService),
      actual = ws.environmentDirectory.bind(ws)
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    vi.spyOn(ws, 'environmentDirectory').mockImplementation(async (...args) => {
      await gate
      return actual(...args)
    })
    const pending = Array.from({ length: 4 }, () =>
      f.files.externalTarget({
        target: f.target,
        source: { path: 'code.ts' },
        action: 'ide',
        line: 1,
      }),
    )
    const done = Promise.allSettled(pending)
    await expect(f.files.list(f.target)).rejects.toThrow('繁忙')
    let closed = false
    const drain = f.files.close().then(() => {
      closed = true
      return undefined
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    await expect(
      f.files.externalTarget({
        target: f.target,
        source: { path: 'code.ts' },
        action: 'ide',
        line: 1,
      }),
    ).rejects.toThrow('关闭')
    release()
    expect((await done).every((r) => r.status === 'fulfilled')).toBe(true)
    await drain
    expect(closed).toBe(true)
  } finally {
    release()
    await f.close()
  }
})

test('fILE-06 private proof binds actual Unicode bytes, line and physical root without starting a kernel', async () => {
  const f = await fixture()
  try {
    const path = join(f.cwd, '中文 & code.ts')
    writeFileSync(path, '\ufeffconst 中文 = 1\r\nconst second = 2\r\n')
    const listing = await f.files.list(f.target),
      node = listing.entries.find((n) => n.name === '中文 & code.ts')!
    const read = await f.files.read({ target: f.target, source: { file: node.id } })
    const proof = await f.files.externalTarget({
      target: f.target,
      source: { file: node.id },
      version: read.version!,
      action: 'ide',
      line: 2,
    })
    expect(await verifyExternalTarget(proof)).toBe(path)
    expect(proof).toMatchObject({ root: f.cwd, kind: 'file', line: 2 })
    await expect(
      f.files.externalTarget({ target: f.target, source: { path }, action: 'ide', line: 9 }),
    ).rejects.toThrow('行号')
    writeFileSync(path, 'external edit\n')
    await expect(verifyExternalTarget(proof)).rejects.toThrow('已变化')
    await expect(
      f.files.externalTarget({
        target: f.target,
        source: { path },
        version: read.version!,
        action: 'ide',
        line: 1,
      }),
    ).rejects.toThrow('版本已变化')
    unlinkSync(path)
    await expect(verifyExternalTarget(proof)).rejects.toThrow(/.+/)
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
})

test('fILE-06 rejects outside, private, alternate spelling, cross-target handle, hard links and junctions', async () => {
  const f = await fixture()
  try {
    writeFileSync(join(f.cwd, 'code.ts'), 'safe')
    writeFileSync(join(f.root, 'outside.ts'), 'outside')
    mkdirSync(join(f.cwd, '.git'))
    writeFileSync(join(f.cwd, '.git', 'HEAD'), 'secret')
    const other = join(f.root, 'other')
    mkdirSync(other)
    const ws = await f.app.get(WorkspaceService).open(other)
    if (!ws.ok) {
      throw Error('other rejected')
    }
    const listing = await f.files.list(f.target),
      node = listing.entries.find((n) => n.name === 'code.ts')!
    await expect(
      f.files.externalTarget({
        target: { workspaceId: ws.workspace.id },
        source: { file: node.id },
        action: 'ide',
        line: 1,
      }),
    ).rejects.toThrow(/.+/)
    for (const path of [
      '../outside.ts',
      join(f.root, 'outside.ts'),
      '.git/HEAD',
      'code.ts:secret',
      'code.ts.',
      'NUL',
    ]) {
      await expect(
        f.files.externalTarget({ target: f.target, source: { path }, action: 'reveal', line: 1 }),
      ).rejects.toThrow(/.+/)
    }
    linkSync(join(f.cwd, 'code.ts'), join(f.cwd, 'hard.ts'))
    await expect(
      f.files.externalTarget({
        target: f.target,
        source: { path: 'hard.ts' },
        action: 'ide',
        line: 1,
      }),
    ).rejects.toThrow(/.+/)
    unlinkSync(join(f.cwd, 'hard.ts'))
    symlinkSync(other, join(f.cwd, 'linked'), 'junction')
    await expect(
      f.files.externalTarget({
        target: f.target,
        source: { path: 'linked' },
        action: 'reveal',
        line: 1,
      }),
    ).rejects.toThrow(/.+/)
  } finally {
    await f.close()
  }
})

test('fILE-06 directories and non-readable bytes never invent code lines or system-open active documents', async () => {
  const f = await fixture()
  try {
    const target = f.target
    const root = await f.files.externalTarget({
      target,
      source: { path: '.' },
      action: 'reveal',
      line: 1,
    })
    expect(await verifyExternalTarget(root)).toBe(f.cwd)
    await expect(
      f.files.externalTarget({ target, source: { path: '.' }, action: 'ide', line: 2 }),
    ).rejects.toThrow('目录')
    for (const name of ['run.cmd', 'page.html', 'vector.svg', 'shortcut.lnk']) {
      writeFileSync(join(f.cwd, name), 'fixture')
      await expect(
        f.files.externalTarget({ target, source: { path: name }, action: 'system', line: 1 }),
      ).rejects.toThrow('类型')
    }
    for (const [name, bytes] of [
      ['binary.dat', Buffer.from([0, 1])],
      ['encoding.txt', Buffer.from([0xff, 0xfe])],
      ['large.txt', Buffer.alloc(262145, 120)],
    ] as const) {
      writeFileSync(join(f.cwd, name), bytes)
      await expect(
        f.files.externalTarget({ target, source: { path: name }, action: 'ide', line: 2 }),
      ).rejects.toThrow('行号')
      expect(
        (await f.files.externalTarget({ target, source: { path: name }, action: 'ide', line: 1 }))
          .line,
      ).toBe(1)
    }
    writeFileSync(join(f.cwd, 'safe.txt'), 'safe')
    expect(
      await verifyExternalTarget(
        await f.files.externalTarget({
          target,
          source: { path: 'safe.txt' },
          action: 'system',
          line: 1,
        }),
      ),
    ).toBe(join(f.cwd, 'safe.txt'))
  } finally {
    await f.close()
  }
})

test('fILE-06 main recheck rejects expired proofs and root replacement; fixed permission diagnostics hide OS details', async () => {
  const f = await fixture()
  try {
    mkdirSync(join(f.cwd, 'folder'))
    writeFileSync(join(f.cwd, 'folder', 'code.ts'), 'safe')
    const proof = await f.files.externalTarget({
      target: f.target,
      source: { path: 'folder/code.ts' },
      action: 'ide',
      line: 1,
    })
    await expect(verifyExternalTarget({ ...proof, expiresAt: Date.now() - 1 })).rejects.toThrow(
      '过期',
    )
    renameSync(join(f.cwd, 'folder'), join(f.cwd, 'old'))
    mkdirSync(join(f.cwd, 'folder'))
    writeFileSync(join(f.cwd, 'folder', 'code.ts'), 'safe')
    await expect(verifyExternalTarget(proof)).rejects.toThrow('已变化')
    const denial = Object.assign(Error('private path must not leak'), { code: 'EACCES' })
    expect(externalFailure(denial)).toContain('权限不足')
    expect(externalFailure(denial)).not.toContain('private path')
  } finally {
    await f.close()
  }
})

test('fILE-06 private parent IPC rechecks actual desktop identity after IO; browser and restart cookies cannot get a proof', async () => {
  const f = await fixture(),
    redactor = new Redactor()
  let now = 1000
  const access = new AccessService(24477, redactor, () => now)
  try {
    writeFileSync(join(f.cwd, 'code.ts'), 'safe')
    const pair = (kind: 'desktop' | 'browser') =>
      access.redeem(access.issueTicket(kind).code, 'fixture')!.cookie.split(';')[0]
    const q = {
      type: 'host-file-target' as const,
      id: randomUUID(),
      cookie: pair('desktop'),
      input: { target: f.target, source: { path: 'code.ts' }, action: 'ide' as const, line: 1 },
    }
    expect(await resolveHostFile(access, f.files, redactor, q)).toMatchObject({
      ok: true,
      id: q.id,
    })
    expect(
      await resolveHostFile(access, f.files, redactor, { ...q, cookie: pair('browser') }),
    ).toMatchObject({ ok: false })
    const actual = f.files.externalTarget.bind(f.files)
    vi.spyOn(f.files, 'externalTarget').mockImplementation(async (input) => {
      const proof = await actual(input)
      now += 8 * 60 * 60 * 1000 + 1
      return proof
    })
    const expired = await resolveHostFile(access, f.files, redactor, q)
    expect(expired?.ok).toBe(false)
    expect(expired && !expired.ok ? expired.message : '').toContain('检查期间失效')
    expect(await resolveHostFile(access, f.files, redactor, q)).toMatchObject({ ok: false })
    expect(
      await resolveHostFile(access, f.files, redactor, { ...q, command: 'arbitrary' }),
    ).toBeNull()
    const restarted = new AccessService(24477, redactor)
    try {
      expect(await resolveHostFile(restarted, f.files, redactor, q)).toMatchObject({ ok: false })
    } finally {
      restarted.close()
    }
  } finally {
    access.close()
    await f.close()
  }
})

test('fILE-06 actual executable argv, early failure, program replacement, cancelled save and profile restart', async () => {
  const f = await fixture()
  try {
    const program = externalProgram(f.root),
      profile = join(f.root, 'profile'),
      editor = new ExternalEditor(profile)
    const path = join(f.cwd, '中文 & argument.txt')
    writeFileSync(path, 'one\ntwo')
    const proof = await f.files.externalTarget({
      target: f.target,
      source: { path },
      action: 'ide',
      line: 2,
    })
    expect(await editor.select(program.path, 'vscode', active)).toBe(true)
    expect(await new ExternalEditor(profile).status()).toMatchObject({
      state: 'ready',
      source: 'selected',
      adapter: 'vscode',
    })
    expect(await editor.open(proof, active)).toBe(true)
    const argv = readFileSync(program.path + '.args', 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((s) => Buffer.from(s, 'base64').toString())
    expect(argv).toEqual(['--new-window', '--goto', path + ':2'])
    expect(
      await editor.open(
        await f.files.externalTarget({
          target: f.target,
          source: { path },
          action: 'ide',
          line: 1,
        }),
        () => false,
      ),
    ).toBe(false)
    expect(await editor.select(program.fail, 'path', () => false)).toBe(false)
    expect((await editor.status()).adapter).toBe('vscode')
    await editor.select(program.fail, 'path', active)
    await expect(
      editor.open(
        await f.files.externalTarget({
          target: f.target,
          source: { path },
          action: 'ide',
          line: 1,
        }),
        active,
      ),
    ).rejects.toThrow('报告失败')
    writeFileSync(program.fail, 'changed executable')
    const changed = await editor.status()
    expect(changed.state).toBe('invalid')
    expect(changed.diagnostic).toContain('程序已变化')
    unlinkSync(program.fail)
    const missing = await editor.status()
    expect(missing.state).toBe('invalid')
    expect(missing.diagnostic).toContain('不存在')
    await editor.reset()
    expect(
      readFileSync(program.path + '.args', 'utf8')
        .trim()
        .split(/\r?\n/),
    ).toHaveLength(3)
  } finally {
    await f.close()
  }
})

test('fILE-06 bounded discovery prefers standard VS Code, treats code.cmd only as a hint, and uses fixed argument arrays', () => {
  const base = resolve('fixture-install'),
    bin = join(base, 'Microsoft VS Code', 'bin')
  const paths = codeCandidates({
    LOCALAPPDATA: base,
    ProgramFiles: base,
    PATH: [bin, '.', 'relative'].join(process.platform === 'win32' ? ';' : ':'),
  })
  expect(paths[0]).toBe(join(base, 'Programs', 'Microsoft VS Code', 'Code.exe'))
  expect(paths).toContain(join(dirname(bin), 'Code.exe'))
  expect(paths.every((p) => p.endsWith('Code.exe'))).toBe(true)
  expect(editorArguments('jetbrains', 'x & y', false, 20)).toEqual(['--line', '20', 'x & y'])
  expect(editorArguments('path', 'x;evil', false, 20)).toEqual(['x;evil'])
  expect(editorArguments('vscode', 'folder', true, 1)).toEqual(['--new-window', 'folder'])
})
