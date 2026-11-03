import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { WorkspaceResult } from '@pi-workbench/shared'

import { createHash, randomUUID } from 'node:crypto'
import { open, opendir, realpath, stat, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, parse, resolve } from 'node:path'
import process from 'node:process'

import { eq } from 'drizzle-orm'

import { workspaceResultSchema } from '@pi-workbench/shared'

import { workspaces } from '../../infrastructure/database/schema.js'

type FailureCode = Extract<WorkspaceResult, { ok: false }>['code']
const diagnostics: Record<FailureCode, [string, string]> = {
  invalid_path: ['目录路径无效。', '请输入完整的本机绝对路径，或重新选择文件夹。'],
  not_found: ['目录不存在或已被移动。', '恢复原目录后重试，或选择其他目录；原记录与会话保留。'],
  not_directory: ['选择的路径不是文件夹。', '请选择文件夹，而不是文件。'],
  not_readable: [
    '当前 Windows 用户无法读取这个目录。',
    '检查目录的读取与列出权限后重试，或选择其他目录。',
  ],
  not_writable: [
    '当前用户无法在目录中写入并清理校验文件。',
    '检查写入 / 删除权限、只读状态与磁盘空间后重试，或选择其他目录。',
  ],
  directory_changed: [
    '这个路径现在指向另一个目录。',
    '请重新打开目录以确认新的目录身份；不会沿用旧目录的会话或授权。',
  ],
  unknown_workspace: ['工作区记录不存在或无法读取。', '请重新选择目录；不会创建空会话。'],
  storage_failed: [
    '工作区记录未能保存。',
    '检查应用数据目录和磁盘空间后重新打开；原工作区保持不变。',
  ],
  cleanup_failed: [
    '目录校验文件未能清理。',
    '检查目录中的 .pi-workbench-check- 文件及删除权限，处理后重试。',
  ],
  unavailable: ['目录暂时无法访问。', '检查磁盘、网络位置或链接目标后重试，也可以选择其他目录。'],
}
function failed(code: FailureCode): Extract<WorkspaceResult, { ok: false }> {
  const [message, recovery] = diagnostics[code]
  return { ok: false, code, message, recovery }
}
function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : ''
}
function classify(error: unknown, stage: 'resolve' | 'read' | 'write'): WorkspaceResult {
  const code = errorCode(error)
  if (code === 'ENOENT') {
    return failed('not_found')
  }
  if (code === 'ENOTDIR') {
    return failed('not_directory')
  }
  if (['EACCES', 'EPERM', 'EROFS'].includes(code)) {
    return failed(stage === 'write' ? 'not_writable' : 'not_readable')
  }
  if (stage === 'write' && ['ENOSPC', 'EDQUOT'].includes(code)) {
    return failed('not_writable')
  }
  return failed('unavailable')
}

/** Daemon-owned directory identity registry. Resolves links with realpath and uses the OS
 * device/inode identity, preserving distinct case-sensitive directories even on Windows.
 * Validation only lists one directory entry and creates/removes an exclusive 4-byte probe;
 * no project settings, instructions, scripts, SDK process or session are opened.
 */
export class WorkspaceService {
  constructor(private readonly database: WorkspaceDatabase) {}

  /** Display metadata only; callers must validate identity/access before execution. */
  lookup(id: string) {
    const row = this.database.db.select().from(workspaces).where(eq(workspaces.id, id)).get()
    return row ? { id: row.id, canonicalPath: row.canonicalPath, name: row.name } : undefined
  }

  /** Failed validation never changes the registry. No global active workspace is stored:
   * selection belongs to each client view and cannot interrupt another view's running task.
   */
  async open(path: string): Promise<WorkspaceResult> {
    return this.check(path)
  }

  /** Recheck identity as well as access before switching. A replacement at the old path must
   * be explicitly opened; old metadata is preserved and never rebound to another directory.
   */
  async validate(id: string): Promise<WorkspaceResult> {
    try {
      const row = this.database.db.select().from(workspaces).where(eq(workspaces.id, id)).get()
      return row
        ? await this.check(row.canonicalPath, row.directoryKey)
        : failed('unknown_workspace')
    } catch {
      return failed('storage_failed')
    }
  }

  private async check(path: string, expectedKey?: string): Promise<WorkspaceResult> {
    // Win32 device namespaces can address devices rather than ordinary directory paths.
    if (
      !path ||
      path.length > 4096 ||
      path.includes('\0') ||
      !isAbsolute(path) ||
      (process.platform === 'win32' && /^\\\\[?.]\\/.test(path))
    ) {
      return failed('invalid_path')
    }
    let stage: 'resolve' | 'read' | 'write' = 'resolve'
    let canonicalPath: string, directoryKey: string
    try {
      canonicalPath = await realpath(resolve(path))
      const before = await stat(canonicalPath, { bigint: true })
      if (!before.isDirectory()) {
        return failed('not_directory')
      }
      // A platform that cannot provide physical identity fails closed instead of guessing
      // by lowercasing paths (which would conflate Windows case-sensitive directories).
      if (before.ino === 0n) {
        return failed('unavailable')
      }
      directoryKey = createHash('sha256')
        .update(`${process.platform}:${before.dev}:${before.ino}:${before.birthtimeNs}`)
        .digest('hex')
      if (expectedKey && expectedKey !== directoryKey) {
        return failed('directory_changed')
      }
      stage = 'read'
      const directory = await opendir(canonicalPath)
      try {
        await directory.read()
      } finally {
        await directory.close()
      }
      stage = 'write'
      const probe = join(canonicalPath, `.pi-workbench-check-${randomUUID()}`)
      const handle = await open(probe, 'wx', 0o600)
      let writeFailure: unknown,
        cleanupFailure = false
      try {
        await handle.writeFile('piw\n')
      } catch (error) {
        writeFailure = error
      } finally {
        try {
          await handle.close()
        } catch {
          cleanupFailure = true
        }
        try {
          await unlink(probe)
        } catch {
          cleanupFailure = true
        }
      }
      if (cleanupFailure) {
        return failed('cleanup_failed')
      }
      if (writeFailure) {
        return classify(writeFailure, 'write')
      }
      stage = 'resolve'
      const after = await stat(canonicalPath, { bigint: true })
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.birthtimeNs !== after.birthtimeNs ||
        (await realpath(resolve(path))) !== canonicalPath
      ) {
        return failed('directory_changed')
      }
    } catch (error) {
      return classify(error, stage)
    }
    try {
      // Synchronous SQLite transaction follows async filesystem validation: concurrent opens
      // of aliases converge on one unique identity without an await inside the transaction.
      return this.database.db.transaction((tx) => {
        const existing = tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.directoryKey, directoryKey))
          .get()
        const workspace = {
          id: existing?.id ?? randomUUID(),
          canonicalPath,
          name: basename(canonicalPath) || parse(canonicalPath).root,
        }
        tx.insert(workspaces)
          .values({ ...workspace, directoryKey })
          .onConflictDoUpdate({
            target: workspaces.directoryKey,
            set: { canonicalPath, name: workspace.name },
          })
          .run()
        return workspaceResultSchema.parse({ ok: true, workspace, reused: Boolean(existing) })
      })
    } catch {
      return failed('storage_failed')
    }
  }
}
