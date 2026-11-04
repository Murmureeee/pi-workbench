import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type {
  WorkspaceEdit,
  WorkspaceMetadataResult,
  WorkspaceRecent,
  WorkspaceRecord,
  WorkspaceRelocate,
  WorkspaceRename,
  WorkspaceResult,
} from '@pi-workbench/shared'

import { createHash, randomUUID } from 'node:crypto'
import { open, opendir, realpath, stat, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, parse, resolve } from 'node:path'
import process from 'node:process'

import { asc, count, desc, eq, isNotNull, max } from 'drizzle-orm'

import {
  workspaceNameSchema,
  workspaceRecentSchema,
  workspaceRecordSchema,
  workspaceResultSchema,
} from '@pi-workbench/shared'

import { workspaces } from '../../infrastructure/database/schema.js'

type FailureCode = Extract<WorkspaceResult, { ok: false }>['code']
type Failure = Extract<WorkspaceResult, { ok: false }>
type WorkspaceRow = typeof workspaces.$inferSelect
type DirectoryInspection = { ok: true; canonicalPath: string; directoryKey: string } | Failure
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
  invalid_name: [
    '显示名称无效。',
    '请输入 1–80 个 Unicode 字符，不含控制字符；不会修改文件夹名称。',
  ],
  conflict: ['工作区记录已更新。', '编辑内容保留，请核对最新记录后明确继续；不会自动覆盖。'],
  relocation_required: [
    '同一目录已登记在其他路径。',
    '请在最近工作区中明确重新定位；既有会话仍保留原执行目录。',
  ],
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
function classify(error: unknown, stage: 'resolve' | 'read' | 'write'): Failure {
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
    const row = this.row(id)
    return row ? this.display(row) : undefined
  }

  /** Metadata for explicit recovery, including records hidden from recents. No IO or write. */
  lookupRecord(id: string): WorkspaceRecord | undefined {
    const row = this.row(id)
    return row ? this.record(row) : undefined
  }

  /** Read-only physical identity check for environment display. No probe, recency write,
   * trust or runtime is created. A saved session supplies its immutable original cwd. */
  async environmentDirectory(id: string, cwd?: string) {
    const row = this.row(id)
    if (!row) {
      return failed('unknown_workspace')
    }
    return this.inspect(cwd ?? row.canonicalPath, row.directoryKey, false)
  }

  /** Persisted recent metadata only: listing never probes directories or starts a task.
   * Removed and pre-upgrade records remain registered but have no recent timestamp. */
  recent(): WorkspaceRecent {
    const rows = this.database.db
      .select()
      .from(workspaces)
      .where(isNotNull(workspaces.lastOpenedAt))
      .orderBy(desc(workspaces.lastOpenedAt), asc(workspaces.id))
      .limit(100)
      .all()
    const total = this.database.db
      .select({ value: count() })
      .from(workspaces)
      .where(isNotNull(workspaces.lastOpenedAt))
      .get()!.value
    return workspaceRecentSchema.parse({
      entries: rows.map((row) => this.record(row)),
      total,
      limit: 100,
      order: 'last-opened-desc-id-asc',
    })
  }

  private row(id: string) {
    return this.database.db.select().from(workspaces).where(eq(workspaces.id, id)).get()
  }

  private display(row: WorkspaceRow) {
    return { id: row.id, canonicalPath: row.canonicalPath, name: row.customName ?? row.name }
  }

  private record(row: WorkspaceRow): WorkspaceRecord {
    return workspaceRecordSchema.parse({
      ...this.display(row),
      defaultName: row.name,
      customName: row.customName,
      lastOpenedAt: row.lastOpenedAt,
      revision: row.revision,
    })
  }

  private metadataFailure(code: FailureCode, row?: WorkspaceRow): WorkspaceMetadataResult {
    return { ...failed(code), current: row ? this.record(row) : null }
  }

  /** Failed validation never changes the registry; aliases retain custom names. Successful
   * explicit opens update recency, while internal standalone registration opts out with
   * remember:false. No global active selection is stored and no background task is changed.
   */
  async open(path: string, options: { remember?: boolean } = {}): Promise<WorkspaceResult> {
    const checked = await this.inspect(path)
    if (!checked.ok) {
      return checked
    }
    try {
      return this.database.db.transaction((tx) => {
        const existing = tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.directoryKey, checked.directoryKey))
          .get()
        if (existing && existing.canonicalPath !== checked.canonicalPath) {
          return failed('relocation_required')
        }
        const latest = tx
          .select({ value: max(workspaces.lastOpenedAt) })
          .from(workspaces)
          .get()
        const lastOpenedAt =
          options.remember === false
            ? (existing?.lastOpenedAt ?? null)
            : Math.max(Date.now(), (latest?.value ?? 0) + 1)
        const values = {
          id: existing?.id ?? randomUUID(),
          directoryKey: checked.directoryKey,
          canonicalPath: checked.canonicalPath,
          name:
            existing?.name ??
            (basename(checked.canonicalPath) || parse(checked.canonicalPath).root),
          lastOpenedAt,
        }
        if (!existing) {
          tx.insert(workspaces).values(values).run()
        } else if (options.remember !== false) {
          tx.update(workspaces)
            .set({ lastOpenedAt, revision: existing.revision + 1 })
            .where(eq(workspaces.id, existing.id))
            .run()
        }
        const row = tx.select().from(workspaces).where(eq(workspaces.id, values.id)).get()!
        return workspaceResultSchema.parse({
          ok: true,
          workspace: this.display(row),
          reused: Boolean(existing),
        })
      })
    } catch {
      return failed('storage_failed')
    }
  }

  /** Recheck identity as well as access before switching. A replacement at the old path must
   * be explicitly opened; old metadata is preserved and never rebound to another directory.
   */
  async validate(id: string): Promise<WorkspaceResult> {
    try {
      const row = this.row(id)
      if (!row) {
        return failed('unknown_workspace')
      }
      const checked = await this.inspect(row.canonicalPath, row.directoryKey)
      if (!checked.ok) {
        return checked
      }
      const current = this.row(id)
      if (
        !current ||
        current.canonicalPath !== row.canonicalPath ||
        current.directoryKey !== row.directoryKey
      ) {
        return failed('directory_changed')
      }
      return { ok: true, workspace: this.display(current), reused: true }
    } catch {
      return failed('storage_failed')
    }
  }

  /** Explicit UI switching updates recency after validation. Revision checking prevents
   * an in-flight check from reviving a record removed or relocated by another client. */
  async activate(id: string): Promise<WorkspaceResult> {
    try {
      const row = this.row(id)
      if (!row) {
        return failed('unknown_workspace')
      }
      const checked = await this.inspect(row.canonicalPath, row.directoryKey)
      if (!checked.ok) {
        return checked
      }
      return this.database.db.transaction((tx) => {
        const current = tx.select().from(workspaces).where(eq(workspaces.id, id)).get()
        if (!current || current.revision !== row.revision) {
          return failed('conflict')
        }
        const latest = tx
          .select({ value: max(workspaces.lastOpenedAt) })
          .from(workspaces)
          .get()
        tx.update(workspaces)
          .set({
            lastOpenedAt: Math.max(Date.now(), (latest?.value ?? 0) + 1),
            revision: current.revision + 1,
          })
          .where(eq(workspaces.id, id))
          .run()
        return { ok: true as const, workspace: this.display(current), reused: true }
      })
    } catch {
      return failed('storage_failed')
    }
  }

  /** CAS edits touch display metadata only. Null restores the directory-derived default;
   * rename never accesses the directory, changes recency, or updates project/session cwd. */
  rename(input: WorkspaceRename): WorkspaceMetadataResult {
    if (input.name !== null && !workspaceNameSchema.safeParse(input.name).success) {
      return this.metadataFailure('invalid_name')
    }
    return this.edit(input, { customName: input.name === null ? null : input.name.trim() })
  }

  /** Hides a recent entry, retaining its identity, custom name, directory and every reference.
   * Explicitly opening it again restores the same identity to the recent list. */
  remove(input: WorkspaceEdit): WorkspaceMetadataResult {
    return this.edit(input, { lastOpenedAt: null })
  }

  private edit(
    input: WorkspaceEdit,
    changes: { customName: string | null } | { lastOpenedAt: null },
  ): WorkspaceMetadataResult {
    try {
      return this.database.db.transaction((tx) => {
        const row = tx.select().from(workspaces).where(eq(workspaces.id, input.id)).get()
        if (!row) {
          return this.metadataFailure('unknown_workspace')
        }
        if (row.revision !== input.expectedRevision) {
          return this.metadataFailure('conflict', row)
        }
        const updated = tx
          .update(workspaces)
          .set({ ...changes, revision: row.revision + 1 })
          .where(eq(workspaces.id, row.id))
          .returning()
          .get()
        return { ok: true, record: this.record(updated) }
      })
    } catch {
      return this.metadataFailure('storage_failed')
    }
  }

  /** Explicit relocation accepts only the same physical directory. Validation occurs before
   * a revision-checked SQLite commit; failures keep the old mapping. Existing sessions keep
   * their immutable cwd and are rejected on a later send if it no longer matches. No task,
   * resource trust, file, project or history is moved or rebound by this operation. */
  async relocate(input: WorkspaceRelocate): Promise<WorkspaceMetadataResult> {
    try {
      const row = this.row(input.id)
      if (!row) {
        return this.metadataFailure('unknown_workspace')
      }
      if (row.revision !== input.expectedRevision) {
        return this.metadataFailure('conflict', row)
      }
      const checked = await this.inspect(input.path, row.directoryKey)
      if (!checked.ok) {
        return { ...checked, current: this.record(row) }
      }
      return this.database.db.transaction((tx) => {
        const current = tx.select().from(workspaces).where(eq(workspaces.id, row.id)).get()
        if (!current || current.revision !== row.revision) {
          return this.metadataFailure('conflict', current)
        }
        const updated = tx
          .update(workspaces)
          .set({
            canonicalPath: checked.canonicalPath,
            name: basename(checked.canonicalPath) || parse(checked.canonicalPath).root,
            revision: current.revision + 1,
          })
          .where(eq(workspaces.id, row.id))
          .returning()
          .get()
        return { ok: true, record: this.record(updated) }
      })
    } catch {
      return this.metadataFailure('storage_failed')
    }
  }

  private async inspect(
    path: string,
    expectedKey?: string,
    probeWritable = true,
  ): Promise<DirectoryInspection> {
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
      if (probeWritable) {
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
    return { ok: true, canonicalPath, directoryKey }
  }
}
