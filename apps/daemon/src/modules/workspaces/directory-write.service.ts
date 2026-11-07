import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { WorkspaceService } from './workspace.service.js'
import type { DirectoryRound, Redactor } from '@pi-workbench/shared'

import { lstat, opendir, realpath } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { desc, eq, inArray } from 'drizzle-orm'

import { directoryRoundSchema } from '@pi-workbench/shared'

import { directoryRounds } from '../../infrastructure/database/schema.js'

type Identity = { canonicalPath: string; directoryKey: string }
type Observation = { files: Map<string, string>; coverage: DirectoryRound['coverage'] }
type Lease = {
  identity: Identity
  record: DirectoryRound
  pid: number | null
  baseline?: Observation
  timer?: ReturnType<typeof setTimeout>
  pending?: Promise<void>
  finishing?: boolean
  scanning?: boolean
}
const alive = (pid: number | null) => {
  if (!pid) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}
const contains = (a: string, b: string) => {
  // Paths are already realpath results. path.relative folds case on Windows and would
  // conflate physically distinct roots in a case-sensitive directory.
  return a === b || b.startsWith(a.endsWith(sep) ? a : `${a}${sep}`)
}

/** Daemon-owned round leases. SQLite is provenance metadata, never a restored permit.
 * All current SDK rounds can call write/command tools, so reservation precedes dispatch.
 * Sampling is deliberately not attribution or a recoverable baseline: every record forbids
 * automatic rollback, even if no change was observed. No file contents are read here. */
export class DirectoryWriteService {
  private readonly leases = new Map<string, Lease>()
  private closed = false
  private settlementSaved: (turnId: string) => boolean = () => true

