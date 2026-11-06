import type { CreateModelRuntimeOptions } from '@earendil-works/pi-coding-agent'

import { getApiProvider, getSupportedThinkingLevels } from '@earendil-works/pi-ai/compat'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { ModelRuntime, VERSION } from '@earendil-works/pi-coding-agent'

/** The discovery runtime has no credential access or persistence. Do not replace this with
 * AuthStorage, getAvailable/checkAuth, refresh, or a request-time auth resolver: those paths
 * can resolve commands, refresh OAuth, restore/write caches or contact a provider.
 */
const noCredentials: NonNullable<CreateModelRuntimeOptions['credentials']> = {
  read: () => Promise.resolve(undefined),
  list: () => Promise.resolve([]),
  modify: () => Promise.reject(new Error('Model discovery cannot modify credentials')),
  delete: () => Promise.reject(new Error('Model discovery cannot delete credentials')),
}

// An explicit store prevents the SDK from even constructing its default disk-backed cache
// when modelsPath is supplied. Discovery never restores or persists dynamic model catalogs.
const noModelCache: NonNullable<CreateModelRuntimeOptions['modelsStore']> = {
  read: () => Promise.resolve(undefined),
  write: () => Promise.reject(new Error('Model discovery cannot persist a catalog')),
  delete: () => Promise.reject(new Error('Model discovery cannot delete a catalog')),
}

/** Read only the installed SDK's static catalog and explicit models.json overlay. The caller
 * bounds/checks that path. No agent session/resource loader is created; no availability or
 * network refresh runs, and no disk-backed models store is used. Returned fields are allowlisted;
 * endpoints, headers, credentials, raw config and SDK errors never leave this boundary.
 */
export async function discoverModelCatalog(modelsPath?: string) {
  const builtinIds = new Set(builtinProviders().map((provider) => provider.id))
  const runtime = await ModelRuntime.create({
    credentials: noCredentials,
    modelsPath: modelsPath ?? null,
    modelsStore: noModelCache,
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  return {
    sdkVersion: VERSION,
    invalid: Boolean(runtime.getError()),
    providers: runtime.getProviders().map((provider) => ({
      id: provider.id,
      builtin: builtinIds.has(provider.id),
      name: provider.name,
      models: runtime.getAllModels(provider.id).map((model) => ({
        id: model.id,
        name: model.name,
        type: model.type ?? 'chat',
        api: model.api,
        input: [...model.input],
        reasoning: 'reasoning' in model && model.reasoning,
        thinkingLevels:
          (model.type ?? 'chat') === 'chat' && 'reasoning' in model
            ? getSupportedThinkingLevels(model)
            : ['off' as const],
        contextWindow: 'contextWindow' in model ? model.contextWindow : null,
        maxTokens: 'maxTokens' in model ? model.maxTokens : null,
        endpointValid: validEndpoint(model.baseUrl),
        sdkSupported:
          (model.type ?? 'chat') === 'chat'
            ? Boolean(getApiProvider(model.api))
            : model.type === 'image'
              ? typeof provider.generateImages === 'function'
              : typeof provider.classify === 'function',
      })),
    })),
  }
}

function validEndpoint(value: string): boolean {
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
