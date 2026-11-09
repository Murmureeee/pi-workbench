import { Server } from 'node:http'

import { expect, it, vi } from 'vitest'

import { createOfflineProvider } from './offline-provider.js'

function isListener(value: unknown): value is () => void {
  return typeof value === 'function'
}

it.runIf(process.platform === 'win32')(
  'retries a reserved Windows port before any request',
  async () => {
    const listen = vi.spyOn(Server.prototype, 'listen').mockImplementationOnce(function (
      this: Server,
    ) {
      listen.mockRestore()
      queueMicrotask(() =>
        this.emit('error', Object.assign(new Error('reserved port'), { code: 'EACCES' })),
      )
      return this
    })
    const provider = await createOfflineProvider()
    try {
      expect(provider.stats()).toEqual({ localRequests: 0, blockedNetworkAttempts: 0 })
      provider.prepare('reply')
      const response = await fetch(`${provider.baseUrl}/chat/completions`, { method: 'POST' })
      expect(await response.text()).toContain('OFFLINE_')
      expect(provider.stats()).toEqual({ localRequests: 1, blockedNetworkAttempts: 0 })
    } finally {
      await provider.close()
      vi.restoreAllMocks()
    }
  },
)

it.runIf(process.platform === 'win32')(
  'fails persistent local permission denial after sixteen attempts',
  async () => {
    const error = Object.assign(new Error('persistent permission denial'), { code: 'EACCES' })
    const listen = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server) {
      queueMicrotask(() => this.emit('error', error))
      return this
    })
    try {
      await expect(createOfflineProvider()).rejects.toBe(error)
      expect(listen).toHaveBeenCalledTimes(16)
    } finally {
      vi.restoreAllMocks()
    }
  },
)

it('serves one local response even when Windows assigns fetch-forbidden port 6000 for port zero', async () => {
  // Reproduce this machine's low dynamic TCP range without changing OS settings.
  const listen = vi.spyOn(Server.prototype, 'listen').mockImplementationOnce(function (
    this: Server,
    ...args: unknown[]
  ) {
    listen.mockRestore()
    const [port, host, listener] = args
    if (typeof port !== 'number' || typeof host !== 'string') {
      throw new Error('Expected a numeric loopback listener')
    }
    return this.listen(port === 0 ? 6000 : port, host, () => {
      if (isListener(listener)) {
        listener()
      }
    })
  })
  const provider = await createOfflineProvider()
  try {
    provider.prepare('reply')
    const reply = await fetch(`${provider.baseUrl}/chat/completions`, { method: 'POST' })
    expect(reply.status).toBe(200)
    expect(await reply.text()).toContain('OFFLINE_')
    expect(provider.stats()).toEqual({ localRequests: 1, blockedNetworkAttempts: 0 })
  } finally {
    await provider.close()
    vi.restoreAllMocks()
  }
})
