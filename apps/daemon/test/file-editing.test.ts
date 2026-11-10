/* oxlint-disable no-await-in-loop -- Real file mutations and their native exclusive locks must be observed in order. */
import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  linkSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'

import { fileEditSnapshotSchema, runtimeCapabilities } from '@pi-workbench/shared'

import { ChangeProvenanceService } from '../dist/modules/changes/change-provenance.service.js'
import { ChangeReviewService } from '../dist/modules/changes/change-review.service.js'
import { ChangeService } from '../dist/modules/changes/change.service.js'
import { FileEditService } from '../dist/modules/files/file-edit.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { AuditService } from '../dist/modules/security/audit.service.js'
import { DirectoryWriteService } from '../dist/modules/workspaces/directory-write.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { authorizedHeaders } from './helpers/access.js'
import { setupChangeFixture } from './helpers/change-fixture.js'
import { fixtureGit as git } from './helpers/git.js'

async function fixture() {
  const f = await setupChangeFixture(),
    ws = await f.app.get(WorkspaceService).open(f.cwd)
  if (!ws.ok) {
    throw new Error('editing workspace unavailable')
  }
  const target = { workspaceId: ws.workspace.id },
    owner = 'file-editor-fixture'
  return {
    ...f,
    get app() {
      return f.app
    },
    target,
    owner,
    get edits() {
      return f.app.get(FileEditService)
    },
    open: (path: string) => f.app.get(FileEditService).open({ target, source: { path } }, owner),
  }
}

test('fILE-03 native exclusive UTF8/BOM LF/CRLF/no-newline saves exact bytes; unchanged bytes are never formatted; user Git stays intact', async () => {
  const f = await fixture()
  try {
    git(f.cwd, 'init')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'user baseline\n')
    git(f.cwd, 'add', '.')
    git(f.cwd, 'commit', '-m', 'user history')
    const head = git(f.cwd, 'rev-parse', 'HEAD'),
      index = readFileSync(join(f.cwd, '.git', 'index'))
    const cases = ['中文\nnext\n', '\ufeff中文\r\nnext\r\n', 'single', '\ufeff', '']
    for (const [i, raw] of cases.entries()) {
      const path = `代码${i}.ts`
      writeFileSync(join(f.cwd, path), raw)
      const d = fileEditSnapshotSchema.parse(await f.open(path))
      expect(d.text).toBe(raw.replace(/^\ufeff/, '').replaceAll('\r\n', '\n'))
      await f.edits.save({ editId: d.editId, text: d.text }, f.owner)
      expect(readFileSync(join(f.cwd, path))).toEqual(Buffer.from(raw))
      await f.edits.save({ editId: d.editId, text: d.text + '\n用户' }, f.owner)
      expect(readFileSync(join(f.cwd, path))).toEqual(
        Buffer.from(raw + (d.newline === 'crlf' ? '\r\n' : '\n') + '用户'),
      )
    }
    expect(git(f.cwd, 'rev-parse', 'HEAD')).toBe(head)
    expect(readFileSync(join(f.cwd, '.git', 'index'))).toEqual(index)
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(
      f.app
        .get(AuditService)
        .page({ kind: 'user-file-save' })
        .entries.filter((e) => e.decision === 'saved'),
    ).toHaveLength(10)
  } finally {
    await f.close()
  }
}, 60000)

test('fILE-03 real external version races retain disk; separate overwrite binds the exact draft/version/client and is single use', async () => {
  const f = await fixture()
  try {
    const path = join(f.cwd, 'race.ts')
    writeFileSync(path, 'baseline')
    const d = await f.open('race.ts')
    writeFileSync(path, 'external one')
    const a = await f.edits.save({ editId: d.editId, text: 'my draft' }, f.owner)
    expect(a.status).toBe('conflict')
    expect(readFileSync(path, 'utf8')).toBe('external one')
    await expect(
      f.edits.save(
        { editId: d.editId, text: 'my draft', confirmationId: a.confirmationId },
        'another-client',
      ),
    ).rejects.toThrow('许可')
    await expect(
      f.edits.save(
        { editId: d.editId, text: 'different draft', confirmationId: a.confirmationId },
        f.owner,
      ),
    ).rejects.toThrow('确认')
    writeFileSync(path, 'external two')
    const b = await f.edits.save(
      { editId: d.editId, text: 'my draft', confirmationId: a.confirmationId },
      f.owner,
    )
    expect(b.status).toBe('conflict')
    expect(readFileSync(path, 'utf8')).toBe('external two')
    expect(
      (
        await f.edits.save(
          { editId: d.editId, text: 'my draft', confirmationId: b.confirmationId },
          f.owner,
        )
      ).status,
    ).toBe('saved')
    expect(readFileSync(path, 'utf8')).toBe('my draft')
    await expect(
      f.edits.save(
        { editId: d.editId, text: 'my draft', confirmationId: b.confirmationId },
        f.owner,
      ),
    ).rejects.toThrow('确认')
  } finally {
    await f.close()
  }
}, 30000)

