import type { SecurityService } from '../security/security.service.js'
import type { ModelCatalog, ModelProvider } from '@pi-workbench/shared'

import { discoverModelCatalog } from '@pi-workbench/agent-adapter'
import { modelCatalogSchema } from '@pi-workbench/shared'

/** Host-owned discovery only. Combines the SDK catalog with security-owned metadata, never
 * opens a session or enables transport. Concurrent source edits fail this read; the client
 * keeps its last snapshot marked stale until an explicit refresh succeeds.
 */
export class ModelService {
  constructor(private readonly security: SecurityService) {}

  async discover(): Promise<ModelCatalog> {
    const sources = this.security.modelSources()
    const catalog = await discoverModelCatalog(sources.modelsPath)
    if (this.security.modelSources().revision !== sources.revision) {
      throw new Error('Model configuration changed during discovery; refresh again')
    }
    const native = new Map(sources.providers.map((provider) => [provider.id, provider]))
    const credentials = new Map(
      sources.credentials.map((credential) => [credential.id, credential]),
    )
    const sdk = new Map(catalog.providers.map((provider) => [provider.id, provider]))
    const sourceError = sources.files.some(
      (file) => !['ok', 'missing', 'disabled'].includes(file.state),
    )
    const providers: ModelProvider[] = [
      ...new Set([...sdk.keys(), ...native.keys(), ...credentials.keys()]),
    ]
      .toSorted()
      .map((id) => {
        const provider = sdk.get(id),
          config = native.get(id),
          stored = credentials.get(id)
        const authentication: ModelProvider['authentication'] = stored
          ? { origin: 'auth.json', kind: stored.kind, status: stored.status }
          : config
            ? { origin: 'models.json', kind: 'api_key', status: config.credential }
            : { origin: 'none', kind: 'unknown', status: 'unchecked' }
        const models: ModelProvider['models'] = (provider?.models ?? []).map(
          ({ endpointValid, ...model }) =>
            Object.assign(model, {
              origin:
                config &&
                model.type === 'chat' &&
                !catalog.invalid &&
                (config.definedModels.includes(model.id) ||
                  config.overriddenModels.includes(model.id))
                  ? ('models.json' as const)
                  : ('pi-sdk' as const),
              parameters: !endpointValid
                ? 'invalid'
                : ((model.type === 'chat' ? config?.modelParameters.get(model.id) : undefined) ??
                  config?.parameters ??
                  'ok'),
            }),
        )
        return {
          id,
          name: provider?.name ?? id,
          origins: [
            ...(provider?.builtin ? ['pi-sdk' as const] : []),
            ...(config ? ['models.json' as const] : []),
            ...(stored ? ['auth.json' as const] : []),
          ],
          authentication,
          issue:
            catalog.invalid && config
              ? 'config-error'
              : !provider
                ? 'not-in-sdk'
                : !models.length
                  ? 'no-models'
                  : 'none',
          models,
        }
      })
    const selected = sources.defaultModel
    return modelCatalogSchema.parse(
      this.security.redactor.value({
        version: 1,
        sdkVersion: catalog.sdkVersion,
        realProviderEnabled: false,
        networkVerification: 'not-performed',
        sourceDirectory: sources.directory,
        diagnostic: !sources.directory
          ? 'disabled'
          : catalog.invalid || sourceError
            ? 'config-error'
            : 'ok',
        files: sources.files,
        defaultModel: selected
          ? {
              ...selected,
              found: providers.some(
                (provider) =>
                  provider.id === selected.provider &&
                  provider.models.some((model) => model.id === selected.model),
              ),
            }
          : null,
        providers,
      }),
    )
  }
}
