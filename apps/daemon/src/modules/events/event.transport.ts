import type { EventService } from './event.service.js'
import type { RuntimeFrame } from '@pi-workbench/shared'
import type { FastifyInstance } from 'fastify'

import websocket from '@fastify/websocket'

import { runtimeSubscribeSchema } from '@pi-workbench/shared'

/** Registers read-only REST/WS on the existing Fastify adapter, under its Host/Origin hook.
 * No cookies/commands/pairing are claimed here (SEC-08). Upgrade requires an explicit allowed
 * Origin; bounded subscribe time, inbound frames and outbound backlog protect the local service.
 */
export async function registerEventTransport(server: FastifyInstance, events: EventService) {
  await server.register(websocket, { options: { maxPayload: 16384 } })
  server.get('/api/protocol', (_request, reply) =>
    reply.header('cache-control', 'no-store').send(events.hello()),
  )
  server.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/snapshot',
    (request, reply) => {
      const snapshot = events.snapshot(request.params.sessionId)
      return reply
        .header('cache-control', 'no-store')
        .code(snapshot ? 200 : 404)
        .send(snapshot ?? { message: 'Unknown runtime' })
    },
  )
  server.get(
    '/api/events',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        if (!request.headers.origin) {
          await reply.code(403).send({ message: 'WebSocket Origin required' })
        }
      },
    },
    (socket) => {
      let unsubscribe: (() => void) | undefined
      const send = (frame: RuntimeFrame) => {
        if (socket.readyState !== socket.OPEN) {
          return
        }
        if (socket.bufferedAmount > 2 * 1024 * 1024) {
          socket.close(1013, 'Slow observer; reconnect with cursor')
          return
        }
        socket.send(JSON.stringify(frame))
      }
      const timer = setTimeout(() => socket.close(1008, 'Subscribe timed out'), 10000)
      const heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate()
        } else {
          alive = false
          socket.ping()
        }
      }, 15000)
      let alive = true
      socket.on('pong', () => {
        alive = true
      })
      socket.on('message', (bytes, binary) => {
        try {
          const parsed = runtimeSubscribeSchema.safeParse(
            binary || !Buffer.isBuffer(bytes) ? null : JSON.parse(bytes.toString('utf8')),
          )
          if (
            !parsed.success ||
            unsubscribe ||
            parsed.data.requiredCapabilities.some(
              (cap) => !events.hello().capabilities.some((available) => available === cap),
            )
          ) {
            send({
              type: 'incompatible',
              message:
                'Match client/server versions and capabilities, restart, then resync. Mutations disabled.',
            })
            socket.close(1008, 'Incompatible protocol')
            return
          }
          clearTimeout(timer)
          unsubscribe = events.subscribe(parsed.data, send)
        } catch {
          socket.close(1008, 'Invalid subscription')
        }
      })
      const clean = () => {
        clearTimeout(timer)
        clearInterval(heartbeat)
        unsubscribe?.()
      }
      socket.on('close', clean)
      socket.on('error', clean)
      send(events.hello())
    },
  )
}
