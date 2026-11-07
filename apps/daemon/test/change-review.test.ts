/* oxlint-disable no-await-in-loop -- Real SDK approvals and file/ledger operations must follow invocation order. */
import type { ExecutionRequest } from '@pi-workbench/shared'

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { expect, test, vi } from 'vitest'

import { executionDigest, executionParameters } from '@pi-workbench/agent-adapter'
import { changeReviewSchema, changeSourcesSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { ChangeProvenanceService } from '../dist/modules/changes/change-provenance.service.js'
import { ChangeReviewService } from '../dist/modules/changes/change-review.service.js'
import { ChangeService } from '../dist/modules/changes/change.service.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { ApprovalService } from '../dist/modules/security/approval.service.js'
import { SecurityService } from '../dist/modules/security/security.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { authorizedHeaders } from './helpers/access.js'

const wait = { timeout: 20000, interval: 40 }
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
function required<T>(v: T | undefined): T {
  if (v === undefined) {
    throw new Error('Change fixture value missing')
  }
  return v
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'piw-review-')),
    cwd = join(root, '中文目录'),
    dataDir = join(root, 'data')
  mkdirSync(cwd)
  let app = await createApp({
    dataDir,
    port: 24475,
    development: true,
    resourceLimits: { kernels: 4, modelTasks: 3 },
  })
  const get = () => ({
    kernels: app.get(KernelService),
    changes: app.get(ChangeService),
    sources: app.get(ChangeProvenanceService),
    review: app.get(ChangeReviewService),
    approvals: app.get(ApprovalService),
  })
  const start = (
    fixture: 'hold' | 'reply' | 'change-chain' | 'approval-command' | 'approval-running' = 'hold',
  ) => {
    const sessionId = randomUUID(),
      turnId = randomUUID(),
      promise = get().kernels.prompt(sessionId, cwd, {
        turnId,
        text: 'CHANGE real SDK local fixture',
        fixture,
      })
    void promise.catch(() => undefined)
    return { sessionId, turnId, promise }
  }
  return {
    root,
    cwd,
    dataDir,
    get,
    start,
    get app() {
      return app
    },
    ready: async (id: string) =>
      vi.waitFor(
        () => expect(get().changes.history(id).rounds[0]?.baseline.status).toBe('ready'),
        wait,
      ),
    approve: async (turnId: string, action: 'allow-once' | 'cancel' = 'allow-once') => {
      await vi.waitFor(
        () =>
          expect(
            get()
              .approvals.list()
              .some((pending) => pending.turnId === turnId),
          ).toBe(true),
        wait,
      )
      const p = required(
        get()
          .approvals.list()
          .find((pending) => pending.turnId === turnId),
      )
      get().approvals.decide(
        p.id,
        {
          sessionId: p.sessionId,
          epoch: p.epoch,
          turnId: p.turnId,
          digest: p.risk.digest,
          policyVersion: p.risk.policyVersion,
          action,
          reason: 'explicit local fixture consent',
          acceptIrreversible: true,
        },
        'desktop-fixture',
      )
    },
    restart: async () => {
      await app.close()
      app = await createApp({ dataDir, port: 24475, development: true })
    },
    close: async () => {
      await app.close()
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    },
  }
}
function git(cwd: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=f@piw.invalid',
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
      const p = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(p)
      } else {
        files[relative(root, p)] = hash(readFileSync(p))
      }
    }
  }
  walk(root)
  return files
}

