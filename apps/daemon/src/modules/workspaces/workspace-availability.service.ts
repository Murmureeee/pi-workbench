import type { TrustService } from '../security/trust.service.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { WorkspaceService } from './workspace.service.js'
import type { WorkspaceAvailability, WorkspaceEnvironmentTarget } from '@pi-workbench/shared'

import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'

/** Desktop recovery observes saved identities, not renderer-supplied paths. Explicit checks
 * may probe access but never change metadata/cwd/trust or restart a stopped task. Four bounded
 * inspections at most; a result spanning a metadata change fails closed. */
export class WorkspaceAvailabilityService {
  private readonly pending = new Map<string, Promise<WorkspaceAvailability>>()

  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly sessions: SessionStore,
    private readonly trust: TrustService,
  ) {}

  inspect(target: WorkspaceEnvironmentTarget, probe = false): Promise<WorkspaceAvailability> {
    const key = JSON.stringify([target, probe])
    const pending = this.pending.get(key)
    if (pending) {
      return pending
    }
    if (this.pending.size >= 4) {
      throw new ServiceUnavailableException('目录检查繁忙，请稍后重试；没有恢复执行。')
    }
    const operation = this.check(target, probe).finally(() => this.pending.delete(key))
    this.pending.set(key, operation)
    return operation
  }

  private async check(
    target: WorkspaceEnvironmentTarget,
    probe: boolean,
  ): Promise<WorkspaceAvailability> {
    const session =
      'sessionId' in target ? this.sessions.executionEnvironment(target.sessionId) : undefined
    if ('sessionId' in target && !session) {
      throw new NotFoundException('会话不存在，请刷新列表。')
    }
    const workspaceId = session?.workspaceId ?? ('workspaceId' in target ? target.workspaceId : '')
    const workspace = this.workspaces.lookupRecord(workspaceId)
    if (!workspace) {
      throw new NotFoundException('工作区记录不存在；历史保留，请重新打开目录。')
    }
    const cwd = session?.cwd ?? workspace.canonicalPath
    const base = { target, workspace, cwd, resources: null, checkedAt: Date.now() }
    if (cwd !== workspace.canonicalPath) {
      return {
        ...base,
        state: 'relocated',
        diagnostic: '工作区已重新定位；已有会话仍绑定原 cwd，续发被阻止。',
        recovery:
          '恢复原物理目录及原登记路径后重新校验；也可在新位置明确新建会话。此处不能迁移已有会话。',
      }
    }
    const checked = probe
      ? await this.workspaces.validate(workspaceId)
      : await this.workspaces.environmentDirectory(workspaceId, cwd)
    if (!checked.ok) {
      return {
        ...base,
        state: 'unavailable',
        diagnostic: checked.message,
        recovery:
          '恢复原物理目录、挂载或访问权限后重新校验；移动后可重新定位同一目录。历史和草稿保留，不会自动重发。',
      }
    }
    const resources = this.trust.inspect(cwd).resources
    const after = await this.workspaces.environmentDirectory(workspaceId, cwd)
    if (!after.ok || this.workspaces.lookupRecord(workspaceId)?.revision !== workspace.revision) {
      return {
        ...base,
        state: 'unavailable',
        diagnostic: '检查期间目录或登记信息已改变。',
        recovery: '请重新校验当前目录；已有会话和草稿保留，没有恢复执行。',
      }
    }
    return {
      ...base,
      state: 'available',
      diagnostic: '',
      checkedAt: Date.now(),
      recovery: '目录检查通过；请先核对历史和执行结果，再明确发送。校验不会重发任务或授予权限。',
      resources: {
        trusted: resources.filter((item) => item.trust === 'trusted' && item.kind === 'context')
          .length,
        untrusted: resources.filter((item) => !['trusted', 'blocked'].includes(item.trust)).length,
        blocked: resources.filter((item) => item.trust === 'blocked').length,
        execution: 'disabled',
      },
    }
  }
}
