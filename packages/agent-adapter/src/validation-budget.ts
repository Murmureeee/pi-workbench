// @env node
import type { BudgetFile, RequestReservation } from './types.js'

import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { setTimeout } from 'node:timers/promises'

import { budgetSchema } from './budget-schema.js'

function readBudget(file: string): BudgetFile {
  const result = budgetSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!result.success) {
    throw new Error('Invalid validation budget: fail closed')
  }
  return result.data
}

async function mutate(file: string, update: (data: BudgetFile) => void): Promise<void> {
  const lock = `${file}.lock`
  let handle: number | undefined
  const deadline = Date.now() + 3000
  while (handle === undefined) {
    try {
      handle = openSync(lock, 'wx')
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'EEXIST') ||
        Date.now() >= deadline
      ) {
        throw error
      }
      await setTimeout(10)
    }
  }
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const data = readBudget(file)
    update(data)
    const output = openSync(temporary, 'wx')
    try {
      writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`)
      fsyncSync(output)
    } finally {
      closeSync(output)
    }
    renameSync(temporary, file)
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary)
    }
    closeSync(handle)
    unlinkSync(lock)
  }
}

export async function reserveRequest(
  file: string,
  milestone: string,
  purpose: string,
  outputLimit: number,
): Promise<RequestReservation> {
  if (!purpose.trim() || !Number.isInteger(outputLimit) || outputLimit < 1 || outputLimit > 512) {
    throw new Error('A purpose and an output limit of 1–512 tokens are required')
  }
  const request: RequestReservation = {
    requestId: randomUUID(),
    purpose,
    outputLimit,
    status: 'reserved',
    reservedAt: new Date().toISOString(),
  }
  await mutate(file, (data) => {
    const entry = data.milestones.find((m) => m.id === milestone)
    if (
      !entry ||
      entry.scopeAuthorization ||
      entry.requests.length >= data.limits.maxNewProviderRequestsPerMilestone
    ) {
      throw new Error('Validation budget unavailable or exhausted')
    }
    entry.requests.push(request)
  })
  return request
}

export async function finishRequest(
  file: string,
  requestId: string,
  status: Exclude<RequestReservation['status'], 'reserved'>,
): Promise<void> {
  await mutate(file, (data) => {
    const request = data.milestones
      .flatMap((m) => m.requests)
      .find((r) => r.requestId === requestId)
    if (!request || request.status !== 'reserved') {
      throw new Error('Unknown or already finished reservation')
    }
    request.status = status
  })
}
