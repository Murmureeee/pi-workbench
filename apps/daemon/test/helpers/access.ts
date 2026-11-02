import type { createApp } from '../../dist/bootstrap/app.js'

import { AccessService } from '../../dist/modules/security/access.service.js'

/** Existing CORE tests receive a host-issued ticket and redeem it through the real HTTP
 * handler. SEC-08 tests additionally exercise unpaired/invalid/revoked browser behavior.
 */
export async function authorizedHeaders(app: Awaited<ReturnType<typeof createApp>>, port: number) {
  const ticket = app.get(AccessService).issueTicket()
  const response = await app.inject({
    method: 'POST',
    url: '/api/access/pair',
    headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
    payload: { code: ticket.code, label: 'Contract fixture client' },
  })
  const setCookie = response.headers['set-cookie']
  if (response.statusCode !== 200 || typeof setCookie !== 'string') {
    throw new Error('Fixture pairing failed')
  }
  return { host: `127.0.0.1:${port}`, cookie: setCookie.split(';')[0] ?? '' }
}
