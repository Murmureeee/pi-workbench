import type { createApp } from '../../apps/daemon/dist/bootstrap/app.js'
import type { Page } from '@playwright/test'

import { AccessService } from '../../apps/daemon/dist/modules/security/access.service.js'

/** Host-authorized fixture identity; redemption uses the actual daemon transport. The dedicated
 * SEC-08 browser test uses the actual pairing form and native TCP instead of this setup helper.
 */
export async function authorizePage(
  page: Page,
  app: Awaited<ReturnType<typeof createApp>>,
  port = 4318,
) {
  const access = app.get(AccessService),
    ticket = access.issueTicket()
  const response = await app.inject({
    method: 'POST',
    url: '/api/access/pair',
    headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
    payload: { code: ticket.code, label: 'CORE browser fixture' },
  })
  const setCookie = response.headers['set-cookie']
  if (response.statusCode !== 200 || typeof setCookie !== 'string') {
    throw new Error('Fixture pairing failed')
  }
  const bearer = setCookie.match(/^piw_client_\d+=([0-9a-f]{64});/)?.[1]
  if (!bearer) {
    throw new Error('Fixture cookie is invalid')
  }
  await page.context().addCookies([
    {
      name: access.cookieName,
      value: bearer,
      domain: '127.0.0.1',
      path: '/api',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ])
}
