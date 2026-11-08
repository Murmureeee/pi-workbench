/* oxlint-disable no-await-in-loop -- Parent creation and compare-before-write are deliberately sequential. */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { observeFile } from './file-observation.js'

export const sameBytes = (a: Buffer | null, b: Buffer | null) =>
  a === null ? b === null : b !== null && a.equals(b)

/** Private file adapter. Caller owns the physical directory lease and validates the
 * ledger exclusions. Missing parents are inspected individually, never recursive mkdir.
 * A same-user process can still race the final OS syscall; this is not a filesystem sandbox. */
export class FileRestore {
  async read(cwd: string, path: string): Promise<Buffer | null> {
    const parts = path.split('/')
    for (let i = 0; i < parts.length; i++) {
      const parent = join(cwd, ...parts.slice(0, i))
      try {
        const stat = await lstat(parent)
        if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(parent)) !== parent) {
          throw new Error('回滚父目录身份变化。')
        }
      } catch (error) {
        if (i > 0 && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return null
        }
        throw error
      }
    }
    return (await observeFile(cwd, path)).bytes
  }

  /** Replace/delete only an exact expected byte image. Temp files are exclusive, fsynced
   * and removed on failure. Compensation calls this same guarded boundary in reverse. */
  async write(
    cwd: string,
    path: string,
    expected: Buffer | null,
    target: Buffer | null,
  ): Promise<void> {
    if (!sameBytes(await this.read(cwd, path), expected)) {
      throw new Error('目标在确认后发生变化，未覆盖。')
    }
    const full = join(cwd, ...path.split('/'))
    if (target === null) {
      if (expected !== null) {
        await unlink(full)
      }
      return
    }
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const parent = join(cwd, ...parts.slice(0, i))
      try {
        await mkdir(parent)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
          throw error
        }
      }
      await this.read(cwd, path)
    }
    const temporary = join(dirname(full), `.pi-workbench-rollback-${randomUUID()}`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      try {
        await handle.writeFile(target)
        await handle.sync()
      } finally {
        await handle.close()
      }
      if (!sameBytes(await this.read(cwd, path), expected)) {
        throw new Error('写入前目标发生变化，临时文件未替换现场。')
      }
      await rename(temporary, full)
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          throw error
        }
      })
    }
  }
}
