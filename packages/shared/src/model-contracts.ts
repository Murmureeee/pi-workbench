import { z } from 'zod'

export const modelFileStateSchema = z.enum([
  'disabled',
  'ok',
  'missing',
  'invalid',
  'unreadable',
  'too-large',
])
const credentialSchema = z.strictObject({
  origin: z.enum(['none', 'auth.json', 'models.json']),
  kind: z.enum(['api_key', 'oauth', 'unknown']),
  status: z.enum(['configured', 'missing', 'expired', 'command-disabled', 'invalid', 'unchecked']),
})
const modelSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  type: z.enum(['chat', 'image', 'classifier']),
  api: z.string(),
  origin: z.enum(['pi-sdk', 'models.json']),
  input: z.array(z.string()),
  reasoning: z.boolean(),
  contextWindow: z.number().positive().nullable(),
  maxTokens: z.number().positive().nullable(),
  sdkSupported: z.boolean(),
  parameters: z.enum(['ok', 'missing', 'command-disabled', 'invalid']),
})

/** Discovery is a local catalog, never evidence of a successful request or account entitlement.
 * Transport remains closed even when credential metadata says configured.
 */
export const modelCatalogSchema = z.strictObject({
  version: z.literal(1),
  sdkVersion: z.string(),
  realProviderEnabled: z.literal(false),
  networkVerification: z.literal('not-performed'),
  sourceDirectory: z.string().nullable(),
  files: z.array(
    z.strictObject({
      name: z.enum(['auth.json', 'models.json', 'settings.json']),
      state: modelFileStateSchema,
    }),
  ),
  diagnostic: z.enum(['ok', 'disabled', 'config-error']),
  defaultModel: z
    .strictObject({ provider: z.string(), model: z.string(), found: z.boolean() })
    .nullable(),
  providers: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      origins: z.array(z.enum(['pi-sdk', 'models.json', 'auth.json'])),
      authentication: credentialSchema,
      issue: z.enum(['none', 'config-error', 'not-in-sdk', 'no-models']),
      models: z.array(modelSchema),
    }),
  ),
})
export type ModelCatalog = z.infer<typeof modelCatalogSchema>
export type ModelProvider = ModelCatalog['providers'][number]
