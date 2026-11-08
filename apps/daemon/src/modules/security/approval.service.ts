import type { EventService } from '../events/event.service.js'
import type { SessionStore } from '../sessions/session.store.js'
import type { ExecutionPolicyService } from './execution-policy.service.js'
import type { GrantScope, SessionGrantService } from './session-grant.service.js'
import type {
  ExecutionApproval,
  ExecutionApprovalCommand,
  ExecutionDecision,
  ExecutionRequest,
  Redactor,
} from '@pi-workbench/shared'

import { ConflictException } from '@nestjs/common'

import { executionApprovalListSchema } from '@pi-workbench/shared'

type Binding = { sessionId: string; epoch: string; turnId: string; cwd: string }
type Outcome = 'allowed' | 'denied' | 'cancelled' | 'invalidated'
interface Pending {
  view: ExecutionApproval
  decision: ExecutionDecision
  current: () => boolean
  cleanup: () => void
  scope: GrantScope
  resolve: (outcome: ApprovalOutcome) => void
  reject: (error: unknown) => void
}
interface ApprovalOutcome {
  decision: ExecutionDecision
  authorizationCurrent: () => boolean
}

/** Daemon-owned live waiters have no timer and survive observer unload/disconnect. Every
 * decision consumes one immutable invocation synchronously, with persistence before permit.
 * Only runtime cancellation/policy/lifecycle invalidation wakes old requests; restart never
 * restores executable waiters. Rejection blocks automatic alternate tools for this turn.
 */
export class ApprovalService {
  private readonly pending = new Map<string, Pending>()
  private readonly rejected = new Set<string>()
  private readonly unsubscribe: () => void
  constructor(
    private readonly store: SessionStore,
    private readonly events: EventService,
    private readonly policy: ExecutionPolicyService,
    private readonly redactor: Redactor,
    readonly grants: SessionGrantService,
  ) {
    this.unsubscribe = policy.onInvalidate(() => this.invalidate('执行策略已变化，旧请求失效。'))
  }
  list(sessionId?: string): ExecutionApproval[] {
    return executionApprovalListSchema.parse(
      this.redactor.value({
        approvals: [...this.pending.values()]
          .filter((p) => !sessionId || p.view.sessionId === sessionId)
          .map((p) => this.visible(p)),
      }),
    ).approvals
  }
  rejectedTurn(turnId: string): boolean {
    return this.rejected.has(turnId)
  }

