import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { WorkspaceService } from './workspace.service.js'
import type { Project, ProjectCommand } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'

import { HttpException } from '@nestjs/common'
import { and, asc, desc, eq } from 'drizzle-orm'

import { projectCommandSchema, projectCreateSchema, projectSchema } from '@pi-workbench/shared'

import { projects } from '../../infrastructure/database/schema.js'

/** Daemon-owned project metadata. Default directories are checked by WorkspaceService;
 * editing organization never loads resources, grants access or changes a session cwd.
 * Revisions are checked again after directory IO; no failed mutation is retried.
 */
export class ProjectService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly workspaces: WorkspaceService,
  ) {}
  list(): Project[] {
    return this.database.db
      .select()
      .from(projects)
      .where(eq(projects.removed, false))
      .orderBy(desc(projects.pinned), asc(projects.position), asc(projects.id))
      .all()
      .map((row) => this.display(row))
  }

  /** Register a future default without treating a metadata save as a recent workspace
   * activation. Uses the same physical-directory and read/write validation boundary. */
  resolveDirectory(path: string) {
    return this.workspaces.open(path, { remember: false })
  }

  private row(id: string) {
    return this.database.db.select().from(projects).where(eq(projects.id, id)).get()
  }

  /** Reconciles an uncertain create without replaying it or resurrecting removed records. */
  created(requestId: string): Project | null {
    const row = this.database.db
      .select()
      .from(projects)
      .where(eq(projects.requestId, requestId))
      .get()
    if (row?.removed) {
      throw new HttpException('这个请求创建的项目已移除，不会重新创建。', 409)
    }
    return row ? this.display(row) : null
  }

  private display(row: typeof projects.$inferSelect): Project {
    return projectSchema.parse({
      id: row.id,
      name: row.name,
      workspaceId: row.workspaceId,
      directory: row.workspaceId
        ? (this.workspaces.lookup(row.workspaceId)?.canonicalPath ?? null)
        : null,
      pinned: row.pinned,
      position: row.position,
      revision: row.revision,
    })
  }

  /** Synchronous final admission check, called after directory IO and before persistence. */
  assertDefault(id: string | null, workspaceId: string | null): void {
    if (!id) {
      return
    }
    const project = this.row(id)
    if (!project || project.removed) {
      throw new HttpException('项目已移除，请重新选择归属；草稿保留。', 409)
    }
    if (project.workspaceId !== workspaceId) {
      throw new HttpException('项目默认目录已变化，请核对后重新选择项目。', 409)
    }
  }

  private current(id: string, expectedRevision: number) {
    const row = this.row(id)
    if (!row || row.removed) {
      throw new HttpException('项目已移除，请刷新项目列表。', 409)
    }
    if (row.revision !== expectedRevision) {
      throw new HttpException('项目已更新，编辑内容保留；请核对最新版本后明确继续。', 409)
    }
    return row
  }

  /** Organization-only admission. No directory IO, resource loading or default inheritance. */
  assertMembership(id: string, expectedRevision: number): void {
    this.current(id, expectedRevision)
  }

  private failure(error: unknown): never {
    if (error instanceof HttpException) {
      throw error
    }
    throw new HttpException('项目未能保存，请核对最新列表后重试；会话与文件保留。', 503)
  }

  /** A create ID stays bound to its original input even after rename/default edits.
   * Removed IDs are retained as tombstones and cannot be recreated by a late retry. */
  async create(input: {
    requestId: string
    name: string
    workspaceId: string | null
  }): Promise<Project> {
    const parsed = projectCreateSchema.safeParse(input)
    if (!parsed.success) {
      throw new HttpException('项目名称须为 1–80 个 Unicode 字符，目录身份须有效。', 400)
    }
    input = parsed.data
    const creationInput = JSON.stringify({ name: input.name, workspaceId: input.workspaceId })
    const priorResult = () => {
      const prior = this.database.db
        .select()
        .from(projects)
        .where(eq(projects.requestId, input.requestId))
        .get()
      if (prior) {
        if (prior.creationInput !== creationInput) {
          throw new HttpException('项目请求已绑定其他内容。', 409)
        }
        if (prior.removed) {
          throw new HttpException('这个请求创建的项目已移除，不会重新创建。', 409)
        }
        return this.display(prior)
      }
      return undefined
    }
    try {
      const prior = priorResult()
      if (prior) {
        return prior
      }
      if (input.workspaceId) {
        const checked = await this.workspaces.validate(input.workspaceId)
        if (!checked.ok) {
          throw new HttpException(checked, 409)
        }
      }
      return this.database.db.transaction((tx) => {
        const duplicate = priorResult()
        if (duplicate) {
          return duplicate
        }
        const position =
          Math.max(
            -1,
            ...this.list()
              .filter((row) => !row.pinned)
              .map((row) => row.position),
          ) + 1
        const row = tx
          .insert(projects)
          .values({
            id: randomUUID(),
            name: input.name,
            workspaceId: input.workspaceId,
            requestId: input.requestId,
            creationInput,
            position,
          })
          .returning()
          .get()
        return this.display(row)
      })
    } catch (error) {
      return this.failure(error)
    }
  }

  /** Only future sessions use the saved default. Existing session configuration is owned
   * by SessionStore and is deliberately untouched by project edits. */
  async edit(id: string, input: Extract<ProjectCommand, { action: 'edit' }>): Promise<Project> {
    const parsed = projectCommandSchema.safeParse(input)
    if (!parsed.success || parsed.data.action !== 'edit') {
      throw new HttpException('项目编辑内容无效。', 400)
    }
    input = parsed.data
    try {
      this.current(id, input.expectedRevision)
      if (input.workspaceId) {
        const checked = await this.workspaces.validate(input.workspaceId)
        if (!checked.ok) {
          throw new HttpException(checked, 409)
        }
      }
      return this.database.db.transaction((tx) => {
        this.current(id, input.expectedRevision)
        const row = tx
          .update(projects)
          .set({
            name: input.name,
            workspaceId: input.workspaceId,
            revision: input.expectedRevision + 1,
          })
          .where(and(eq(projects.id, id), eq(projects.revision, input.expectedRevision)))
          .returning()
          .get()
        return this.display(row)
      })
    } catch (error) {
      return this.failure(error)
    }
  }

  /** Pin groups are ordered independently; pin/unpin appends to its destination group.
   * A move swaps adjacent full-list positions (never filtered-search positions) and bumps
   * both revisions. Removal retains the create tombstone. The synchronous detach callback
   * uses SessionStore's public API in this same SQLite transaction, so failure rolls back
   * both grouping and session attribution; execution/history/permissions are untouched. */
  organize(
    id: string,
    input: Exclude<ProjectCommand, { action: 'edit' }>,
    detach: () => void,
  ): Project {
    const parsed = projectCommandSchema.safeParse(input)
    if (!parsed.success || parsed.data.action === 'edit') {
      throw new HttpException('项目操作或版本无效。', 400)
    }
    input = parsed.data
    try {
      return this.database.db.transaction((tx) => {
        const current = this.current(id, input.expectedRevision)
        if (input.action === 'remove') {
          detach()
          const row = tx
            .update(projects)
            .set({ removed: true, revision: current.revision + 1 })
            .where(eq(projects.id, id))
            .returning()
            .get()
          return this.display(row)
        }
        const group = this.list().filter((row) => row.pinned === current.pinned)
        if (input.action === 'move') {
          const index = group.findIndex((row) => row.id === id)
          const neighbor = group[index + (input.direction === 'up' ? -1 : 1)]
          if (!neighbor) {
            return this.display(current)
          }
          // Normalize legacy/large position gaps before swapping. Only changed rows bump
          // revisions, so a stale editor can never silently undo an order operation.
          const reordered = [...group]
          const nextIndex = index + (input.direction === 'up' ? -1 : 1)
          reordered[index] = neighbor
          reordered[nextIndex] = group[index]!
          for (const [position, row] of reordered.entries()) {
            if (row.position !== position) {
              tx.update(projects)
                .set({ position, revision: row.revision + 1 })
                .where(eq(projects.id, row.id))
                .run()
            }
          }
          return this.display(this.row(id)!)
        }
        if (current.pinned === input.pinned) {
          return this.display(current)
        }
        const destination = this.list().filter((row) => row.pinned === input.pinned)
        const position = Math.max(-1, ...destination.map((row) => row.position)) + 1
        return this.display(
          tx
            .update(projects)
            .set({ pinned: input.pinned, position, revision: current.revision + 1 })
            .where(eq(projects.id, id))
            .returning()
            .get(),
        )
      })
    } catch (error) {
      return this.failure(error)
    }
  }
}
