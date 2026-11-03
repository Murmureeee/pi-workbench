import { Server } from 'node:http'

import { expect, it, vi } from 'vitest'

import { createOfflineProvider } from './offline-provider.js'

function isListener(value: unknown): value is () => void {
  return typeof value === 'function'
}

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
