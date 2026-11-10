import type { AccessService } from '../security/access.service.js'
import type { FileEditService } from './file-edit.service.js'
import type { FileService } from './file.service.js'
import type { FastifyInstance } from 'fastify'

import {
  fileListQuerySchema,
  fileLocateQuerySchema,
  fileReadQuerySchema,
  fileSearchQuerySchema,
} from '@pi-workbench/shared'

/** Existing SEC-08 identity/Origin boundary applies first. Only registered target IDs
 * and opaque handles cross transport; aborting observation does not abort an SDK task. */
export function registerFileTransport(
  server: FastifyInstance,
  files: FileService,
  access: AccessService,
  edits: FileEditService,
) {
  for (const operation of ['open', 'save'] as const) {
    server.post(
      `/api/files/edit/${operation}`,
      { bodyLimit: 2 * 1024 * 1024 },
      async (request, reply) => {
        const client = access.authenticate(request.headers.cookie)
        if (client?.info.kind !== 'desktop') {
          return reply.code(403).send({ message: '文件编辑仅向已配对 Electron 开放。' })
        }
        const abort = new AbortController()
        const close = () => {
          if (!reply.raw.writableFinished) {
            abort.abort()
          }
        }
        reply.raw.once('close', close)
        try {
          return operation === 'open'
            ? await edits.open(request.body, client.info.id, abort.signal)
            : await edits.save(request.body, client.info.id, abort.signal)
        } finally {
          reply.raw.off('close', close)
        }
      },
    )
  }
  for (const operation of ['list', 'search', 'locate', 'read'] as const) {
    server.get(`/api/files/${operation}`, async (request, reply) => {
      if (access.authenticate(request.headers.cookie)?.info.kind !== 'desktop') {
        return reply.code(403).send({ message: '文件浏览目前仅向已配对 Electron 开放。' })
      }
      const schema =
        operation === 'list'
          ? fileListQuerySchema
          : operation === 'read'
            ? fileReadQuerySchema
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
        if ('path' in q || (operation === 'read' && 'file' in q)) {
          return await files.read(
            {
              target,
              source: 'file' in q ? { file: q.file } : { path: q.path },
              ...('version' in q && q.version ? { version: q.version } : {}),
            },
            abort.signal,
          )
        }
        if ('query' in q) {
          return await files.search(target, q.query, abort.signal)
        }
        if ('file' in q) {
          return await files.locate(target, q.file, abort.signal)
        }
        return await files.list(
          target,
          'directory' in q ? q.directory : undefined,
          'cursor' in q ? q.cursor : undefined,
          abort.signal,
        )
      } finally {
        reply.raw.off('close', close)
      }
    })
  }
}
