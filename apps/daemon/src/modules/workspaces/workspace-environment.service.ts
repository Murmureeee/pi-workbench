import type { SessionStore } from '../sessions/session.store.js'
import type { WorkspaceService } from './workspace.service.js'
import type { WorkspaceEnvironment, WorkspaceEnvironmentTarget } from '@pi-workbench/shared'

import { NotFoundException } from '@nestjs/common'

import { readGitEnvironment } from './git-environment.js'

/** Observation only. Resolve identities on the host; session cwd takes precedence over
 * mutable workspace/project metadata. At most four inspections run, with no disk cache. */
export class WorkspaceEnvironmentService {
  private readonly pending = new Map<string, Promise<WorkspaceEnvironment>>()

  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly sessions: SessionStore,
  ) {}

  inspect(target: WorkspaceEnvironmentTarget): Promise<WorkspaceEnvironment> {
    const session =
      'sessionId' in target ? this.sessions.executionEnvironment(target.sessionId) : undefined
    if ('sessionId' in target && !session) {
      throw new NotFoundException('会话不存在，请刷新会话列表。')
    }
    const workspaceId = session?.workspaceId ?? ('workspaceId' in target ? target.workspaceId : '')
    const workspace = this.workspaces.lookup(workspaceId)
    if (!workspace) {
      throw new NotFoundException('工作区不存在，请重新打开目录。')
    }
    const cwd = session?.cwd ?? workspace.canonicalPath
    const base = { target, cwd, workspacePath: workspace.canonicalPath }
    const key = JSON.stringify(base)
    const pending = this.pending.get(key)
    if (pending) {
      return pending
    }
    if (this.pending.size >= 4) {
      return Promise.resolve({
        ...base,
        resolvedCwd: null,
        directoryMessage: '',
        checkedAt: Date.now(),
        git: { status: 'unavailable', code: 'busy', message: '环境检查繁忙，请稍后刷新。' },
      })
    }
    const task = (async (): Promise<WorkspaceEnvironment> => {
      const before = await this.workspaces.environmentDirectory(workspaceId, cwd)
      if (!before.ok) {
        return {
          ...base,
          resolvedCwd: null,
          directoryMessage: `${before.message} ${before.recovery}`,
          checkedAt: Date.now(),
          git: {
            status: 'unavailable',
            code: 'directory_unavailable',
            message: '执行目录当前不可用，保留原 cwd；请恢复目录后重新检查。',
          },
        }
      }
      const git = await readGitEnvironment(before.canonicalPath)
      const after = await this.workspaces.environmentDirectory(workspaceId, cwd)
      if (
        !after.ok ||
        before.canonicalPath !== after.canonicalPath ||
        this.workspaces.lookup(workspaceId)?.canonicalPath !== workspace.canonicalPath
      ) {
        return {
          ...base,
          resolvedCwd: null,
          directoryMessage: '检查期间目录或登记路径已改变。',
          checkedAt: Date.now(),
          git: {
            status: 'unavailable',
            code: 'changed',
            message: '目录已改变，请刷新；已有会话 cwd 保留。',
          },
        }
      }
      return {
        ...base,
        resolvedCwd: after.canonicalPath,
        directoryMessage: '',
        checkedAt: Date.now(),
        git,
      }
    })().finally(() => this.pending.delete(key))
    this.pending.set(key, task)
    return task
  }
}
