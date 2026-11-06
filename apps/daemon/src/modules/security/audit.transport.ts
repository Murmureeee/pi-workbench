import type { AccessService } from './access.service.js'
import type { AuditService } from './audit.service.js'
import type { FastifyInstance } from 'fastify'

import { auditExportSchema, auditQuerySchema } from '@pi-workbench/shared'

/** Read/export only, paired desktop identity. There is deliberately no append/update/delete
 * route; clearing filters or downloaded copies never deletes the audit originals. */
export function registerAuditTransport(
  server: FastifyInstance,
  audit: AuditService,
  access: AccessService,
): void {
  server.addHook('preHandler', async (request, reply) => {
    if (
      request.url.split('?')[0]?.startsWith('/api/audit') &&
      access.authenticate(request.headers.cookie)?.info.kind !== 'desktop'
    ) {
      await reply.code(403).send({ message: '操作审计目前仅向 Electron 开放。' })
    }
  })
  for (const path of ['/api/audit', '/api/audit/export']) {
    server.get(path, (request, reply) => {
      const query = auditQuerySchema.safeParse(request.query)
      if (!query.success) {
        return reply.code(400).send({ message: '审计筛选或分页无效，请重新核对。' })
      }
      try {
        const page = audit.page(query.data)
        if (path === '/api/audit') {
          return page
        }
        const exported = auditExportSchema.parse({
          format: 'piw-audit-v1',
          exportedAt: Date.now(),
          redacted: true,
          query: query.data,
          page,
        })
        return reply
          .type('application/json; charset=utf-8')
          .header('content-disposition', 'attachment; filename="piw-audit-redacted.json"')
          .send(exported)
      } catch {
        return reply.code(409).send({ message: '审计无法完整读取，请检查存储后刷新；原件保留。' })
      }
    })
  }
}