test('fILE-03 real writes stay untouched when requested audit fails; a completion audit failure is uncertain with saved bytes; repeated opens reuse only same client/version permits', async () => {
  const f = await fixture()
  try {
    const path = join(f.cwd, 'recovery.ts')
    writeFileSync(path, 'baseline')
    const d = await f.open(path)
    for (let i = 0; i < 17; i++) {
      expect((await f.open(path)).editId).toBe(d.editId)
    }
    const audit = f.app.get(AuditService),
      record = audit.record.bind(audit)
    const spy = vi.spyOn(audit, 'record').mockImplementationOnce(() => {
      throw new Error('isolated requested audit failure')
    })
    await expect(
      f.edits.save({ editId: d.editId, text: 'requested failure draft' }, f.owner),
    ).rejects.toThrow('未完成')
    expect(readFileSync(path, 'utf8')).toBe('baseline')
    spy.mockImplementationOnce(record).mockImplementationOnce(() => {
      throw new Error('isolated completion audit failure')
    })
    await expect(
      f.edits.save({ editId: d.editId, text: 'actually saved, client must reconcile' }, f.owner),
    ).rejects.toThrow('未完成')
    expect(readFileSync(path, 'utf8')).toBe('actually saved, client must reconcile')
    spy.mockRestore()
    const fresh = await f.open(path)
    expect(fresh.text).toBe('actually saved, client must reconcile')
    expect(
      (await f.edits.save({ editId: fresh.editId, text: 'explicit recovery' }, f.owner)).status,
    ).toBe('saved')
  } finally {
    await f.close()
  }
}, 60000)

test('fILE-03 actual deletion, replacement, read-only permission, junction, hard link and private/ambiguous paths fail without creating or overwriting', async () => {
  const f = await fixture()
  try {
    const path = join(f.cwd, 'identity.ts')
    writeFileSync(path, 'baseline')
    const d = await f.open('identity.ts')
    unlinkSync(path)
    await expect(f.edits.save({ editId: d.editId, text: 'lost' }, f.owner)).rejects.toThrow(/.+/)
    writeFileSync(path, 'replacement')
    await expect(f.edits.save({ editId: d.editId, text: 'lost' }, f.owner)).rejects.toThrow('身份')
    expect(readFileSync(path, 'utf8')).toBe('replacement')
    const fresh = await f.open('identity.ts')
    chmodSync(path, 0o444)
    try {
      await expect(f.edits.save({ editId: fresh.editId, text: 'denied' }, f.owner)).rejects.toThrow(
        /.+/,
      )
    } finally {
      chmodSync(path, 0o666)
    }
    expect(readFileSync(path, 'utf8')).toBe('replacement')
    const aclDraft = await f.open('identity.ts')
    const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true,
    }).match(/S-1-[\d-]+/)?.[0]
    if (!sid) {
      throw new Error('Actual Windows ACL fixture SID missing')
    }
    try {
      execFileSync('icacls', [path, '/deny', `*${sid}:(WD)`], { windowsHide: true, stdio: 'pipe' })
      await expect(
        f.edits.save({ editId: aclDraft.editId, text: 'ACL denied' }, f.owner),
      ).rejects.toThrow('独占')
      expect(readFileSync(path, 'utf8')).toBe('replacement')
    } finally {
      execFileSync('icacls', [path, '/remove:d', `*${sid}`], { windowsHide: true, stdio: 'pipe' })
    }
    linkSync(path, join(f.cwd, 'hard.ts'))
    await expect(f.open('hard.ts')).rejects.toThrow(/.+/)
    unlinkSync(join(f.cwd, 'hard.ts'))
    const other = join(f.root, 'outside')
    mkdirSync(other)
    writeFileSync(join(other, 'out.ts'), 'outside')
    symlinkSync(other, join(f.cwd, 'junction'), 'junction')
    for (const hint of [
      '../outside/out.ts',
      'junction/out.ts',
      '.git/HEAD',
      '.env',
      'identity.ts:stream',
      'identity.ts.',
    ]) {
      await expect(f.open(hint)).rejects.toThrow(/.+/)
    }
    expect(readFileSync(join(other, 'out.ts'), 'utf8')).toBe('outside')
  } finally {
    await f.close()
  }
}, 30000)

