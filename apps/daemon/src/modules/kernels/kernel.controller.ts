import { Controller, Get, Header, Inject } from '@nestjs/common'

import { KernelService } from './kernel.service.js'

/** Read-only kernel/resource diagnostics. Client mutations await M2 commands and pairing. */
@Controller('api/kernels')
export class KernelController {
  constructor(@Inject(KernelService) private readonly kernels: KernelService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return {
      source: 'real-sdk/local-fixture',
      realProviderEnabled: false,
      kernels: this.kernels.list(),
    }
  }

  @Get('resources')
  @Header('Cache-Control', 'no-store')
  resources() {
    return this.kernels.resources()
  }
}