  /** Eligibility and final-directory recheck remain the host policy's responsibility. Raw
   * parameters stay in this waiter only; durable summaries use the common redactor. */
  async wait(
    binding: Binding,
    request: ExecutionRequest,
    decision: ExecutionDecision,
    signal: AbortSignal,
    current: () => boolean,
    scope: GrantScope,
  ): Promise<ApprovalOutcome> {
    if (signal.aborted || !current() || this.rejected.has(binding.turnId)) {
      return {
        decision: {
          ...decision,
          allowed: false,
          reason: '本轮调用已取消、失效或被拒绝；未执行，未换用其他形式重试。',
        },
        authorizationCurrent: () => false,
      }
    }
    if (this.pending.size >= 64 || this.pending.has(request.id)) {
      throw new Error('审批等待上限或身份冲突；未执行。')
    }
    const view: ExecutionApproval = {
      ...binding,
      id: request.id,
      callId: request.callId,
      parentId: request.parentId,
      tool: request.tool,
      parameters: request.parameters,
      risk: decision.risk,
      createdAt: Date.now(),
      irreversible: true,
      sessionPermission: {
        eligible: decision.risk.level === 'L2' && request.parentId === null,
        matchingGrantId: null,
        targetPath: scope.targetPath,
        physicalIdentity: scope.physicalIdentity,
        parameterDigest: scope.parameterDigest,
      },
    }
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.finishSafe(request.id, 'invalidated', '任务、IPC或内核已失效；未执行。')
      }
      const pending: Pending = {
        view,
        scope,
        decision,
        current,
        resolve,
        reject,
        cleanup: () => signal.removeEventListener('abort', cancel),
      }
      this.pending.set(request.id, pending)
      signal.addEventListener('abort', cancel, { once: true })
      try {
        this.persist(pending, 'pending', '等待明确决定；无倒计时。', null)
        this.publishHead(binding)
        if (signal.aborted || !current()) {
          cancel()
        }
      } catch (error) {
        this.pending.delete(request.id)
        pending.cleanup()
        this.rejected.add(binding.turnId)
        this.invalidateTurn(binding.turnId, '审批记录保存失败，本轮不再执行。')
        reject(error)
      }
    })
  }

  /** The first matching live decision wins across clients. A stale command cannot change
   * or recreate an already consumed permit, and missing irreversible consent cannot allow. */
  decide(id: string, command: ExecutionApprovalCommand, actor: string): void {
    const p = this.pending.get(id),
      v = p?.view
    if (!p || !v) {
      throw new ConflictException('审批已处理或失效，请同步当前状态；未再次执行。')
    }
    if (
      command.sessionId !== v.sessionId ||
      command.epoch !== v.epoch ||
      command.turnId !== v.turnId ||
      command.digest !== v.risk.digest ||
      command.policyVersion !== v.risk.policyVersion
    ) {
      throw new ConflictException('审批对象、最终参数或版本不匹配；未执行。')
    }
    if (
      !p.current() ||
      this.rejected.has(v.turnId) ||
      this.policy.policyVersion !== v.risk.policyVersion
    ) {
      this.finish(id, 'invalidated', '运行或策略已失效；未执行。', actor)
      throw new ConflictException('运行或策略已失效，请重新同步。')
    }
    const allowing = ['allow-once', 'allow-session', 'use-grant'].includes(command.action)
    if (allowing && !command.acceptIrreversible) {
      throw new ConflictException(
        '尚未明确接受本次不可回滚执行；文件版本保存不保证本次调用可回滚，未执行。',
      )
    }
    let grantId: string | null = null
    if (command.action === 'use-grant') {
      grantId = this.matching(p)
      if (!grantId || command.grantId !== grantId) {
        throw new ConflictException('会话授权已撤销或范围不匹配；未执行，请核对后单次审批。')
      }
    } else if (command.action === 'allow-session') {
      grantId = this.grants.create(v, p.scope, actor)
    }
    try {
      this.finish(
        id,
        allowing ? 'allowed' : command.action === 'deny' ? 'denied' : 'cancelled',
        command.reason ||
          (allowing
            ? '明确允许本次不可回滚调用'
            : command.action === 'deny'
              ? '用户拒绝本次调用'
              : '用户取消本次调用'),
        actor,
        grantId,
      )
    } catch (error) {
      if (command.action === 'allow-session' && grantId) {
        this.grants.revoke(v.sessionId, grantId, '本次审批保存失败，撤销新授权', actor)
      }
      throw error
    }
  }
  endTurn(turnId: string): void {
    for (const p of this.pending.values()) {
      if (p.view.turnId === turnId) {
        this.finishSafe(p.view.id, 'invalidated', '轮次已结束，旧请求失效。')
      }
    }
    this.rejected.delete(turnId)
  }
  invalidate(reason: string): void {
    for (const id of this.pending.keys()) {
      this.finishSafe(id, 'invalidated', reason)
    }
  }
  close(): void {
    this.unsubscribe()
    this.invalidate('服务正在退出，旧待审批不恢复。')
    this.grants.close()
  }
  private finishSafe(id: string, outcome: Outcome, reason: string): void {
    try {
      this.finish(id, outcome, reason, null)
    } catch {
      /* finish rejects the waiter on durable failure. */
    }
  }
  private finish(
    id: string,
    outcome: Outcome,
    reason: string,
    actor: string | null,
    grantId: string | null = null,
  ): void {
    const p = this.pending.get(id)
    if (!p) {
      return
    }
    this.pending.delete(id)
    p.cleanup()
    if (outcome !== 'allowed') {
      this.rejected.add(p.view.turnId)
    }
    try {
      this.persist(p, outcome, reason, actor, grantId)
      this.events.publish(p.view.sessionId, p.view.epoch, p.view.turnId, {
        type: 'approval.resolved',
        approvalId: id,
      })
      this.publishHead(p.view)
      p.resolve({
        decision: {
          ...p.decision,
          allowed: outcome === 'allowed',
          reason:
            outcome === 'allowed'
              ? grantId
                ? '最终参数匹配会话授权，并已单独确认本次不可回滚执行。'
                : '仅本次最终参数获批；不生成会话授权。'
              : `${reason} 未执行；本轮不自动改换形式重试。`,
        },
        authorizationCurrent: () =>
          !grantId ||
          this.grants.current(grantId, p.view.sessionId, p.scope, p.view.risk.policyVersion),
      })
    } catch (error) {
      this.rejected.add(p.view.turnId)
      p.reject(error)
      throw error
    } finally {
      if (this.rejected.has(p.view.turnId)) {
        this.invalidateTurn(p.view.turnId, '本轮已有拒绝、取消或失效决定；不自动改换形式重试。')
      }
    }
  }
  private invalidateTurn(turnId: string, reason: string): void {
    for (const p of this.pending.values()) {
      if (p.view.turnId === turnId) {
        this.finishSafe(p.view.id, 'invalidated', reason)
      }
    }
  }
  private persist(
    p: Pending,
    decision: Outcome | 'pending',
    reason: string,
    actor: string | null,
    grantId: string | null = null,
  ): void {
    const v = p.view
    this.store.saveApproval({
      id: v.id,
      sessionId: v.sessionId,
      epoch: v.epoch,
      turnId: v.turnId,
      source: 'workbench',
      decision,
      parameters: this.redactor.value({
        tool: v.tool,
        callId: v.callId,
        parentId: v.parentId,
        cwd: v.cwd,
        parameters: v.parameters,
        risk: v.risk,
        createdAt: v.createdAt,
        decidedAt: decision === 'pending' ? null : Date.now(),
        actor,
        grantId,
        irreversible: true,
      }),
      reason: this.redactor.text(reason),
    })
  }
  private matching(p: Pending): string | null {
    return p.view.sessionPermission.eligible
      ? this.grants.find(p.view.sessionId, p.scope, p.view.risk.policyVersion)
      : null
  }
  private visible(p: Pending): ExecutionApproval {
    return {
      ...p.view,
      sessionPermission: { ...p.view.sessionPermission, matchingGrantId: this.matching(p) },
    }
  }
  private publishHead(binding: Binding): void {
    const head = [...this.pending.values()].find(
      (p) =>
        p.view.sessionId === binding.sessionId &&
        p.view.epoch === binding.epoch &&
        p.view.turnId === binding.turnId,
    )
    if (head) {
      this.events.publish(binding.sessionId, binding.epoch, binding.turnId, {
        type: 'approval.requested',
        approval: {
          id: head.view.id,
          command: `${head.view.tool} · ${head.view.risk.level} · 最终参数待明确审批`,
          cwd: binding.cwd,
        },
      })
    }
  }
}
