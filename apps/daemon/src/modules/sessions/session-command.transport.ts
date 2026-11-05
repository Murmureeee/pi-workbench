import type { EventService } from '../events/event.service.js'
import type { KernelService } from '../kernels/kernel.service.js'
import type { AccessService } from '../security/access.service.js'
import type { ProjectService } from '../workspaces/project.service.js'
import type { SessionService } from './session.service.js'
import type { SessionStore } from './session.store.js'
import type { FastifyInstance, FastifyReply } from 'fastify'

import { HttpException } from '@nestjs/common'
import { z } from 'zod'

import {
  inputQueueCommandSchema,
  projectCommandSchema,
  projectCreateSchema,
  runtimeCapabilities,
  sessionOrganizeSchema,
  sessionProjectSchema,
  sessionRenameSchema,
  sessionSubmitSchema,
  workspaceOpenSchema,
} from '@pi-workbench/shared'

function failure(reply: FastifyReply, error: unknown) {
  if (error instanceof HttpException) {
    const value = error.getResponse()
    return reply
      .code(error.getStatus())
      .send(typeof value === 'string' ? { message: value } : value)
  }
  throw error
}

/** Narrow desktop mutations under the existing Host/Origin/JSON/CSRF gate. Browser
 * pairing grants observation, never this development fixture or provider transport.
 */
