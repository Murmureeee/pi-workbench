import type { AccessService } from '../security/access.service.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { ChangeRollbackService } from './change-rollback.service.js'
import type { FastifyInstance } from 'fastify'

import { HttpException } from '@nestjs/common'
import { z } from 'zod'

import {
  rollbackCommandSchema,
  rollbackHistoryQuerySchema,
  rollbackTargetSchema,
  runtimeCapabilities,
} from '@pi-workbench/shared'

/** Mutation gate supplements the common paired Host/Origin/CSRF boundary. Client-supplied
 * paths are never accepted, and mismatched protocol capabilities cannot confirm writes. */
export function registerRollbackTransport(
  server: FastifyInstance,
  service: ChangeRollbackService,
  access: AccessService,
  sessions: SessionStore,
): void {
  server.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/changes/rollback')) {
      return
    }
    if (access.authenticate(request.headers.cookie)?.info.kind !== 'desktop') {
      await reply.code(403).send({ message: '回滚仅向已配对 Electron 开放。' })
    } else if (
      request.method === 'POST' &&
      (request.headers['x-piw-protocol'] !== '1' ||
        request.headers['x-piw-capabilities'] !== runtimeCapabilities.join(','))
    ) {
      await reply.code(409).send({ message: '客户端协议或能力不兼容，请更新后重新同步。' })
    }
  })
  for (const mode of ['prepare', 'command'] as const) {
    server.post(`/api/changes/rollback/${mode}`, async (request, reply) => {
      const input = (mode === 'prepare' ? rollbackTargetSchema : rollbackCommandSchema).safeParse(
        request.body,
      )
      const client = access.authenticate(request.headers.cookie)
      if (!input.success || !client) {
        return reply.code(400).send({ message: '回滚身份或参数无效。' })
      }
      if (!sessions.executionEnvironment(input.data.sessionId)) {
        return reply.code(404).send({ message: '会话不存在。' })
      }
      try {
        return mode === 'prepare' && 'turnId' in input.data
          ? await service.prepare(input.data, client.info.id)
          : 'operationId' in input.data
            ? await service.command(input.data)
            : undefined
      } catch (error) {
        if (error instanceof HttpException) {
          return reply.code(error.getStatus()).send(error.getResponse())
        }
        return reply
          .code(503)
          .send({ message: '回滚未确认成功，现场和记录保留；请查询操作状态，不要自动重试。' })
      }
    })
  }
  server.get('/api/changes/rollback/record', (request, reply) => {
    const input = z
      .strictObject({ sessionId: z.uuid(), operationId: z.uuid() })
      .safeParse(request.query)
    if (!input.success) {
      return reply.code(400).send({ message: '回滚查询身份无效。' })
    }
    try {
      return service.record(input.data.sessionId, input.data.operationId)
    } catch {
      return reply.code(404).send({ message: '回滚操作不存在或不属于该会话。' })
    }
  })
  server.get('/api/changes/rollback/history', (request, reply) => {
    const input = rollbackHistoryQuerySchema.safeParse(request.query)
    if (!input.success) {
      return reply.code(400).send({ message: '回滚记录分页参数无效。' })
    }
    if (!sessions.executionEnvironment(input.data.sessionId)) {
      return reply.code(404).send({ message: '会话不存在。' })
    }
    try {
      return service.history(input.data.sessionId, input.data.before)
    } catch {
      return reply.code(503).send({ message: '持久回滚记录暂不可读，未补造记录。' })
    }
  })
}
