import type { AccessService } from './access.service.js'
import type { FastifyInstance } from 'fastify'

import { pairRequestSchema, revokeClientSchema } from '@pi-workbench/shared'

/** One ingress policy for every current/future HTTP route and WS upgrade. No proxy headers
 * grant identity. Writes require exact Origin, JSON, a client cookie and its CSRF nonce.
 * Public exceptions contain only health/protocol, pairing status/redeem and offline fixtures.
 */
export function registerAccessTransport(
  server: FastifyInstance,
  access: AccessService,
  port: number,
  development: boolean,
): void {
  const expectedHost = `127.0.0.1:${port}`
  const origins = new Set([
    `http://${expectedHost}`,
    ...(development ? ['http://127.0.0.1:5173'] : []),
  ])
  // Early authorization can reply before @fastify/websocket sets request.ws. Its cleanup
  // hook then cannot see the rejected upgrade: explicitly release that raw response socket.
  server.addHook('onResponse', async (request, reply) => {
    if (request.headers.upgrade?.toLowerCase() === 'websocket' && reply.statusCode !== 101) {
      reply.raw.socket?.destroy()
    }
  })
  server.addHook('onRequest', async (request, reply) => {
    const writing = !['GET', 'HEAD'].includes(request.method)
    if (
      request.headers.host !== expectedHost ||
      (request.headers.origin && !origins.has(request.headers.origin)) ||
      ((writing || request.headers.upgrade?.toLowerCase() === 'websocket') &&
        !request.headers.origin)
    ) {
      await reply.code(403).send({ message: 'Unexpected host or origin' })
      return
    }
    const path = request.url.split('?')[0]!
    if (writing && !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
      await reply.code(415).send({ message: 'JSON request required' })
      return
    }
    const publicRead = !writing && ['/api/health', '/api/protocol', '/api/access'].includes(path)
    const offlineRead = !writing && /^\/api\/lab\/scenes\/[a-z-]+$/.test(path)
    if (publicRead || offlineRead || (request.method === 'POST' && path === '/api/access/pair')) {
      return
    }
    const client = access.authenticate(request.headers.cookie)
    if (!client) {
      await reply.code(401).send({ message: 'Pair this client with the local host again' })
    } else if (writing && request.headers['x-piw-csrf'] !== client.csrf) {
      await reply.code(403).send({ message: 'Client CSRF verification failed' })
    }
  })
  server.get('/api/access', (request) => access.snapshot(request.headers.cookie))
  server.post('/api/access/pair', (request, reply) => {
    const parsed = pairRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid pairing request' })
    }
    const result = access.redeem(parsed.data.code, parsed.data.label)
    if (!result) {
      return reply.code(401).send({ message: '配对链接无效、已使用或已过期；请从宿主重新生成。' })
    }
    return reply.header('set-cookie', result.cookie).send({ paired: true })
  })
  server.get('/api/access/clients', () => ({ clients: access.list() }))
  server.post<{ Params: { id: string } }>('/api/access/clients/:id/revoke', (request, reply) => {
    const parsed = revokeClientSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid client identity' })
    }
    const removed = access.revoke(parsed.data.id)
    return reply.code(removed ? 200 : 404).send({ revoked: removed })
  })
  server.addHook('onClose', async () => access.close())
}
