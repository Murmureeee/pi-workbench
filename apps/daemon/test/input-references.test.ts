/* oxlint-disable no-await-in-loop -- Real filesystem cases must use one isolated fixture and close it sequentially. */
import type { SessionSubmit } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, vi } from 'vitest'
import { z } from 'zod'

import { inputReferenceSchema } from '@pi-workbench/shared'

import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { FileService } from '../dist/modules/files/file.service.js'
import { InputReferenceService } from '../dist/modules/files/input-reference.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { ProjectService } from '../dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { authorizedHeaders } from './helpers/access.js'
import { setupChangeFixture } from './helpers/change-fixture.js'

const noop = () => undefined

async function fixture(modelTasks = 3) {
  const f = await setupChangeFixture(undefined, modelTasks),
    opened = await f.app.get(WorkspaceService).open(f.cwd)
  if (!opened.ok) {
    throw Error('scope missing')
  }
  const command = (ids: string[], draftId: string): SessionSubmit => ({
    requestId: randomUUID(),
    sessionId: null,
    text: '分析引用',
    retryOf: null,
    references: { draftId, ids },
    configuration: {
      projectId: null,
      workspaceId: opened.workspace.id,
      model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
      thinking: 'off',
    },
  })
  return {
    ...f,
    get app() {
      return f.app
    },
    command,
    target: { workspaceId: opened.workspace.id },
    get refs() {
      return f.app.get(InputReferenceService)
    },
    get sessions() {
      return f.app.get(SessionService)
    },
    get database() {
      return f.app.get(WorkspaceDatabase)
    },
  }
}

test('iNPUT-03 exact BOM/CRLF/paste bytes stay private; first-send binds atomically and reaches the real SDK local fixture', async () => {
  const f = await fixture()
  try {
    const draftId = randomUUID(),
      raw = '\ufeff  中文\r\napi_key = "isolated-paste-secret"\r\n  '
    const item = inputReferenceSchema.parse(
      await f.refs.create({ kind: 'paste', draftId, text: raw }),
    )
    expect(item.preview).not.toContain('isolated-paste-secret')
    expect(item.bytes).toBe(Buffer.byteLength(raw))
    const saved = z
      .object({ content: z.instanceof(Buffer), session_id: z.string().nullable() })
      .parse(
        f.database.sqlite
          .prepare('select content,session_id from input_references where id=?')
          .get(item.id),
      )
    expect(saved.content).toEqual(Buffer.from(raw))
    expect(saved.session_id).toBeNull()
    expect(f.app.get(SessionStore).managedSessions()).toEqual([])
    const input = f.command([item.id], draftId),
      receipt = await f.sessions.submit(input)
    expect(receipt.submission.text).toContain(raw)
    await vi.waitFor(
      () =>
        expect(f.app.get(SessionStore).receipt(input.requestId)?.submission.status).toBe(
          'completed',
        ),
      { timeout: 20000 },
    )
    const native = f.app.get(SessionStore).history(receipt.session.id)
    expect(native?.messages.some((m) => m.role === 'user' && m.text.includes(raw))).toBe(true)
    expect(JSON.stringify(native)).toContain('isolated-paste-secret') // host store; HTTP is redacted below
    const headers = await authorizedHeaders(f.app, 24477)
    const response = await f.app.inject({
      method: 'GET',
      url: `/api/sessions/${receipt.session.id}/history`,
      headers,
    })
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('isolated-paste-secret')
  } finally {
    await f.close()
  }
})

test('iNPUT-03 actual file/range versions preserve line endings and external changes reject before creating a session', async () => {
  const f = await fixture()
  try {
    const draftId = randomUUID(),
      path = join(f.cwd, '中文.ts'),
      raw = '\ufeffone\r\ntwo\r\nthree'
    writeFileSync(path, raw)
    const range = await f.refs.create({
      kind: 'range',
      draftId,
      target: f.target,
      path,
      from: 2,
      to: 2,
    })
    expect(range.preview).toBe('two\r\n')
    writeFileSync(path, raw + ' external')
    await expect(f.sessions.submit(f.command([range.id], draftId))).rejects.toThrow('变化')
    expect(f.app.get(SessionStore).managedSessions()).toEqual([])
    expect(readFileSync(path, 'utf8')).toBe(raw + ' external')
    await expect(
      f.refs.create({ kind: 'range', draftId, target: f.target, path, from: 4, to: 5 }),
    ).rejects.toThrow('范围')
    writeFileSync(path, 'one\r\n')
    const empty = await f.refs.create({
      kind: 'range',
      draftId,
      target: f.target,
      path,
      from: 2,
      to: 2,
    })
    expect(empty.bytes).toBe(0)
  } finally {
    await f.close()
  }
})