  /** A later file-version stage may fail its final SQLite commit. Even a dead child is
   * insufficient to release that round until durable settlement metadata exists. */
  setSettlementCheck(check: (turnId: string) => boolean): void {
    this.settlementSaved = check
  }

  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly workspaces: WorkspaceService,
    private readonly redactor: Redactor,
  ) {
    // A previous daemon can die while its child is still stopping. Retain only a blocking
    // quarantine until that PID exits; never attach it, send input, or restore approval.
    for (const row of database.db
      .select()
      .from(directoryRounds)
      .where(inArray(directoryRounds.state, ['active', 'quarantined']))
      .all()) {
      const record = directoryRoundSchema.parse(JSON.parse(row.data))
      if (!['active', 'quarantined'].includes(record.state)) {
        continue
      }
      record.state = alive(row.runtimePid) ? 'quarantined' : 'interrupted'
      record.endedAt = record.state === 'interrupted' ? Date.now() : null
      const lease: Lease = {
        identity: { directoryKey: row.directoryKey, canonicalPath: row.cwd },
        record,
        pid: row.runtimePid,
      }
      this.save(lease)
      if (record.state === 'quarantined') {
        this.leases.set(record.turnId, lease)
      }
    }
  }

  identify(cwd: string): Identity {
    return this.workspaces.executionIdentity(cwd)
  }

  overlaps(a: Identity, b: Identity): boolean {
    return (
      a.directoryKey === b.directoryKey ||
      contains(a.canonicalPath, b.canonicalPath) ||
      contains(b.canonicalPath, a.canonicalPath)
    )
  }

  /** Overlapping roots also conflict: a parent-root tool can write a child workspace. */
  blocker(identity: Identity): DirectoryRound | null {
    for (const lease of this.leases.values()) {
      if (
        lease.record.state === 'quarantined' &&
        !alive(lease.pid) &&
        this.settlementSaved(lease.record.turnId)
      ) {
        lease.record = { ...lease.record, state: 'interrupted', endedAt: Date.now() }
        try {
          this.save(lease)
        } catch {
          lease.record.state = 'quarantined'
          lease.record.endedAt = null
          if (this.overlaps(lease.identity, identity)) {
            return lease.record
          }
          continue
        }
        this.leases.delete(lease.record.turnId)
        continue
      }
      if (this.overlaps(lease.identity, identity)) {
        return lease.record
      }
    }
    return null
  }

  /** Synchronous claim occurs before consuming model/kernel slots. Failed persistence
   * never grants a lease; the scheduler can continue admitting independent directories. */
  reserve(identity: Identity, sessionId: string, turnId: string): void {
    if (this.closed || this.blocker(identity)) {
      throw new Error('目录仍被另一轮占用。')
    }
    const now = Date.now()
    const lease: Lease = {
      identity,
      pid: null,
      record: {
        sessionId,
        turnId,
        cwd: identity.canonicalPath,
        state: 'active',
        startedAt: now,
        checkedAt: now,
        endedAt: null,
        coverage: 'unavailable',
        changedPaths: [],
        changesTruncated: false,
        provenance: 'uncertain',
        automaticRollback: false,
      },
    }
    this.save(lease)
    this.leases.set(turnId, lease)
  }

  /** Binds an actually created child before dispatch. Identity is checked again after IO
   * and at every final tool decision; stale callbacks can never transfer the lease. */
  async begin(turnId: string, pid: number): Promise<void> {
    const lease = this.required(turnId)
    lease.pid = pid
    this.save(lease)
    lease.baseline = await this.scan(lease)
    lease.record.coverage = lease.baseline.coverage
    lease.record.checkedAt = Date.now()
    this.save(lease)
    this.watch(lease)
  }

  assertOwner(turnId: string, cwd: string): void {
    const lease = this.required(turnId),
      identity = this.identify(cwd)
    if (
      lease.record.state !== 'active' ||
      identity.directoryKey !== lease.identity.directoryKey ||
      identity.canonicalPath !== lease.identity.canonicalPath
    ) {
      throw new Error('目录写入占用或物理身份已失效。')
    }
  }

  private required(turnId: string): Lease {
    const lease = this.leases.get(turnId)
    if (!lease || this.closed) {
      throw new Error('目录写入占用不可用。')
    }
    return lease
  }

  latest(sessionId: string): DirectoryRound | null {
    const row = this.database.db
      .select()
      .from(directoryRounds)
      .where(eq(directoryRounds.sessionId, sessionId))
      .orderBy(desc(directoryRounds.startedAt), desc(directoryRounds.turnId))
      .limit(1)
      .get()
    return row ? directoryRoundSchema.parse(JSON.parse(row.data)) : null
  }

  ownerForSession(sessionId: string): DirectoryRound | null {
    return (
      [...this.leases.values()].find((lease) => lease.record.sessionId === sessionId)?.record ??
      null
    )
  }

  /** Caller supplies proof of SDK settlement or actual child exit. A failed cleanup keeps
   * a quarantine, including after restart. Persist the final observation before release. */
  async finish(turnId: string, safe: boolean): Promise<void> {
    const lease = this.leases.get(turnId)
    if (!lease) {
      return
    }
    lease.finishing = true
    clearTimeout(lease.timer)
    try {
      await lease.pending
      await this.sample(lease)
      lease.record.state = safe ? 'released' : 'quarantined'
      lease.record.endedAt = safe ? Date.now() : null
      this.save(lease)
    } catch (error) {
      lease.record.state = 'quarantined'
      lease.record.endedAt = null
      throw error
    }
    if (safe) {
      this.leases.delete(turnId)
    }
  }

  private save(lease: Lease): void {
    const data = JSON.stringify(directoryRoundSchema.parse(this.redactor.value(lease.record)))
    this.database.db
      .insert(directoryRounds)
      .values({
        turnId: lease.record.turnId,
        sessionId: lease.record.sessionId,
        directoryKey: lease.identity.directoryKey,
        startedAt: lease.record.startedAt,
        state: lease.record.state,
        cwd: lease.identity.canonicalPath,
        runtimePid: lease.pid,
        data,
      })
      .onConflictDoUpdate({
        target: directoryRounds.turnId,
        set: { data, state: lease.record.state, runtimePid: lease.pid },
      })
      .run()
  }

  private watch(lease: Lease): void {
    if (
      this.closed ||
      lease.finishing ||
      this.leases.get(lease.record.turnId) !== lease ||
      lease.record.state !== 'active'
    ) {
      return
    }
    lease.timer = setTimeout(() => {
      lease.pending = this.sample(lease)
        .catch(() => {
          lease.record.coverage = 'unavailable'
          // Persistence failure must not grant another writer or crash the observer.
        })
        .finally(() => {
          lease.pending = undefined
          this.watch(lease)
        })
    }, 1000)
    lease.timer.unref()
  }

  private async sample(lease: Lease): Promise<void> {
    if (!lease.baseline) {
      return
    }
    const observation = await this.scan(lease)
    const paths = new Set(lease.record.changedPaths)
    for (const path of new Set([...lease.baseline.files.keys(), ...observation.files.keys()])) {
      const before = lease.baseline.files.get(path),
        after = observation.files.get(path)
      // Missing metadata in a partial/failed scan is not evidence of deletion or creation.
      // Only complete traversal can establish absence; two observed values can differ
      // even when unrelated subtrees were excluded or unavailable.
      if (
        before !== after &&
        (before !== undefined || lease.baseline.coverage === 'bounded') &&
        (after !== undefined || observation.coverage === 'bounded')
      ) {
        if (paths.size < 32) {
          paths.add(this.redactor.text(path))
        } else {
          lease.record.changesTruncated = true
        }
      }
    }
    lease.record.changedPaths = [...paths]
    lease.record.coverage =
      lease.record.coverage === 'unavailable' || observation.coverage === 'unavailable'
        ? 'unavailable'
        : lease.record.coverage === 'limited' || observation.coverage === 'limited'
          ? 'limited'
          : 'bounded'
    lease.record.checkedAt = Date.now()
    this.save(lease)
  }

  /** At most 2048 entries/depth 8/1 s per sample. Links are observed but never traversed;
   * check physical parents around awaits. A racing tree, excluded tree or IO error limits
   * coverage. Metadata can miss transient/content-preserving changes; it proves no origin. */
  private async scan(lease: Lease): Promise<Observation> {
    // A timed-out OS read cannot be cancelled. Do not pile up a new scan while that
    // previous read is still outstanding; late completion touches only a local map.
    if (lease.scanning) {
      return { files: new Map(), coverage: 'unavailable' }
    }
    const observation: Observation = { files: new Map(), coverage: 'bounded' }
    const deadline = Date.now() + 1000
    let entries = 0,
      expired = false
    const walk = async (path: string, depth: number): Promise<void> => {
      if (expired || Date.now() >= deadline || entries >= 2048 || depth > 8) {
        observation.coverage = 'limited'
        return
      }
      const before = await lstat(path, { bigint: true })
      if (!before.isDirectory() || before.isSymbolicLink() || (await realpath(path)) !== path) {
        observation.coverage = 'limited'
        return
      }
      const dir = await opendir(path)
      try {
        for await (const entry of dir) {
          if (expired || Date.now() >= deadline || ++entries > 2048) {
            observation.coverage = 'limited'
            break
          }
          if (entry.name.startsWith('.pi-workbench-check-')) {
            continue
          }
          if (['.git', 'node_modules', '.workbench'].includes(entry.name)) {
            observation.coverage = 'limited'
            continue
          }
          const full = join(path, entry.name),
            stat = await lstat(full, { bigint: true })
          observation.files.set(
            relative(lease.identity.canonicalPath, full),
            `${stat.dev}:${stat.ino}:${stat.birthtimeNs}:${stat.isDirectory() ? 'dir' : `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`}`,
          )
          if (stat.isDirectory() && !stat.isSymbolicLink()) {
            await walk(full, depth + 1)
          } else if (!stat.isFile() || stat.nlink !== 1n) {
            observation.coverage = 'limited'
          }
        }
      } finally {
        const after = await lstat(path, { bigint: true })
        if (
          after.ino !== before.ino ||
          after.birthtimeNs !== before.birthtimeNs ||
          after.dev !== before.dev ||
          (await realpath(path)) !== path
        ) {
          observation.coverage = 'unavailable'
        }
      }
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      this.assertOwner(lease.record.turnId, lease.identity.canonicalPath)
      lease.scanning = true
      const operation = walk(lease.identity.canonicalPath, 0).finally(() => {
        lease.scanning = false
      })
      await Promise.race([
        operation,
        new Promise<never>((_ok, fail) => {
          timeout = setTimeout(() => {
            expired = true
            fail(new Error('Observation timed out'))
          }, 1100)
          timeout.unref()
        }),
      ])
      this.assertOwner(lease.record.turnId, lease.identity.canonicalPath)
    } catch {
      observation.coverage = 'unavailable'
    } finally {
      clearTimeout(timeout)
    }
    // A timed-out scan owns only this local map; it cannot mutate persisted observations.
    return { files: new Map(observation.files), coverage: observation.coverage }
  }

  close(): void {
    this.closed = true
    for (const lease of this.leases.values()) {
      clearTimeout(lease.timer)
    }
  }
}
