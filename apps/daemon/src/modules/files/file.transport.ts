import type { AccessService } from '../security/access.service.js'
import type { FileService } from './file.service.js'
import type { FastifyInstance } from 'fastify'

import {
  fileListQuerySchema,
  fileLocateQuerySchema,
  fileSearchQuerySchema,
} from '@pi-workbench/shared'

/** Existing SEC-08 identity/Origin boundary applies first. Only registered target IDs
 * and opaque handles cross transport; aborting observation does not abort an SDK task. */
export function registerFileTransport(
  server: FastifyInstance,
  files: FileService,
  access: AccessService,
) {
  for (const operation of ['list', 'search', 'locate'] as const) {
    server.get(`/api/files/${operation}`, async (request, reply) => {
      if (access.authenticate(request.headers.cookie)?.info.kind !== 'desktop') {
        return reply.code(403).send({ message: '文件浏览目前仅向已配对 Electron 开放。' })
      }
      const schema =
        operation === 'list'
          ? fileListQuerySchema
          : operation === 'search'
            ? fileSearchQuerySchema
            : fileLocateQuerySchema
      const parsed = schema.safeParse(request.query)
      if (!parsed.success) {
        return reply.code(400).send({ message: '文件请求无效；只接受已登记身份和当前文件句柄。' })
      }
      const q = parsed.data,
        target = 'sessionId' in q ? { sessionId: q.sessionId } : { workspaceId: q.workspaceId }
      const abort = new AbortController()
      const close = () => {
        if (!reply.raw.writableFinished) {
          abort.abort()
        }
      }
      reply.raw.once('close', close)
      try {
        if ('query' in q) {
          return await files.search(target, q.query, abort.signal)
        }
        if ('file' in q) {
          return await files.locate(target, q.file, abort.signal)
        }
        return await files.list(target, q.directory, q.cursor, abort.signal)
      } finally {
        reply.raw.off('close', close)
      }
    })
  }
}
