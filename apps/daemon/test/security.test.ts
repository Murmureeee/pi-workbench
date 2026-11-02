import type { RuntimeFrame } from '@pi-workbench/shared'

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import {
  applyRuntimeEvent,
  redacted,
  runtimeSnapshotSchema,
  securitySnapshotSchema,
} from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { SecurityService } from '../dist/modules/security/security.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'
import { authorizedHeaders } from './helpers/access.js'

const fixtureSecret = 'unlabelled-fixture-credential-4d91'
function acl(path: string, protect = false): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return execFileSync(
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$ErrorActionPreference = "Stop"; ' +
        (protect
          ? '$acl = Get-Acl -LiteralPath $env:PIW_ACL_SOURCE; $acl.SetAccessRuleProtection($true, $true); Set-Acl -LiteralPath $env:PIW_ACL_SOURCE -AclObject $acl; '
          : '') +
        '(Get-Acl -LiteralPath $env:PIW_ACL_SOURCE).Sddl',
    ],
    {
      env: { SystemRoot: systemRoot, WINDIR: systemRoot, PIW_ACL_SOURCE: path },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    },
  ).trim()
}
function readObject(path: string): Record<string, unknown> {
  return readObjectFromText(readFileSync(path, 'utf8'))
}
function readObjectFromText(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected fixture object')
  }
  return Object.fromEntries(Object.entries(value))
}
function nativeConfig(directory: string) {
  const config = join(directory, 'pi')
  mkdirSync(config)
  writeFileSync(
    join(config, 'auth.json'),
    JSON.stringify({
      existing: { type: 'api_key', key: fixtureSecret, extra: { keep: true } },
      expired: {
        type: 'oauth',
        access: 'oauth-access-fixture',
        refresh: 'oauth-refresh-fixture',
        expires: 1,
      },
    }),
  )
  writeFileSync(
    join(config, 'models.json'),
    JSON.stringify({
      providers: {
        existing: {
          apiKey: fixtureSecret,
          baseUrl: 'https://fixture.invalid/v1',
          models: [{ id: 'existing-model' }],
        },
      },
    }),
  )
  writeFileSync(
    join(config, 'settings.json'),
    '{"defaultProvider":"existing","defaultModel":"existing-model"}',
  )
  return config
}

