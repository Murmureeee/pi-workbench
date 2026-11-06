/// <reference types="@fastify/websocket" preserve="true" />
import type { DaemonOptions } from './types.js'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { FastifyReply } from 'fastify'

import { HttpException, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'

import {
  legacyReadSchema,
  resourceLimitsSchema,
  sessionSearchQuerySchema,
} from '@pi-workbench/shared'

import { WorkspaceDatabase } from '../infrastructure/database/database.js'
import { EventService } from '../modules/events/event.service.js'
import { registerEventTransport } from '../modules/events/event.transport.js'
import { HealthController } from '../modules/health/health.controller.js'
import { KernelController } from '../modules/kernels/kernel.controller.js'
import { KernelService } from '../modules/kernels/kernel.service.js'
import { LabController } from '../modules/lab/lab.controller.js'
import { ModelService } from '../modules/models/model.service.js'
import { SearchService } from '../modules/search/search.service.js'
import { AccessService } from '../modules/security/access.service.js'
import { registerAccessTransport } from '../modules/security/access.transport.js'
import { ApprovalService } from '../modules/security/approval.service.js'
import { ExecutionPolicyService } from '../modules/security/execution-policy.service.js'
import { SecurityService } from '../modules/security/security.service.js'
import { TrustService } from '../modules/security/trust.service.js'
import { registerTrustTransport } from '../modules/security/trust.transport.js'
import { LegacyHistoryService } from '../modules/sessions/legacy-history.service.js'
import { registerSessionCommands } from '../modules/sessions/session-command.transport.js'
import { SessionService } from '../modules/sessions/session.service.js'
import { SessionStore } from '../modules/sessions/session.store.js'
import { registerSessionTransport } from '../modules/sessions/session.transport.js'
import { ProjectService } from '../modules/workspaces/project.service.js'
import { WorkspaceAvailabilityService } from '../modules/workspaces/workspace-availability.service.js'
import { WorkspaceEnvironmentService } from '../modules/workspaces/workspace-environment.service.js'
import { WorkspaceService } from '../modules/workspaces/workspace.service.js'
import { registerWorkspaceTransport } from '../modules/workspaces/workspace.transport.js'
// @env node
import 'reflect-metadata'

@Module({
  controllers: [HealthController],
})
class HealthModule {}
@Module({
  controllers: [LabController],
})
class LabModule {}

export async function createApp(options: DaemonOptions): Promise<NestFastifyApplication> {
  const resourceLimits = resourceLimitsSchema.parse(options.resourceLimits ?? {})
  const security = new SecurityService(options.piAgentDir)
  const events = new EventService(1024, 2 * 1024 * 1024, security.redactor)
  const database = new WorkspaceDatabase(options.dataDir)
  let store: SessionStore
  try {
    store = new SessionStore(database, options.dataDir)
    for (const snapshot of store.observations(events.daemonId)) {
      events.restore(snapshot)
    }
    events.setPersistence((snapshot, immediate) => store.capture(snapshot, immediate))
  } catch (error) {
    database.close()
    throw error
  }
  const access = new AccessService(options.port, security.redactor)
  const trust = new TrustService(database, options.piAgentDir)
  const workspaces = new WorkspaceService(database)
  const environment = new WorkspaceEnvironmentService(workspaces, store)
  const availability = new WorkspaceAvailabilityService(workspaces, store, trust)
  const models = new ModelService(security)
  const legacy = new LegacyHistoryService(options.piAgentDir)
  const projects = new ProjectService(database, workspaces)
  const executionPolicy = new ExecutionPolicyService()
  const approvals = new ApprovalService(store, events, executionPolicy, security.redactor)
  const kernels = new KernelService(
    options.dataDir,
    events,
    store,
    resourceLimits,
    trust,
    executionPolicy,
    approvals,
  )
  const sessionService = new SessionService(
    options.dataDir,
    Boolean(options.development),
    store,
    kernels,
    workspaces,
    projects,
    models,
    security,
    events,
    trust,
  )
  const search = new SearchService(database, store, sessionService, projects, security)
  @Module({
    imports: [HealthModule, LabModule],
    controllers: [KernelController],
    providers: [
      { provide: EventService, useValue: events },
      {
        provide: KernelService,
        useValue: kernels,
      },
      {
        provide: WorkspaceDatabase,
        useValue: database,
      },
      { provide: SessionStore, useValue: store },
      { provide: SecurityService, useValue: security },
      { provide: AccessService, useValue: access },
      { provide: TrustService, useValue: trust },
      { provide: ExecutionPolicyService, useValue: executionPolicy },
      { provide: ApprovalService, useValue: approvals },
      { provide: WorkspaceService, useValue: workspaces },
      { provide: WorkspaceEnvironmentService, useValue: environment },
      { provide: WorkspaceAvailabilityService, useValue: availability },
      { provide: ModelService, useValue: models },
      { provide: ProjectService, useValue: projects },
      { provide: SessionService, useValue: sessionService },
      { provide: LegacyHistoryService, useValue: legacy },
      { provide: SearchService, useValue: search },
    ],
  })
  class AppModule {}
  const adapter = new FastifyAdapter({ bodyLimit: 65536, logger: false })
  adapter.getInstance().addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store')
    reply.header('x-content-type-options', 'nosniff')
    if (Buffer.isBuffer(payload)) {
      const safe = security.export(payload)
      if (!safe) {
        reply.code(422).type('application/json')
        reply.removeHeader('content-disposition')
        return JSON.stringify({ message: '无法安全解析导出内容，原件保留，请在本机检查。' })
      }
      if (!safe.equals(payload)) {
        reply.header('content-disposition', 'attachment; filename="piw-redacted-record.txt"')
        reply.header('x-piw-redacted', 'true')
      }
      return safe
    }
    if (typeof payload === 'string') {
      if (String(reply.getHeader('content-type')).includes('application/json')) {
        const value: unknown = JSON.parse(payload)
        return JSON.stringify(security.redactor.value(value))
      }
      return security.redactor.text(payload)
    }
    return payload
  })
  adapter.getInstance().addHook('onRequest', async () => {
    security.refresh()
  })
  registerAccessTransport(adapter.getInstance(), access, options.port, Boolean(options.development))
  registerTrustTransport(adapter.getInstance(), trust, access)
  registerWorkspaceTransport(adapter.getInstance(), workspaces, access, environment, availability)
  adapter.getInstance().addHook('preHandler', async (request, reply) => {
    if (
      request.url.startsWith('/api/legacy-history') &&
      access.authenticate(request.headers.cookie)?.info.kind !== 'desktop'
    ) {
      await reply.code(403).send({ message: '旧 pi 历史发现目前仅向 Electron 开放。' })
    }
  })
  adapter.getInstance().get('/api/legacy-history', () => legacy.discover())
  adapter
    .getInstance()
    .get<{ Params: { id: string; messageId: string } }>(
      '/api/legacy-history/:id/messages/:messageId',
      (request, reply) => {
        const query = legacyReadSchema.safeParse(request.query)
        if (!query.success || !query.data.version || query.data.cursor) {
          return reply.code(400).send({ message: '读取全文需要原历史版本。' })
        }
        const content = legacy.content(
          request.params.id,
          request.params.messageId,
          query.data.version,
        )
        return reply
          .type('text/plain; charset=utf-8')
          .send(security.redactor.text(content.text, content.incomplete))
      },
    )
  adapter
    .getInstance()
    .get<{ Params: { id: string } }>('/api/legacy-history/:id', (request, reply) => {
      const query = legacyReadSchema.safeParse(request.query)
      if (!query.success) {
        return reply.code(400).send({ message: '历史读取参数无效。' })
      }
      const page = legacy.read(request.params.id, query.data.version, query.data.cursor)
      return {
        ...page,
        messages: page.messages.map((message) =>
          Object.assign({}, message, {
            text: security.redactor.text(message.text, message.truncated || message.incomplete),
          }),
        ),
      }
    })
  adapter.getInstance().get('/api/models', (request, reply) => {
    if (access.authenticate(request.headers.cookie)?.info.kind !== 'desktop') {
      return reply
        .code(403)
        .send({ message: 'Model discovery is currently available in Electron only' })
    }
    return models.discover()
  })
  adapter
    .getInstance()
    .get('/api/security/credentials', (_request, reply) =>
      reply.header('cache-control', 'no-store').send(security.snapshot()),
    )
  adapter.getInstance().addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/security/') && !['GET', 'HEAD'].includes(request.method)) {
      await reply.code(403).send({ message: 'Credential configuration writes await MODEL-02' })
    }
  })
  await registerEventTransport(adapter.getInstance(), events, access)
  registerSessionTransport(adapter.getInstance(), store, security)
  registerSessionCommands(
    adapter.getInstance(),
    sessionService,
    store,
    projects,
    kernels,
    access,
    events,
    approvals,
  )
  adapter.getInstance().get('/api/chat/search', (request, reply) => {
    const query = sessionSearchQuerySchema.safeParse(request.query)
    if (!query.success) {
      return reply
        .code(400)
        .send({ message: '搜索条件无效：最多 160 个 Unicode 字符，日期范围须有序，分页上限 50。' })
    }
    return search.search(query.data)
  })
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  })
  app.useGlobalFilters({
    catch(error: unknown, host) {
      const reply = host.switchToHttp().getResponse<FastifyReply>()
      if (error instanceof HttpException) {
        void reply.code(error.getStatus()).send(security.redactor.value(error.getResponse()))
      } else {
        security.log('http-failure', error)
        void reply
          .code(500)
          .send({ message: 'Local operation failed; inspect redacted host diagnostics' })
      }
    },
  })
  app.enableShutdownHooks()
  await app.init()
  await adapter.getInstance().ready()
  return app
}
