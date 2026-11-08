import type { AccessService } from '../security/access.service.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { ChangeAvailabilityService } from './change-availability.service.js'
import type { ChangeProvenanceService } from './change-provenance.service.js'
import type { ChangeReviewService } from './change-review.service.js'
import type { ChangeService } from './change.service.js'
import type { FastifyInstance } from 'fastify'

import {
  changeDiffQuerySchema,
  changeHistoryQuerySchema,
  changeSourcesQuerySchema,
} from '@pi-workbench/shared'

/** Paired desktop read-only versions, provenance and redacted Diff. No client path or restore command. */
export function registerChangeTransport(
  server: FastifyInstance,
  changes: ChangeService,
  sessions: SessionStore,
  access: AccessService,
  provenance: ChangeProvenanceService,
  review: ChangeReviewService,
  availability: ChangeAvailabilityService,
) {
  server.get('/api/changes/rounds', (request, reply) => {
    if (access.authenticate(request.headers.cookie)?.info.kind !== 'desktop') {
      return reply.code(403).send({ message: '文件版本目前仅向已配对 Electron 开放。' })
    }
    const query = changeHistoryQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply.code(400).send({ message: '文件版本查询身份无效。' })
    }
    if (!sessions.executionEnvironment(query.data.sessionId)) {
      return reply.code(404).send({ message: '会话不存在。' })
    }
    try {
      return changes.history(query.data.sessionId, query.data.before)
    } catch {
      return reply.code(503).send({ message: '文件版本记录暂不可读，现场与任务保留，请重新同步。' })
    }
  })
  for (const mode of ['sources', 'review', 'diff', 'availability'] as const) {
    server.get(`/api/changes/${mode}`, async (request, reply) => {
      if (access.authenticate(request.headers.cookie)?.info.kind !== 'desktop') {
        return reply.code(403).send({ message: '修改审查目前仅向已配对Electron开放。' })
      }
      const query = (mode === 'diff' ? changeDiffQuerySchema : changeSourcesQuerySchema).safeParse(
        request.query,
      )
      if (!query.success) {
        return reply.code(400).send({ message: '修改审查查询身份无效。' })
      }
      const { sessionId, turnId } = query.data
      try {
        // A turn/file ID is scoped to its owning session, never a client-selected raw path.
        if (
          !sessions.executionEnvironment(sessionId) ||
          changes.context(turnId).record.sessionId !== sessionId
        ) {
          return await reply.code(404).send({ message: '会话或轮次不存在。' })
        }
      } catch {
        return reply.code(404).send({ message: '会话或轮次不存在。' })
      }
      try {
        if (mode === 'sources') {
          return await provenance.sources(turnId, 'offset' in query.data ? query.data.offset : 0)
        }
        if (mode === 'review') {
          return await review.list(turnId, 'offset' in query.data ? query.data.offset : 0)
        }
        if (mode === 'availability') {
          return await availability.inspect(turnId, 'offset' in query.data ? query.data.offset : 0)
        }
        return await review.diff(turnId, 'fileId' in query.data ? query.data.fileId : '')
      } catch {
        return reply
          .code(503)
          .send({ message: '历史版本或来源证据暂不可读；现场保留，未读取当前文件替代。' })
      }
    })
  }
}
