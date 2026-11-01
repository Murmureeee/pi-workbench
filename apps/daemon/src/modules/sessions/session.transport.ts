import type { SessionStore } from './session.store.js'
import type { FastifyInstance } from 'fastify'

/** Read-only managed history. All paths resolve from validated database identities; no source
 * path is accepted from HTTP. Same Host/Origin boundary as events; no write/continuation API.
 */
export function registerSessionTransport(server: FastifyInstance, store: SessionStore): void {
  server.get('/api/sessions', (_request, reply) =>
    reply.header('cache-control', 'no-store').send({ sessions: store.list(), canResume: false }),
  )
  server.get<{ Params: { sessionId: string }; Querystring: { cursor?: string; limit?: string } }>(
    '/api/sessions/:sessionId/history',
    (request, reply) => {
      try {
        const page = store.history(
          request.params.sessionId,
          request.query.cursor,
          request.query.limit === undefined ? undefined : Number(request.query.limit),
        )
        return reply
          .header('cache-control', 'no-store')
          .code(page ? 200 : 404)
          .send(page ?? { message: 'Unknown session' })
      } catch (error) {
        return reply
          .code(409)
          .send({ message: error instanceof Error ? error.message : 'Refresh history' })
      }
    },
  )
  server.get<{ Params: { sessionId: string; messageId: string } }>(
    '/api/sessions/:sessionId/messages/:messageId/content',
    (request, reply) => {
      const content = store.content(request.params.sessionId, request.params.messageId)
      return reply
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .type('text/plain; charset=utf-8')
        .code(content === undefined ? 404 : 200)
        .send(content ?? 'Unknown message')
    },
  )
  server.get<{ Params: { sessionId: string; diagnosticId: string } }>(
    '/api/sessions/:sessionId/diagnostics/:diagnosticId/raw',
    (request, reply) => {
      const content = store.raw(request.params.sessionId, request.params.diagnosticId)
      return reply
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', 'attachment; filename="piw-original-record.bin"')
        .type('application/octet-stream')
        .code(content === undefined ? 404 : 200)
        .send(content ?? Buffer.from('Unknown diagnostic'))
    },
  )
}
