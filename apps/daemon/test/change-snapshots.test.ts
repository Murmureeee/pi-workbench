import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { expect, test, vi } from 'vitest'

import { changeHistorySchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { ChangeService } from '../dist/modules/changes/change.service.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../dist/modules/security/approval.service.js'
import { SecurityService } from '../dist/modules/security/security.service.js'
import { SessionGrantService } from '../dist/modules/security/session-grant.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { DirectoryWriteService } from '../dist/modules/workspaces/directory-write.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { authorizedHeaders } from './helpers/access.js'

const wait = { timeout: 20000, interval: 40 }
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Snapshot fixture value missing')
  }
  return value
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'piw-snapshot-')),
    cwd = join(root, '中文文件'),
    dataDir = join(root, 'data')
  mkdirSync(cwd)
  const app = await createApp({
    dataDir,
    port: 24472,
    development: true,
    resourceLimits: { kernels: 4, modelTasks: 3 },
  })
  const changes = app.get(ChangeService),
    kernels = app.get(KernelService),
    writes = app.get(DirectoryWriteService),
    approvals = app.get(ApprovalService)
  const start = (fixture: 'hold' | 'reply' | 'error' | 'approval-write' = 'reply', path = cwd) => {
    const sessionId = randomUUID(),
      turnId = randomUUID()
    const promise = kernels.prompt(sessionId, path, {
      turnId,
      text: 'CHANGE01 real SDK offline fixture',
      fixture,
    })
    void promise.catch(() => undefined)
    return { sessionId, turnId, promise }
  }
  return {
    root,
    cwd,
    dataDir,
    app,
    changes,
    kernels,
    writes,
    approvals,
    start,
    latest: (id: string) => required(changes.history(id).rounds[0]),
    stream: async (id: string) =>
      vi.waitFor(
        () => expect(app.get(EventService).snapshot(id)?.turns.at(-1)?.text).toContain('OFFLINE_'),
        wait,
      ),
    close: async () => {
      await app.close()
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}
function approve(f: Awaited<ReturnType<typeof setup>>, accept = true) {
  const p = required(f.approvals.list()[0])
  f.approvals.decide(
    p.id,
    {
      sessionId: p.sessionId,
      epoch: p.epoch,
      turnId: p.turnId,
      digest: p.risk.digest,
      policyVersion: p.risk.policyVersion,
      action: 'allow-once',
      reason: 'explicit CHANGE01 local fixture consent',
      acceptIrreversible: accept,
    },
    'desktop-fixture',
  )
}
function git(cwd: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@piw.invalid',
      '-c',
      'core.autocrlf=false',
      '-C',
      cwd,
      ...args,
    ],
    { windowsHide: true },
  )
}
function metadata(root: string) {
  const files: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        files[relative(root, full)] = createHash('sha256').update(readFileSync(full)).digest('hex')
      }
    }
  }
  walk(root)
  return files
}

