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
import { ChangeAvailabilityService } from '../modules/changes/change-availability.service.js'
import { ChangeDecisionService } from '../modules/changes/change-decision.service.js'
import { registerChangeDecisions } from '../modules/changes/change-decision.transport.js'
import { ChangeProvenanceService } from '../modules/changes/change-provenance.service.js'
import { ChangeReviewService } from '../modules/changes/change-review.service.js'
import { ChangeRollbackService } from '../modules/changes/change-rollback.service.js'
import { registerRollbackTransport } from '../modules/changes/change-rollback.transport.js'
import { ChangeService } from '../modules/changes/change.service.js'
import { registerChangeTransport } from '../modules/changes/change.transport.js'
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
import { AuditService } from '../modules/security/audit.service.js'
import { registerAuditTransport } from '../modules/security/audit.transport.js'
import { ExecutionPolicyService } from '../modules/security/execution-policy.service.js'
import { SecurityService } from '../modules/security/security.service.js'
import { SessionGrantService } from '../modules/security/session-grant.service.js'
import { TrustService } from '../modules/security/trust.service.js'
import { registerTrustTransport } from '../modules/security/trust.transport.js'
import { LegacyHistoryService } from '../modules/sessions/legacy-history.service.js'
import { registerSessionCommands } from '../modules/sessions/session-command.transport.js'
import { SessionService } from '../modules/sessions/session.service.js'
import { SessionStore } from '../modules/sessions/session.store.js'
import { registerSessionTransport } from '../modules/sessions/session.transport.js'
import { DirectoryWriteService } from '../modules/workspaces/directory-write.service.js'
import { GitStatusService } from '../modules/workspaces/git-status.service.js'
import { registerGitStatusTransport } from '../modules/workspaces/git-status.transport.js'
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
  let audit: AuditService
  try {
    audit = new AuditService(database, security.redactor)
    store = new SessionStore(database, options.dataDir, audit)
    for (const snapshot of store.observations(events.daemonId)) {
      events.restore(snapshot)
    }
    events.setPersistence((snapshot, immediate) => store.capture(snapshot, immediate))
  } catch (error) {
    database.close()
    throw error
  }
  const access = new AccessService(options.port, security.redactor, Date.now, audit)
  const trust = new TrustService(database, options.piAgentDir, audit)
  const workspaces = new WorkspaceService(database)
  const writes = new DirectoryWriteService(database, workspaces, security.redactor)
  let changes: ChangeService
  let provenance: ChangeProvenanceService
  let review: ChangeReviewService
  try {
    if (options.ledgerCapacityBytes !== undefined && !options.development) {
      throw new Error('Ledger capacity overrides require an isolated development host')
    }
    changes = new ChangeService(
      database,
      options.dataDir,
      writes,
      security.redactor,
      options.ledgerCapacityBytes,
    )
    provenance = new ChangeProvenanceService(database, changes, security.redactor)
    review = new ChangeReviewService(changes, provenance, security.redactor)
  } catch (error) {
    writes.close()
    access.close()
    events.close()
    store.close()
    throw error
  }
  const environment = new WorkspaceEnvironmentService(workspaces, store)
  const gitStatus = new GitStatusService(
    environment,
    workspaces,
    changes,
    provenance,
    security.redactor,
  )
  const changeAvailability = new ChangeAvailabilityService(
    changes,
    review,
    writes,
    security.redactor,
  )
  const availability = new WorkspaceAvailabilityService(workspaces, store, trust)
  const models = new ModelService(security)
  const legacy = new LegacyHistoryService(options.piAgentDir)
  const projects = new ProjectService(database, workspaces)
  const executionPolicy = new ExecutionPolicyService()
  const grants = new SessionGrantService(store, executionPolicy, security.redactor)
  const approvals = new ApprovalService(store, events, executionPolicy, security.redactor, grants)
  const rollback = new ChangeRollbackService(
    database,
    changes,
    review,
    writes,
    audit,
    security.redactor,
  )
  const decisions = new ChangeDecisionService(database, review, rollback, audit, security.redactor)
  const kernels = new KernelService(
    options.dataDir,
    events,
    store,
    writes,
    changes,
    resourceLimits,
    trust,
    executionPolicy,
    approvals,
    provenance,
    rollback,
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
      { provide: SessionGrantService, useValue: grants },
      { provide: AuditService, useValue: audit },
      { provide: WorkspaceService, useValue: workspaces },
      { provide: DirectoryWriteService, useValue: writes },
      { provide: ChangeService, useValue: changes },
      { provide: ChangeProvenanceService, useValue: provenance },
      { provide: ChangeReviewService, useValue: review },
      { provide: ChangeAvailabilityService, useValue: changeAvailability },
      { provide: ChangeRollbackService, useValue: rollback },
      { provide: ChangeDecisionService, useValue: decisions },
      { provide: WorkspaceEnvironmentService, useValue: environment },
      { provide: GitStatusService, useValue: gitStatus },
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
  registerAuditTransport(adapter.getInstance(), audit, access)
  registerChangeTransport(
    adapter.getInstance(),
    changes,
    store,
    access,
    provenance,
    review,
    changeAvailability,
  )
  registerRollbackTransport(adapter.getInstance(), rollback, access, store)
  registerChangeDecisions(adapter.getInstance(), decisions, access, store)
  registerTrustTransport(adapter.getInstance(), trust, access)
  registerGitStatusTransport(adapter.getInstance(), gitStatus, access)
  registerWorkspaceTransport(
    adapter.getInstance(),
    workspaces,
    access,
    environment,
    availability,
    writes,
    kernels,
    store,
  )
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
