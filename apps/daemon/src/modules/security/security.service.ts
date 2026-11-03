// @env node
import type { ModelCatalog, SecuritySnapshot } from '@pi-workbench/shared'

import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import stripJsonComments from 'strip-json-comments'

import { Redactor, securitySnapshotSchema } from '@pi-workbench/shared'

type Diagnostic = SecuritySnapshot['diagnostic']
type Provider = SecuritySnapshot['providers'][number]
type ConfigState = ModelCatalog['files'][number]['state']
type Parameters = ModelCatalog['providers'][number]['models'][number]['parameters']

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}

/** Atomic replacement must retain the source's access policy. POSIX mode bits are copied;
 * Windows copies the actual DACL using the built-in ACL cmdlets with fixed code and a minimal
 * environment. No credential contents enter arguments/stdout, no shell profile is loaded,
 * and failure prevents the rename. This does not claim encrypted native pi storage.
 */
function preserveAccess(source: string, target: string): void {
  if (process.platform !== 'win32') {
    chmodSync(target, statSync(source).mode & 0o777)
    return
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const result = spawnSync(
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$ErrorActionPreference = "Stop"; Get-Acl -LiteralPath $env:PIW_ACL_SOURCE | Set-Acl -LiteralPath $env:PIW_ACL_TARGET',
    ],
    {
      env: {
        SystemRoot: systemRoot,
        WINDIR: systemRoot,
        PIW_ACL_SOURCE: source,
        PIW_ACL_TARGET: target,
      },
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5000,
    },
  )
  if (result.error || result.status !== 0) {
    throw new Error('Native credential permissions could not be retained')
  }
}

/** Native pi remains the credential owner. Reads never create auth.json, invoke config commands,
 * refresh OAuth or contact a provider. Credential configuration is never copied to SQLite/IPC
 * or public results; user-authored sensitive session content remains owned by native history.
 * This service is host-only; paired configuration UI still awaits MODEL-02.
 */
export class SecurityService {
  readonly redactor = new Redactor()
  private diagnostic: Diagnostic = 'disabled'
  private providers: Provider[] = []

  constructor(
    private readonly agentDir?: string,
    private readonly env: Readonly<Record<string, string | undefined>> = process.env,
  ) {
    this.refresh()
  }

