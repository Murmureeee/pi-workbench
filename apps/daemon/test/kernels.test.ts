import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { createApp } from '../dist/bootstrap/app.js'
import { KernelService } from '../dist/modules/kernels/kernel.service.js'
import { authorizedHeaders } from './helpers/access.js'

describe('CORE-04 daemon authority and process ownership', () => {
  it('shares a single generation across callers and HTTP observers, then explicitly recreates it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-kernel-service-'))
    const cwd = join(directory, 'workspace')
    const otherCwd = join(directory, 'other-workspace')
    mkdirSync(cwd)
    mkdirSync(otherCwd)
    const app = await createApp({ dataDir: directory, port: 4317, development: true })
    try {
      const service = app.get(KernelService)
      const sessionId = randomUUID()
      const [desktopKernel, browserKernel] = await Promise.all([
        service.open(sessionId, cwd),
        service.open(sessionId, cwd),
      ])
      expect(desktopKernel).toBe(browserKernel)
      expect(service.list()).toHaveLength(1)
      await expect(service.open(sessionId, otherCwd)).rejects.toThrow('cwd cannot change')
      const server = app.getHttpAdapter().getInstance(),
        headers = await authorizedHeaders(app, 4317)
      const observe = (origin: string) =>
        server.inject({
          method: 'GET',
          url: '/api/kernels',
          headers: { ...headers, origin },
        })
      const desktop = await observe('http://127.0.0.1:5173')
      const browser = await observe('http://127.0.0.1:4317')
      expect(desktop.statusCode).toBe(200)
      expect(desktop.json()).toEqual(browser.json())
      expect(desktop.json()).toMatchObject({
        source: 'real-sdk/local-fixture',
        realProviderEnabled: false,
        kernels: [{ sessionId, state: 'ready', pid: desktopKernel.snapshot.pid, cwd }],
      })
      // Closing an observer is only the completion of this GET; the process still works.
      expect(
        await service.prompt(sessionId, cwd, {
          turnId: randomUUID(),
          text: 'shared daemon fixture',
        }),
      ).toMatchObject({ outcome: 'completed' })
      expect((await observe('http://127.0.0.1:5173')).json()).toEqual(
        (await observe('http://127.0.0.1:4317')).json(),
      )
      expect(
        (
          await server.inject({
            method: 'POST',
            url: '/api/kernels',
            headers: { host: '127.0.0.1:4317' },
          })
        ).statusCode,
      ).toBe(403)
      const old = desktopKernel.snapshot
      await service.destroy(sessionId)
      expect(service.list()).toHaveLength(0)
      expect(() => {
        if (old.pid) {
          process.kill(old.pid, 0)
        }
      }).toThrow(/ESRCH/)
      const recreated = await service.open(sessionId, cwd)
      expect(recreated.snapshot.epoch).not.toBe(old.epoch)
      expect(recreated.snapshot.sessionFile).toBe(old.sessionFile)
      expect(recreated.snapshot.state).toBe('ready')
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('closes all kernels, including running work, when Nest shuts down', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-kernel-shutdown-'))
    const app = await createApp({ dataDir: directory, port: 4317 })
    const service = app.get(KernelService)
    try {
      const [first, second] = await Promise.all([
        service.open(randomUUID(), directory),
        service.open(randomUUID(), directory),
      ])
      const delta = new Promise<void>((resolve) => {
        first.subscribe((event) => {
          if (event.type === 'delta') {
            resolve()
          }
        })
      })
      const run = service.prompt(first.snapshot.sessionId, directory, {
        turnId: randomUUID(),
        text: 'shutdown fixture',
        fixture: 'hold',
      })
      await delta
      await app.close()
      expect(await run).toMatchObject({ outcome: 'aborted' })
      expect(first.snapshot.state).toBe('disposed')
      expect(second.snapshot.state).toBe('disposed')
      for (const kernel of [first, second]) {
        expect(() => {
          if (kernel.snapshot.pid) {
            process.kill(kernel.snapshot.pid, 0)
          }
        }).toThrow(/ESRCH/)
      }
      await expect(service.open(randomUUID(), directory)).rejects.toThrow('shutting down')
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
