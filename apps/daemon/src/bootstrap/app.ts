/// <reference types="@fastify/websocket" preserve="true" />
import type { DaemonOptions } from './types.js'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'

import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'

import { WorkspaceDatabase } from '../infrastructure/database/database.js'
import { EventService } from '../modules/events/event.service.js'
import { registerEventTransport } from '../modules/events/event.transport.js'
import { HealthController } from '../modules/health/health.controller.js'
import { KernelController } from '../modules/kernels/kernel.controller.js'
import { KernelService } from '../modules/kernels/kernel.service.js'
import { LabController } from '../modules/lab/lab.controller.js'
import { SessionStore } from '../modules/sessions/session.store.js'
import { registerSessionTransport } from '../modules/sessions/session.transport.js'
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
  const events = new EventService()
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
  @Module({
    imports: [HealthModule, LabModule],
    controllers: [KernelController],
    providers: [
      { provide: EventService, useValue: events },
      {
        provide: KernelService,
        useFactory: () => new KernelService(options.dataDir, events, store),
      },
      {
        provide: WorkspaceDatabase,
        useValue: database,
      },
      { provide: SessionStore, useValue: store },
    ],
  })
  class AppModule {}
  const adapter = new FastifyAdapter({ bodyLimit: 65536, logger: false })
  adapter.getInstance().addHook('onRequest', async (request, reply) => {
    const expectedHost = `127.0.0.1:${options.port}`
    const origins = [
      `http://${expectedHost}`,
      ...(options.development ? ['http://127.0.0.1:5173'] : []),
    ]
    if (
      request.headers.host !== expectedHost ||
      (request.headers.origin && !origins.includes(request.headers.origin))
    ) {
      await reply.code(403).send({ message: 'Unexpected host or origin' })
    }
  })
  await registerEventTransport(adapter.getInstance(), events)
  registerSessionTransport(adapter.getInstance(), store)
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: false,
  })
  app.enableShutdownHooks()
  await app.init()
  await adapter.getInstance().ready()
  return app
}
