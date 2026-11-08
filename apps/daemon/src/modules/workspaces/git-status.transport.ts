import type { AccessService } from '../security/access.service.js'
import type { GitStatusService } from './git-status.service.js'
import type { FastifyInstance } from 'fastify'

import { workspaceEnvironmentTargetSchema } from '@pi-workbench/shared'

/** SEC-08 authenticates the transport first; only paired desktops may inspect a registered
 * workspace/session. Raw client paths and all mutation methods remain unavailable. */
export function registerGitStatusTransport(
  server: FastifyInstance,
  service: GitStatusService,
  access: AccessService,
) {
  server.get('/api/git/status', async (request, reply) => {
    if (access.authenticate(request.headers.cookie)?.info.kind !== 'desktop') {
      return reply.code(403).send({ message: '仓库状态目前仅向已配对Electron开放。' })
    }
    const target = workspaceEnvironmentTargetSchema.safeParse(request.query)
    if (!target.success) {
      return reply.code(400).send({ message: '只接受已登记的工作区或会话身份。' })
    }
    return service.inspect(target.data)
  })
}