test('cHANGE-02 actual SDK write/edit chain links final parameters, epoch, invocation and stable bytes; dirty/index history stays untouched across reopen', async () => {
  const f = await setup()
  try {
    git(f.cwd, 'init')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'committed\n')
    git(f.cwd, 'add', '.')
    git(f.cwd, 'commit', '-m', 'user history')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'staged\n')
    git(f.cwd, 'add', '.')
    writeFileSync(join(f.cwd, 'tracked.txt'), 'dirty\n')
    writeFileSync(join(f.cwd, 'untracked.txt'), 'user untracked')
    const before = metadata(join(f.cwd, '.git')),
      t = f.start('change-chain')
    await f.approve(t.turnId)
    await f.approve(t.turnId)
    expect(await t.promise).toMatchObject({
      outcome: 'completed',
      localRequests: 3,
      blockedNetworkAttempts: 0,
    })
    const observations = f.get().sources.observations(t.turnId)
    expect(observations.map((o) => [o.tool, o.status, o.callId])).toEqual([
      ['write', 'completed', 'change-1'],
      ['edit', 'completed', 'change-2'],
    ])
    expect(observations[0]?.before.sha256).toBe(hash('dirty\n'))
    expect(observations[0]?.after.sha256).toBe(observations[1]?.before.sha256)
    expect(
      observations.every(
        (o) =>
          o.sessionId === t.sessionId &&
          o.turnId === t.turnId &&
          o.expected === o.after.sha256 &&
          o.epoch === observations[0]?.epoch,
      ),
    ).toBe(true)
    const source = required((await f.get().sources.sources(t.turnId)).files[0])
    expect(source).toMatchObject({
      path: 'tracked.txt',
      source: 'tool-observed',
      automaticRollback: false,
    })
    expect(source.tools.every((tool) => tool.confirmed)).toBe(true)
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('second\n')
    expect(metadata(join(f.cwd, '.git'))).toEqual(before)
    const saved = await f.get().review.list(t.turnId)
    await f.restart()
    expect(f.get().sources.observations(t.turnId)).toEqual(observations)
    expect(await f.get().review.list(t.turnId)).toEqual(saved)
    expect(f.get().kernels.list()).toEqual([])
    expect(f.get().approvals.list()).toEqual([])
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-02 actual external edits before the first permit and after last tool observation stay mixed with confirmed tool sections', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'tracked.txt'), 'baseline\n')
    const complete = f.get().sources.complete.bind(f.get().sources)
    vi.spyOn(f.get().sources, 'complete').mockImplementation(async (...args) => {
      await complete(...args)
      if (f.get().sources.observations(args[0]).length === 2) {
        writeFileSync(join(f.cwd, 'tracked.txt'), 'external after tool\n')
      }
    })
    const t = f.start('change-chain')
    await f.ready(t.sessionId)
    writeFileSync(join(f.cwd, 'tracked.txt'), 'external before permit\n')
    await f.approve(t.turnId)
    await f.approve(t.turnId)
    await t.promise
    const source = required((await f.get().sources.sources(t.turnId)).files[0])
    expect(source).toMatchObject({ source: 'mixed', automaticRollback: false })
    expect(source.tools.filter((tool) => tool.confirmed)).toHaveLength(2)
    expect((await f.get().changes.readVersion(t.turnId, 'final', 'tracked.txt'))?.toString()).toBe(
      'external after tool\n',
    )
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-02 actual overwritten post-image cannot confirm the SDK write or failed edit', async () => {
  const f = await setup()
  try {
    const complete = f.get().sources.complete.bind(f.get().sources)
    vi.spyOn(f.get().sources, 'complete').mockImplementation(async (...args) => {
      if (f.get().sources.observations(args[0]).length === 1) {
        writeFileSync(join(f.cwd, 'tracked.txt'), 'host changed before post-image\n')
      }
      await complete(...args)
    })
    const t = f.start('change-chain')
    await f.approve(t.turnId)
    await f.approve(t.turnId)
    await t.promise
    const source = required((await f.get().sources.sources(t.turnId)).files[0])
    expect(source.source).toBe('unknown')
    expect(source.tools.every((tool) => !tool.confirmed)).toBe(true)
    expect(f.get().sources.observations(t.turnId)[1]?.status).toBe('failed')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-02 real command mutations remain unknown; cancelled tools create no positive provenance', async () => {
  const f = await setup()
  try {
    const t = f.start('approval-command')
    await f.approve(t.turnId)
    await t.promise
    expect(readFileSync(join(f.cwd, 'APPROVAL-COMMAND.txt'), 'utf8')).toContain(
      'SEC02_COMMAND_ONCE',
    )
    expect(f.get().sources.observations(t.turnId)[0]).toMatchObject({
      tool: 'powershell',
      fileId: null,
      expected: null,
      status: 'completed',
    })
    expect(
      (await f.get().sources.sources(t.turnId)).files.every((v) => v.source === 'unknown'),
    ).toBe(true)
    const next = f.start('change-chain')
    await f.approve(next.turnId, 'cancel')
    await next.promise
    expect(f.get().sources.observations(next.turnId)).toEqual([])
    expect(existsSync(join(f.cwd, 'tracked.txt'))).toBe(false)
  } finally {
    await f.close()
  }
}, 60000)

