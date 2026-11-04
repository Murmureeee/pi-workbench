import type { EventService } from '../events/event.service.js'
import type { KernelService } from '../kernels/kernel.service.js'
import type { ModelService } from '../models/model.service.js'
import type { SecurityService } from '../security/security.service.js'
import type { TrustService } from '../security/trust.service.js'
import type { ProjectService } from '../workspaces/project.service.js'
import type { WorkspaceService } from '../workspaces/workspace.service.js'
import type { SessionStore } from './session.store.js'
import type {
  ManagedSession,
  ProjectCommand,
  SessionOrganize,
  SessionProject,
  SessionReceipt,
  SessionRename,
  SessionSubmit,
} from '@pi-workbench/shared'

import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rmdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { HttpException } from '@nestjs/common'

import { sessionProjectSchema, sessionRenameSchema, sessionSpaceSchema } from '@pi-workbench/shared'

import { KernelExecutionUncertain } from '../kernels/kernel.service.js'
import { SessionOrganizationConflict, SessionTitleConflict } from './session.store.js'

/** Desktop first-send authority. Persists immutable input before admission, reconciles
 * request IDs before checking mutable resources, and never retries background work.
 * Only the existing isolated SDK/local fixture can execute; provider transport stays shut.
 */
export class SessionService {
  private readonly accepting = new Map<
    string,
    { digest: string; promise: Promise<SessionReceipt> }
  >()
  constructor(
    private readonly dataDir: string,
    private readonly development: boolean,
    private readonly store: SessionStore,
    private readonly kernels: KernelService,
    private readonly workspaces: WorkspaceService,
    private readonly projects: ProjectService,
    private readonly models: ModelService,
    private readonly security: SecurityService,
    private readonly events: EventService,
    private readonly trust: TrustService,
  ) {}

  options() {
    return {
      version: 1,
      realProviderEnabled: false,
      localFixtureEnabled: this.development,
      projects: this.projects.list(),
    }
  }

  /** Read-only policy/source inspection binds the persisted execution cwd, never a project's
   * current default. No grants, model admission, config merge or source body is returned. */
  async space(sessionId: string) {
    const session = this.store.managedSessions().find((row) => row.id === sessionId)
    const origin = this.store.origin(sessionId)
    if (!session || !origin) {
      throw new HttpException('会话执行空间不存在，旧 pi 历史仅供只读。', 404)
    }
    const before = await this.workspaces.environmentDirectory(session.workspaceId, session.cwd)
    if (!before.ok) {
      throw new HttpException('执行目录当前不可用，保留原会话与来源；请恢复后重新核对。', 409)
    }
    const snapshot = this.trust.inspect(session.cwd)
    const after = await this.workspaces.environmentDirectory(session.workspaceId, session.cwd)
    const current = this.store.managedSessions().find((row) => row.id === sessionId)
    if (
      !after.ok ||
      after.canonicalPath !== before.canonicalPath ||
      current?.membershipVersion !== session.membershipVersion
    ) {
      throw new HttpException('核对期间目录或归属已变化，请重新核对；原文件保留。', 409)
    }
    const loaded = snapshot.activeTurns
      .filter((turn) => turn.sessionId === sessionId)
      .flatMap((turn) => turn.resources)
    return sessionSpaceSchema.parse({
      sessionId,
      cwd: session.cwd,
      workspaceId: session.workspaceId,
      standalone: origin.kind === 'standalone',
      projectId: session.configuration.projectId,
      membershipVersion: session.membershipVersion,
      origin,
      policy: 'host-tools-disabled',
      realProviderEnabled: false,
      activeContextCount: loaded.length,
      resources: snapshot.resources.map(
        ({ project: _project, preview: _preview, impact: _impact, ...resource }) => ({
          ...resource,
          enabledNextTurn: resource.capability === 'context-only' && resource.trust === 'trusted',
          loadedNow: loaded.some(
            (row) => row.id === resource.id && row.fingerprint === resource.fingerprint,
          ),
        }),
      ),
      diagnostics: snapshot.diagnostics,
    })
  }

  /** Only changes attribution, even during a background task. No await separates project
   * validation and SQLite CAS; obsolete target or session versions cannot be overwritten. */
  setProject(sessionId: string, input: SessionProject) {
    const parsed = sessionProjectSchema.safeParse(input)
    if (!parsed.success) {
      throw new HttpException('项目归属或保存版本无效。', 400)
    }
    if (!this.store.managedSessions().some((row) => row.id === sessionId)) {
      throw new HttpException('会话不存在。', 404)
    }
    if (parsed.data.project) {
      this.projects.assertMembership(parsed.data.project.id, parsed.data.project.revision)
    }
    try {
      return this.store.setProject(
        sessionId,
        parsed.data.project?.id ?? null,
        parsed.data.expectedVersion,
      )
    } catch (error) {
      if (error instanceof SessionOrganizationConflict) {
        throw new HttpException(error.message, 409)
      }
      this.security.log('session-project-failed', error)
      throw new HttpException('归属未能保存，请核对最新归属后重试；执行空间和文件保留。', 503)
    }
  }

