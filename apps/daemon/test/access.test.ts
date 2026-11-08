import type { RuntimeFrame } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'

import {
  accessSnapshotSchema,
  clientListSchema,
  pairRequestSchema,
  Redactor,
  runtimeFrameSchema,
} from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { EventService } from '../dist/modules/events/event.service.js'
import { registerEventTransport } from '../dist/modules/events/event.transport.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { registerAccessTransport } from '../dist/modules/security/access.transport.js'
import { authorizedHeaders } from './helpers/access.js'

const port = 24348,
  origin = `http://127.0.0.1:${port}`,
  base = { host: `127.0.0.1:${port}`, origin }

describe('SEC-08 host-owned ephemeral authorization (synthetic credentials, no provider traffic)', () => {
  it('consumes tickets once, rejects exact-boundary expiry, rotates identities and never exposes bearer credentials in snapshots/logs', () => {
    let now = 1000000
    const redactor = new Redactor(),
      access = new AccessService(port, redactor, () => now)
    try {
      const expired = access.issueTicket()
      now = expired.expiresAt
      expect(access.redeem(expired.code, 'expired')).toBeUndefined()
      const ticket = access.issueTicket(),
        first = access.redeem(ticket.code, 'first')!
      expect(access.redeem(ticket.code, 'reused')).toBeUndefined()
      const second = access.redeem(access.issueTicket().code, 'second')!
      expect(second.client.info.id).not.toBe(first.client.info.id)
      expect(access.authenticate(`${first.cookie}; ${first.cookie}`)).toBeUndefined()
      const view = accessSnapshotSchema.parse(access.snapshot(first.cookie))
      expect(view).toMatchObject({ authenticated: true, restartPolicy: 're-pair' })
      expect(view.client?.expiresAt).toBe(now + 8 * 60 * 60 * 1000)
      const bearer = first.cookie.match(/^piw_client_\d+=([0-9a-f]{64});/)?.[1] ?? ''
      expect(JSON.stringify(view)).not.toContain(bearer)
      expect(redactor.text(`${ticket.code} ${bearer}`)).toBe('«redacted» «redacted»')
      const closed = vi.fn<() => void>(),
        removed = vi.fn<() => void>()
      access.observe(first.cookie, closed)
      access.observe(second.cookie, removed)?.()
      now = first.client.info.expiresAt
      expect(access.snapshot(first.cookie).authenticated).toBe(false)
      expect(closed).toHaveBeenCalledExactlyOnceWith()
      expect(removed).not.toHaveBeenCalled()
    } finally {
      access.close()
    }
  })

  it('bounds tickets/clients, throttles failed redemption and never lets browser revocation remove desktop identity', () => {
    let now = 1000000
    const access = new AccessService(port, new Redactor(), () => now)
    try {
      for (let index = 0; index < 4; index++) {
        access.issueTicket()
      }
      expect(() => access.issueTicket()).toThrow('limit')
      now += 120000
      const ticket = access.issueTicket()
      for (let index = 0; index < 10; index++) {
        expect(access.redeem('invalid', 'invalid')).toBeUndefined()
      }
      expect(access.redeem(ticket.code, 'limited')).toBeUndefined()
      now += 60000
      const desktop = access.redeem(ticket.code, 'native')!
      for (let index = 1; index < 32; index++) {
        access.redeem(access.issueTicket().code, 'client')
      }
      expect(() => access.issueTicket()).toThrow('limit')
      expect(access.revoke(desktop.client.info.id)).toBe(true)
      const native = access.redeem(access.issueTicket('desktop').code, 'desktop')!
      expect(access.revoke(native.client.info.id)).toBe(false)
      expect(access.authenticate(native.cookie)).toBeDefined()
    } finally {
      access.close()
    }
  })

  it('validates contracts and strips no unexpected executable or credential fields silently', () => {
    expect(
      pairRequestSchema.safeParse({ code: 'a'.repeat(64), label: 'client', kind: 'desktop' })
        .success,
    ).toBe(false)
    expect(pairRequestSchema.safeParse({ code: 'invalid', label: '' }).success).toBe(false)
    expect(
      pairRequestSchema.safeParse({ code: 'a'.repeat(64), label: 'x'.repeat(65) }).success,
    ).toBe(false)
    expect(clientListSchema.safeParse({ clients: [{ id: 'invalid', label: 'a' }] }).success).toBe(
      false,
    )
  })
})

