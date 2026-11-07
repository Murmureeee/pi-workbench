import type { KernelService } from '../kernels/kernel.service.js'
import type { AccessService } from '../security/access.service.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { DirectoryWriteService } from './directory-write.service.js'
import type { WorkspaceAvailabilityService } from './workspace-availability.service.js'
import type { WorkspaceEnvironmentService } from './workspace-environment.service.js'
import type { WorkspaceService } from './workspace.service.js'
import type { FastifyInstance } from 'fastify'

import { HttpException, NotFoundException } from '@nestjs/common'

import {
  directoryWriteStatusSchema,
  workspaceEditSchema,
  workspaceEnvironmentTargetSchema,
  workspaceOpenSchema,
  workspaceRelocateSchema,
  workspaceRenameSchema,
  workspaceValidateSchema,
} from '@pi-workbench/shared'

/** Both commands use the existing SEC-08 Host/Origin/JSON/CSRF client gate. Opening a
 * directory is metadata registration, never resource trust, session creation or execution.
 */
export function registerWorkspaceTransport(
  server: FastifyInstance,
  workspaces: WorkspaceService,
  access: AccessService,
  environment: WorkspaceEnvironmentService,
  availability: WorkspaceAvailabilityService,
  writes: DirectoryWriteService,
  kernels: KernelService,
  sessions: SessionStore,
) {
  const desktopPaths = new Set(
    [
      'recent',
      'activate',
      'rename',
      'remove',
      'relocate',
      'environment',
      'availability',
      'recover',
      'write-status',
    ].map((operation) => `/api/workspaces/${operation}`),
  )
  server.get('/api/workspaces/write-status', async (request, reply) => {
    const parsed = workspaceEnvironmentTargetSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: '目录观察身份无效。' })
    }
    const target = parsed.data
    const session = 'sessionId' in target ? sessions.executionEnvironment(target.sessionId) : null
    if ('sessionId' in target && !session) {
      return reply.code(404).send({ message: '会话不存在。' })
    }
    const workspace = workspaces.lookupRecord(
      session?.workspaceId ?? ('workspaceId' in target ? target.workspaceId : ''),
    )
    if (!workspace) {
      return reply.code(404).send({ message: '工作区记录不存在。' })
    }
    const cwd = session?.cwd ?? workspace.canonicalPath
    try {
      const checked = await workspaces.environmentDirectory(workspace.id, cwd)
      const available = checked.ok && cwd === workspace.canonicalPath
      let identity: ReturnType<DirectoryWriteService['identify']> | undefined
      if (checked.ok) {
        identity = { canonicalPath: checked.canonicalPath, directoryKey: checked.directoryKey }
      }
      return directoryWriteStatusSchema.parse({
        target,
        cwd,
        available,
        owner: identity
          ? writes.blocker(identity)
          : 'sessionId' in target
            ? writes.ownerForSession(target.sessionId)
            : null,
        queue: identity ? kernels.directoryQueue(identity) : [],
        latest: session ? writes.latest('sessionId' in target ? target.sessionId : '') : null,
      })
    } catch {
      return reply.code(503).send({ message: '目录占用与来源暂未同步；保留原任务，请稍后刷新。' })
    }
  })
  server.addHook('preHandler', async (request, reply) => {
    if (
      desktopPaths.has(request.url.split('?')[0]!) &&
      access.authenticate(request.headers.cookie)?.info.kind !== 'desktop'
    ) {
      await reply.code(403).send({ message: '最近工作区与整理目前仅向 Electron 开放。' })
    }
  })
  server.get('/api/workspaces/availability', async (request, reply) => {
    const target = workspaceEnvironmentTargetSchema.safeParse(request.query)
    if (!target.success) {
      return reply.code(400).send({ message: '请选择一个已登记工作区或会话。' })
    }
    try {
      return await availability.inspect(target.data)
    } catch (error) {
      if (error instanceof HttpException) {
        return reply.code(error.getStatus()).send(error.getResponse())
      }
      throw error
    }
  })
  server.post('/api/workspaces/recover', async (request, reply) => {
    const target = workspaceEnvironmentTargetSchema.safeParse(request.body)
    if (!target.success) {
      return reply.code(400).send({ message: '恢复仅接受已登记身份，不接受替换执行目录。' })
    }
    try {
      return await availability.inspect(target.data, true)
    } catch (error) {
      if (error instanceof HttpException) {
        return reply.code(error.getStatus()).send(error.getResponse())
      }
      throw error
    }
  })
  server.get('/api/workspaces/environment', async (request, reply) => {
    const parsed = workspaceEnvironmentTargetSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: '请指定一个会话或已登记工作区；不接受任意执行路径。' })
    }
    try {
      return await reply
        .header('cache-control', 'no-store')
        .send(await environment.inspect(parsed.data))
    } catch (error) {
      if (error instanceof NotFoundException) {
        return reply.code(404).send({ message: error.message })
      }
      throw error
    }
  })
  server.get('/api/workspaces/recent', (_request, reply) => {
    try {
      return reply.header('cache-control', 'no-store').send(workspaces.recent())
    } catch {
      return reply.code(503).send({ message: '最近列表读取失败，已有目录与会话保留。' })
    }
  })
  server.post('/api/workspaces/activate', async (request, reply) => {
    const parsed = workspaceValidateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        code: 'unknown_workspace',
        message: '工作区身份无效。',
        recovery: '请刷新列表后重新打开。',
      })
    }
    return workspaces.activate(parsed.data.id)
  })
  server.post('/api/workspaces/rename', (request, reply) => {
    const parsed = workspaceRenameSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        code: 'invalid_name',
        current: null,
        message: '名称或工作区版本无效。',
        recovery: '请输入 1–80 个 Unicode 字符并核对最新记录。',
      })
    }
    return workspaces.rename(parsed.data)
  })
  server.post('/api/workspaces/remove', (request, reply) => {
    const parsed = workspaceEditSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        code: 'unknown_workspace',
        current: null,
        message: '工作区身份或版本无效。',
        recovery: '请刷新列表后重试；目录和会话保留。',
      })
    }
    return workspaces.remove(parsed.data)
  })
  server.post('/api/workspaces/relocate', async (request, reply) => {
    const parsed = workspaceRelocateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        code: 'invalid_path',
        current: null,
        message: '路径或工作区版本无效。',
        recovery: '请输入完整绝对路径并核对最新记录。',
      })
    }
    return workspaces.relocate(parsed.data)
  })
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
