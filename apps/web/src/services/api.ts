// @env browser
import type { Fixture, Health, Scene } from '@pi-workbench/shared'

import { fixtureSchema, healthSchema } from '@pi-workbench/shared'

/** Protocol validation failure; keep it distinct from unavailable HTTP transport. */
export class LocalContractError extends Error {
  constructor() {
    super('Local response does not match the client contract')
    this.name = 'LocalContractError'
  }
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) {
    throw new Error(`Local service returned ${response.status}`)
  }
  return response.json()
}
export async function getHealth(): Promise<Health> {
  const parsed = healthSchema.safeParse(await getJson('/api/health'))
  if (!parsed.success) {
    throw new LocalContractError()
  }
  return parsed.data
}
export async function getFixture(scene: Scene): Promise<Fixture> {
  const parsed = fixtureSchema.safeParse(await getJson(`/api/lab/scenes/${scene}`))
  if (!parsed.success) {
    throw new LocalContractError()
  }
  return parsed.data
}
