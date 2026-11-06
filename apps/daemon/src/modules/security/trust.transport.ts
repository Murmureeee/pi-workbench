import type { AccessService } from './access.service.js'
import type { TrustService } from './trust.service.js'
import type { FastifyInstance } from 'fastify'

import { trustGrantSchema, trustInspectSchema, trustRevokeSchema } from '@pi-workbench/shared'

/** Uses the same SEC-08 authenticated Host/Origin/JSON/CSRF gate as other private commands.
 * Discovery is an explicit bounded host read, never a package installation or workspace open.
 */
export function registerTrustTransport(
  server: FastifyInstance,
  trust: TrustService,
  access: AccessService,
) {
  server.get('/api/trust', () => trust.inspect())
  server.post('/api/trust/inspect', (request, reply) => {
    const parsed = trustInspectSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: '请选择有效的绝对目录。' })
    }
    try {
      return trust.inspect(parsed.data.project)
    } catch {
      return reply
        .code(409)
        .send({ message: '目录无法完整检查，请确认路径、访问权限和资源数量后重试。' })
    }
  })
  server.post('/api/trust/grant', (request, reply) => {
    const parsed = trustGrantSchema.safeParse(request.body),
      client = access.authenticate(request.headers.cookie)
    if (!parsed.success) {
      return reply.code(400).send({ message: '信任请求无效，请刷新来源。' })
    }
    if (!client) {
      return reply.code(401).send({ message: '请重新配对。' })
    }
    try {
      return { record: trust.grant(parsed.data, client.info.id) }
    } catch {
      return reply
        .code(409)
        .send({ message: '资源已变化、不可检查或记录无法保存，未授予新信任。请刷新。' })
    }
  })
  server.post('/api/trust/revoke', (request, reply) => {
    const parsed = trustRevokeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: '信任记录无效。' })
    }
    const revoked = trust.revoke(
      parsed.data.recordId,
      access.authenticate(request.headers.cookie)?.info.id ?? null,
    )
    return reply.code(revoked ? 200 : 404).send({ revoked, effective: 'next-turn' })
  })
}