  /** Organizing a project never changes execution. Removal only releases attribution,
   * using the two owners' public APIs in one daemon-owned SQLite transaction. */
  organizeProject(id: string, input: Exclude<ProjectCommand, { action: 'edit' }>) {
    return this.projects.organize(id, input, () => this.store.detachProject(id))
  }

  /** Persist first, then notify metadata observers. No model requests or automatic retries.
   * The optional local binding protects future delayed local summaries from manual titles. */
  rename(sessionId: string, input: SessionRename, localRequestId?: string) {
    const parsed = sessionRenameSchema.safeParse(input)
    if (!parsed.success) {
      throw new HttpException('标题或保存版本无效。', 400)
    }
    if (!this.store.titles().some((row) => row.sessionId === sessionId)) {
      throw new HttpException('会话不存在，旧 pi 历史仅供只读。', 404)
    }
    try {
      const title = this.store.rename(
        sessionId,
        {
          ...parsed.data,
          title: this.security.redactor.text(parsed.data.title),
        },
        localRequestId,
      )
      this.events.publishTitle(title)
      return title
    } catch (error) {
      if (error instanceof SessionTitleConflict) {
        throw new HttpException(error.message, 409)
      }
      this.security.log('session-rename-failed', error)
      throw new HttpException('标题未能保存，请核对最新标题后重试；编辑内容保留。', 503)
    }
  }

  /** Reports daemon task/queue ownership even if the client view has been evicted. */
  activity() {
    const resources = this.kernels.resources()
    return this.store.activity().map((item) => {
      const kernel = resources.kernels.find((row) => row.sessionId === item.id)
      return Object.assign({}, item, {
        running:
          item.running ||
          resources.queue.some((row) => row.sessionId === item.id) ||
          Boolean(
            kernel &&
            (kernel.pins > 0 || ['starting', 'running', 'stopping'].includes(kernel.state)),
          ),
        approvals: Math.max(item.approvals, kernel?.waitingApproval ? 1 : 0),
      })
    })
  }

  /** No await between live checks and SQLite CAS: accepted activity cannot slip through.
   * Archive is organization only; stopping is a separate explicit kernel command. */
  organize(sessionId: string, input: SessionOrganize) {
    if (!this.store.managedSessions().some((item) => item.id === sessionId)) {
      throw new HttpException('会话不存在，请刷新列表。', 404)
    }
    if (input.action === 'archive' && input.archived) {
      const activity = this.activity().find((item) => item.id === sessionId)
      if (activity?.running || activity?.approvals || activity?.held) {
        throw new HttpException(
          '会话仍有运行、待审批或待处理任务；请先停止或处理，再确认归档。',
          409,
        )
      }
    }
    try {
      return this.store.organize(sessionId, input)
    } catch (error) {
      if (error instanceof SessionOrganizationConflict) {
        throw new HttpException(error.message, 409)
      }
      this.security.log('session-organization-failed', error)
      throw new HttpException('整理状态未能保存，请刷新核对；历史和草稿保留。', 503)
    }
  }

  submit(input: SessionSubmit): Promise<SessionReceipt> {
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const prior = this.store.submission(input.requestId)
    if (prior) {
      if (prior.digest !== digest) {
        return Promise.reject(new HttpException('请求标识已绑定其他内容，请先核对原提交。', 409))
      }
      return Promise.resolve(this.store.receipt(input.requestId)!)
    }
    const pending = this.accepting.get(input.requestId)
    if (pending) {
      return pending.digest === digest
        ? pending.promise
        : Promise.reject(new HttpException('正在保存的请求不能改写。', 409))
    }
    const promise = this.accept(input, digest).finally(() => this.accepting.delete(input.requestId))
    this.accepting.set(input.requestId, { digest, promise })
    return promise
  }

