import type { KernelService } from '../kernels/kernel.service.js'
import type { ModelService } from '../models/model.service.js'
import type { SecurityService } from '../security/security.service.js'
import type { ProjectService } from '../workspaces/project.service.js'
import type { WorkspaceService } from '../workspaces/workspace.service.js'
import type { SessionStore } from './session.store.js'
import type { ManagedSession, SessionReceipt, SessionSubmit } from '@pi-workbench/shared'

import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rmdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { HttpException } from '@nestjs/common'

import { KernelExecutionUncertain } from '../kernels/kernel.service.js'

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
  ) {}

  options() {
    return {
      version: 1,
      realProviderEnabled: false,
      localFixtureEnabled: this.development,
      projects: this.projects.list(),
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
    const project = input.configuration.projectId
      ? this.projects.list().find((item) => item.id === input.configuration.projectId)
      : undefined
    if (input.configuration.projectId && !project) {
      throw new HttpException('项目不存在，请重新选择。', 409)
    }
    if (project && project.workspaceId !== input.configuration.workspaceId) {
      throw new HttpException('项目默认目录已变化，请重新选择项目。', 409)
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
          : await this.workspaces.open(standalone!)
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