describe('SEC-08 actual daemon REST and native TCP WebSocket boundary', () => {
  it('atomically pairs over concurrent HTTP, sends HttpOnly session cookies, requires CSRF and rejects unpaired/foreign/future writes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-pairing-http-'))
    const app = await createApp({ dataDir: directory, port, development: true })
    try {
      const access = app.get(AccessService),
        ticket = access.issueTicket()
      const replies = await Promise.all(
        [0, 1].map(() =>
          app.inject({
            method: 'POST',
            url: '/api/access/pair',
            headers: base,
            payload: { code: ticket.code, label: 'Browser' },
          }),
        ),
      )
      expect(replies.filter((reply) => reply.statusCode === 200)).toHaveLength(1)
      expect(replies.filter((reply) => reply.statusCode === 401)).toHaveLength(1)
      const paired = replies.find((reply) => reply.statusCode === 200)!,
        cookie = String(paired.headers['set-cookie'])
      expect(cookie).toMatch(/; Path=\/api; HttpOnly; SameSite=Strict$/)
      expect(cookie).not.toMatch(/Expires|Max-Age/)
      expect(paired.body).toBe('{"paired":true}')
      const headers = { ...base, cookie },
        snapshot = accessSnapshotSchema.parse(
          (await app.inject({ url: '/api/access', headers })).json(),
        )
      const id = snapshot.client!.id,
        csrf = snapshot.csrf!
      expect(
        clientListSchema.parse((await app.inject({ url: '/api/access/clients', headers })).json())
          .clients,
      ).toHaveLength(1)
      expect((await app.inject({ url: '/api/access/clients', headers: base })).statusCode).toBe(401)
      await Promise.all(
        [
          '/api/kernels',
          '/api/kernels/resources',
          '/api/sessions',
          '/api/security/credentials',
          '/api/events',
        ].map(async (path) => {
          expect((await app.inject({ url: path, headers: base })).statusCode).toBe(401)
        }),
      )
      await Promise.all(
        [
          { ...base, host: 'evil.example' },
          { ...base, origin: 'null' },
          { ...base, origin: 'http://localhost:5173' },
          {
            ...base,
            origin: 'https://evil.example',
            'x-forwarded-host': base.host,
            'x-forwarded-proto': 'http',
          },
        ].map(async (invalidHeaders) => {
          expect(
            (await app.inject({ url: '/api/health', headers: invalidHeaders })).statusCode,
          ).toBe(403)
          expect(
            (
              await app.inject({
                method: 'POST',
                url: '/api/access/pair',
                headers: invalidHeaders,
                payload: { code: access.issueTicket().code, label: 'foreign' },
              })
            ).statusCode,
          ).toBe(403)
        }),
      )
      expect(
        (await app.inject({ method: 'POST', url: '/api/future/write', headers: base, payload: {} }))
          .statusCode,
      ).toBe(401)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/future/write',
            headers: { host: base.host, cookie },
            payload: {},
          })
        ).statusCode,
      ).toBe(403)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/access/clients/${id}/revoke`,
            headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(403)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/access/clients/${id}/revoke`,
            headers: { ...headers, 'x-piw-csrf': 'wrong' },
            payload: {},
          })
        ).statusCode,
      ).toBe(403)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/access/clients/${id}/revoke`,
            headers: { ...headers, 'x-piw-csrf': csrf, 'content-type': 'text/plain' },
            payload: '{}',
          })
        ).statusCode,
      ).toBe(415)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/access/clients/${id}/revoke`,
            headers: { ...headers, 'x-piw-csrf': csrf },
            payload: {},
          })
        ).statusCode,
      ).toBe(200)
      expect((await app.inject({ url: '/api/kernels', headers })).statusCode).toBe(401)
      expect(access.list()).toEqual([])
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('discards every old ticket/cookie on actual daemon restart while preserving on-disk data', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-pairing-restart-'))
    let app = await createApp({ dataDir: directory, port, development: true })
    try {
      const headers = await authorizedHeaders(app, port),
        ticket = app.get(AccessService).issueTicket()
      await app.close()
      app = await createApp({ dataDir: directory, port, development: true })
      expect((await app.inject({ url: '/api/kernels', headers })).statusCode).toBe(401)
      expect(
        accessSnapshotSchema.parse((await app.inject({ url: '/api/access', headers })).json()),
      ).toMatchObject({ authenticated: false, client: null, csrf: null, restartPolicy: 're-pair' })
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/access/pair',
            headers: base,
            payload: { code: ticket.code, label: 'old' },
          })
        ).statusCode,
      ).toBe(401)
      const renewed = await authorizedHeaders(app, port)
      expect((await app.inject({ url: '/api/kernels', headers: renewed })).statusCode).toBe(200)
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects unpaired TCP upgrades; revocation disconnects one live observer without cancelling SDK work or another client', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-pairing-ws-'))
    const app = await createApp({ dataDir: directory, port, development: true }),
      sockets: WebSocket[] = []
    try {
      await app.listen(port, '127.0.0.1')
      const rejected = new WebSocket(`ws://127.0.0.1:${port}/api/events`, { origin })
      const failure = await new Promise<Error>((resolve) => {
        rejected.once('error', resolve)
      })
      expect(failure.message).toContain('401')
      const first = await authorizedHeaders(app, port),
        second = await authorizedHeaders(app, port)
      const access = app.get(AccessService),
        kernels = app.get(KernelService),
        events = app.get(EventService),
        sessionId = randomUUID(),
        turnId = randomUUID()
      await kernels.open(sessionId, directory)
      const snapshot = events.snapshot(sessionId)!
      const connect = async (headers: typeof first) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/api/events`, { headers, origin }),
          frames: RuntimeFrame[] = []
        sockets.push(socket)
        socket.on('message', (raw) => {
          if (!Buffer.isBuffer(raw)) {
            throw new Error('Expected frame buffer')
          }
          const frame = runtimeFrameSchema.parse(JSON.parse(raw.toString()))
          frames.push(frame)
          if (frame.type === 'hello') {
            socket.send(
              JSON.stringify({
                type: 'subscribe',
                protocolVersion: 1,
                requiredCapabilities: [],
                sessionId,
                epoch: snapshot.epoch,
                daemonId: snapshot.daemonId,
                since: 0,
              }),
            )
          }
        })
        await expect.poll(() => frames.some((frame) => frame.type === 'caught-up')).toBe(true)
        return { socket, frames }
      }
      const a = await connect(first),
        b = await connect(second)
      const run = kernels.prompt(sessionId, directory, {
        turnId,
        text: 'held SDK local fixture',
        fixture: 'hold',
      })
      // Prompt now includes the protected baseline and capacity checks before SDK output.
      // Give real disk/child IO time under the full suite; keep the streaming assertion.
      await expect
        .poll(() => events.snapshot(sessionId)?.turns[0]?.text, {
          timeout: 15000,
          interval: 50,
        })
        .toBe('OFFLINE_')
      const closed = new Promise<number>((resolve) =>
        a.socket.once('close', (code) => resolve(code)),
      )
      const secondIdentity = access.snapshot(second.cookie)
      const revoked = await fetch(
        `${origin}/api/access/clients/${access.snapshot(first.cookie).client!.id}/revoke`,
        {
          method: 'POST',
          headers: {
            ...second,
            origin,
            'content-type': 'application/json',
            'x-piw-csrf': secondIdentity.csrf!,
          },
          body: '{}',
        },
      )
      expect(revoked.status).toBe(200)
      expect(await closed).toBe(1008)
      expect(kernels.list()[0]?.state).toBe('running')
      expect(b.socket.readyState).toBe(WebSocket.OPEN)
      await kernels.abort(sessionId, turnId)
      expect(await run).toMatchObject({ outcome: 'aborted' })
      await expect
        .poll(() =>
          b.frames.some(
            (frame) => frame.type === 'event' && frame.event.payload.type === 'turn.finished',
          ),
        )
        .toBe(true)
      expect((await fetch(`${origin}/api/kernels`, { headers: first })).status).toBe(401)
    } finally {
      for (const socket of sockets) {
        socket.terminate()
      }
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('expires an idle TCP socket without waiting for any new HTTP request', async () => {
    let now = 1000000
    const server = fastify(),
      access = new AccessService(port, new Redactor(), () => now),
      events = new EventService()
    registerAccessTransport(server, access, port, false)
    await registerEventTransport(server, events, access)
    let socket: WebSocket | undefined
    try {
      await server.listen({ port, host: '127.0.0.1' })
      const result = access.redeem(access.issueTicket().code, 'expiry')!
      socket = new WebSocket(`ws://127.0.0.1:${port}/api/events`, {
        headers: { cookie: result.cookie },
        origin,
      })
      await new Promise<void>((resolve) => socket!.once('open', resolve))
      const closed = new Promise<number>((resolve) =>
        socket!.once('close', (code) => resolve(code)),
      )
      now = result.client.info.expiresAt
      expect(await closed).toBe(1008)
      expect(access.list()).toEqual([])
    } finally {
      socket?.terminate()
      events.close()
      await server.close()
    }
  })
})
