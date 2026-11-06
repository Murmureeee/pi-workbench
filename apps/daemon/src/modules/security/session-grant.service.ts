import type { SessionStore } from '../sessions/session.store.js'
import type { ExecutionPolicyService } from './execution-policy.service.js'
import type { ExecutionApproval, Redactor, SessionGrant } from '@pi-workbench/shared'

import { randomUUID } from 'node:crypto'

import { ConflictException } from '@nestjs/common'

import { sessionGrantListSchema } from '@pi-workbench/shared'

/** Host-only scope binds canonical parameters and every physical directory ancestor. Raw
 * matching keys stay in memory and are never restored from display/audit records. */
export interface GrantScope {
  key: string
  targetPath: string | null
  physicalIdentity: string
  parameterDigest: string
}
interface Grant {
  view: SessionGrant
  key: string
  epoch: string
  turnId: string
}

/** Daemon owns at most 64 live session grants. Revocation removes authority synchronously
 * before any audit IO; it never aborts an already running action. Restart/policy changes
 * discard authority. Baseline-free actions still require per-invocation irreversible consent.
 */
export class SessionGrantService {
  private readonly grants = new Map<string, Grant>()
  private auditWarning: string | null = null
  private readonly unsubscribe: () => void
  constructor(
    private readonly store: SessionStore,
    private readonly policy: ExecutionPolicyService,
    private readonly redactor: Redactor,
  ) {
    this.unsubscribe = policy.onInvalidate(() => this.revoke(null, null, '策略版本变化'))
  }
  list(sessionId?: string) {
    return sessionGrantListSchema.parse(
      this.redactor.value({
        grants: [...this.grants.values()]
          .filter((g) => !sessionId || g.view.sessionId === sessionId)
          .map((g) => g.view),
        auditWarning: this.auditWarning,
      }),
    )
  }
  find(sessionId: string, scope: GrantScope, policyVersion: number): string | null {
    return (
      [...this.grants.values()].find(
        (g) =>
          g.view.sessionId === sessionId &&
          g.key === scope.key &&
          g.view.policyVersion === policyVersion,
      )?.view.id ?? null
    )
  }
  current(id: string, sessionId: string, scope: GrantScope, policyVersion: number): boolean {
    const g = this.grants.get(id)
    return Boolean(
      g &&
      g.view.sessionId === sessionId &&
      g.key === scope.key &&
      g.view.policyVersion === policyVersion &&
      policyVersion === this.policy.policyVersion,
    )
  }
  /** Only a current ordinary approval can create a grant. The client supplies no scope
   * fields: the displayed immutable request determines the exact host-owned boundary. */
  create(approval: ExecutionApproval, scope: GrantScope, actor: string): string {
    if (
      !approval.sessionPermission.eligible ||
      approval.risk.level !== 'L2' ||
      approval.parentId !== null ||
      !['write', 'edit', 'bash', 'powershell'].includes(approval.tool) ||
      approval.risk.policyVersion !== this.policy.policyVersion
    ) {
      throw new ConflictException('此调用仅允许单次审批，不能生成会话授权。')
    }
    const existing = this.find(approval.sessionId, scope, approval.risk.policyVersion)
    if (existing) {
      return existing
    }
    if (this.grants.size >= 64) {
      throw new ConflictException('会话授权已达64条上限，请先撤销不需要的授权。')
    }
    const grant: Grant = {
      key: scope.key,
      epoch: approval.epoch,
      turnId: approval.turnId,
      view: {
        id: randomUUID(),
        sessionId: approval.sessionId,
        tool: approval.tool,
        cwd: approval.cwd,
        targetPath: scope.targetPath,
        physicalIdentity: scope.physicalIdentity,
        parameterDigest: scope.parameterDigest,
        parameters: approval.parameters,
        policyVersion: approval.risk.policyVersion,
        createdAt: Date.now(),
        actor,
      },
    }
    this.persist(grant, 'created', '显式授予相同最终参数的会话授权', actor)
    this.grants.set(grant.view.id, grant)
    return grant.view.id
  }
  /** Removal is immediate even when audit storage fails. A warning reports the lost audit;
   * no failed persistence path can retain or recreate the removed permission. */
  revoke(
    sessionId: string | null,
    id: string | null,
    reason: string,
    actor: string | null = null,
  ): void {
    const selected = [...this.grants.values()].filter(
      (g) => (!sessionId || g.view.sessionId === sessionId) && (!id || g.view.id === id),
    )
    if (id && !selected.length) {
      throw new ConflictException('授权已撤销或不属于此会话，请刷新。')
    }
    for (const g of selected) {
      this.grants.delete(g.view.id)
    }
    for (const g of selected) {
      try {
        this.persist(g, 'revoked', reason, actor)
      } catch {
        this.auditWarning = '授权已撤销并阻止后续复用，但审计记录保存失败；请核对本机存储。'
      }
    }
  }
  close(): void {
    this.unsubscribe()
    this.revoke(null, null, '服务退出；重启不恢复会话授权')
  }
  private persist(
    grant: Grant,
    event: 'created' | 'revoked',
    reason: string,
    actor: string | null,
  ): void {
    this.store.saveApproval({
      id: randomUUID(),
      sessionId: grant.view.sessionId,
      epoch: grant.epoch,
      turnId: grant.turnId,
      source: 'workbench',
      decision: event === 'created' ? 'allowed' : 'invalidated',
      parameters: this.redactor.value({
        kind: 'session-grant',
        event,
        grant: grant.view,
        actor,
        at: Date.now(),
        scope: 'exact-final-parameters',
        irreversibleConsent: 'per-invocation',
      }),
      reason: this.redactor.text(reason),
    })
  }
}