test('fILE-03 bounds reject mixed/CR/legacy/binary/redacted text and over-limit edits; actual long Unicode path retains bytes', async () => {
  const f = await fixture()
  try {
    const cases: [string, string | Buffer][] = [
      ['mixed.ts', 'a\r\nb\nc'],
      ['cr.ts', 'a\rb'],
      ['legacy.txt', Buffer.from([0xff, 0xfe, 0x61])],
      ['bin.dat', Buffer.from([0])],
      ['secret.ts', 'api_key = "fixture-secret-only"'],
      ['large.ts', 'a'.repeat(262145)],
      ['lines.ts', 'a\n'.repeat(10001)],
    ]
    for (const [path, bytes] of cases) {
      writeFileSync(join(f.cwd, path), bytes)
      await expect(f.open(path)).rejects.toThrow(/.+/)
    }
    const dir = join(
      f.cwd,
      ...Array.from({ length: 5 }, (_, i) => `中文长目录${i}${'a'.repeat(35)}`),
    )
    mkdirSync(dir, { recursive: true })
    const path = join(dir, '精确.ts')
    writeFileSync(path, 'one\n')
    const d = await f.open(path)
    for (const text of ['a\r\nb', 'a'.repeat(262145), 'a\n'.repeat(10001), '\ud800']) {
      await expect(f.edits.save({ editId: d.editId, text }, f.owner)).rejects.toThrow(/.+/)
    }
    expect((await f.edits.save({ editId: d.editId, text: '中文新稿\n' }, f.owner)).status).toBe(
      'saved',
    )
    expect(readFileSync(path)).toEqual(Buffer.from('中文新稿\n'))
  } finally {
    await f.close()
  }
}, 60000)

test('fILE-03 independent external exclusive writer makes native save fail closed and retry after lock release works', async () => {
  const f = await fixture()
  try {
    const path = join(f.cwd, 'locked.ts')
    writeFileSync(path, 'baseline')
    const d = await f.open(path)
    const script =
      '$ErrorActionPreference="Stop";[Console]::InputEncoding=New-Object System.Text.UTF8Encoding;$p=[Console]::In.ReadLine();$f=[IO.File]::Open($p,3,3,0);[Console]::WriteLine("locked");[Console]::In.ReadLine()|Out-Null;$f.Dispose()'
    const lock = spawn(
      join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    )
    let out = ''
    lock.stdout.on('data', (b: Buffer) => {
      out += b.toString()
    })
    lock.stdin.write(path + '\n')
    try {
      await vi.waitFor(() => expect(out).toContain('locked'))
      await expect(f.edits.save({ editId: d.editId, text: 'draft' }, f.owner)).rejects.toThrow(
        '独占',
      )
    } finally {
      lock.stdin.end('\n')
      await new Promise<void>((resolve) => lock.once('exit', () => resolve()))
    }
    expect(readFileSync(path, 'utf8')).toBe('baseline')
    expect((await f.edits.save({ editId: d.editId, text: 'draft' }, f.owner)).status).toBe('saved')
  } finally {
    await f.close()
  }
}, 30000)

test('fILE-03 real SDK managed writer blocks manual saves; reverse lease blocks admission; final native version check catches mutation after arbiter claim', async () => {
  const f = await fixture()
  try {
    const path = join(f.cwd, 'managed.ts')
    writeFileSync(path, 'baseline')
    const d = await f.open(path)
    const task = f.start()
    await f.ready(task.sessionId)
    const pid = f.app.get(KernelService).list()[0]?.pid
    await expect(f.edits.save({ editId: d.editId, text: 'draft' }, f.owner)).rejects.toThrow(
      '受管写入',
    )
    expect(f.app.get(KernelService).list()[0]?.pid).toBe(pid)
    await f.app.get(KernelService).abort(task.sessionId, task.turnId)
    await task.promise
    await vi.waitFor(() =>
      expect(
        f.app.get(DirectoryWriteService).blocker(f.app.get(DirectoryWriteService).identify(f.cwd)),
      ).toBeNull(),
    )
    const writes = f.app.get(DirectoryWriteService),
      acquire = writes.acquireManual.bind(writes)
    vi.spyOn(writes, 'acquireManual').mockImplementationOnce((cwd, id) => {
      const release = acquire(cwd, id)
      writeFileSync(path, 'changed after claim')
      return release
    })
    const conflict = await f.edits.save({ editId: d.editId, text: 'draft' }, f.owner)
    expect(conflict.status).toBe('conflict')
    expect(readFileSync(path, 'utf8')).toBe('changed after claim')
    const release = acquire(f.cwd),
      queued = f.start()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(
      f.app
        .get(KernelService)
        .resources()
        .queue.some((q) => q.id === queued.turnId),
    ).toBe(true)
    release()
    await f.ready(queued.sessionId)
    await f.app.get(KernelService).abort(queued.sessionId, queued.turnId)
    await queued.promise
  } finally {
    await f.close()
  }
}, 60000)