test('iNPUT-03 directory is path-only, never recursively sends secrets; missing, outside, links and oversize decline', async () => {
  const f = await fixture()
  try {
    const draftId = randomUUID(),
      dir = join(f.cwd, 'folder'),
      outside = join(f.root, 'outside')
    mkdirSync(dir)
    mkdirSync(outside)
    writeFileSync(join(dir, 'child.txt'), 'do-not-auto-send')
    symlinkSync(outside, join(f.cwd, 'link'), 'junction')
    const item = await f.refs.create({ kind: 'directory', draftId, target: f.target, path: dir })
    expect(item.bytes).toBe(0)
    expect(item.preview).toBe('')
    const receipt = await f.sessions.submit(f.command([item.id], draftId))
    expect(receipt.submission.text).toContain('仅路径')
    expect(receipt.submission.text).not.toContain('do-not-auto-send')
    for (const path of ['missing.ts', '../outside', 'link', '.git/HEAD']) {
      await expect(
        f.refs.create({ kind: 'file', draftId, target: f.target, path }),
      ).rejects.toThrow(/变化|路径|范围|普通/)
    }
    await expect(
      f.refs.create({ kind: 'paste', draftId, text: '中'.repeat(100000) }),
    ).rejects.toThrow('256 KiB')
  } finally {
    await f.close()
  }
})

