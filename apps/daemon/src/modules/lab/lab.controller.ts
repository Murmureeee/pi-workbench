import type { Fixture } from '@pi-workbench/shared'

import { BadRequestException, Controller, Get, Param } from '@nestjs/common'

import { fixtureFor } from '@pi-workbench/agent-adapter'
import { sceneSchema } from '@pi-workbench/shared'

@Controller('api/lab/scenes')
export class LabController {
  @Get(':name')
  getScene(@Param('name') name: string): Fixture {
    const parsed = sceneSchema.safeParse(name)
    if (!parsed.success) {
      throw new BadRequestException('Unknown offline scene')
    }
    return fixtureFor(parsed.data)
  }
}