  private async accept(input: SessionSubmit, digest: string): Promise<SessionReceipt> {
    if (input.configuration.model.kind === 'provider') {
      const catalog = await this.models.discover()
      const provider = catalog.providers.find(
        (item) => item.id === input.configuration.model.provider,
      )
      if (
        !provider?.models.some(
          (model) =>
            model.id === input.configuration.model.model &&
            model.type === 'chat' &&
            model.sdkSupported &&
            model.parameters === 'ok',
        )
      ) {
        throw new HttpException('所选模型当前不可用，请刷新模型目录。', 409)
      }
      throw new HttpException('真实提供商传输仍关闭；配置已保留，没有调用模型或创建会话。', 409)
    }
    if (!this.development) {
      throw new HttpException('离线验收模型仅用于开发验证。', 403)
    }
    const existing = input.sessionId
      ? this.store.managedSessions().find((item) => item.id === input.sessionId)
      : undefined
    if (input.sessionId && !existing) {
      throw new HttpException('会话不存在，请刷新列表。', 404)
    }
    if (
      existing &&
      JSON.stringify(existing.configuration) !== JSON.stringify(input.configuration)
    ) {
      throw new HttpException('已有会话继续使用已保存配置；不能在发送时静默切换环境。', 409)
    }
    if (input.retryOf) {
      const failed = this.store.receipt(input.retryOf)
      if (
        !failed ||
        failed.session.id !== input.sessionId ||
        failed.submission.status !== 'failed' ||
        this.security.redactor.text(failed.submission.text) !== input.text
      ) {
        throw new HttpException(
          '只能明确重试当前会话已确认失败的任务；中断或结果未知不能重放。',
          409,
        )
      }
      input = { ...input, text: failed.submission.text }
    }
    if (!existing) {
      this.projects.assertDefault(input.configuration.projectId, input.configuration.workspaceId)
    }
    const sessionId = existing?.id ?? randomUUID()
    const standalone =
      !existing && !input.configuration.workspaceId
        ? join(this.dataDir, 'standalone', sessionId)
        : undefined
    let saved = false
    let createdDirectory = false
    try {
      if (standalone) {
        const base = join(this.dataDir, 'standalone')
        await mkdir(base, { recursive: true })
        if (
          (await lstat(base)).isSymbolicLink() ||
          relative(await realpath(this.dataDir), await realpath(base)) !== 'standalone'
        ) {
          throw new Error('Managed standalone boundary is not a private data directory')
        }
        await mkdir(standalone)
        createdDirectory = true
      }
      const workspace = existing
        ? await this.workspaces.validate(existing.workspaceId)
        : input.configuration.workspaceId
          ? await this.workspaces.validate(input.configuration.workspaceId)
          : await this.workspaces.open(standalone!, { remember: false })
      if (!workspace.ok) {
        throw new HttpException(workspace, 409)
      }
      if (existing && workspace.workspace.canonicalPath !== existing.cwd) {
        throw new HttpException('执行目录身份已变化，请检查工作区。', 409)
      }
      const prepared: ManagedSession = existing ?? {
        id: sessionId,
        createdAt: Date.now(),
        cwd: workspace.workspace.canonicalPath,
        workspaceId: workspace.workspace.id,
        creationRequestId: input.requestId,
        configuration: input.configuration,
        title:
          Array.from(
            this.security.redactor
              .text(input.text)
              .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
              .replace(/\s+/gu, ' ')
              .trim(),
          )
            .slice(0, 40)
            .join('') || '新任务',
        titleSource: 'local',
        titleVersion: 1,
        membershipVersion: 1,
      }
      if (!existing) {
        this.projects.assertDefault(input.configuration.projectId, input.configuration.workspaceId)
      } else if (
        JSON.stringify(
          this.store.managedSessions().find((row) => row.id === existing.id)?.configuration,
        ) !== JSON.stringify(input.configuration)
      ) {
        throw new HttpException('会话归属已变化，请刷新核对；原执行目录保留。', 409)
      }
      saved = this.store.acceptSubmission(input, digest, prepared)
      const receipt = this.store.receipt(input.requestId)!
      if (saved) {
        try {
          this.dispatch(receipt)
        } catch (error) {
          this.security.log('session-dispatch-failed', error)
          this.store.settleSubmission(
            input.requestId,
            'failed',
            '任务已保存，但未能启动。请检查本地服务后明确重试。',
          )
        }
      }
      return receipt
    } catch (error) {
      if (error instanceof SessionOrganizationConflict) {
        throw new HttpException(error.message, 409)
      }
      if (error instanceof HttpException) {
        throw error
      }
      this.security.log('session-accept-failed', error)
      throw new HttpException(
        '会话未能保存。请检查本地服务、数据目录或当前任务；草稿保留，可核对原请求后重试。',
        409,
      )
    } finally {
      if (standalone && createdDirectory && !saved) {
        await rmdir(standalone).catch((error: unknown) =>
          this.security.log('standalone-empty-cleanup-failed', error),
        )
      }
    }
  }

  private dispatch(receipt: SessionReceipt): void {
    const { session, submission } = receipt
    this.store.settleSubmission(submission.requestId, 'executing')
    void this.kernels
      .prompt(
        session.id,
        session.cwd,
        { turnId: submission.turnId, text: submission.text },
        {
          preflight: async () => {
            const checked = await this.workspaces.validate(session.workspaceId)
            if (!checked.ok || checked.workspace.canonicalPath !== session.cwd) {
              throw new Error('执行前目录复核失败；原会话与任务保留，请恢复目录后明确重试。')
            }
          },
        },
      )
      .then((result) => {
        this.store.settleSubmission(
          submission.requestId,
          result.outcome === 'error'
            ? 'failed'
            : result.outcome === 'aborted'
              ? 'aborted'
              : 'completed',
          result.error ? this.security.redactor.text(result.error) : null,
        )
        return undefined
      })
      .catch((error: unknown) => {
        this.security.log('session-run-failed', error)
        this.store.settleSubmission(
          submission.requestId,
          error instanceof KernelExecutionUncertain
            ? 'interrupted'
            : error instanceof Error && error.name === 'AbortError'
              ? 'aborted'
              : 'failed',
          error instanceof KernelExecutionUncertain
            ? '内核连接中断，执行结果待确认；请检查历史和现场，未自动重发。'
            : '内核未能完成任务。原会话与首条消息保留，请检查目录和本地服务后明确重试。',
        )
      })
      .catch((error: unknown) => this.security.log('session-settlement-failed', error))
  }
}
