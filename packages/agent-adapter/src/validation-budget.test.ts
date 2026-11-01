import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { budgetSchema } from './budget-schema.js'
import { finishRequest, reserveRequest } from './validation-budget.js'

function readTemporaryBudget(file: string): BudgetFile {
  return budgetSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
}

const directories: string[] = []
function temporaryBudget(): string {
  const directory = mkdtempSync(join(tmpdir(), 'piw-budget-test-'))
  directories.push(directory)
  const file = join(directory, 'budget.json')
  copyFileSync(
    new URL('../../../docs/validation/live-validation-budget.json', import.meta.url),
    file,
  )
  return file
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('OPS-01 persistent development request guard (no provider)', () => {
  it('counts failed and aborted requests and survives reopening', async () => {
    const file = temporaryBudget()
    const first = await reserveRequest(file, 'M1', 'offline reservation test', 512)
    await finishRequest(file, first.requestId, 'failed')
    const second = await reserveRequest(file, 'M1', 'offline abort accounting', 64)
    await finishRequest(file, second.requestId, 'aborted')
    await expect(reserveRequest(file, 'M1', 'must not reset', 64)).rejects.toThrow('exhausted')
    expect(
      readTemporaryBudget(file)
        .milestones.find((m) => m.id === 'M1')
        ?.requests.map((r) => r.status),
    ).toEqual(['failed', 'aborted'])
  })
  it('rejects missing records, oversized output, closed and optional scopes', async () => {
    const file = temporaryBudget()
    await expect(reserveRequest(`${file}.missing`, 'M1', 'missing', 10)).rejects.toThrow('ENOENT')
    await expect(reserveRequest(file, 'M1', 'oversized', 513)).rejects.toThrow('1–512')
    await expect(reserveRequest(file, 'M0', 'closed milestone', 10)).rejects.toThrow('unavailable')
    await expect(reserveRequest(file, 'M8', 'unapproved scope', 10)).rejects.toThrow('unavailable')
    const data = readTemporaryBudget(file)
    data.limits.maxNewProviderRequestsPerMilestone = 3
    writeFileSync(file, JSON.stringify(data))
    await expect(reserveRequest(file, 'M1', 'tampered limit', 10)).rejects.toThrow('fail closed')
  })
  it('reserves atomically across independent processes before any transport', async () => {
    const file = temporaryBudget()
    const moduleUrl = new URL('../dist/validation-budget.js', import.meta.url).href
    const outcomes = await Promise.all(
      Array.from(
        { length: 5 },
        () =>
          new Promise<number | null>((resolve, reject) => {
            const code = `import {reserveRequest} from ${JSON.stringify(moduleUrl)};try{await reserveRequest(process.argv[1],'M2','offline concurrent test',64)}catch{process.exitCode=2}`
            const child = spawn(process.execPath, ['--input-type=module', '-e', code, file], {
              stdio: 'ignore',
              windowsHide: true,
            })
            child.once('error', reject)
            child.once('exit', resolve)
          }),
      ),
    )
    expect(outcomes.filter((code) => code === 0)).toHaveLength(2)
    expect(outcomes.filter((code) => code === 2)).toHaveLength(3)
    expect(readTemporaryBudget(file).milestones.find((m) => m.id === 'M2')?.requests).toHaveLength(
      2,
    )
  })
  it('fails closed when retry policy or reservation records are malformed', async () => {
    const file = temporaryBudget()
    const original = readTemporaryBudget(file)
    const { automaticRetry: _automaticRetry, ...limits } = original.limits
    writeFileSync(file, JSON.stringify({ ...original, limits }))
    await expect(reserveRequest(file, 'M1', 'missing policy', 64)).rejects.toThrow('fail closed')
    writeFileSync(
      file,
      JSON.stringify({
        ...original,
        milestones: [{ id: 'M1', requests: [{ requestId: 'unknown', status: 'made-up' }] }],
      }),
    )
    await expect(reserveRequest(file, 'M1', 'invalid record', 64)).rejects.toThrow('fail closed')
  })
})
import type { BudgetFile } from './types.js'
