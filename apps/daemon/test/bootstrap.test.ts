import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fixtureSchema, healthSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { readOptions } from '../dist/bootstrap/options.js'
import { WorkspaceDatabase } from '../dist/infrastructure/database/database.js'

describe('OPS-01 service and native SQLite baseline', () => {
  it('applies reviewed migrations once and reopens persisted metadata', () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-db-test-'))
    try {
      const first = new WorkspaceDatabase(directory)
      expect(first.sqlite.pragma('journal_mode', { simple: true })).toBe('wal')
      first.sqlite
        .prepare('INSERT INTO workspace_meta (key, value) VALUES (?, ?)')
        .run('test-marker', 'preserved')
      first.close()
      const second = new WorkspaceDatabase(directory)
      expect(
        second.sqlite.prepare('SELECT value FROM workspace_meta WHERE key = ?').get('test-marker'),
      ).toEqual({ value: 'preserved' })
      expect(second.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual(
        { n: 2 },
      )
      second.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('serves validated fake fixtures and rejects unexpected hosts and origins', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'piw-daemon-test-'))
    const app = await createApp({ dataDir: directory, port: 4317, development: true })
    try {
      const server = app.getHttpAdapter().getInstance()
      const health = await server.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host: '127.0.0.1:4317' },
      })
      expect(health.statusCode).toBe(200)
      const healthData = healthSchema.parse(health.json())
      expect(healthData).toMatchObject({
        kernel: 'fake',
        realProviderEnabled: false,
        storage: 'sqlite',
      })
      expect(healthData.node).toMatch(/^v24\./)
      const fixture = await server.inject({
        method: 'GET',
        url: '/api/lab/scenes/approval',
        headers: { host: '127.0.0.1:4317' },
      })
      const fixtureData = fixtureSchema.parse(fixture.json())
      expect(fixtureData.source).toBe('fake-kernel')
      expect(fixtureData.events.at(-1)?.payload.type).toBe('approval')
      expect(
        (
          await server.inject({
            method: 'GET',
            url: '/api/lab/scenes/invalid',
            headers: { host: '127.0.0.1:4317' },
          })
        ).statusCode,
      ).toBe(400)
      expect(
        (
          await server.inject({
            method: 'GET',
            url: '/api/health',
            headers: { host: 'untrusted.example' },
          })
        ).statusCode,
      ).toBe(403)
      expect(
        (
          await server.inject({
            method: 'GET',
            url: '/api/health',
            headers: { host: '127.0.0.1:4317', origin: 'https://untrusted.example' },
          })
        ).statusCode,
      ).toBe(403)
      expect(
        (
          await server.inject({
            method: 'POST',
            url: '/api/lab/scenes/approval',
            headers: { host: '127.0.0.1:4317' },
          })
        ).statusCode,
      ).toBe(404)
    } finally {
      await app.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('uses the Windows application directory and refuses a real kernel', () => {
    expect(readOptions({ LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local' }).dataDir).toContain(
      'PiWorkbench',
    )
    expect(() => readOptions({ PIW_KERNEL: 'real' })).toThrow('Only the offline fake kernel')
    expect(() => readOptions({ PIW_PORT: 'NaN' })).toThrow('Invalid PIW_PORT')
  })
})
