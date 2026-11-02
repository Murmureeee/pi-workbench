import { z } from 'zod'

export const pairingTicketSchema = z.strictObject({
  code: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.number().int().positive(),
})
export const pairRequestSchema = z.strictObject({
  code: pairingTicketSchema.shape.code,
  label: z.string().trim().min(1).max(64),
})
const clientInfoSchema = z.strictObject({
  id: z.uuid(),
  label: z.string().max(64),
  kind: z.enum(['browser', 'desktop']),
  createdAt: z.number(),
  expiresAt: z.number(),
})
export const accessSnapshotSchema = z.strictObject({
  version: z.literal(1),
  authenticated: z.boolean(),
  client: clientInfoSchema.nullable(),
  csrf: z.string().nullable(),
  restartPolicy: z.literal('re-pair'),
})
export const clientListSchema = z.strictObject({ clients: z.array(clientInfoSchema) })
export const revokeClientSchema = z.strictObject({ id: z.uuid() })
export const hostAccessRequestSchema = z.strictObject({
  type: z.literal('host-access'),
  id: z.uuid(),
  operation: z.enum(['desktop', 'browser']),
})
export const hostAccessResultSchema = z.strictObject({
  type: z.literal('host-access-result'),
  id: z.uuid(),
  apiOrigin: z.string().regex(/^http:\/\/127\.0\.0\.1:\d{1,5}$/),
  ticket: pairingTicketSchema,
})
export type ClientInfo = z.infer<typeof clientInfoSchema>
