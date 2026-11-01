import { randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/** One daemon owns a data root. A dead process lease may be replaced; malformed/live leases
 * fail closed. Never unlinks another owner's token, including after a failed database open.
 */
export function acquireDataLease(dataDir: string): () => void {
  const path = join(dataDir, 'daemon.lock')
  const token = randomUUID()
  try {
    const record: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (
      typeof record !== 'object' ||
      record === null ||
      !('pid' in record) ||
      !Number.isSafeInteger(record.pid) ||
      typeof record.pid !== 'number' ||
      record.pid <= 0
    ) {
      throw new Error('Invalid daemon.lock; preserve and inspect the original file')
    }
    let dead = false
    try {
      process.kill(record.pid, 0)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
        dead = true
      } else {
        throw error
      }
    }
    if (!dead) {
      throw new Error('Data directory already owned by a running daemon')
    }
    unlinkSync(path)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
  const content = JSON.stringify({ pid: process.pid, token })
  writeFileSync(path, content, { flag: 'wx', mode: 0o600 })
  return () => {
    if (readFileSync(path, 'utf8') === content) {
      unlinkSync(path)
    }
  }
}