  private configuration(name: string): {
    state: ConfigState
    data: Record<string, unknown>
    digest: string
  } {
    if (!this.agentDir) {
      return { state: 'disabled', data: {}, digest: 'disabled' }
    }
    try {
      const path = join(this.agentDir, name)
      if (!existsSync(path)) {
        return { state: 'missing', data: {}, digest: 'missing' }
      }
      const stat = statSync(path)
      if (!stat.isFile()) {
        return { state: 'invalid', data: {}, digest: 'invalid' }
      }
      if (stat.size > 4 * 1024 * 1024) {
        return { state: 'too-large', data: {}, digest: 'too-large' }
      }
      const content = readFileSync(path)
      const digest = createHash('sha256').update(content).digest('hex')
      if (content.byteLength > 4 * 1024 * 1024) {
        return { state: 'too-large', data: {}, digest }
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(content).replace(/^\uFEFF/, '')
      let value: unknown
      try {
        value = JSON.parse(name === 'auth.json' ? text : stripJsonComments(text))
      } catch {
        return { state: 'invalid', data: {}, digest }
      }
      const data = object(value)
      return { state: data ? 'ok' : 'invalid', data: data ?? {}, digest }
    } catch {
      return { state: 'unreadable', data: {}, digest: 'unreadable' }
    }
  }

  private read(name: string): Record<string, unknown> {
    const result = this.configuration(name)
    if (!['ok', 'missing', 'disabled'].includes(result.state)) {
      throw new Error(result.state === 'unreadable' ? 'unreadable' : 'invalid')
    }
    return result.data
  }

  /** Static config-value resolution follows pi's $ENV / ${ENV}, $$ and $! semantics. Leading !
   * commands are deliberately refused. Only explicitly referenced environment names are read.
   */
  private config(value: unknown, variables?: Record<string, unknown>): Provider['status'] {
    if (typeof value !== 'string' || !value.trim()) {
      return 'missing'
    }
    if (value.startsWith('!')) {
      return 'command-disabled'
    }
    let missing = false
    const resolved = value.replace(
      /\$(\$|!|\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/g,
      (_match, name: string) => {
        if (name === '$' || name === '!') {
          return name
        }
        const key = name.startsWith('{') ? name.slice(1, -1) : name
        const local = variables?.[key]
        const found = typeof local === 'string' && local ? local : this.env[key]
        if (!found) {
          missing = true
        }
        return found ?? ''
      },
    )
    if (missing || !resolved.trim()) {
      return 'missing'
    }
    this.redactor.remember(resolved)
    return 'configured'
  }

  private scan(value: unknown): void {
    const record = object(value)
    if (!record) {
      if (Array.isArray(value)) {
        value.forEach((item: unknown) => this.scan(item))
      }
      return
    }
    for (const [name, item] of Object.entries(record)) {
      if (name === 'headers') {
        for (const header of Object.values(object(item) ?? {})) {
          this.config(header, object(record.env))
        }
      }
      if (
        /api[_-]?key|token|secret|password|authorization|cookie|^(?:key|access|refresh)$/i.test(
          name,
        )
      ) {
        if (
          record.type === 'oauth' &&
          (name === 'access' || name === 'refresh') &&
          typeof item === 'string'
        ) {
          this.redactor.remember(item)
        } else {
          this.config(item, object(record.env))
        }
      }
      this.scan(item)
    }
  }

  /** Refresh metadata and retain old registered secrets for late errors/history after rotation. */
  refresh(): SecuritySnapshot {
    this.providers = []
    this.diagnostic = this.agentDir ? 'ok' : 'disabled'
    if (this.agentDir) {
      try {
        const auth = this.read('auth.json')
        this.scan(auth)
        const models = this.read('models.json')
        this.scan(models)
        for (const [id, entry] of Object.entries(auth)) {
          const value = object(entry)
          let kind: Provider['kind'] = 'unknown',
            status: Provider['status'] = 'invalid'
          if (value?.type === 'api_key') {
            kind = 'api_key'
            status = this.config(value.key, object(value.env))
          } else if (value?.type === 'oauth') {
            kind = 'oauth'
            status =
              typeof value.expires === 'number' &&
              Number.isFinite(value.expires) &&
              typeof value.access === 'string' &&
              typeof value.refresh === 'string'
                ? value.expires <= Date.now()
                  ? 'expired'
                  : value.access
                    ? 'configured'
                    : 'missing'
                : 'invalid'
          }
          this.providers.push({ id: this.redactor.text(id), origin: 'auth.json', kind, status })
        }
        for (const [id, entry] of Object.entries(object(models.providers) ?? {})) {
          const value = object(entry)
          this.providers.push({
            id: this.redactor.text(id),
            origin: 'models.json',
            kind: 'api_key',
            status: this.config(value?.apiKey, object(value?.env)),
          })
        }
        if (!this.providers.length) {
          this.diagnostic = 'missing'
        }
      } catch (error) {
        this.diagnostic =
          error instanceof Error && error.message === 'invalid' ? 'invalid' : 'unreadable'
      }
    }
    return this.snapshot()
  }

  snapshot(): SecuritySnapshot {
    return securitySnapshotSchema.parse({
      version: 1,
      source: this.agentDir ? 'pi-native' : 'disabled',
      realProviderEnabled: false,
      browserWritesEnabled: false,
      storage: 'existing-pi-config',
      diagnostic: this.diagnostic,
      providers: this.providers,
    })
  }

  /** Host-only metadata projection for MODEL-01. Reads each source independently so broken
   * settings do not hide valid auth/catalog entries. Registers secrets before exposing any
   * labels. Digests only detect concurrent edits; neither digests nor raw configuration are
   * sent to the renderer, SQLite or SDK IPC. Ambient credentials are not resolved here.
   */
  modelSources() {
    const names = ['auth.json', 'models.json', 'settings.json'] as const
    const sources = names.map((name) => Object.assign({ name }, this.configuration(name)))
    const auth = sources[0]!,
      models = sources[1]!,
      settings = sources[2]!
    this.scan(auth.data)
    this.scan(models.data)
    const parameters = (value: unknown, variables?: Record<string, unknown>): Parameters => {
      const headers = object(value)
      const states = Object.values(headers ?? {}).map((entry) => this.config(entry, variables))
      return states.includes('command-disabled')
        ? 'command-disabled'
        : states.some((state) => state !== 'configured')
          ? 'missing'
          : 'ok'
    }
    const providers = Object.entries(object(models.data.providers) ?? {}).map(([id, entry]) => {
      const value = object(entry)
      const entries = Array.isArray(value?.models) ? value.models : []
      const overrides = object(value?.modelOverrides) ?? {}
      const variables = object(object(auth.data[id])?.env)
      const providerParameters = parameters(value?.headers, variables)
      const definitions = new Map(
        entries.flatMap((model: unknown) => {
          const definition = object(model)
          return typeof definition?.id === 'string' ? [[definition.id, definition] as const] : []
        }),
      )
      return {
        id,
        definedModels: entries.flatMap((model: unknown) => {
          const definition = object(model)
          return typeof definition?.id === 'string' ? [definition.id] : []
        }),
        overriddenModels: Object.keys(overrides),
        parameters: providerParameters,
        modelParameters: new Map(
          [...new Set([...definitions.keys(), ...Object.keys(overrides)])].map((modelId) => {
            // SDK resolves provider headers first, then merges chat overrides before definitions.
            // Only literal/env metadata is checked here; commands stay disabled at either layer.
            const headers = {
              ...object(object(overrides[modelId])?.headers),
              ...object(definitions.get(modelId)?.headers),
            }
            const state = parameters(headers, variables)
            const effective =
              state === 'command-disabled' || providerParameters === 'command-disabled'
                ? 'command-disabled'
                : providerParameters === 'ok'
                  ? state
                  : providerParameters
            return [modelId, effective] as const
          }),
        ),
        credential: this.config(value?.apiKey, object(value?.env)),
      }
    })
    // Build auth metadata independently of models.json parsing failures.
    const credentials = Object.entries(auth.data).map(([id, entry]) => {
      const value = object(entry)
      const kind: Provider['kind'] =
        value?.type === 'api_key' || value?.type === 'oauth' ? value.type : 'unknown'
      const status: Provider['status'] =
        kind === 'api_key'
          ? this.config(value?.key, object(value?.env))
          : kind === 'oauth' &&
              typeof value?.expires === 'number' &&
              Number.isFinite(value.expires) &&
              typeof value.access === 'string' &&
              typeof value.refresh === 'string'
            ? value.expires <= Date.now()
              ? 'expired'
              : value.access
                ? 'configured'
                : 'missing'
            : 'invalid'
      return { id, kind, status }
    })
    const provider = settings.data.defaultProvider,
      model = settings.data.defaultModel
    if (
      (provider !== undefined && typeof provider !== 'string') ||
      (model !== undefined && typeof model !== 'string')
    ) {
      settings.state = 'invalid'
    }
    return {
      directory: this.agentDir ?? null,
      modelsPath:
        this.agentDir && models.state === 'ok' ? join(this.agentDir, 'models.json') : undefined,
      files: sources.map(({ name, state }) => ({ name, state })),
      revision: sources.map(({ digest }) => digest).join(':'),
      providers,
      credentials,
      defaultModel:
        typeof provider === 'string' && typeof model === 'string' ? { provider, model } : null,
    }
  }

  /** Host-only optimistic revision; never contains credential values or leaves the host. */
  revision(): string {
    if (!this.agentDir) {
      throw new Error('Credential source is disabled')
    }
    const path = join(this.agentDir, 'auth.json')
    return createHash('sha256')
      .update(existsSync(path) ? readFileSync(path) : '')
      .digest('hex')
  }

  /** Explicit host command. Re-reads under the same auth.json.lock directory protocol used by pi.
   * Never steals an existing lock, overwrites corrupt config, changes OAuth type, or writes
   * models/settings. A sibling temp file is flushed then renamed; failures retain the old file.
   * No browser endpoint exposes this operation before MODEL-02 configuration is implemented.
   */
  saveApiKey(providerId: string, key: string, revision: string): { ok: boolean; code: Diagnostic } {
    this.redactor.remember(key)
    if (
      !this.agentDir ||
      !/^[\w.-]{1,128}$/.test(providerId) ||
      !key.trim() ||
      /[\r\n\0]/.test(key) ||
      key.length > 16384
    ) {
      return { ok: false, code: 'invalid' }
    }
    const path = join(this.agentDir, 'auth.json'),
      lock = `${path}.lock`
    const temporary = `${path}.${randomUUID()}.tmp`
    let acquired = false,
      fd: number | undefined
    try {
      // Existing pi configuration must already exist; this method cannot choose another source.
      mkdirSync(lock)
      acquired = true
      if (revision !== this.revision()) {
        this.diagnostic = 'conflict'
        return { ok: false, code: 'conflict' }
      }
      const auth = this.read('auth.json'),
        current = object(auth[providerId])
      if (!existsSync(path) || !lstatSync(path).isFile()) {
        throw new Error('Native credential source must be an existing regular file')
      }
      if (current && current.type !== 'api_key') {
        this.diagnostic = 'conflict'
        return { ok: false, code: 'conflict' }
      }
      const literal = key.replaceAll('$', () => '$$').replace(/^!/, '$!')
      const data = { ...auth, [providerId]: { ...current, type: 'api_key', key: literal } }
      fd = openSync(temporary, 'wx', 0o600)
      // Apply the source's ACL before the temporary file contains any credential bytes.
      preserveAccess(path, temporary)
      writeFileSync(fd, JSON.stringify(data, null, 2) + '\n', 'utf8')
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      if (revision !== this.revision()) {
        this.diagnostic = 'conflict'
        return { ok: false, code: 'conflict' }
      }
      renameSync(temporary, path)
      this.refresh()
      return { ok: true, code: 'ok' }
    } catch (error) {
      this.diagnostic =
        !acquired && existsSync(lock)
          ? 'locked'
          : error instanceof Error && error.message === 'invalid'
            ? 'invalid'
            : 'save-failed'
      return { ok: false, code: this.diagnostic }
    } finally {
      if (fd !== undefined) {
        closeSync(fd)
      }
      if (existsSync(temporary)) {
        unlinkSync(temporary)
      }
      if (acquired) {
        rmdirSync(lock)
      }
    }
  }

  /** All application diagnostics use the same policy; do not log raw request/config objects. */
  log(event: string, detail: unknown): void {
    console.error(JSON.stringify(this.redactor.value({ event, detail })))
  }

  /** Export a safe copy, preserving original files. Unknown binary/invalid UTF-8 is fail-closed. */
  export(content: Buffer): Buffer | undefined {
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content)
    } catch {
      return undefined
    }
    // Parse whole JSON first to cover nested fields and escaped values. Broken records still
    // pass through the same text policy, with escaped registered values registered as well.
    try {
      const value: unknown = JSON.parse(text)
      const safe = this.redactor.value(value)
      return JSON.stringify(safe) === JSON.stringify(value)
        ? content
        : Buffer.from(JSON.stringify(safe, null, 2), 'utf8')
    } catch {
      return Buffer.from(this.redactor.text(text), 'utf8')
    }
  }
}
