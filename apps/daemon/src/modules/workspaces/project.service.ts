import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { WorkspaceService } from './workspace.service.js'
import type { Project } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'

import { HttpException } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import { projects } from '../../infrastructure/database/schema.js'

/** Minimal project identity for first-send attribution. Workspace access is checked by its
 * owner; creating a project never loads instructions, changes cwd or creates a session.
 * Reordering, rename, relocation and removal remain WS-06 work.
 */
export class ProjectService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly workspaces: WorkspaceService,
  ) {}
  list(): Project[] {
    return this.database.db
      .select({ id: projects.id, name: projects.name, workspaceId: projects.workspaceId })
      .from(projects)
      .all()
      .map((project) =>
        Object.assign(project, {
          directory: project.workspaceId
            ? (this.workspaces.lookup(project.workspaceId)?.canonicalPath ?? null)
            : null,
        }),
      )
  }
  async create(input: {
    requestId: string
    name: string
    workspaceId: string | null
  }): Promise<Project> {
    if (input.workspaceId) {
      const checked = await this.workspaces.validate(input.workspaceId)
      if (!checked.ok) {
        throw new HttpException(checked, 409)
      }
    }
    return this.database.db.transaction((tx) => {
      const prior = tx.select().from(projects).where(eq(projects.requestId, input.requestId)).get()
      if (prior) {
        if (prior.name !== input.name || prior.workspaceId !== input.workspaceId) {
          throw new HttpException('项目请求已绑定其他内容。', 409)
        }
        return {
          id: prior.id,
          name: prior.name,
          workspaceId: prior.workspaceId,
          directory: prior.workspaceId
            ? (this.workspaces.lookup(prior.workspaceId)?.canonicalPath ?? null)
            : null,
        }
      }
      const project = { id: randomUUID(), name: input.name, workspaceId: input.workspaceId }
      tx.insert(projects)
        .values({ ...project, requestId: input.requestId })
        .run()
      return {
        ...project,
        directory: project.workspaceId
          ? (this.workspaces.lookup(project.workspaceId)?.canonicalPath ?? null)
          : null,
      }
    })
  }
}