test('iNPUT-03 actual SQLite abort leaves draft unbound; conflicting draft and competing new-session requests cannot steal versions', async () => {
  const f = await fixture()
  try {
    const draftId = randomUUID(),
      item = await f.refs.create({ kind: 'paste', draftId, text: 'kept original' }),
      input = f.command([item.id], draftId)
    f.database.sqlite.exec(
      "CREATE TEMP TRIGGER fail_input BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'injected disk failure'); END",
    )
    await expect(f.sessions.submit(input)).rejects.toThrow('保存')
    expect(f.app.get(SessionStore).managedSessions()).toEqual([])
    expect(
      f.database.sqlite.prepare('select session_id from input_references where id=?').get(item.id),
    ).toEqual({ session_id: null })
    f.database.sqlite.exec('DROP TRIGGER fail_input')
    await expect(f.sessions.submit(f.command([item.id], randomUUID()))).rejects.toThrow('草稿')
    const results = await Promise.allSettled([
      f.sessions.submit(input),
      f.sessions.submit(f.command([item.id], draftId)),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(f.app.get(SessionStore).managedSessions()).toHaveLength(1)
  } finally {
    await f.close()
  }
})

test('iNPUT-03 same-data restart retains bound byte versions and idempotent receipt with zero new kernel or revalidation', async () => {
  const f = await fixture()
  try {
    const draftId = randomUUID(),
      path = join(f.cwd, 'code.ts')
    writeFileSync(path, 'old\r\n')
    const item = await f.refs.create({ kind: 'file', draftId, target: f.target, path }),
      input = f.command([item.id], draftId),
      receipt = await f.sessions.submit(input)
    await vi.waitFor(
      () =>
        expect(f.app.get(SessionStore).receipt(input.requestId)?.submission.status).toBe(
          'completed',
        ),
      { timeout: 20000 },
    )
    await f.restart()
    writeFileSync(path, 'external new')
    expect((await f.sessions.submit(input)).session.id).toBe(receipt.session.id)
    expect(f.app.get(KernelService).list()).toEqual([])
    expect(
      f.database.sqlite
        .prepare('select content,session_id from input_references where id=?')
        .get(item.id),
    ).toEqual({ content: Buffer.from('old\r\n'), session_id: receipt.session.id })
  } finally {
    await f.close()
  }
})

test('iNPUT-03 removal during actual file preparation rejects before atomic creation', async () => {
  const f = await fixture()
  let release: () => void = noop
  try {
    const projects = f.app.get(ProjectService),
      project = await projects.create({
        requestId: randomUUID(),
        name: 'delayed admission',
        workspaceId: f.target.workspaceId,
      })
    writeFileSync(join(f.cwd, 'race.ts'), 'checked bytes')
    const draftId = randomUUID(),
      item = await f.refs.create({ kind: 'file', draftId, target: f.target, path: 'race.ts' })
    const files = f.app.get(FileService),
      capture = files.capture.bind(files)
    let enter: () => void = noop
    const entered = new Promise<void>((done) => {
        enter = done
      }),
      gate = new Promise<void>((done) => {
        release = done
      })
    vi.spyOn(files, 'capture').mockImplementation(async (...args) => {
      const result = await capture(...args)
      enter()
      await gate
      return result
    })
    const input = f.command([item.id], draftId)
    input.configuration.projectId = project.id
    const pending = f.sessions.submit(input)
    await entered
    f.sessions.organizeProject(project.id, { action: 'remove', expectedRevision: project.revision })
    release()
    await expect(pending).rejects.toThrow('项目')
    expect(f.app.get(SessionStore).managedSessions()).toEqual([])
    expect(
      f.database.sqlite.prepare('select session_id from input_references where id=?').get(item.id),
    ).toEqual({ session_id: null })
  } finally {
    release()
    await f.close()
  }
})

test('iNPUT-03 real model-slot contention revalidates queued references before SDK dispatch and requires a fresh input after change', async () => {
  const f = await fixture(1)
  try {
    const other = join(f.root, 'model-owner')
    mkdirSync(other)
    const hold = f.start(randomUUID(), other)
    await f.ready(hold.sessionId)
    await vi.waitFor(
      () =>
        expect(
          f.app
            .get(KernelService)
            .list()
            .find((k) => k.sessionId === hold.sessionId)?.state,
        ).toBe('running'),
      { timeout: 20000 },
    )
    const draftId = randomUUID(),
      path = join(f.cwd, 'queued.ts')
    writeFileSync(path, 'before queue\r\n')
    const item = await f.refs.create({ kind: 'file', draftId, target: f.target, path })
    const input = f.command([item.id], draftId),
      receipt = await f.sessions.submit(input)
    writeFileSync(path, 'external while queued')
    await f.app.get(KernelService).abort(hold.sessionId, hold.turnId)
    await hold.promise
    await vi.waitFor(
      () =>
        expect(f.app.get(SessionStore).receipt(input.requestId)?.submission.status).toBe('failed'),
      { timeout: 20000 },
    )
    const failed = f.app.get(SessionStore).receipt(input.requestId)!.submission
    expect(failed.error).toContain('输入引用失效')
    expect(
      f.app
        .get(KernelService)
        .list()
        .some((k) => k.sessionId === receipt.session.id),
    ).toBe(false)
    await expect(
      f.sessions.submit({
        ...input,
        requestId: randomUUID(),
        sessionId: receipt.session.id,
        text: failed.text,
        retryOf: input.requestId,
        references: undefined,
      }),
    ).rejects.toThrow('重新添加引用')
  } finally {
    await f.close()
  }
}, 40000)

test('iNPUT-03 aggregate/quota and expired unbound cleanup preserve already bound versions', async () => {
  const f = await fixture()
  try {
    const draftId = randomUUID(),
      ids: string[] = []
    for (let i = 0; i < 3; i++) {
      ids.push((await f.refs.create({ kind: 'paste', draftId, text: 'x'.repeat(200000) })).id)
    }
    await expect(f.sessions.submit(f.command(ids, draftId))).rejects.toThrow('512 KiB')
    expect(f.app.get(SessionStore).managedSessions()).toEqual([])
    const bound = await f.refs.create({
      kind: 'paste',
      draftId: randomUUID(),
      text: 'necessary original',
    })
    const receipt = await f.sessions.submit(f.command([bound.id], bound.draftId))
    f.database.sqlite
      .prepare('update input_references set content=zeroblob(?) where id=?')
      .run(32 * 1024 * 1024, ids[0])
    await expect(f.refs.create({ kind: 'paste', draftId, text: 'capacity probe' })).rejects.toThrow(
      '32 MiB',
    )
    f.database.sqlite
      .prepare('update input_references set created_at=?')
      .run(Date.now() - 8 * 86400000)
    await f.refs.create({ kind: 'paste', draftId, text: 'new unbound' })
    expect(
      f.database.sqlite
        .prepare('select content,session_id from input_references where id=?')
        .get(bound.id),
    ).toEqual({ content: Buffer.from('necessary original'), session_id: receipt.session.id })
    expect(
      f.database.sqlite.prepare('select id from input_references where id=?').get(ids[0]),
    ).toBeUndefined()
  } finally {
    await f.close()
  }
})