export function registerSessionCommands(
  server: FastifyInstance,
  service: SessionService,
  store: SessionStore,
  projects: ProjectService,
  kernels: KernelService,
  access: AccessService,
  events: EventService,
): void {
  server.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/chat/')) {
      return
    }
    if (access.authenticate(request.headers.cookie)?.info.kind !== 'desktop') {
      await reply.code(403).send({ message: '会话发送目前仅向 Electron 开放。' })
    } else if (
      request.method === 'POST' &&
      (request.headers['x-piw-protocol'] !== '1' ||
        request.headers['x-piw-capabilities'] !== runtimeCapabilities.join(','))
    ) {
      await reply.code(409).send({ message: '客户端协议或能力不兼容，请更新后重新同步。' })
    }
  })
  server.get('/api/chat/options', () => service.options())
  server.get<{ Params: { sessionId: string } }>(
    '/api/chat/sessions/:sessionId/queue',
    (request, reply) => {
      try {
        return service.inputQueue(request.params.sessionId)
      } catch (error) {
        return failure(reply, error)
      }
    },
  )
  server.post<{ Params: { sessionId: string } }>(
    '/api/chat/sessions/:sessionId/queue',
    async (request, reply) => {
      const parsed = inputQueueCommandSchema.safeParse(request.body)
      if (!z.uuid().safeParse(request.params.sessionId).success || !parsed.success) {
        return reply.code(400).send({ message: '队列输入、操作或版本无效。' })
      }
      try {
        return await service.inputCommand(request.params.sessionId, parsed.data)
      } catch (error) {
        return failure(reply, error)
      }
    },
  )
  server.get('/api/chat/sessions', () => ({ sessions: store.managedSessions() }))
  server.get<{ Params: { sessionId: string } }>(
    '/api/chat/sessions/:sessionId/space',
    async (request, reply) => {
      if (!z.uuid().safeParse(request.params.sessionId).success) {
        return reply.code(400).send({ message: '会话身份无效。' })
      }
      try {
        return await service.space(request.params.sessionId)
      } catch (error) {
        return failure(reply, error)
      }
    },
  )
  server.post<{ Params: { sessionId: string } }>(
    '/api/chat/sessions/:sessionId/project',
    (request, reply) => {
      const parsed = sessionProjectSchema.safeParse(request.body)
      if (!z.uuid().safeParse(request.params.sessionId).success || !parsed.success) {
        return reply.code(400).send({ message: '会话归属或版本无效。' })
      }
      try {
        return service.setProject(request.params.sessionId, parsed.data)
      } catch (error) {
        return failure(reply, error)
      }
    },
  )
  server.post<{ Params: { sessionId: string } }>(
    '/api/chat/sessions/:sessionId/title',
    (request, reply) => {
      const parsed = sessionRenameSchema.safeParse(request.body)
      if (!z.uuid().safeParse(request.params.sessionId).success || !parsed.success) {
        return reply
          .code(400)
          .send({ message: '标题须为去首尾空白后的 1–80 个 Unicode 字符，且保存版本有效。' })
      }
      try {
        return service.rename(request.params.sessionId, parsed.data)
      } catch (error) {
        return failure(reply, error)
      }
    },
  )
  server.get('/api/chat/organization', () => ({ organizations: store.organizations() }))
  server.post<{ Params: { sessionId: string } }>(
    '/api/chat/sessions/:sessionId/organization',
    (request, reply) => {
      const parsed = sessionOrganizeSchema.safeParse(request.body)
      if (!z.uuid().safeParse(request.params.sessionId).success || !parsed.success) {
        return reply.code(400).send({ message: '会话整理操作或版本无效。' })
      }
      try {
        return service.organize(request.params.sessionId, parsed.data)
      } catch (error) {
        return failure(reply, error)
      }
    },
  )
  server.get('/api/chat/activity', () => ({
    sessions: service.activity().map((item) =>
      Object.assign({}, item, {
        approvals: Math.max(
          item.approvals,
          events.visibleSnapshot(item.id)?.turns.filter((turn) => turn.approval !== null).length ??
            0,
        ),
      }),
    ),
  }))
  server.get<{ Params: { requestId: string } }>(
    '/api/chat/submissions/:requestId',
    (request, reply) => {
      const result = store.receipt(request.params.requestId)
      return result ?? reply.code(404).send({ message: '这个创建请求尚无已保存结果。' })
    },
  )
  server.get<{ Params: { sessionId: string } }>(
    '/api/chat/sessions/:sessionId/submissions',
    (request, reply) => {
      if (!store.managedSessions().some((item) => item.id === request.params.sessionId)) {
        return reply.code(404).send({ message: '会话不存在。' })
      }
      return { submissions: store.submissions(request.params.sessionId).slice(-100) }
    },
  )
  server.post('/api/chat/submit', async (request, reply) => {
    const parsed = sessionSubmitSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: '任务或配置无效；正文不能为空，最多 16000 字符。' })
    }
    try {
      return await reply.code(202).send(await service.submit(parsed.data))
    } catch (error) {
      return failure(reply, error)
    }
  })
  server.post('/api/chat/projects/resolve-directory', async (request, reply) => {
    const parsed = workspaceOpenSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: '默认目录须为有效的绝对路径。' })
    }
    return projects.resolveDirectory(parsed.data.path)
  })
  server.post('/api/chat/projects', async (request, reply) => {
    const parsed = projectCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: '项目名称或目录无效。' })
    }
    try {
      return await projects.create(parsed.data)
    } catch (error) {
      return failure(reply, error)
    }
  })
  server.get<{ Params: { requestId: string } }>(
    '/api/chat/projects/requests/:requestId',
    (request, reply) => {
      if (!z.uuid().safeParse(request.params.requestId).success) {
        return reply.code(400).send({ message: '项目请求身份无效。' })
      }
      try {
        return { project: projects.created(request.params.requestId) }
      } catch (error) {
        return failure(reply, error)
      }
    },
  )
  server.post<{ Params: { projectId: string } }>(
    '/api/chat/projects/:projectId',
    async (request, reply) => {
      const parsed = projectCommandSchema.safeParse(request.body)
      if (!z.uuid().safeParse(request.params.projectId).success || !parsed.success) {
        return reply.code(400).send({ message: '项目操作、名称或版本无效。' })
      }
      try {
        if (parsed.data.action === 'edit') {
          return await projects.edit(request.params.projectId, parsed.data)
        }
        return service.organizeProject(request.params.projectId, parsed.data)
      } catch (error) {
        return failure(reply, error)
      }
    },
  )
  server.post<{ Params: { sessionId: string } }>(
    '/api/chat/sessions/:sessionId/abort',
    async (request, reply) => {
      const parsed = z.strictObject({ requestId: z.uuid() }).safeParse(request.body)
      const submission = parsed.success ? store.submission(parsed.data.requestId) : undefined
      if (
        !submission ||
        submission.sessionId !== request.params.sessionId ||
        !['pending', 'executing'].includes(submission.status)
      ) {
        return reply.code(409).send({ message: '任务已结束或身份不匹配，请刷新状态。' })
      }
      try {
        service.pauseInput(submission.sessionId)
        await kernels.abort(submission.sessionId, submission.turnId)
        return { stopping: true }
      } catch {
        return reply.code(409).send({ message: '停止结果待确认，请刷新当前任务；不会重发。' })
      }
    },
  )
}
