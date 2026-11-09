import type { SessionSubmit } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runtimeCapabilities, sessionReceiptSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { SessionService } from '../dist/modules/sessions/session.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { ProjectService } from '../dist/modules/workspaces/project.service.js'
import { WorkspaceService } from '../dist/modules/workspaces/workspace.service.js'
import { processBirth } from './helpers/process-identity.js'

const port = 24358
const apps: Awaited<ReturnType<typeof createApp>>[] = [],
  directories: string[] = []
async function fixture(development = true) {
  const directory = mkdtempSync(join(tmpdir(), 'piw-first-send-'))
  directories.push(directory)
  const app = await createApp({ dataDir: join(directory, 'data'), port, development })
  apps.push(app)
  const ticket = app.get(AccessService).issueTicket('desktop')
  const pair = await app.inject({
    method: 'POST',
    url: '/api/access/pair',
    headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
    payload: { code: ticket.code, label: 'First-send test' },
  })
  const cookie = String(pair.headers['set-cookie']).split(';')[0]
  const snapshot = await app.inject({
    method: 'GET',
    url: '/api/access',
    headers: { host: `127.0.0.1:${port}`, cookie },
  })
  const value: unknown = snapshot.json()
  if (!value || typeof value !== 'object' || !('csrf' in value) || typeof value.csrf !== 'string') {
    throw new Error('No CSRF')
  }
  const headers = {
    host: `127.0.0.1:${port}`,
    origin: `http://127.0.0.1:${port}`,
    cookie,
    'x-piw-csrf': value.csrf,
    'x-piw-protocol': '1',
    'x-piw-capabilities': runtimeCapabilities.join(','),
  }
  const submit = (command: SessionSubmit) =>
    app.inject({ method: 'POST', url: '/api/chat/submit', headers, payload: command })
  const store = app.get(SessionStore),
    kernels = app.get(KernelService)
  return { directory, app, headers, submit, store, kernels }
}
function input(patch: Partial<SessionSubmit> = {}): SessionSubmit {
  return {
    requestId: randomUUID(),
    sessionId: null,
    configuration: {
      projectId: null,
      workspaceId: null,
      model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
      thinking: 'off',
    },
    text: '  中文任务，不额外调用模型起名  ',
    retryOf: null,
    ...patch,
  }
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('SESSION-01 durable first-send, actual SDK/local fixture and desktop boundary', () => {
  it('has no empty session before send; atomically commits input before startup and coalesces concurrent/repeated requests', async () => {
    const f = await fixture(),
      task = input()
    expect(f.store.list()).toEqual([])
    expect(f.kernels.list()).toEqual([])
    const original = f.kernels.prompt.bind(f.kernels)
    const runs: Awaited<ReturnType<KernelService['prompt']>>[] = []
    const promptSpy = vi
      .spyOn(f.kernels, 'prompt')
      .mockImplementation((id, cwd, prompt, options) => {
        expect(f.store.list()).toHaveLength(1)
        expect(f.store.submission(task.requestId)).toMatchObject({
          sessionId: id,
          text: task.text.trim(),
        })
        return original(id, cwd, prompt, options).then((result) => {
          runs.push(result)
          return result
        })
      })
    const responses = await Promise.all([f.submit(task), f.submit(task), f.submit(task)])
    expect(responses.map((response) => response.statusCode)).toEqual([202, 202, 202])
    const receipt = sessionReceiptSchema.parse(responses[0].json())
    expect(
      responses.map((response) => sessionReceiptSchema.parse(response.json()).session.id),
    ).toEqual([receipt.session.id, receipt.session.id, receipt.session.id])
    expect(receipt.session.cwd).toContain(join('standalone', receipt.session.id))
    expect(receipt.session.configuration.projectId).toBeNull()
    await expect
      .poll(() => f.store.receipt(task.requestId)?.submission.status, { timeout: 10000 })
      .toBe('completed')
    expect(f.store.submission(task.requestId)?.text).toBeNull()
    const history = f.store.history(receipt.session.id)
    expect(history?.messages.map((message) => [message.role, message.text])).toEqual([
      ['user', task.text.trim()],
      ['assistant', 'OFFLINE_OK'],
    ])
    expect(runs).toMatchObject([{ localRequests: 1, blockedNetworkAttempts: 0 }])
    const repeat = await f.submit(task)
    expect(sessionReceiptSchema.parse(repeat.json()).submission.messageId).toBe(
      receipt.submission.messageId,
    )
    expect(promptSpy).toHaveBeenCalledTimes(1)
    expect((await f.submit({ ...task, text: '改写请求内容' })).statusCode).toBe(409)
    expect(f.store.managedSessions()).toHaveLength(1)
  })

  it('rolls back all first-send records on an actual SQLite commit failure and allows the same request after repair', async () => {
    const f = await fixture(),
      task = input(),
      sqlite = f.app.get(WorkspaceDatabase).sqlite
    sqlite.exec(
      "CREATE TRIGGER fail_first_send BEFORE INSERT ON session_submissions BEGIN SELECT RAISE(ABORT, 'injected disk write failure'); END",
    )
    expect((await f.submit(task)).statusCode).toBe(409)
    expect(f.store.list()).toEqual([])
    expect(f.store.submission(task.requestId)).toBeUndefined()
    expect(f.kernels.list()).toEqual([])
    sqlite.exec('DROP TRIGGER fail_first_send')
    expect((await f.submit(task)).statusCode).toBe(202)
    await expect
      .poll(() => f.store.receipt(task.requestId)?.submission.status, { timeout: 10000 })
      .toBe('completed')
  })

  it('keeps the original session/input after an actual SDK provider error; explicit retry is a new deduplicated turn in the same session', async () => {
    const f = await fixture(),
      task = input(),
      original = f.kernels.prompt.bind(f.kernels)
    vi.spyOn(f.kernels, 'prompt').mockImplementationOnce((id, cwd, prompt, options) =>
      original(id, cwd, { ...prompt, fixture: 'error' }, options),
    )
    const first = sessionReceiptSchema.parse((await f.submit(task)).json())
    await expect
      .poll(() => f.store.receipt(task.requestId)?.submission.status, { timeout: 10000 })
      .toBe('failed')
    const retry = {
      ...task,
      requestId: randomUUID(),
      sessionId: first.session.id,
      retryOf: task.requestId,
    }
    const results = await Promise.all([f.submit(retry), f.submit(retry)])
    expect(results.map((response) => response.statusCode)).toEqual([202, 202])
    await expect
      .poll(() => f.store.receipt(retry.requestId)?.submission.status, { timeout: 10000 })
      .toBe('completed')
    expect(f.store.managedSessions()).toHaveLength(1)
    expect(f.store.submissions(first.session.id)).toHaveLength(2)
    expect(
      f.store.history(first.session.id)?.messages.filter((message) => message.role === 'user'),
    ).toHaveLength(2)
    expect(f.store.receipt(task.requestId)?.submission.messageId).toBe(first.submission.messageId)
    expect(
      f.store.history(first.session.id)?.messages.filter((message) => message.role === 'assistant'),
    ).toHaveLength(2)
    const followup = input({ sessionId: first.session.id, text: '继续当前会话' })
    expect((await f.submit(followup)).statusCode).toBe(202)
    await expect
      .poll(() => f.store.receipt(followup.requestId)?.submission.status, { timeout: 10000 })
      .toBe('completed')
    expect(f.store.managedSessions()).toHaveLength(1)
  })

  it('preserves input after an actual SDK hard kill and restart; repeated creation recovers the same ID without replaying uncertain work', async () => {
    const f = await fixture(),
      task = input(),
      original = f.kernels.prompt.bind(f.kernels)
    const prompt = vi
      .spyOn(f.kernels, 'prompt')
      .mockImplementationOnce((id, cwd, command, options) =>
        original(id, cwd, { ...command, fixture: 'hold' }, options),
      )
    const first = sessionReceiptSchema.parse((await f.submit(task)).json())
    await expect
      .poll(() => f.app.get(EventService).snapshot(first.session.id)?.turns.at(-1)?.text, {
        timeout: 10000,
      })
      .toContain('OFFLINE_')
    const pid = f.kernels.list().find((kernel) => kernel.sessionId === first.session.id)?.pid
    if (!pid) {
      throw new Error('No SDK process to kill')
    }
    const birth = processBirth(pid)
    expect(birth).not.toBe('')
    process.kill(pid, 'SIGKILL')
    await expect
      .poll(() => f.store.receipt(task.requestId)?.submission.status, { timeout: 10000 })
      .toBe('interrupted')
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(f.store.receipt(task.requestId)?.submission.text).toBe(task.text.trim())
    // IPC failure can precede OS reaping; wait for this exact process identity.
    await expect.poll(() => processBirth(pid), { timeout: 10000 }).not.toBe(birth)
    await f.app.close()
    const restarted = await createApp({
      dataDir: join(f.directory, 'data'),
      port,
      development: true,
    })
    apps.push(restarted)
    const receipt = await restarted.get(SessionService).submit({ ...task, text: task.text.trim() })
    expect(receipt.session.id).toBe(first.session.id)
    expect(receipt.submission.messageId).toBe(first.submission.messageId)
    expect(receipt.submission.status).toBe('interrupted')
    expect(restarted.get(KernelService).list()).toEqual([])
    await expect(
      restarted
        .get(SessionService)
        .submit(
          input({ sessionId: first.session.id, retryOf: task.requestId, text: task.text.trim() }),
        ),
    ).rejects.toThrow('结果未知')
  })

  it('rechecks a queued execution directory before SDK admission; preserves the saved task and permits explicit retry after repair', async () => {
    const f = await fixture(),
      original = f.kernels.prompt.bind(f.kernels),
      directory = join(f.directory, 'queued-project')
    mkdirSync(directory)
    const workspace = await f.app.get(WorkspaceService).open(directory)
    if (!workspace.ok) {
      throw new Error('No queued workspace')
    }
    vi.spyOn(f.kernels, 'prompt').mockImplementationOnce((id, cwd, command, options) =>
      original(id, cwd, { ...command, fixture: 'hold' }, options),
    )
    const holding = sessionReceiptSchema.parse((await f.submit(input())).json())
    await expect
      .poll(() => f.app.get(EventService).snapshot(holding.session.id)?.turns.at(-1)?.text, {
        timeout: 10000,
      })
      .toContain('OFFLINE_')
    const task = input({
      configuration: { ...input().configuration, workspaceId: workspace.workspace.id },
    })
    const queued = sessionReceiptSchema.parse((await f.submit(task)).json())
    expect(f.kernels.resources().queue).toContainEqual(
      expect.objectContaining({ sessionId: queued.session.id, stage: 'queued' }),
    )
    renameSync(directory, `${directory}-moved`)
    await f.kernels.abort(holding.session.id, holding.submission.turnId)
    await expect
      .poll(() => f.store.receipt(task.requestId)?.submission.status, { timeout: 10000 })
      .toBe('failed')
    expect(f.kernels.list().some((kernel) => kernel.sessionId === queued.session.id)).toBe(false)
    expect(f.store.receipt(task.requestId)?.submission.text).toBe(task.text.trim())
    renameSync(`${directory}-moved`, directory)
    const retry = {
      ...task,
      text: task.text.trim(),
      requestId: randomUUID(),
      sessionId: queued.session.id,
      retryOf: task.requestId,
    }
    expect((await f.submit(retry)).statusCode).toBe(202)
    await expect
      .poll(() => f.store.receipt(retry.requestId)?.submission.status, { timeout: 10000 })
      .toBe('completed')
    expect(f.store.managedSessions()).toHaveLength(2)
  })

  it('refuses a standalone base redirected outside its managed directory without creating a session or touching the destination', async () => {
    const f = await fixture(),
      destination = join(f.directory, 'outside')
    mkdirSync(destination)
    writeFileSync(join(destination, 'keep.txt'), 'unchanged')
    symlinkSync(
      destination,
      join(f.directory, 'data', 'standalone'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    expect((await f.submit(input())).statusCode).toBe(409)
    expect(f.store.list()).toEqual([])
    expect(f.kernels.list()).toEqual([])
    expect(readdirSync(destination)).toEqual(['keep.txt'])
    expect(readFileSync(join(destination, 'keep.txt'), 'utf8')).toBe('unchanged')
  })

  it('uses explicitly selected project/workspace and never carries that directory to a later global new session', async () => {
    const f = await fixture(),
      directory = join(f.directory, 'project')
    mkdirSync(directory)
    const result = await f.app.get(WorkspaceService).open(directory)
    if (!result.ok) {
      throw new Error('Workspace fixture failed')
    }
    const project = await f.app
      .get(ProjectService)
      .create({ requestId: randomUUID(), name: '同名项目', workspaceId: result.workspace.id })
    const task = input({
      configuration: {
        projectId: project.id,
        workspaceId: result.workspace.id,
        model: { kind: 'local-fixture', provider: 'piw-offline', model: 'fixture' },
        thinking: 'off',
      },
    })
    const first = sessionReceiptSchema.parse((await f.submit(task)).json())
    expect(first.session.cwd).toBe(result.workspace.canonicalPath)
    await expect
      .poll(() => f.store.receipt(task.requestId)?.submission.status, { timeout: 10000 })
      .toBe('completed')
    const global = input(),
      next = sessionReceiptSchema.parse((await f.submit(global)).json())
    expect(next.session.cwd).not.toBe(first.session.cwd)
    expect(next.session.configuration.projectId).toBeNull()
    expect(existsSync(next.session.cwd)).toBe(true)
    await expect
      .poll(() => f.store.receipt(global.requestId)?.submission.status, { timeout: 10000 })
      .toBe('completed')
    await f.kernels.destroy(first.session.id)
    renameSync(directory, `${directory}-moved`)
    expect((await f.submit(input({ configuration: task.configuration }))).statusCode).toBe(409)
    expect(f.store.managedSessions()).toHaveLength(2)
    // Existing creation requests reconcile despite a now missing execution directory.
    expect(sessionReceiptSchema.parse((await f.submit(task)).json()).session.id).toBe(
      first.session.id,
    )
  })

  it('refuses blank input, altered existing configuration, browser identity, missing CSRF/protocol and nondevelopment fixtures', async () => {
    const f = await fixture(),
      task = input()
    expect((await f.submit({ ...task, text: ' \n ' })).statusCode).toBe(400)
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/chat/submit',
          headers: { ...f.headers, 'x-piw-csrf': '' },
          payload: task,
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/chat/submit',
          headers: { ...f.headers, 'x-piw-protocol': '99' },
          payload: task,
        })
      ).statusCode,
    ).toBe(409)
    const browser = f.app.get(AccessService).issueTicket('browser')
    const pair = await f.app.inject({
      method: 'POST',
      url: '/api/access/pair',
      headers: f.headers,
      payload: { code: browser.code, label: 'Browser fixture' },
    })
    expect(
      (
        await f.app.inject({
          method: 'GET',
          url: '/api/chat/options',
          headers: {
            host: f.headers.host,
            cookie: String(pair.headers['set-cookie']).split(';')[0],
          },
        })
      ).statusCode,
    ).toBe(403)
    const first = sessionReceiptSchema.parse((await f.submit(task)).json())
    await expect
      .poll(() => f.store.receipt(task.requestId)?.submission.status, { timeout: 10000 })
      .toBe('completed')
    const changed = input({
      sessionId: first.session.id,
      configuration: { ...task.configuration, workspaceId: first.session.workspaceId },
    })
    expect((await f.submit(changed)).statusCode).toBe(409)
    const production = await fixture(false)
    expect((await production.submit(input())).statusCode).toBe(403)
    expect(production.kernels.list()).toEqual([])
  })

  it('keeps provider transport closed and redacts the local title without changing native execution input', async () => {
    const f = await fixture(),
      source = join(f.directory, 'pi')
    mkdirSync(source)
    const auth = join(source, 'auth.json')
    writeFileSync(
      auth,
      JSON.stringify({ existing: { type: 'api_key', key: 'first-send-secret-19730' } }),
    )
    const prior = readFileSync(auth)
    const app = await createApp({
      dataDir: join(f.directory, 'redaction-data'),
      port,
      development: true,
      piAgentDir: source,
    })
    apps.push(app)
    const service = app.get(SessionService),
      store = app.get(SessionStore)
    const task = input({ text: '请检查 first-send-secret-19730，并处理中文任务' })
    const receipt = await service.submit(task)
    expect(receipt.session.title).not.toContain('first-send-secret-19730')
    await expect
      .poll(() => store.receipt(task.requestId)?.submission.status, { timeout: 10000 })
      .toBe('completed')
    expect(store.history(receipt.session.id)?.messages[0]?.text).toBe(task.text)
    expect(readFileSync(auth)).toEqual(prior)
    await expect(
      service.submit(
        input({
          configuration: {
            ...task.configuration,
            model: { kind: 'provider', provider: 'openai', model: 'gpt-4o' },
          },
        }),
      ),
    ).rejects.toThrow('真实提供商传输仍关闭')
    expect(store.managedSessions()).toHaveLength(1)
  })
})
