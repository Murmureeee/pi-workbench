import type { SecurityService } from '../security/security.service.js'
import type { SessionStore } from './session.store.js'
import type { HistoryMessage } from '@pi-workbench/shared'
import type { FastifyInstance } from 'fastify'

import {
  messageTargetSchema,
  visibleModelRequest,
  visibleReasoning,
  visibleToolObservation,
} from '@pi-workbench/shared'

function incomplete(message: Pick<HistoryMessage, 'origin' | 'outcome'>): boolean {
  return (
    message.origin === 'interrupted-checkpoint' ||
    ['aborted', 'error', 'interrupted'].includes(message.outcome ?? '')
  )
}

/** Read-only managed history. All paths resolve from validated database identities; no source
 * path is accepted from HTTP. Same Host/Origin boundary as events; no write/continuation API.
 */
export function registerSessionTransport(
  server: FastifyInstance,
  store: SessionStore,
  security: SecurityService,
): void {
  server.get('/api/sessions', (_request, reply) =>
    reply.header('cache-control', 'no-store').send({ sessions: store.list(), canResume: false }),
  )
  server.get<{ Querystring: { q?: string } }>('/api/session-titles', (request, reply) => {
    const query = request.query.q ?? ''
    if (typeof query !== 'string' || Array.from(query).length > 80) {
      return reply.code(400).send({ message: '标题查询最多 80 个 Unicode 字符。' })
    }
    return reply.header('cache-control', 'no-store').send({ titles: store.titles(query) })
  })
  server.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/locate',
    (request, reply) => {
      const target = messageTargetSchema.safeParse(request.query)
      if (!target.success) {
        return reply.code(400).send({ message: '消息或工具链接参数无效，请重新复制。' })
      }
      const location = store.locate(request.params.sessionId, target.data)
      return reply
        .header('cache-control', 'no-store')
        .code(location ? 200 : 404)
        .send(location ?? { message: '目标记录不可用或尚未持久保存；未定位到其他记录。' })
    },
  )
  server.get<{
    Params: { sessionId: string }
    Querystring: { cursor?: string; limit?: string; around?: string }
  }>('/api/sessions/:sessionId/history', (request, reply) => {
    try {
      if (
        (request.query.around && request.query.cursor) ||
        (request.query.around?.length ?? 0) > 512
      ) {
        return reply.code(400).send({ message: '消息定位不能与分页游标同时使用。' })
      }
      const page = store.history(
        request.params.sessionId,
        request.query.cursor,
        request.query.limit === undefined ? undefined : Number(request.query.limit),
        request.query.around,
      )
      if (page) {
        if (page.modelRequests) {
          page.modelRequests = page.modelRequests.map((item) => ({
            ...item,
            request: visibleModelRequest(item.request, security.redactor),
          }))
        }
        if (page.toolTimelines) {
          page.toolTimelines = page.toolTimelines.map((timeline) => ({
            ...timeline,
            tools: timeline.tools.map((tool) => visibleToolObservation(tool, security.redactor)),
          }))
        }
        page.messages = page.messages.map((message) => ({
          ...message,
          text: security.redactor.text(message.text, message.truncated || incomplete(message)),
          ...(message.reasoning
            ? { reasoning: visibleReasoning(message.reasoning, security.redactor) }
            : {}),
        }))
      }
      return reply
        .header('cache-control', 'no-store')
        .code(page ? 200 : 404)
        .send(page ?? { message: 'Unknown session' })
    } catch (error) {
      return reply
        .code(409)
        .send({ message: error instanceof Error ? error.message : 'Refresh history' })
    }
  })
  server.get<{ Params: { sessionId: string; messageId: string } }>(
    '/api/sessions/:sessionId/messages/:messageId/content',
    (request, reply) => {
      const content = store.content(request.params.sessionId, request.params.messageId)
      return reply
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .type('text/plain; charset=utf-8')
        .code(content === undefined ? 404 : 200)
        .send(
          content ? security.redactor.text(content.text, incomplete(content)) : 'Unknown message',
        )
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
