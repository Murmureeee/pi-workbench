import { z } from 'zod'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const path = z.string().min(1).max(4096)
export const trustResourceSchema = z.strictObject({
  id: digest,
  project: path,
  origin: z.enum(['project', 'user', 'third-party']),
  kind: z.enum([
    'context',
    'extension',
    'skill',
    'prompt',
    'theme',
    'script',
    'settings',
    'package',
  ]),
  path,
  source: z.string().max(8192),
  fingerprint: digest.nullable(),
  impact: z.string().max(2048),
  preview: z.string().max(16384),
  diagnostic: z.string().max(2048).nullable(),
  capability: z.enum(['context-only', 'disabled']),
  trust: z.enum(['untrusted', 'trusted', 'changed', 'revoked', 'blocked']),
})
export const trustRecordSchema = trustResourceSchema
  .omit({ preview: true, diagnostic: true, trust: true })
  .extend({
    recordId: z.uuid(),
    fingerprint: digest,
    grantedAt: z.number().int().nonnegative(),
    grantedBy: z.uuid(),
    revokedAt: z.number().int().nonnegative().nullable(),
  })
export const trustedContextSchema = z.strictObject({
  id: digest,
  path,
  fingerprint: digest,
  content: z.string().max(65536),
})
export const trustSnapshotSchema = z.strictObject({
  version: z.literal(1),
  project: path.nullable(),
  resources: z.array(trustResourceSchema).max(256),
  records: z.array(trustRecordSchema).max(5000),
  activeTurns: z.array(
    z.strictObject({
      sessionId: z.uuid(),
      turnId: z.uuid(),
      project: path,
      resources: z.array(z.strictObject({ id: digest, fingerprint: digest })).max(128),
    }),
  ),
  diagnostics: z.array(z.string()),
  persistence: z.literal('fingerprint-until-revoked'),
  revocation: z.literal('next-turn'),
  execution: z.literal('deny-all'),
})
export const trustInspectSchema = z.strictObject({ project: path })
export const trustGrantSchema = z.strictObject({
  project: path,
  id: digest,
  fingerprint: digest,
  confirmed: z.literal(true),
})
export const trustRevokeSchema = z.strictObject({ recordId: z.uuid() })
export type TrustResource = z.infer<typeof trustResourceSchema>
export type TrustRecord = z.infer<typeof trustRecordSchema>
export type TrustSnapshot = z.infer<typeof trustSnapshotSchema>
export type TrustedContext = z.infer<typeof trustedContextSchema>
