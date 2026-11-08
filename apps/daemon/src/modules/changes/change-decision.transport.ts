import type { AccessService } from '../security/access.service.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { ChangeDecisionService } from './change-decision.service.js'
import type { FastifyInstance } from 'fastify'

import { HttpException } from '@nestjs/common'

import {
  changeAcceptSchema,
  changeSourcesQuerySchema,
  runtimeCapabilities,
} from '@pi-workbench/shared'

/** Paired desktop facts; common Host/Origin/JSON/CSRF guards still own mutations. */
export function registerChangeDecisions(
  server: FastifyInstance,
  service: ChangeDecisionService,
  access: AccessService,
  sessions: SessionStore,
) {
  server.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/changes/decisions')) {
      return
    }
    if (access.authenticate(request.headers.cookie)?.info.kind !== 'desktop') {
      await reply.code(403).send({ message: '审查决定仅向已配对 Electron 开放。' })
    } else if (
      request.method === 'POST' &&
      (request.headers['x-piw-protocol'] !== '1' ||
        request.headers['x-piw-capabilities'] !== runtimeCapabilities.join(','))
    ) {
      await reply.code(409).send({ message: '客户端协议或能力不兼容，请更新后重新同步。' })
    }
  })
  server.get('/api/changes/decisions', async (request, reply) => {
    const input = changeSourcesQuerySchema.safeParse(request.query)
    if (!input.success || !sessions.executionEnvironment(input.data.sessionId)) {
      return reply.code(404).send({ message: '审查会话或轮次无效。' })
    }
    try {
      return await service.status(input.data.sessionId, input.data.turnId)
    } catch {
      return reply.code(503).send({ message: '审查决定未同步；未推断处理进度，请明确刷新。' })
    }
  })
  server.post('/api/changes/decisions/accept', async (request, reply) => {
    const input = changeAcceptSchema.safeParse(request.body),
      client = access.authenticate(request.headers.cookie)
    if (!input.success || !client || !sessions.executionEnvironment(input.data.sessionId)) {
      return reply.code(400).send({ message: '接受身份或历史版本无效。' })
    }
    try {
      return await service.accept(input.data, client.info.id)
    } catch (error) {
      if (error instanceof HttpException) {
        return reply.code(error.getStatus()).send(error.getResponse())
      }
      return reply.code(503).send({ message: '接受未确认保存；请先刷新审查决定，再明确重试。' })
    }
  })
}