describe('SEC-06 native credential boundary (synthetic credentials, no provider traffic)', () => {
  it('reads only safe metadata, diagnoses missing/expired/command/env values without executing or writing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-credentials-'))
    try {
      const config = nativeConfig(directory),
        auth = join(config, 'auth.json')
      const data = readObject(auth)
      const marker = join(directory, 'must-not-execute')
      data.command = { type: 'api_key', key: `!echo secret > ${marker}` }
      data.environment = { type: 'api_key', key: '${TEST_SECRET}' }
      data.missing = { type: 'api_key', key: '$ABSENT_VALUE' }
      writeFileSync(auth, JSON.stringify(data))
      const before = readFileSync(auth),
        service = new SecurityService(config, { TEST_SECRET: 'env-fixture-value' })
      const snapshot = service.snapshot()
      expect(snapshot.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'existing', status: 'configured' }),
          expect.objectContaining({ id: 'expired', status: 'expired' }),
          expect.objectContaining({ id: 'command', status: 'command-disabled' }),
          expect.objectContaining({ id: 'environment', status: 'configured' }),
          expect.objectContaining({ id: 'missing', status: 'missing' }),
        ]),
      )
      expect(JSON.stringify(snapshot)).not.toContain(fixtureSecret)
      expect(service.redactor.text('env-fixture-value')).toBe(redacted)
      expect(existsSync(marker)).toBe(false)
      expect(readFileSync(auth)).toEqual(before)
      expect(new SecurityService().snapshot()).toMatchObject({
        diagnostic: 'disabled',
        providers: [],
      })
      expect(new SecurityService(join(directory, 'absent')).snapshot()).toMatchObject({
        diagnostic: 'missing',
      })
      expect(existsSync(join(directory, 'absent'))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('atomically updates one native credential, preserves unrelated providers/settings/models and rejects stale/locked writes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-save-credential-'))
    try {
      const config = nativeConfig(directory),
        auth = join(config, 'auth.json'),
        service = new SecurityService(config, {})
      const models = readFileSync(join(config, 'models.json')),
        settings = readFileSync(join(config, 'settings.json'))
      const revision = service.revision()
      const permissions =
        process.platform === 'win32' ? acl(auth, true) : String(statSync(auth).mode & 0o777)
      expect(service.saveApiKey('existing', '!literal-$KEY', revision)).toEqual({
        ok: true,
        code: 'ok',
      })
      const saved = readObject(auth)
      expect(process.platform === 'win32' ? acl(auth) : String(statSync(auth).mode & 0o777)).toBe(
        permissions,
      )
      expect(saved.existing).toEqual({
        type: 'api_key',
        key: '$!literal-$$KEY',
        extra: { keep: true },
      })
      expect(saved.expired).toMatchObject({ refresh: 'oauth-refresh-fixture' })
      expect(readFileSync(join(config, 'models.json'))).toEqual(models)
      expect(readFileSync(join(config, 'settings.json'))).toEqual(settings)
      const current = readFileSync(auth)
      expect(service.saveApiKey('existing', 'another-fixture', revision)).toEqual({
        ok: false,
        code: 'conflict',
      })
      mkdirSync(`${auth}.lock`)
      expect(service.saveApiKey('existing', 'another-fixture', service.revision())).toEqual({
        ok: false,
        code: 'locked',
      })
      expect(existsSync(`${auth}.lock`)).toBe(true)
      expect(readFileSync(auth)).toEqual(current)
      expect(service.redactor.text(fixtureSecret)).toBe(redacted)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('diagnoses corrupt config and real filesystem save failure without overwriting valid files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-credential-failure-'))
    try {
      const config = nativeConfig(directory),
        auth = join(config, 'auth.json'),
        service = new SecurityService(config, {})
      const original = readFileSync(auth)
      chmodSync(auth, 0o400)
      try {
        expect(service.saveApiKey('existing', 'replacement-fixture', service.revision())).toEqual({
          ok: false,
          code: 'save-failed',
        })
        expect(readFileSync(auth)).toEqual(original)
      } finally {
        chmodSync(auth, 0o600)
      }
      writeFileSync(auth, '{broken-credential')
      expect(service.refresh().diagnostic).toBe('invalid')
      expect(service.saveApiKey('existing', 'replacement-fixture', service.revision())).toEqual({
        ok: false,
        code: 'invalid',
      })
      expect(readFileSync(auth, 'utf8')).toBe('{broken-credential')
      expect(service.redactor.text(fixtureSecret)).toBe(redacted)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses the same policy for actual logging and safe exports; unknown binary is refused', () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-safe-export-'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const service = new SecurityService(nativeConfig(directory), {})
      service.log('test-diagnostic', {
        nested: { api_key: fixtureSecret },
        error: new Error(`failed ${fixtureSecret}`),
      })
      const text = JSON.stringify(log.mock.calls)
      expect(text).not.toContain(fixtureSecret)
      expect(text).toContain(redacted)
      expect(
        service
          .export(Buffer.from(`{"value":"${fixtureSecret}","token":"other-fixture"}`))
          ?.toString(),
      ).not.toContain(fixtureSecret)
      expect(service.export(Buffer.from('{broken secret=' + fixtureSecret))?.toString()).toContain(
        redacted,
      )
      expect(service.export(Buffer.from([0xff, 0xfe]))).toBeUndefined()
      const clean = Buffer.from('{broken-jsonl\n')
      expect(service.export(clean)).toEqual(clean)
    } finally {
      log.mockRestore()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('scrubs live and replayed split events and approvals while raw execution/persistence stays unchanged', () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-safe-events-'))
    try {
      const security = new SecurityService(nativeConfig(directory), {})
      const events = new EventService(1024, 2 * 1024 * 1024, security.redactor)
      const sessionId = randomUUID(),
        epoch = randomUUID(),
        turnId = randomUUID()
      events.attach(sessionId, epoch, 'synthetic-ipc-fixture')
      const initial = events.snapshot(sessionId)!
      const request = {
        type: 'subscribe' as const,
        protocolVersion: 1 as const,
        requiredCapabilities: [],
        sessionId,
        epoch,
        daemonId: events.daemonId,
        since: 0,
      }
      const frames: RuntimeFrame[] = []
      events.subscribe(request, (frame) => frames.push(frame), true)
      events.publish(sessionId, epoch, turnId, {
        type: 'turn.started',
        messageId: 'm',
        prompt: `task ${fixtureSecret}`,
      })
      for (const chunk of ['prefix ', ...fixtureSecret.split(''), ' suffix ']) {
        events.publish(sessionId, epoch, turnId, {
          type: 'message.delta',
          messageId: 'm',
          text: chunk,
        })
        expect(JSON.stringify(events.visibleSnapshot(sessionId))).not.toContain(fixtureSecret)
      }
      const command = `curl --token ${fixtureSecret}`
      events.publish(sessionId, epoch, turnId, {
        type: 'approval.requested',
        approval: { id: 'a', command, cwd: directory },
      })
      expect(events.snapshot(sessionId)?.turns[0]?.approval?.command).toBe(command)
      events.publish(sessionId, epoch, turnId, { type: 'turn.finished', outcome: 'completed' })
      const replay: RuntimeFrame[] = []
      events.subscribe(request, (frame) => replay.push(frame), true)()
      for (const list of [frames, replay]) {
        const state = list
          .flatMap((frame) => (frame.type === 'event' ? [frame.event] : []))
          .reduce(applyRuntimeEvent, initial)
        expect(state).toEqual(events.visibleSnapshot(sessionId))
        expect(state.turns[0]?.text).toBe(`prefix ${redacted} suffix `)
        expect(JSON.stringify(list)).not.toContain(fixtureSecret)
      }
      expect(events.snapshot(sessionId)?.turns[0]?.text).toContain(fixtureSecret)
      // Termination and crash recovery must not flush a withheld credential prefix.
      for (const outcome of ['aborted', 'error'] as const) {
        const stoppedTurn = randomUUID(),
          messageId = `${stoppedTurn}:assistant`,
          start = events.snapshot(sessionId)!,
          since = start.seq,
          partial = fixtureSecret.slice(0, -4)
        events.publish(sessionId, epoch, stoppedTurn, {
          type: 'turn.started',
          messageId,
          prompt: 'synthetic interrupted credential',
        })
        events.publish(sessionId, epoch, stoppedTurn, {
          type: 'message.delta',
          messageId,
          text: `prefix ${partial}`,
        })
        events.publish(sessionId, epoch, stoppedTurn, { type: 'turn.finished', outcome })
        const stoppedReplay: RuntimeFrame[] = []
        events.subscribe({ ...request, since }, (frame) => stoppedReplay.push(frame), true)()
        const state = stoppedReplay
          .flatMap((frame) => (frame.type === 'event' ? [frame.event] : []))
          .reduce(applyRuntimeEvent, start)
        expect(state.turns.at(-1)?.text).toBe('prefix ')
        expect(events.visibleSnapshot(sessionId)?.turns.at(-1)?.text).toBe('prefix ')
        expect(JSON.stringify(stoppedReplay)).not.toContain(partial)
        expect(events.snapshot(sessionId)?.turns.at(-1)?.text).toBe(`prefix ${partial}`)
        const raw = events.snapshot(sessionId)!
        raw.turns.at(-1)!.phase = 'interrupted'
        events.restore(raw)
        expect(events.visibleSnapshot(sessionId)?.turns.at(-1)?.text).toBe('prefix ')
      }
      events.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('applies the policy to real SDK REST/history/downloads and forbids browser writes without model traffic', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-security-http-')),
      config = nativeConfig(directory)
    const app = await createApp({
      dataDir: join(directory, 'data'),
      port: 4338,
      development: true,
      piAgentDir: config,
    })
    const headers = await authorizedHeaders(app, 4338)
    try {
      const meta = await app.inject({ method: 'GET', url: '/api/security/credentials', headers })
      expect(meta.statusCode).toBe(200)
      expect(meta.headers['cache-control']).toBe('no-store')
      expect(securitySnapshotSchema.parse(meta.json())).toMatchObject({
        source: 'pi-native',
        realProviderEnabled: false,
      })
      expect(meta.body).not.toContain(fixtureSecret)
      const forbidden = await app.inject({
        method: 'POST',
        url: '/api/security/credentials',
        headers: {
          ...headers,
          origin: 'http://127.0.0.1:4338',
          'x-piw-csrf': (await app.inject({ method: 'GET', url: '/api/access', headers })).json<{
            csrf: string
          }>().csrf,
        },
        payload: { key: fixtureSecret },
      })
      expect(forbidden.statusCode).toBe(403)
      expect(forbidden.body).not.toContain(fixtureSecret)
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/security/credentials',
            headers: { host: 'evil.test' },
          })
        ).statusCode,
      ).toBe(403)
      const sessionId = randomUUID(),
        turnId = randomUUID(),
        kernels = app.get(KernelService)
      await kernels.prompt(sessionId, directory, {
        turnId,
        text: `sensitive ${fixtureSecret}`,
        fixture: 'context',
      })
      const kernel = kernels.list().find((item) => item.sessionId === sessionId)!
      expect(readFileSync(kernel.sessionFile!, 'utf8')).toContain(fixtureSecret)
      const snapshot = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/snapshot`,
        headers,
      })
      expect(runtimeSnapshotSchema.parse(snapshot.json()).turns[0]?.prompt).toContain(redacted)
      expect(snapshot.body).not.toContain(fixtureSecret)
      const history = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/history`,
        headers,
      })
      expect(history.body).not.toContain(fixtureSecret)
      const store = app.get(SessionStore),
        first = store.history(sessionId)?.messages[0]
      if (!first) {
        throw new Error('Expected actual native SDK message')
      }
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/sessions/${sessionId}/messages/${first.id}/content`,
            headers,
          })
        ).body,
      ).not.toContain(fixtureSecret)
      // Synthetic native aborted message appended to the actual SDK history, with a known
      // credential cut mid-value. Both preview and full-content endpoints must stay protected.
      const partial = fixtureSecret.slice(0, -4),
        nativeEntries = readFileSync(kernel.sessionFile!, 'utf8')
          .trim()
          .split('\n')
          .map((line) => readObjectFromText(line)),
        parentId = nativeEntries.at(-1)?.id
      appendFileSync(
        kernel.sessionFile!,
        JSON.stringify({
          type: 'message',
          id: 'synthetic-aborted-secret',
          parentId,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: `prefix ${partial}` }],
            stopReason: 'aborted',
          },
        }) + '\n',
      )
      const stopped = store
        .history(sessionId)
        ?.messages.find((message) => message.nativeEntryId === 'synthetic-aborted-secret')
      if (!stopped) {
        throw new Error('Expected synthetic aborted native message')
      }
      expect(store.content(sessionId, stopped.id)?.text).toBe(`prefix ${partial}`)
      const protectedHistory = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/history`,
        headers,
      })
      expect(protectedHistory.body).not.toContain(partial)
      const protectedFull = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/messages/${stopped.id}/content`,
        headers,
      })
      expect(protectedFull.body).toBe('prefix ')
      expect(readFileSync(kernel.sessionFile!, 'utf8')).toContain(partial)
      appendFileSync(kernel.sessionFile!, `{broken token=${fixtureSecret}\n`)
      const bad = store.history(sessionId)?.diagnostics.find((item) => item.source === 'sdk-jsonl')
      if (!bad) {
        throw new Error('Expected corrupt native record diagnostic')
      }
      const download = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/diagnostics/${bad.id}/raw`,
        headers,
      })
      expect(download.statusCode).toBe(200)
      expect(download.headers['x-piw-redacted']).toBe('true')
      expect(download.body).toContain(redacted)
      expect(download.body).not.toContain(fixtureSecret)
      expect(readFileSync(kernel.sessionFile!, 'utf8')).toContain(fixtureSecret)
      appendFileSync(kernel.sessionFile!, Buffer.from([0xff, 0xfe, 0x0a]))
      const binary = store.history(sessionId)?.diagnostics.at(-1)
      if (!binary) {
        throw new Error('Expected binary record diagnostic')
      }
      const blocked = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/diagnostics/${binary.id}/raw`,
        headers,
      })
      expect(blocked.statusCode).toBe(422)
      expect(blocked.body).toContain('无法安全解析')
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
