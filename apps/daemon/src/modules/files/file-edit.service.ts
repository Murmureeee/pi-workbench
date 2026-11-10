import type { AuditService } from '../security/audit.service.js'
import type { DirectoryWriteService } from '../workspaces/directory-write.service.js'
import type { FileService } from './file.service.js'
import type { FileEditSnapshot, Redactor } from '@pi-workbench/shared'

import { createHash, randomUUID } from 'node:crypto'

import { HttpException } from '@nestjs/common'

import { fileEditOpenSchema, fileEditResultSchema, fileEditSaveSchema } from '@pi-workbench/shared'

import { proveFilePath } from '../../infrastructure/file-boundary.js'
import { windowsFileSave } from './windows-file-save.js'

type Edit = {
  owner: string
  snapshot: FileEditSnapshot
  root: string
  path: string
  chain: string
  expires: number
  confirmation?: { id: string; version: string; textHash: string }
  busy: boolean
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const denied = (message: string) => new HttpException(message, 409)

/** Daemon-owned, client-bound editor. No raw secret may enter an editable renderer;
 * saves are human/external audit events, never tool provenance or historical decisions.
 * Four native operations / sixteen volatile edit permits; shutdown drains actual IO. */
export class FileEditService {
  private readonly edits = new Map<string, Edit>()
  private readonly running = new Set<Promise<unknown>>()
  private closing = false
  constructor(
    private readonly files: FileService,
    private readonly writes: DirectoryWriteService,
    private readonly audit: AuditService,
    private readonly redactor: Redactor,
  ) {}

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing || this.running.size >= 4) {
      throw denied('文件编辑正在关闭或繁忙；请保留稿件稍后重试。')
    }
    const pending = operation()
    this.running.add(pending)
    try {
      return await pending
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      throw denied('保存或读取未完成；编辑稿保留。请核对文件、权限与独占占用后重试；不会自动覆盖。')
    } finally {
      this.running.delete(pending)
    }
  }
  private decode(bytes: Buffer) {
    if (bytes.length > 262144 || bytes.includes(0)) {
      throw denied('仅编辑 256 KiB 内的完整 UTF-8 普通文本。')
    }
    let raw: string
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw denied('编码不是有效 UTF-8，保留只读。')
    }
    if (
      // oxlint-disable-next-line no-control-regex -- Editor must not round-trip binary controls.
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw) ||
      raw.split(/\r\n|\r|\n/).length > 10000
    ) {
      throw denied('二进制控制字符或超过 10,000 行，保留只读。')
    }
    if (this.redactor.text(raw) !== raw) {
      throw denied(
        '文本包含需要脱敏的内容，不能把脱敏替换写回原件；保留只读，可明确使用外部编辑器。',
      )
    }
    const withoutCRLF = raw.replaceAll('\r\n', '')
    if (withoutCRLF.includes('\r') || (raw.includes('\r\n') && withoutCRLF.includes('\n'))) {
      throw denied('混合换行或单独 CR 不支持精确往返编辑，保留只读。')
    }
    return {
      text: raw.replaceAll('\r\n', '\n'),
      bom: bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])),
      newline: raw.includes('\r\n')
        ? ('crlf' as const)
        : raw.includes('\n')
          ? ('lf' as const)
          : ('none' as const),
    }
  }

  open(value: unknown, owner: string, signal?: AbortSignal) {
    return this.run(async () => {
      const q = fileEditOpenSchema.parse(value),
        target = await this.files.editTarget(q)
      if (this.redactor.text(target.absolute) !== target.absolute) {
        throw denied('路径需要脱敏，保留只读；请明确选择外部编辑器。')
      }
      signal?.throwIfAborted()
      const read = await windowsFileSave(target.absolute)
      if (read.status !== 'ready') {
        throw denied('无法取得独占读取；文件可能变化、占用或权限不足。')
      }
      const after = await this.files.editTarget({
        target: q.target,
        source: { path: target.absolute },
      })
      if (target.chain !== after.chain) {
        throw denied('文件或目录被替换，未开放编辑。')
      }
      signal?.throwIfAborted()
      const bytes = Buffer.from(read.bytes, 'base64'),
        format = this.decode(bytes)
      for (const [id, e] of this.edits) {
        if (e.expires < Date.now() && !e.busy) {
          this.edits.delete(id)
        }
      }
      const existing = [...this.edits.values()].find(
        (e) =>
          e.owner === owner &&
          !e.busy &&
          e.root === target.root &&
          e.path === target.path &&
          e.chain === target.chain &&
          e.snapshot.version === read.version &&
          JSON.stringify(e.snapshot.target) === JSON.stringify(q.target),
      )
      if (existing) {
        return existing.snapshot
      }
      if (this.edits.size >= 16) {
        throw denied('编辑许可达到 16 项限额；稿件保留，请重新连接后重验。')
      }
      const snapshot: FileEditSnapshot = {
        editId: randomUUID(),
        target: q.target,
        path: this.redactor.text(target.path),
        absolutePath: this.redactor.text(target.absolute),
        version: read.version,
        ...format,
        bytes: bytes.length,
        source: 'current-disk',
      }
      this.edits.set(snapshot.editId, {
        owner,
        snapshot,
        ...target,
        expires: Date.now() + 8 * 3600000,
        busy: false,
      })
      return snapshot
    })
  }

  save(value: unknown, owner: string, signal?: AbortSignal) {
    return this.run(async () => {
      const q = fileEditSaveSchema.parse(value),
        e = this.edits.get(q.editId)
      if (!e || e.owner !== owner || e.expires < Date.now() || e.busy) {
        throw denied('编辑许可已失效或保存正在进行；保留稿件并重新读取核对。')
      }
      const encoded = Buffer.from(
        (e.snapshot.bom ? '\ufeff' : '') +
          q.text.replaceAll('\n', e.snapshot.newline === 'crlf' ? '\r\n' : '\n'),
      )
      if (
        q.text.includes('\r') ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(q.text)
      ) {
        throw denied('编辑稿含不支持的 CR 或无效 Unicode，未保存。')
      }
      this.decode(encoded)
      const confirmation = e.confirmation
      if (
        q.confirmationId &&
        (!confirmation ||
          confirmation.id !== q.confirmationId ||
          confirmation.textHash !== hash(q.text))
      ) {
        throw denied('覆盖确认与当前稿件不一致；请重新核对冲突。')
      }
      const expected = q.confirmationId ? confirmation!.version : e.snapshot.version
      e.confirmation = undefined
      e.busy = true
      let release: (() => void) | undefined
      try {
        const current = await this.files.editTarget({
          target: e.snapshot.target,
          source: { path: e.snapshot.absolutePath },
        })
        if (current.root !== e.root || current.chain !== e.chain) {
          throw denied('物理目录或文件身份已替换；禁止覆盖。编辑稿保留，请另存或重新读取。')
        }
        try {
          release = this.writes.acquireManual(
            e.root,
            'sessionId' in e.snapshot.target ? e.snapshot.target.sessionId : undefined,
          )
        } catch {
          throw denied('目录有受管写入或回滚正在进行；编辑稿保留，请等待实际结束后重试。')
        }
        const proof = await proveFilePath(e.root, e.path)
        if (proof.chain !== e.chain) {
          throw denied('保存前路径身份已变化，编辑稿保留。')
        }
        signal?.throwIfAborted()
        this.audit.record({
          kind: 'user-file-save',
          objectId: q.editId,
          sessionId: 'sessionId' in e.snapshot.target ? e.snapshot.target.sessionId : null,
          source: 'human',
          actor: owner,
          risk: 'L1',
          decision: 'requested',
          scope: JSON.stringify({
            path: e.snapshot.absolutePath,
            expected,
            textHash: hash(q.text),
          }),
          reason: q.confirmationId
            ? '明确单次覆盖当前冲突版本；用户／外部修改'
            : '用户保存；来源不归属 agent',
        })
        signal?.throwIfAborted()
        const result = await windowsFileSave(proof.absolute, expected, encoded)
        e.confirmation = undefined
        if (result.status === 'changed') {
          const id = randomUUID()
          e.confirmation = { id, version: result.version, textHash: hash(q.text) }
          return fileEditResultSchema.parse({
            status: 'conflict',
            version: result.version,
            confirmationId: id,
            source: 'user-external',
            diagnostic:
              '外部内容或权限／版本已变化。编辑稿保留；查看磁盘后，须单独明确确认才能覆盖本次版本。再次变化仍会拒绝。',
          })
        }
        if (result.status !== 'saved') {
          throw denied(
            result.status === 'uncertain'
              ? '写入及恢复均失败，磁盘可能是部分内容；编辑稿保留，请核对磁盘，禁止自动重试。'
              : '独占写入失败或权限／占用变化；编辑稿保留，请核对磁盘后重试。',
          )
        }
        e.snapshot = { ...e.snapshot, version: result.version, text: q.text, bytes: encoded.length }
        this.audit.record({
          kind: 'user-file-save',
          objectId: q.editId,
          sessionId: 'sessionId' in e.snapshot.target ? e.snapshot.target.sessionId : null,
          source: 'human',
          actor: owner,
          risk: 'L1',
          decision: 'saved',
          scope: JSON.stringify({ path: e.snapshot.absolutePath, version: result.version }),
          reason: '用户／外部修改；不改历史 Diff、接受决定或用户 Git 历史，混合／未知仍不确定。',
        })
        return fileEditResultSchema.parse({
          status: 'saved',
          version: result.version,
          confirmationId: null,
          source: 'user-external',
          diagnostic: '已保存为用户／外部修改；历史 Diff 和决定保留。',
        })
      } finally {
        e.busy = false
        release?.()
      }
    })
  }
  /** Stop issuing permits and drain native operations before KernelService closes SQLite. */
  async close() {
    this.closing = true
    await Promise.allSettled(this.running)
    this.edits.clear()
  }
}