test.each(['kill', 'abort', 'close'] as const)(
  'cHANGE-02 %s during real running command retains unknown/interrupted observations with no replay',
  async (mode) => {
    const f = await setup()
    try {
      const t = f.start('approval-running')
      await f.approve(t.turnId)
      await vi.waitFor(
        () => expect(f.get().sources.observations(t.turnId)[0]?.status).toBe('running'),
        wait,
      )
      if (mode === 'kill') {
        const pid = required(
          f
            .get()
            .kernels.list()
            .find((k) => k.sessionId === t.sessionId)?.pid,
        )
        process.kill(pid, 'SIGKILL')
      } else if (mode === 'abort') {
        await f.get().kernels.abort(t.sessionId, t.turnId)
      } else {
        await f.app.close()
      }
      const result = await t.promise.then(
        (value) => value.outcome,
        () => 'interrupted',
      )
      expect(mode === 'kill' ? ['interrupted'] : ['aborted', 'interrupted']).toContain(result)
      await f.restart()
      const rows = f.get().sources.observations(t.turnId)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).not.toBe('running')
      expect(rows[0]?.expected).toBeNull()
      expect(f.get().kernels.list()).toEqual([])
      expect(f.get().approvals.list()).toEqual([])
      expect(
        (await f.get().sources.sources(t.turnId)).files.every((s) => s.source !== 'tool-observed'),
      ).toBe(true)
    } finally {
      await f.close()
    }
  },
  60000,
)

