import type { WorkspaceService } from './workspace.service.js'
import type { FastifyInstance } from 'fastify'

import { workspaceOpenSchema, workspaceValidateSchema } from '@pi-workbench/shared'

/** Both commands use the existing SEC-08 Host/Origin/JSON/CSRF client gate. Opening a
 * directory is metadata registration, never resource trust, session creation or execution.
 */
export function registerWorkspaceTransport(server: FastifyInstance, workspaces: WorkspaceService) {
  server.post('/api/workspaces/open', async (request, reply) => {
    const parsed = workspaceOpenSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        code: 'invalid_path',
        message: '目录路径无效。',
        recovery: '请输入完整绝对路径，或重新选择文件夹。',
      })
    }
    return workspaces.open(parsed.data.path)
  })
  server.post('/api/workspaces/validate', async (request, reply) => {
    const parsed = workspaceValidateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        code: 'unknown_workspace',
        message: '工作区身份无效。',
        recovery: '请重新选择目录。',
      })
    }
    return workspaces.validate(parsed.data.id)
  })
}
