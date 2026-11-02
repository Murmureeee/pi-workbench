import { z } from 'zod'

const credentialStatusSchema = z.enum([
  'configured',
  'missing',
  'expired',
  'command-disabled',
  'invalid',
])
export const securitySnapshotSchema = z.strictObject({
  version: z.literal(1),
  source: z.enum(['disabled', 'pi-native']),
  realProviderEnabled: z.literal(false),
  browserWritesEnabled: z.literal(false),
  storage: z.literal('existing-pi-config'),
  diagnostic: z.enum([
    'disabled',
    'ok',
    'missing',
    'invalid',
    'unreadable',
    'save-failed',
    'conflict',
    'locked',
  ]),
  providers: z.array(
    z.strictObject({
      id: z.string(),
      origin: z.enum(['auth.json', 'models.json']),
      kind: z.enum(['api_key', 'oauth', 'unknown']),
      status: credentialStatusSchema,
    }),
  ),
})
export type SecuritySnapshot = z.infer<typeof securitySnapshotSchema>
