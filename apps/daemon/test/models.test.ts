import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { modelCatalogSchema } from '@pi-workbench/shared'

import { createApp } from '../dist/bootstrap/app.js'
import { ModelService } from '../dist/modules/models/model.service.js'
import { AccessService } from '../dist/modules/security/access.service.js'
import { SecurityService } from '../dist/modules/security/security.service.js'
import { SessionStore } from '../dist/modules/sessions/session.store.js'

const directories: string[] = []
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'piw-models-'))
  directories.push(directory)
  const security = new SecurityService(directory, { PIW_TEST_MODEL_KEY: 'fixture-env-value' })
  return { directory, security, service: new ModelService(security) }
}
const custom = {
  api: 'openai-completions',
  baseUrl: 'https://fixture.invalid/v1',
  apiKey: 'fixture-secret-model-1973',
  models: [
    {
      id: 'local-code',
      name: 'Local Code',
      contextWindow: 64000,
      maxTokens: 1024,
      reasoning: true,
      input: ['text', 'image'],
    },
  ],
}
function write(directory: string, file: string, value: unknown) {
  writeFileSync(join(directory, file), JSON.stringify(value))
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MODEL-01 installed SDK catalog and host-owned configuration', () => {
  it('defaults to static SDK discovery without reading a user directory, authenticating or fetching', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed'))
    const snapshot = await new ModelService(new SecurityService()).discover()
    expect(snapshot).toMatchObject({
      sourceDirectory: null,
      diagnostic: 'disabled',
      realProviderEnabled: false,
      networkVerification: 'not-performed',
      sdkVersion: '1.4.0',
    })
    const openai = snapshot.providers.find((provider) => provider.id === 'openai')
    expect(openai?.models.length).toBeGreaterThan(0)
    expect(openai?.authentication).toMatchObject({ status: 'unchecked', origin: 'none' })
    expect(openai?.models.some((model) => model.type === 'chat' && model.sdkSupported)).toBe(true)
    expect(snapshot.files.every((file) => file.state === 'disabled')).toBe(true)
    expect(network).not.toHaveBeenCalled()
  })

  it('uses the SDK JSONC overlay, overrides and defaults while leaving every source byte and directory entry unchanged', async () => {
    const f = fixture()
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed'))
    writeFileSync(
      join(f.directory, 'models.json'),
      '// pi models configuration\n' +
        JSON.stringify({
          providers: {
            existing: custom,
            openai: {
              modelOverrides: { 'gpt-4o': { name: 'Overridden GPT', contextWindow: 12345 } },
            },
          },
        }),
    )
    write(f.directory, 'auth.json', { existing: { type: 'api_key', key: 'native-secret-5873' } })
    write(f.directory, 'settings.json', {
      defaultProvider: 'existing',
      defaultModel: 'local-code',
      extensions: ['must-not-load'],
    })
    writeFileSync(join(f.directory, 'models-store.json'), '{dynamic-cache-must-not-be-read')
    const names = readdirSync(f.directory),
      before = names.map((name) => readFileSync(join(f.directory, name)))
    const snapshot = await f.service.discover()
    expect(snapshot.diagnostic).toBe('ok')
    expect(snapshot.defaultModel).toEqual({
      provider: 'existing',
      model: 'local-code',
      found: true,
    })
    expect(snapshot.providers.find((provider) => provider.id === 'existing')).toMatchObject({
      origins: ['models.json', 'auth.json'],
      authentication: { origin: 'auth.json', status: 'configured' },
      models: [
        {
          id: 'local-code',
          origin: 'models.json',
          sdkSupported: true,
          contextWindow: 64000,
          maxTokens: 1024,
          reasoning: true,
          input: ['text', 'image'],
        },
      ],
    })
    expect(
      snapshot.providers
        .find((provider) => provider.id === 'openai')
        ?.models.find((model) => model.id === 'gpt-4o'),
    ).toMatchObject({ name: 'Overridden GPT', contextWindow: 12345, origin: 'models.json' })
    expect(JSON.stringify(snapshot)).not.toMatch(
      /fixture-secret-model|native-secret|fixture\.invalid|must-not-load/,
    )
    expect(readdirSync(f.directory)).toEqual(names)
    expect(names.map((name) => readFileSync(join(f.directory, name)))).toEqual(before)
    expect(network).not.toHaveBeenCalled()
  })

  it('diagnoses expired, missing, environment and command credentials without running commands or falling back over stored auth', async () => {
    const f = fixture(),
      marker = join(f.directory, 'must-not-execute')
    const command = `!node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')"`
    write(f.directory, 'auth.json', {
      command: { type: 'api_key', key: command },
      expired: { type: 'oauth', access: 'private-access', refresh: 'private-refresh', expires: 1 },
      missing: { type: 'api_key', key: '$PIW_MISSING_MODEL_ENV_1973' },
      environment: { type: 'api_key', key: '$PIW_TEST_MODEL_KEY' },
      unknown: { type: 'subscription-from-other-product' },
    })
    write(f.directory, 'models.json', {
      providers: {
        command: { ...custom, headers: { Authorization: command } },
        expired: custom,
        missing: custom,
        environment: custom,
      },
    })
    const result = await f.service.discover()
    const state = Object.fromEntries(
      result.providers
        .filter((provider) => provider.origins.includes('auth.json'))
        .map((provider) => [provider.id, provider.authentication.status]),
    )
    expect(state).toEqual({
      command: 'command-disabled',
      environment: 'configured',
      expired: 'expired',
      missing: 'missing',
      unknown: 'invalid',
    })
    expect(
      result.providers.find((provider) => provider.id === 'command')?.models[0]?.parameters,
    ).toBe('command-disabled')
    expect(result.providers.find((provider) => provider.id === 'unknown')?.issue).toBe('not-in-sdk')
    expect(existsSync(marker)).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(
      /private-access|private-refresh|fixture-env-value|writeFileSync/,
    )
  })

  it('keeps valid model metadata when auth is malformed and diagnoses missing defaults, unknown APIs and invalid endpoints', async () => {
    const f = fixture()
    writeFileSync(join(f.directory, 'auth.json'), '{broken')
    write(f.directory, 'models.json', {
      providers: { custom: { ...custom, api: 'api-not-installed', baseUrl: 'not a url' } },
    })
    write(f.directory, 'settings.json', { defaultProvider: 'removed', defaultModel: 'gone' })
    const result = await f.service.discover()
    expect(result.diagnostic).toBe('config-error')
    expect(result.files.find((file) => file.name === 'auth.json')?.state).toBe('invalid')
    expect(result.defaultModel?.found).toBe(false)
    expect(result.providers.find((provider) => provider.id === 'custom')?.models[0]).toMatchObject({
      id: 'local-code',
      sdkSupported: false,
      parameters: 'invalid',
    })
  })

  it('checks model override headers in SDK order and resolves only explicit stored environment references', async () => {
    const f = fixture()
    const command = '!must-not-run-model-header'
    write(f.directory, 'auth.json', {
      existing: { type: 'api_key', key: 'header-test-key', env: { MODEL_TENANT: 'local-tenant' } },
    })
    write(f.directory, 'models.json', {
      providers: {
        openai: { modelOverrides: { 'gpt-4o': { headers: { 'X-Model': command } } } },
        existing: {
          ...custom,
          headers: { 'X-Tenant': '$MODEL_TENANT' },
          modelOverrides: { 'local-code': { headers: { 'X-Model': command } } },
          models: [{ ...custom.models[0], headers: { 'X-Model': 'literal-value' } }],
        },
      },
    })
    const result = await f.service.discover()
    expect(
      result.providers
        .find((provider) => provider.id === 'openai')
        ?.models.find((model) => model.id === 'gpt-4o')?.parameters,
    ).toBe('command-disabled')
    expect(
      result.providers.find((provider) => provider.id === 'existing')?.models[0]?.parameters,
    ).toBe('ok')
    expect(JSON.stringify(result)).not.toMatch(
      /must-not-run|local-tenant|literal-value|header-test-key/,
    )
  })

  it('exposes SDK composition failures without returning raw error/config text or silently treating builtins as overrides', async () => {
    const f = fixture()
    write(f.directory, 'models.json', {
      providers: {
        broken: { apiKey: 'secret-composition', models: [{ id: 'secret-composition' }] },
        openai: { models: [{ id: 'gpt-4o', contextWindow: -1 }] },
      },
    })
    const result = await f.service.discover()
    expect(result.diagnostic).toBe('config-error')
    expect(result.providers.find((provider) => provider.id === 'broken')?.issue).toBe(
      'config-error',
    )
    expect(
      result.providers
        .find((provider) => provider.id === 'openai')
        ?.models.find((model) => model.id === 'gpt-4o')?.origin,
    ).toBe('pi-sdk')
    expect(JSON.stringify(result)).not.toContain('secret-composition')
  })

  it('refreshes changes/removal and bounds invalid, oversized and non-file sources without repairing them', async () => {
    const f = fixture()
    write(f.directory, 'models.json', { providers: { first: custom } })
    expect((await f.service.discover()).providers.some((provider) => provider.id === 'first')).toBe(
      true,
    )
    write(f.directory, 'models.json', { providers: { second: custom } })
    const changed = await f.service.discover()
    expect(changed.providers.some((provider) => provider.id === 'first')).toBe(false)
    expect(changed.providers.some((provider) => provider.id === 'second')).toBe(true)
    writeFileSync(join(f.directory, 'models.json'), ' '.repeat(4 * 1024 * 1024 + 1))
    mkdirSync(join(f.directory, 'auth.json'))
    const invalid = await f.service.discover()
    expect(invalid.files).toEqual([
      { name: 'auth.json', state: 'invalid' },
      { name: 'models.json', state: 'too-large' },
      { name: 'settings.json', state: 'missing' },
    ])
    expect(invalid.diagnostic).toBe('config-error')
  })

  it('rejects a concurrent configuration edit instead of returning mismatched source and catalog snapshots', async () => {
    const f = fixture()
    write(f.directory, 'models.json', { providers: { first: custom } })
    const result = f.service.discover()
    write(f.directory, 'models.json', { providers: { second: custom } })
    await expect(result).rejects.toThrow('changed during discovery')
  })

  it('requires a real desktop host identity, denies browser/writes, and never persists a session', async () => {
    const f = fixture()
    write(f.directory, 'models.json', { providers: { existing: custom } })
    const app = await createApp({
      dataDir: join(f.directory, 'data'),
      piAgentDir: f.directory,
      port: 4317,
    })
    const headers = { host: '127.0.0.1:4317' }
    try {
      expect((await app.inject({ url: '/api/models', headers })).statusCode).toBe(401)
      const access = app.get(AccessService)
      const browser = access.redeem(access.issueTicket('browser').code, 'Browser fixture')!
      expect(
        (
          await app.inject({
            url: '/api/models',
            headers: { ...headers, cookie: browser.cookie.split(';')[0] },
          })
        ).statusCode,
      ).toBe(403)
      const desktop = access.redeem(access.issueTicket('desktop').code, 'Desktop fixture')!
      const paired = { ...headers, cookie: desktop.cookie.split(';')[0] }
      const response = await app.inject({ url: '/api/models', headers: paired })
      expect(response.statusCode).toBe(200)
      expect(
        modelCatalogSchema
          .parse(response.json())
          .providers.some((provider) => provider.id === 'existing'),
      ).toBe(true)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/models',
            headers: {
              ...paired,
              origin: 'http://127.0.0.1:4317',
              'x-piw-csrf': desktop.client.csrf,
            },
            payload: {},
          })
        ).statusCode,
      ).toBe(404)
      expect(app.get(SessionStore).list()).toEqual([])
      expect(response.body).not.toContain(custom.apiKey)
    } finally {
      await app.close()
    }
  })
})
