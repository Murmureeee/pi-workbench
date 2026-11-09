import type { WorkspaceDatabase } from '../../infrastructure/database/database.js'
import type { FileService } from './file.service.js'
import type {
  InputReferenceCreate,
  ManagedSession,
  Redactor,
  SessionSubmit,
} from '@pi-workbench/shared'

import { createHash, randomUUID } from 'node:crypto'

import { HttpException } from '@nestjs/common'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'

import { inputReferenceSchema, workspaceEnvironmentTargetSchema } from '@pi-workbench/shared'

import { inputReferences } from '../../infrastructure/database/schema.js'

/** A saved input remains auditable when its live source fails revalidation; retry must
 * use a newly selected version instead of silently replaying the stale context. */
export class InputReferenceUnavailable extends HttpException {
  constructor(message: string) {
    super(`输入引用失效：${message} 请重新添加引用后发送新任务。`, 409)
  }
}
const fail = (message: string) => new InputReferenceUnavailable(message)

/** Private immutable input versions. SQLite stores original bytes, like the outbox;
 * every public read is redacted. No model, file write, new root or execution permit. */
export class InputReferenceService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly files: FileService,
    private readonly redactor: Redactor,
  ) {}

  async create(input: InputReferenceCreate) {
    let content: Buffer,
      path = '长粘贴',
      version: string,
      scope: string | null = null
    let from: number | null = null,
      to: number | null = null
    if (input.kind === 'paste') {
      content = Buffer.from(input.text, 'utf8')
      // Reject lone surrogates rather than silently replacing their received bytes.
      if (content.toString('utf8') !== input.text) {
        throw fail('粘贴含无效 Unicode；未保存替换字符。')
      }
      version = createHash('sha256').update(content).digest('hex')
    } else {
      const captured = await this.files.capture(
        input.target,
        input.path,
        input.kind === 'directory',
        input.version,
      )
      path = captured.path || '.'
      version = captured.version
      scope = JSON.stringify({
        target: input.target,
        root: captured.root,
        path: captured.path,
        workspaceId: captured.workspaceId,
      })
      content = captured.bytes
      if (input.kind === 'range') {
        from = input.from ?? null
        to = input.to ?? null
        const text = content.toString('utf8'),
          lines = text.split(/(?<=\n)|(?<=\r)(?!\n)/)
        if (/[\r\n]$/.test(text)) {
          lines.push('')
        }
        if (!from || !to || from > to || to > lines.length) {
          throw fail('代码范围不存在或超出真实行号。')
        }
        content = Buffer.from(lines.slice(from - 1, to).join(''), 'utf8')
      }
    }
    if (content.length > 256 * 1024) {
      throw fail('每项引用最多 256 KiB，请缩小范围。')
    }
    const data = inputReferenceSchema.parse({
      id: randomUUID(),
      draftId: input.draftId,
      kind: input.kind,
      path: this.redactor.text(path),
      from,
      to,
      bytes: content.length,
      version,
      preview: this.redactor.text(content.toString('utf8')),
      createdAt: Date.now(),
    })
    this.database.db.transaction((tx) => {
      tx.delete(inputReferences)
        .where(
          and(
            isNull(inputReferences.sessionId),
            lt(inputReferences.createdAt, Date.now() - 7 * 86400000),
          ),
        )
        .run()
      const total = tx
        .select({ bytes: sql<number>`coalesce(sum(length(content)), 0)` })
        .from(inputReferences)
        .where(isNull(inputReferences.sessionId))
        .get()!.bytes
      if (total + content.length > 32 * 1024 * 1024) {
        throw fail('未发送引用达到 32 MiB 容量，请处理草稿或等待过期；已发送版本保留。')
      }
      tx.insert(inputReferences)
        .values({
          id: data.id,
          draftId: data.draftId,
          data: JSON.stringify(data),
          scope,
          content,
          createdAt: data.createdAt,
        })
        .run()
    })
    return data
  }

  /** Revalidate original full-file versions before accepting a new submission. A known
   * accepted request is reconciled before reaching here, never re-read or replayed. */
  async prepare(input: SessionSubmit, session: ManagedSession): Promise<string> {
    if (!input.references) {
      return input.text
    }
    let size = 0
    const parts: string[] = []
    for (const id of input.references.ids) {
      const row = this.database.db
        .select()
        .from(inputReferences)
        .where(eq(inputReferences.id, id))
        .get()
      if (
        !row ||
        row.draftId !== input.references.draftId ||
        (row.sessionId && row.sessionId !== session.id)
      ) {
        throw fail('引用不存在、已过期或属于其他草稿／会话，请重新添加。')
      }
      const data = inputReferenceSchema.parse(JSON.parse(row.data))
      size += row.content.length
      if (size > 512 * 1024) {
        throw fail('本次引用合计超过 512 KiB，请移除或缩小范围。')
      }
      if (row.scope) {
        const saved: unknown = JSON.parse(row.scope)
        if (
          !saved ||
          typeof saved !== 'object' ||
          !('target' in saved) ||
          !('root' in saved) ||
          !('path' in saved) ||
          !('workspaceId' in saved) ||
          typeof saved.path !== 'string' ||
          saved.root !== session.cwd ||
          saved.workspaceId !== session.workspaceId
        ) {
          throw fail('引用执行目录与本次任务不一致，请在当前目录重新添加。')
        }
        const target = workspaceEnvironmentTargetSchema.parse(saved.target)
        if ('sessionId' in target && target.sessionId !== session.id) {
          throw fail('引用属于其他会话。')
        }
        try {
          // oxlint-disable-next-line no-await-in-loop -- each bounded reference must pass its own physical/version proof before submission.
          await this.files.capture(
            target,
            saved.path || '.',
            data.kind === 'directory',
            data.version,
          )
        } catch (error) {
          throw fail(error instanceof HttpException ? error.message : '文件版本核对失败。')
        }
      }
      const label = data.kind === 'directory' ? '目录引用（仅路径；未附目录内容）' : '输入引用'
      parts.push(
        `[${label} ${data.path}${data.from ? `:${data.from}-${data.to}` : ''} · ${data.bytes} UTF-8 bytes · version ${data.version}]\n${row.content.toString('utf8')}`,
      )
    }
    return [input.text, ...parts].filter(Boolean).join('\n\n')
  }
}