test('cHANGE-01 captures raw dirty/staged/untracked/binary versions independently, preserves all user Git metadata and reads after SQLite reopen', async () => {
  const f = await setup()
  try {
    git(f.cwd, 'init')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'committed')
    git(f.cwd, 'add', '.')
    git(f.cwd, 'commit', '-m', 'user history')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'staged')
    git(f.cwd, 'add', '.')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'dirty\r\n原字节')
    const binary = Buffer.from([0, 255, 13, 10, 42])
    writeFileSync(join(f.cwd, '二进制.bin'), binary)
    const userGit = metadata(join(f.cwd, '.git'))
    const turn = f.start('hold')
    await f.stream(turn.sessionId)
    expect(f.latest(turn.sessionId).baseline).toMatchObject({ status: 'ready', files: 2 })
    writeFileSync(join(f.cwd, 'tracked.txt'), '外部混合\nnew')
    unlinkSync(join(f.cwd, '二进制.bin'))
    writeFileSync(join(f.cwd, 'added.txt'), 'new file')
    await f.kernels.abort(turn.sessionId, turn.turnId)
    await turn.promise
    expect(f.latest(turn.sessionId)).toMatchObject({
      outcome: 'aborted',
      final: { status: 'ready', files: 2 },
      provenance: 'uncertain',
      automaticRollback: false,
    })
    expect(await f.changes.readVersion(turn.turnId, 'baseline', '二进制.bin')).toEqual(binary)
    expect((await f.changes.readVersion(turn.turnId, 'baseline', 'tracked.txt'))?.toString()).toBe(
      'dirty\r\n原字节',
    )
    expect(await f.changes.readVersion(turn.turnId, 'baseline', 'added.txt')).toBeNull()
    expect(await f.changes.readVersion(turn.turnId, 'final', '二进制.bin')).toBeNull()
    expect(metadata(join(f.cwd, '.git'))).toEqual(userGit)
    await f.app.close()
    // Saved bytes remain recoverable even with the source directory removed. Restart only
    // reads references/metadata, not current cwd and not an old SDK authorization.
    rmSync(f.cwd, { recursive: true, force: true })
    const reopened = await createApp({ dataDir: f.dataDir, port: 24472, development: true })
    try {
      expect(
        (
          await reopened.get(ChangeService).readVersion(turn.turnId, 'final', 'tracked.txt')
        )?.toString(),
      ).toBe('外部混合\nnew')
      expect(reopened.get(KernelService).list()).toEqual([])
      expect(reopened.get(ApprovalService).list()).toEqual([])
      expect(reopened.get(SessionGrantService).list().grants).toEqual([])
    } finally {
      await reopened.close()
    }
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-01 persists successful and provider-error SDK outcomes without inventing a rollback entitlement', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'a.txt'), 'version one')
    const success = f.start()
    await success.promise
    const failure = f.start('error')
    await failure.promise
    for (const [turn, outcome] of [
      [success, 'completed'],
      [failure, 'failed'],
    ] as const) {
      expect(f.latest(turn.sessionId)).toMatchObject({
        outcome,
        baseline: { status: 'ready' },
        final: { status: 'ready' },
        automaticRollback: false,
      })
    }
    const row = f.app
      .get(WorkspaceDatabase)
      .sqlite.prepare('SELECT data FROM change_rounds WHERE turn_id=?')
      .get(success.turnId)
    expect(JSON.stringify(row)).not.toContain('version one')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-01 baseline failure pauses actual SDK writes until explicit per-call irreversible consent', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'too-large.bin'), Buffer.alloc(5 * 1024 * 1024 + 1))
    const turn = f.start('approval-write')
    await vi.waitFor(() => expect(f.approvals.list()).toHaveLength(1), wait)
    expect(f.latest(turn.sessionId).baseline).toMatchObject({ status: 'failed', reference: null })
    expect(required(f.approvals.list()[0]).risk.reasons.join(' ')).toContain('基线不可用')
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    expect(() => approve(f, false)).toThrow(/未执行/)
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    approve(f)
    await turn.promise
    expect(readFileSync(join(f.cwd, 'APPROVED.txt'), 'utf8')).toBe('SEC02_APPROVED_ONCE')
    expect(f.latest(turn.sessionId)).toMatchObject({
      outcome: 'completed',
      final: { status: 'failed' },
    })
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-01 ready reference corrupted during approval denies the actual tool and never reads current bytes as fallback', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'original.txt'), 'baseline only')
    const turn = f.start('approval-write')
    await vi.waitFor(() => expect(f.approvals.list()).toHaveLength(1), wait)
    const partition = required(readdirSync(join(f.dataDir, 'ledger'))[0])
    execFileSync(
      'git',
      [
        '--git-dir',
        join(f.dataDir, 'ledger', partition, 'objects.git'),
        'update-ref',
        '-d',
        `refs/piw/${turn.turnId}/baseline`,
      ],
      { windowsHide: true },
    )
    approve(f)
    await turn.promise
    expect(existsSync(join(f.cwd, 'APPROVED.txt'))).toBe(false)
    expect(f.latest(turn.sessionId).baseline.status).toBe('failed')
    await expect(f.changes.readVersion(turn.turnId, 'baseline', 'original.txt')).rejects.toThrow(
      /不可用/,
    )
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-01 bounded capture excludes ignores, links, nested repositories, credentials and private data with explicit coverage', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, '.gitignore'), 'ignored/\n*.secret\n')
    mkdirSync(join(f.cwd, 'ignored'))
    writeFileSync(join(f.cwd, 'ignored', 'huge.bin'), Buffer.alloc(6 * 1024 * 1024))
    writeFileSync(join(f.cwd, 'key.secret'), 'hidden')
    writeFileSync(join(f.cwd, '.env'), 'PRIVATE_KEY')
    writeFileSync(join(f.cwd, 'hard.txt'), 'linked')
    linkSync(join(f.cwd, 'hard.txt'), join(f.cwd, 'hard-alias.txt'))
    mkdirSync(join(f.cwd, 'nested'))
    git(join(f.cwd, 'nested'), 'init')
    symlinkSync(
      f.dataDir,
      join(f.cwd, 'data-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const turn = f.start()
    await turn.promise
    expect(f.latest(turn.sessionId).baseline).toMatchObject({
      status: 'ready',
      files: 1,
      excluded: 7,
    })
    expect(f.latest(turn.sessionId).baseline.exclusions.map((item) => item.reason)).toEqual(
      expect.arrayContaining(['.gitignore', '私密配置', '嵌套仓库', '链接或非普通独占文件']),
    )
    expect(await f.changes.readVersion(turn.turnId, 'baseline', '.env')).toBeNull()
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-01 redacts persisted display metadata while raw recoverable bytes stay exclusively in the host ledger', async () => {
  const f = await setup()
  try {
    const secret = 'SNAPSHOT_PRIVATE_VALUE_7e184f'
    f.app.get(SecurityService).redactor.remember(secret)
    writeFileSync(join(f.cwd, `.env.${secret}`), 'excluded credential fixture')
    writeFileSync(join(f.cwd, 'source.txt'), `raw source ${secret}`)
    const turn = f.start()
    await turn.promise
    const row = f.app
      .get(WorkspaceDatabase)
      .sqlite.prepare('SELECT data FROM change_rounds WHERE turn_id=?')
      .get(turn.turnId)
    expect(JSON.stringify(row)).not.toContain(secret)
    expect(JSON.stringify(f.changes.history(turn.sessionId))).not.toContain(secret)
    expect(f.latest(turn.sessionId).baseline.exclusions[0]?.path).toContain('«redacted»')
    expect((await f.changes.readVersion(turn.turnId, 'baseline', 'source.txt'))?.toString()).toBe(
      `raw source ${secret}`,
    )
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-01 real SDK write plus external edit stays uncertain and final capture holds competing aliases until committed', async () => {
  const f = await setup()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const capture = f.changes.ledger.capture.bind(f.changes.ledger)
  let finalWaiting = false
  const controlled = vi
    .spyOn(f.changes.ledger, 'capture')
    .mockImplementation(async (identity, turn, phase) => {
      if (phase === 'final' && !finalWaiting) {
        finalWaiting = true
        await gate
      }
      return capture(identity, turn, phase)
    })
  try {
    const alias = join(f.root, 'alias'),
      independent = join(f.root, 'other')
    symlinkSync(f.cwd, alias, process.platform === 'win32' ? 'junction' : 'dir')
    mkdirSync(independent)
    const first = f.start('approval-write')
    await vi.waitFor(() => expect(f.approvals.list()).toHaveLength(1), wait)
    const queued = f.start('hold', alias),
      parallel = f.start('hold', independent)
    await f.stream(parallel.sessionId)
    expect(f.changes.history(queued.sessionId).rounds).toEqual([])
    approve(f)
    await vi.waitFor(() => expect(finalWaiting).toBe(true), wait)
    writeFileSync(join(f.cwd, 'APPROVED.txt'), 'SEC02_APPROVED_ONCE\nEXTERNAL_MIXED')
    expect(f.writes.blocker(f.writes.identify(f.cwd))?.turnId).toBe(first.turnId)
    release()
    await first.promise
    await f.stream(queued.sessionId)
    expect((await f.changes.readVersion(first.turnId, 'final', 'APPROVED.txt'))?.toString()).toBe(
      'SEC02_APPROVED_ONCE\nEXTERNAL_MIXED',
    )
    expect(f.latest(first.sessionId)).toMatchObject({
      provenance: 'uncertain',
      automaticRollback: false,
    })
    expect(f.latest(queued.sessionId).baseline.status).toBe('ready')
  } finally {
    release()
    controlled.mockRestore()
    await f.close()
  }
}, 60000)

test('cHANGE-01 queued cancellation creates no baseline, kernel death records interruption before successor dispatch', async () => {
  const f = await setup()
  try {
    const first = f.start('hold')
    await f.stream(first.sessionId)
    const cancelled = f.start('hold'),
      next = f.start('hold')
    await f.kernels.abort(cancelled.sessionId, cancelled.turnId)
    await expect(cancelled.promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(f.changes.history(cancelled.sessionId).rounds).toEqual([])
    const pid = required(f.kernels.list().find((k) => k.sessionId === first.sessionId)?.pid)
    process.kill(pid, 'SIGKILL')
    await expect(first.promise).rejects.toThrow(/Kernel/)
    await f.stream(next.sessionId)
    expect(f.latest(first.sessionId)).toMatchObject({
      outcome: 'interrupted',
      baseline: { status: 'ready' },
      final: { status: 'ready' },
    })
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-01 failed final SQLite commit retains quarantine after child exit, restart only marks interruption with existing baseline', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'keep.txt'), 'known baseline')
    const first = f.start('hold')
    await f.stream(first.sessionId)
    const db = f.app.get(WorkspaceDatabase)
    db.sqlite.exec(
      "CREATE TRIGGER deny_change_finish BEFORE UPDATE ON change_rounds WHEN NEW.outcome != 'active' BEGIN SELECT RAISE(ABORT, 'fixture final metadata failure'); END",
    )
    const next = f.start('hold')
    await f.kernels.abort(first.sessionId, first.turnId)
    await expect(first.promise).rejects.toThrow(/fixture final metadata failure/)
    await f.kernels.destroy(first.sessionId)
    expect(f.writes.blocker(f.writes.identify(f.cwd))?.state).toBe('quarantined')
    expect(f.changes.history(next.sessionId).rounds).toEqual([])
    await f.kernels.abort(next.sessionId, next.turnId)
    db.sqlite.exec('DROP TRIGGER deny_change_finish')
    const baseline = f.latest(first.sessionId).baseline.reference
    await f.app.close()
    writeFileSync(join(f.cwd, 'keep.txt'), 'changed while daemon was down')
    const reopened = await createApp({ dataDir: f.dataDir, port: 24472, development: true })
    try {
      const record = required(reopened.get(ChangeService).history(first.sessionId).rounds[0])
      expect(record).toMatchObject({
        outcome: 'interrupted',
        baseline: { status: 'ready', reference: baseline },
        final: { status: 'unavailable', reference: null },
      })
      expect(
        (
          await reopened.get(ChangeService).readVersion(first.turnId, 'baseline', 'keep.txt')
        )?.toString(),
      ).toBe('known baseline')
      expect(reopened.get(KernelService).list()).toEqual([])
    } finally {
      await reopened.close()
    }
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-01 paired desktop metadata endpoint paginates actual SQLite rows, rejects browser/unpaired and reveals no file bytes', async () => {
  const f = await setup()
  try {
    const opened = await f.app.get(WorkspaceService).open(f.cwd)
    if (!opened.ok) {
      throw new Error('Workspace fixture rejected')
    }
    const result = await f.app.get(SessionService).submit({
      requestId: randomUUID(),
      sessionId: null,
      text: 'CHANGE01 metadata',
      retryOf: null,
      configuration: {
        projectId: null,
        workspaceId: opened.workspace.id,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
    })
    // SessionService API owns valid sessions; direct kernels in the other tests are host-only.
    const desktop = await authorizedHeaders(f.app, 24472, 'desktop'),
      browser = await authorizedHeaders(f.app, 24472)
    const url = `/api/changes/rounds?sessionId=${result.session.id}`
    await vi.waitFor(
      () => expect(f.changes.history(result.session.id).rounds[0]?.outcome).toBe('completed'),
      wait,
    )
    expect((await f.app.inject({ method: 'GET', url, headers: browser })).statusCode).toBe(403)
    expect(
      (await f.app.inject({ method: 'GET', url, headers: { host: desktop.host } })).statusCode,
    ).toBe(401)
    const response = await f.app.inject({ method: 'GET', url, headers: desktop })
    expect(response.statusCode).toBe(200)
    expect(changeHistorySchema.parse(response.json()).rounds[0]?.baseline.status).toBe('ready')
    // Explicit synthetic historical metadata in real SQLite tests the cursor only; these
    // rows do not claim SDK execution or recoverable file-version evidence.
    const db = f.app.get(WorkspaceDatabase).sqlite
    const original = f.latest(result.session.id)
    for (let i = 0; i < 21; i++) {
      const turnId = randomUUID(),
        record = {
          ...original,
          turnId,
          outcome: 'interrupted',
          baseline: { ...original.baseline, status: 'unavailable', reference: null },
          final: { ...original.final, status: 'unavailable', reference: null },
        }
      db.prepare(
        'INSERT INTO change_rounds(turn_id,session_id,directory_key,cwd,outcome,data) VALUES(?,?,?,?,?,?)',
      ).run(
        turnId,
        result.session.id,
        'explicit pagination fixture',
        f.cwd,
        'interrupted',
        JSON.stringify(record),
      )
    }
    const firstPage = changeHistorySchema.parse(
      (await f.app.inject({ method: 'GET', url, headers: desktop })).json(),
    )
    expect(firstPage.rounds).toHaveLength(20)
    expect(firstPage.next).not.toBeNull()
    const secondPage = changeHistorySchema.parse(
      (
        await f.app.inject({
          method: 'GET',
          url: `${url}&before=${firstPage.next}`,
          headers: desktop,
        })
      ).json(),
    )
    expect(secondPage.rounds).toHaveLength(2)
    expect(secondPage.next).toBeNull()
    expect(
      new Set([...firstPage.rounds, ...secondPage.rounds].map((record) => record.turnId)).size,
    ).toBe(22)
    expect(
      (await f.app.inject({ method: 'GET', url: url + '&cwd=arbitrary', headers: desktop }))
        .statusCode,
    ).toBe(400)
    expect(
      (await f.app.inject({ method: 'POST', url: '/api/changes/restore', headers: desktop }))
        .statusCode,
    ).not.toBe(200)
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-01 actual traversal entry/depth/total-byte limits pause the baseline without copying a partial success', async () => {
  const f = await setup()
  try {
    const cases = [
      join(f.root, 'entry-limit'),
      join(f.root, 'depth-limit'),
      join(f.root, 'byte-limit'),
    ]
    for (const path of cases) {
      mkdirSync(path)
    }
    for (let i = 0; i < 2049; i++) {
      writeFileSync(join(required(cases[0]), `file-${i}`), '')
    }
    let depth = required(cases[1])
    for (let i = 0; i < 9; i++) {
      depth = join(depth, 'nested')
      mkdirSync(depth)
    }
    for (let i = 0; i < 7; i++) {
      writeFileSync(join(required(cases[2]), `large-${i}`), Buffer.alloc(5 * 1024 * 1024))
    }
    const turns = cases.map((path) => f.start('reply', path))
    await Promise.all(turns.map((turn) => turn.promise))
    for (const turn of turns) {
      expect(f.latest(turn.sessionId).baseline).toMatchObject({ status: 'failed', reference: null })
    }
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-01 normal daemon exit saves an active SDK round and restart retains references with zero kernels or replay', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'persist.txt'), 'before shutdown')
    const turn = f.start('hold')
    await f.stream(turn.sessionId)
    const baseline = f.latest(turn.sessionId).baseline.reference
    await f.app.close()
    await turn.promise.catch(() => undefined)
    const reopened = await createApp({ dataDir: f.dataDir, port: 24472, development: true })
    try {
      const record = required(reopened.get(ChangeService).history(turn.sessionId).rounds[0])
      expect(record.outcome).not.toBe('active')
      expect(record.baseline.reference).toBe(baseline)
      expect(record.final.status).toBe('ready')
      expect(reopened.get(KernelService).list()).toEqual([])
      expect(reopened.get(ApprovalService).list()).toEqual([])
      expect(
        (
          await reopened.get(ChangeService).readVersion(turn.turnId, 'baseline', 'persist.txt')
        )?.toString(),
      ).toBe('before shutdown')
    } finally {
      await reopened.close()
    }
  } finally {
    await f.close()
  }
}, 60000)