test('fILE-03 save records human/external only and never mutates historical snapshots, source chain or decisions; restart drops edit permits', async () => {
  const f = await fixture()
  try {
    const path = join(f.cwd, 'history.ts')
    writeFileSync(path, 'before')
    const t = await f.collect(() => writeFileSync(path, 'external after'))
    const history = () => f.app.get(ChangeService).history(t.sessionId).rounds
    const before = JSON.stringify(history())
    const sources = await f.app.get(ChangeProvenanceService).sources(t.turnId)
    const review = await f.app.get(ChangeReviewService).list(t.turnId)
    const d = await f.open('history.ts')
    await f.edits.save({ editId: d.editId, text: 'user saved' }, f.owner)
    const audit = f.app.get(AuditService).page({ kind: 'user-file-save' }).entries
    expect(audit[0]).toMatchObject({ source: 'human', decision: 'saved' })
    expect(audit[0]?.reason).toContain('外部修改')
    expect(before).toBe(JSON.stringify(history()))
    expect((await f.app.get(ChangeProvenanceService).sources(t.turnId)).files).toEqual(
      sources.files,
    )
    expect((await f.app.get(ChangeReviewService).list(t.turnId)).files).toEqual(review.files)
    await f.restart()
    await expect(
      f.edits.save({ editId: d.editId, text: 'restart draft' }, f.owner),
    ).rejects.toThrow('失效')
    expect(readFileSync(path, 'utf8')).toBe('user saved')
    expect(f.app.get(KernelService).list()).toEqual([])
  } finally {
    await f.close()
  }
}, 30000)

test('fILE-03 actual desktop HTTP requires pairing CSRF and strict body; cancelled opens and post-cancellation saves never gain a permit or write', async () => {
  const f = await fixture()
  try {
    writeFileSync(join(f.cwd, 'http.ts'), 'baseline')
    const url = '/api/files/edit/open',
      payload = { target: f.target, source: { path: 'http.ts' } }
    const base = {
      host: '127.0.0.1:24477',
      origin: 'http://127.0.0.1:24477',
      'content-type': 'application/json',
      'x-piw-protocol': '1',
      'x-piw-capabilities': runtimeCapabilities.join(','),
    }
    expect((await f.app.inject({ method: 'POST', url, payload, headers: base })).statusCode).toBe(
      401,
    )
    const browser = await authorizedHeaders(f.app, 24477, 'browser')
    expect(
      (await f.app.inject({ method: 'POST', url, payload, headers: { ...base, ...browser } }))
        .statusCode,
    ).toBe(403)
    const identity = await authorizedHeaders(f.app, 24477, 'desktop')
    const desktop = {
      ...base,
      ...identity,
      'x-piw-csrf': f.app.get(AccessService).snapshot(identity.cookie).csrf!,
    }
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url,
          payload,
          headers: { ...desktop, 'x-piw-csrf': '' },
        })
      ).statusCode,
    ).toBe(403)
    const response = await f.app.inject({ method: 'POST', url, payload, headers: desktop })
    expect(response.statusCode).toBe(200)
    fileEditSnapshotSchema.parse(response.json())
    const d = await f.open('http.ts')
    const c = new AbortController()
    c.abort()
    await expect(
      f.edits.save({ editId: d.editId, text: 'cancelled' }, f.owner, c.signal),
    ).rejects.toThrow(/.+/)
    expect(readFileSync(join(f.cwd, 'http.ts'), 'utf8')).toBe('baseline')
    await expect(f.edits.open(payload, f.owner, c.signal)).rejects.toThrow(/.+/)
  } finally {
    await f.close()
  }
}, 30000)