test('cHANGE-02 public synthetic tool.updated cannot create a source record or confirm actual external bytes', async () => {
  const f = await setup()
  try {
    const t = f.start()
    await f.ready(t.sessionId)
    await vi.waitFor(
      () => expect(f.app.get(EventService).snapshot(t.sessionId)?.turns.length).toBe(1),
      wait,
    )
    const epoch = required(f.app.get(EventService).snapshot(t.sessionId)?.epoch)
    f.app.get(EventService).publish(t.sessionId, epoch, t.turnId, {
      type: 'tool.updated',
      tool: {
        id: 'synthetic-write',
        name: 'write',
        status: 'completed',
        summary: 'pretend agent write',
      },
    })
    writeFileSync(join(f.cwd, 'external.txt'), 'actual external bytes')
    await f.get().kernels.abort(t.sessionId, t.turnId)
    await t.promise
    expect(f.get().sources.observations(t.turnId)).toEqual([])
    expect((await f.get().sources.sources(t.turnId)).files[0]?.source).toBe('unknown')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-02 128-call limit and interrupted SQLite records deny more permits and never resume authorization', async () => {
  const f = await setup()
  try {
    const turn = f.start()
    await f.ready(turn.sessionId)
    const epoch = required(
        f
          .get()
          .kernels.list()
          .find((k) => k.sessionId === turn.sessionId)?.epoch,
      ),
      binding = { sessionId: turn.sessionId, epoch, turnId: turn.turnId, cwd: f.cwd }
    const unsigned = {
        id: randomUUID(),
        callId: 'explicit-host-fixture',
        parentId: null,
        tool: 'write',
        parameters: executionParameters({ path: 'tracked.txt', content: 'no execution' }),
      },
      request = { ...unsigned, digest: executionDigest(binding, unsigned) }
    await f.get().sources.begin(turn.turnId, epoch, request, () => true)
    const sample = required(f.get().sources.observations(turn.turnId)[0]),
      db = f.app.get(WorkspaceDatabase).sqlite
    for (let i = 1; i < 128; i++) {
      const id = randomUUID()
      db.prepare('INSERT INTO change_tool_observations(request_id,turn_id,data) VALUES(?,?,?)').run(
        id,
        turn.turnId,
        JSON.stringify({ ...sample, id, callId: `synthetic-${i}` }),
      )
    }
    await expect(
      f.get().sources.begin(turn.turnId, epoch, { ...request, id: randomUUID() }, () => true),
    ).rejects.toThrow(/128/)
    await f.get().kernels.abort(turn.sessionId, turn.turnId)
    await turn.promise
    await f.restart()
    expect(f.get().sources.observations(turn.turnId)).toHaveLength(128)
    expect(
      f
        .get()
        .sources.observations(turn.turnId)
        .every((item) => item.status === 'interrupted'),
    ).toBe(true)
    expect(f.get().kernels.list()).toEqual([])
    expect(f.get().approvals.list()).toEqual([])
    expect(existsSync(join(f.cwd, 'tracked.txt'))).toBe(false)
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-02 host observation overlap, incomplete permit, excluded file and reopen stay conservative without executing synthetic calls', async () => {
  const f = await setup()
  try {
    const t = f.start()
    await f.ready(t.sessionId)
    const epoch = required(
        f
          .get()
          .kernels.list()
          .find((k) => k.sessionId === t.sessionId)?.epoch,
      ),
      binding = { sessionId: t.sessionId, epoch, turnId: t.turnId, cwd: f.cwd }
    const make = (callId: string, path: string): ExecutionRequest => {
      const u = {
        id: randomUUID(),
        callId,
        parentId: null,
        tool: 'write',
        parameters: executionParameters({ path, content: 'confirmed synthetic bytes' }),
      }
      return { ...u, digest: executionDigest(binding, u) }
    }
    const a = make('synthetic-a', 'excluded.txt'),
      b = make('synthetic-b', 'excluded.txt')
    writeFileSync(join(f.cwd, '.gitignore'), 'excluded.txt\n')
    await f.get().sources.begin(t.turnId, epoch, a, () => true)
    await f.get().sources.begin(t.turnId, epoch, b, () => true)
    // Explicit host-only observation fixture, not SDK tool execution evidence.
    writeFileSync(join(f.cwd, 'excluded.txt'), 'confirmed synthetic bytes')
    await f.get().sources.complete(t.turnId, a.id, a.digest, true)
    await f.get().kernels.abort(t.sessionId, t.turnId)
    await t.promise
    const source = required(
      (await f.get().sources.sources(t.turnId)).files.find((v) => v.path === 'excluded.txt'),
    )
    expect(source).toMatchObject({ source: 'unknown', inSnapshot: false, automaticRollback: false })
    expect(
      f
        .get()
        .sources.observations(t.turnId)
        .map((v) => v.status),
    ).toEqual(['completed', 'interrupted'])
    await f.restart()
    expect(f.get().sources.observations(t.turnId)[1]?.status).toBe('interrupted')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-03 real non-Git immutable versions list add/modify/delete/unique rename/binary/empty; later current files never replace history', async () => {
  const f = await setup()
  try {
    for (const [path, text] of Object.entries({
      'modified.txt': 'old\n',
      'deleted.txt': 'gone\n',
      'old-name.txt': 'unique rename\n',
      'binary.bin': 'text\n',
    })) {
      writeFileSync(join(f.cwd, path), text)
    }
    const t = f.start()
    await f.ready(t.sessionId)
    writeFileSync(join(f.cwd, 'modified.txt'), 'new\n')
    unlinkSync(join(f.cwd, 'deleted.txt'))
    renameSync(join(f.cwd, 'old-name.txt'), join(f.cwd, '新名称.txt'))
    writeFileSync(join(f.cwd, 'added.txt'), 'added\n')
    writeFileSync(join(f.cwd, 'empty.txt'), '')
    writeFileSync(join(f.cwd, 'binary.bin'), Buffer.from([0, 255, 13]))
    await f.get().kernels.abort(t.sessionId, t.turnId)
    await t.promise
    const list = await f.get().review.list(t.turnId)
    expect(list.available).toBe(true)
    expect(list.total).toBe(6)
    expect(Object.fromEntries(list.files.map((v) => [v.path, v.kind]))).toEqual({
      'modified.txt': 'modified',
      'deleted.txt': 'deleted',
      '新名称.txt': 'renamed',
      'added.txt': 'added',
      'empty.txt': 'added',
      'binary.bin': 'modified',
    })
    const selected = required(list.files.find((v) => v.path === 'modified.txt')),
      original = await f.get().review.diff(t.turnId, selected.id)
    expect(selected).toMatchObject({ additions: 1, deletions: 1, source: 'unknown' })
    expect(
      original.hunks
        .flatMap((h) => h.lines)
        .filter((l) => l.kind === 'add')
        .map(({ id: _id, ...line }) => line),
    ).toEqual([{ kind: 'add', text: 'new', oldLine: null, newLine: 1 }])
    const binary = required(list.files.find((v) => v.binary))
    expect(binary.additions).toBeNull()
    expect((await f.get().review.diff(t.turnId, binary.id)).hunks).toEqual([])
    expect(
      (
        await f
          .get()
          .review.diff(t.turnId, required(list.files.find((v) => v.kind === 'renamed')).id)
      ).diagnostic,
    ).toContain('字节完全相同')
    await f.get().kernels.destroy(t.sessionId)
    rmSync(f.cwd, { recursive: true, force: true })
    expect(await f.get().review.diff(t.turnId, selected.id)).toEqual(original)
    await f.restart()
    expect(await f.get().review.diff(t.turnId, selected.id)).toEqual(original)
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-01/03 verifies files tree against manifest before using immutable Git Diff', async () => {
  const f = await setup()
  try {
    writeFileSync(join(f.cwd, 'tracked.txt'), 'original\n')
    const t = f.start('reply')
    await t.promise
    const { record, identity } = f.get().changes.context(t.turnId),
      repo = join(f.dataDir, 'ledger', hash(identity.directoryKey), 'objects.git')
    const manifest = execFileSync(
      'git',
      ['--git-dir', repo, 'cat-file', 'blob', `${record.baseline.reference}:manifest.json`],
      { windowsHide: true },
    )
    const altered = Buffer.from('tree disagrees\n'),
      prefix = `commit refs/piw/${t.turnId}/baseline\ncommitter Fixture <f@piw.invalid> 1700000000 +0000\ndata 0\n\ndeleteall\nM 100644 inline files/tracked.txt\ndata ${altered.length}\n`
    const input = Buffer.concat([
      Buffer.from(prefix),
      altered,
      Buffer.from(`\nM 100644 inline manifest.json\ndata ${manifest.length}\n`),
      manifest,
      Buffer.from('\n\ndone\n'),
    ])
    execFileSync('git', ['--git-dir', repo, 'fast-import', '--force', '--quiet', '--done'], {
      input,
      windowsHide: true,
    })
    const reference = execFileSync(
      'git',
      ['--git-dir', repo, 'rev-parse', `refs/piw/${t.turnId}/baseline`],
      { windowsHide: true },
    )
      .toString()
      .trim()
    await expect(
      f.get().changes.ledger.verify(identity, t.turnId, 'baseline', reference),
    ).rejects.toThrow(/树与清单/)
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-02 post-image acknowledgement fault reaps the actual SDK before releasing the queued directory', async () => {
  const f = await setup()
  try {
    vi.spyOn(f.get().sources, 'complete').mockRejectedValueOnce(
      new Error('Explicit IPC settlement failure fixture'),
    )
    const t = f.start('change-chain')
    await f.approve(t.turnId)
    const next = f.start('reply')
    await expect(t.promise).rejects.toThrow(/settlement|unknown|unavailable/i)
    expect(readFileSync(join(f.cwd, 'tracked.txt'), 'utf8')).toBe('first\n')
    expect(await next.promise).toMatchObject({ outcome: 'completed' })
    expect(f.get().sources.observations(t.turnId)[0]).toMatchObject({
      status: 'interrupted',
      after: { status: 'unavailable' },
      expected: null,
    })
    expect(
      f
        .get()
        .kernels.list()
        .find((k) => k.sessionId === t.sessionId),
    ).toBeUndefined()
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-03 empty rounds, ambiguous duplicate renames, 100-item pages, non-UTF8 and large preview have honest results', async () => {
  const f = await setup()
  try {
    const empty = f.start('reply')
    await empty.promise
    expect(await f.get().review.list(empty.turnId)).toMatchObject({
      available: true,
      total: 0,
      files: [],
    })
    writeFileSync(join(f.cwd, 'a.txt'), 'duplicate')
    writeFileSync(join(f.cwd, 'b.txt'), 'duplicate')
    const t = f.start()
    await f.ready(t.sessionId)
    unlinkSync(join(f.cwd, 'a.txt'))
    unlinkSync(join(f.cwd, 'b.txt'))
    writeFileSync(join(f.cwd, 'c.txt'), 'duplicate')
    writeFileSync(join(f.cwd, 'd.txt'), 'duplicate')
    for (let i = 0; i < 101; i++) {
      writeFileSync(join(f.cwd, `file-${i}.txt`), 'new\n')
    }
    writeFileSync(join(f.cwd, 'large.txt'), 'safe line\n'.repeat(5000))
    writeFileSync(join(f.cwd, 'invalid.txt'), Buffer.from([255, 254]))
    await f.get().kernels.abort(t.sessionId, t.turnId)
    await t.promise
    const first = await f.get().review.list(t.turnId),
      second = await f.get().review.list(t.turnId, 100),
      all = [...first.files, ...second.files]
    expect(first.files).toHaveLength(100)
    expect(first.next).toBe(100)
    expect(second.next).toBeNull()
    expect(all).toHaveLength(107)
    expect(all.some((v) => v.kind === 'renamed')).toBe(false)
    expect(
      (await f.get().review.diff(t.turnId, required(all.find((v) => v.path === 'large.txt')).id))
        .diagnostic,
    ).toContain('预览上限')
    expect(required(all.find((v) => v.path === 'invalid.txt'))).toMatchObject({
      binary: true,
      additions: null,
      deletions: null,
    })
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-03 complete-text redaction protects multiline secrets without fake line identities; paths and patch content stay inert text', async () => {
  const f = await setup()
  try {
    const t = f.start()
    await f.ready(t.sessionId)
    f.app.get(SecurityService).redactor.remember('multi\nline-secret')
    writeFileSync(join(f.cwd, 'danger.txt'), '<img src=x onerror=alert(1)>\napi_key=hide-this\n')
    writeFileSync(join(f.cwd, 'multiline.txt'), 'prefix\nmulti\nline-secret\nsuffix\n')
    writeFileSync(
      join(f.cwd, 'pem.txt'),
      '-----BEGIN PRIVATE KEY-----\nNEVER-REVEAL\n-----END PRIVATE KEY-----\n',
    )
    await f.get().kernels.abort(t.sessionId, t.turnId)
    await t.promise
    const list = await f.get().review.list(t.turnId)
    for (const file of list.files) {
      const diff = await f.get().review.diff(t.turnId, file.id),
        json = JSON.stringify(diff)
      expect(json).not.toMatch(/hide-this|NEVER-REVEAL|line-secret/)
    }
    for (const file of list.files.filter((candidate) => candidate.path !== 'danger.txt')) {
      const result = await f.get().review.diff(t.turnId, file.id)
      expect(result.hunks).toEqual([])
      expect(result.diagnostic).toContain('脱敏改变')
    }
    const diff = await f
      .get()
      .review.diff(t.turnId, required(list.files.find((v) => v.path === 'danger.txt')).id)
    expect(JSON.stringify(diff)).toContain('<img src=x onerror=alert(1)>')
    expect(JSON.stringify(diff)).toContain('«redacted»')
  } finally {
    await f.close()
  }
}, 60000)

test('cHANGE-02/03 desktop transport rejects cross-session/path identities and corrupt objects without current-file fallback', async () => {
  const f = await setup()
  try {
    const opened = await f.app.get(WorkspaceService).open(f.cwd)
    if (!opened.ok) {
      throw new Error('Workspace rejected')
    }
    const receipt = await f.app.get(SessionService).submit({
      requestId: randomUUID(),
      sessionId: null,
      text: 'real managed session',
      retryOf: null,
      configuration: {
        projectId: null,
        workspaceId: opened.workspace.id,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
    })
    await vi.waitFor(
      () =>
        expect(f.get().changes.history(receipt.session.id).rounds[0]?.outcome).toBe('completed'),
      wait,
    )
    const turn = required(f.get().changes.history(receipt.session.id).rounds[0]),
      desktop = await authorizedHeaders(f.app, 24475, 'desktop'),
      browser = await authorizedHeaders(f.app, 24475)
    const base = `sessionId=${receipt.session.id}&turnId=${turn.turnId}`
    for (const mode of ['sources', 'review']) {
      const url = `/api/changes/${mode}?${base}`
      expect((await f.app.inject({ method: 'GET', url, headers: browser })).statusCode).toBe(403)
      expect((await f.app.inject({ method: 'GET', url, headers: desktop })).statusCode).toBe(200)
      expect(
        (await f.app.inject({ method: 'GET', url: `${url}&path=../../secret`, headers: desktop }))
          .statusCode,
      ).toBe(400)
      expect(
        (
          await f.app.inject({
            method: 'GET',
            url: `/api/changes/${mode}?sessionId=${randomUUID()}&turnId=${turn.turnId}`,
            headers: desktop,
          })
        ).statusCode,
      ).toBe(404)
    }
    changeReviewSchema.parse(
      (
        await f.app.inject({ method: 'GET', url: `/api/changes/review?${base}`, headers: desktop })
      ).json(),
    )
    changeSourcesSchema.parse(
      (
        await f.app.inject({ method: 'GET', url: `/api/changes/sources?${base}`, headers: desktop })
      ).json(),
    )
    const { identity } = f.get().changes.context(turn.turnId),
      repo = join(f.dataDir, 'ledger', hash(identity.directoryKey), 'objects.git')
    execFileSync(
      'git',
      ['--git-dir', repo, 'update-ref', '-d', `refs/piw/${turn.turnId}/baseline`],
      { windowsHide: true },
    )
    writeFileSync(join(f.cwd, 'tempting-current.txt'), 'MUST_NOT_FALLBACK')
    expect(
      (await f.app.inject({ method: 'GET', url: `/api/changes/review?${base}`, headers: desktop }))
        .statusCode,
    ).toBe(503)
    expect(
      (
        await f.app.inject({
          method: 'GET',
          url: `/api/changes/diff?${base}&fileId=${hash('not-member')}`,
          headers: desktop,
        })
      ).statusCode,
    ).toBe(503)
  } finally {
    await f.close()
  }
}, 60000)
