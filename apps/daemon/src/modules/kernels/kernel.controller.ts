import { Controller, Get, Inject } from '@nestjs/common'

import { KernelService } from './kernel.service.js'

/** Read-only diagnostics. Mutating client commands await CORE-05 / browser pairing. */
@Controller('api/kernels')
export class KernelController {
  constructor(@Inject(KernelService) private readonly kernels: KernelService) {}

  @Get()
  list() {
    return {
      source: 'real-sdk/local-fixture',
      realProviderEnabled: false,
      kernels: this.kernels.list(),
    }
  }
}
