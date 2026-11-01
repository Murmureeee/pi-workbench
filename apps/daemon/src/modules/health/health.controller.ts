import process from 'node:process'
// @env node
import { Controller, Get } from '@nestjs/common'

import { healthSchema } from '@pi-workbench/shared'

@Controller('api/health')
export class HealthController {
  @Get()
  getHealth(): ReturnType<typeof healthSchema.parse> {
    return healthSchema.parse({
      status: 'ok',
      kernel: 'fake',
      protocolVersion: 1,
      node: process.version,
      storage: 'sqlite',
      realProviderEnabled: false,
    })
  }
}
