/// <reference types="@fastify/websocket" preserve="true" />
import type { DaemonOptions } from './types.js'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { FastifyReply } from 'fastify'

import { HttpException, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'

import { resourceLimitsSchema } from '@pi-workbench/shared'

import { WorkspaceDatabase } from '../infrastructure/database/database.js'
import { EventService } from '../modules/events/event.service.js'
import { registerEventTransport } from '../modules/events/event.transport.js'
import { HealthController } from '../modules/health/health.controller.js'
import { KernelController } from '../modules/kernels/kernel.controller.js'
import { KernelService } from '../modules/kernels/kernel.service.js'
import { LabController } from '../modules/lab/lab.controller.js'
import { AccessService } from '../modules/security/access.service.js'
import { registerAccessTransport } from '../modules/security/access.transport.js'
import { SecurityService } from '../modules/security/security.service.js'
import { TrustService } from '../modules/security/trust.service.js'
import { registerTrustTransport } from '../modules/security/trust.transport.js'
import { SessionStore } from '../modules/sessions/session.store.js'
import { registerSessionTransport } from '../modules/sessions/session.transport.js'
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
  @Module({
    imports: [HealthModule, LabModule],
    controllers: [KernelController],
    providers: [
      { provide: EventService, useValue: events },
      {
        provide: KernelService,
        useFactory: () => new KernelService(options.dataDir, events, store, resourceLimits, trust),
      },
      {
        provide: WorkspaceDatabase,
        useValue: database,
      },
      { provide: SessionStore, useValue: store },
      { provide: SecurityService, useValue: security },
      { provide: AccessService, useValue: access },
      { provide: TrustService, useValue: trust },
      { provide: WorkspaceService, useValue: workspaces },
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
  registerWorkspaceTransport(adapter.getInstance(), workspaces)
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
