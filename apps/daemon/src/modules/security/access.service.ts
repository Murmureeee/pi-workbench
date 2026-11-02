import type { ClientInfo, Redactor } from '@pi-workbench/shared'

import { createHash, randomBytes, randomUUID } from 'node:crypto'

interface Client {
  info: ClientInfo
  csrf: string
  close: Set<() => void>
}

/** Host-owned, ephemeral credentials. Only native host code can issue tickets; the HTTP
 * boundary can redeem them once. Maps retain hashes, never bearer credentials. Restart
 * discards every ticket/client. Revocation closes observers, never cancels agent work.
 */
export class AccessService {
  private readonly tickets = new Map<string, { expiresAt: number; kind: ClientInfo['kind'] }>()
  private readonly clients = new Map<string, Client>()
  private readonly timer: NodeJS.Timeout
  private failures = 0
  private failureWindow = 0
  readonly cookieName: string

  constructor(
    port: number,
    private readonly redactor: Redactor,
    private readonly now: () => number = Date.now,
  ) {
    this.cookieName = `piw_client_${port}`
    this.timer = setInterval(() => this.sweep(), 1000)
    this.timer.unref()
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }

  /** Out-of-band native/TTY operation. Ticket is 256 random bits, valid for 120 seconds;
   * issuance is bounded and never exposed as an unauthenticated HTTP action.
   */
  issueTicket(kind: ClientInfo['kind'] = 'browser') {
    this.sweep()
    if (this.tickets.size >= 4 || this.clients.size >= 32) {
      throw new Error('Client or pending pairing limit reached')
    }
    const code = randomBytes(32).toString('hex'),
      expiresAt = this.now() + 120000
    this.redactor.remember(code)
    this.tickets.set(this.hash(code), { expiresAt, kind })
    return { code, expiresAt }
  }

  /** Synchronous consume+issue prevents concurrent redemption. Failed/expired tickets
   * cannot create sessions; invalid attempts are limited to 10 per minute per daemon.
   */
  redeem(code: string, label: string): { cookie: string; client: Client } | undefined {
    this.sweep()
    if (this.now() - this.failureWindow >= 60000) {
      this.failureWindow = this.now()
      this.failures = 0
    }
    if (this.failures >= 10) {
      return undefined
    }
    const key = this.hash(code),
      ticket = this.tickets.get(key)
    if (!ticket || this.clients.size >= 32) {
      this.failures += 1
      return undefined
    }
    this.tickets.delete(key)
    const bearer = randomBytes(32).toString('hex')
    this.redactor.remember(bearer)
    const client: Client = {
      info: {
        id: randomUUID(),
        label,
        kind: ticket.kind,
        createdAt: this.now(),
        expiresAt: this.now() + 8 * 60 * 60 * 1000,
      },
      csrf: randomBytes(24).toString('hex'),
      close: new Set(),
    }
    this.clients.set(this.hash(bearer), client)
    return { cookie: `${this.cookieName}=${bearer}; Path=/api; HttpOnly; SameSite=Strict`, client }
  }

  authenticate(cookie: string | undefined): Client | undefined {
    this.sweep()
    const values = (cookie ?? '')
      .split(';')
      .map((item) => item.trim())
      .filter((item) => item.startsWith(`${this.cookieName}=`))
    if (values.length !== 1) {
      return undefined
    }
    const bearer = values[0]!.slice(this.cookieName.length + 1)
    return /^[0-9a-f]{64}$/.test(bearer) ? this.clients.get(this.hash(bearer)) : undefined
  }

  snapshot(cookie?: string) {
    const client = this.authenticate(cookie)
    return {
      version: 1 as const,
      authenticated: Boolean(client),
      client: client?.info ?? null,
      csrf: client?.csrf ?? null,
      restartPolicy: 're-pair' as const,
    }
  }

  list(): ClientInfo[] {
    this.sweep()
    return [...this.clients.values()].map((client) => Object.assign({}, client.info))
  }

  revoke(id: string): boolean {
    const entry = [...this.clients.entries()].find(([, client]) => client.info.id === id)
    if (!entry || entry[1].info.kind !== 'browser') {
      return false
    }
    this.remove(entry[0], entry[1])
    return true
  }

  /** The socket owns its removal callback; the service invokes it on expiry/revocation. */
  observe(cookie: string | undefined, close: () => void): (() => void) | undefined {
    const client = this.authenticate(cookie)
    if (!client) {
      return undefined
    }
    client.close.add(close)
    return () => client.close.delete(close)
  }

  private remove(key: string, client: Client): void {
    this.clients.delete(key)
    for (const close of client.close) {
      close()
    }
    client.close.clear()
  }

  private sweep(): void {
    for (const [key, ticket] of this.tickets) {
      if (ticket.expiresAt <= this.now()) {
        this.tickets.delete(key)
      }
    }
    for (const [key, client] of this.clients) {
      if (client.info.expiresAt <= this.now()) {
        this.remove(key, client)
      }
    }
  }

  close(): void {
    clearInterval(this.timer)
    this.tickets.clear()
    for (const [key, client] of this.clients) {
      this.remove(key, client)
    }
  }
}
