import type { LegacySource } from '@pi-workbench/shared'

import { createHash } from 'node:crypto'
import {
  closeSync,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

import { HttpException } from '@nestjs/common'

import { readNativeHistory, readNativeMessage } from '@pi-workbench/agent-adapter'
import { legacyCatalogSchema, legacyPageSchema } from '@pi-workbench/shared'

const maxBytes = 16 * 1024 * 1024
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const fail = (message: string, status = 409) => new HttpException(message, status)
interface Discovered {
  path: string
  source: LegacySource
}

/** An external assistant without a known complete stop remains potentially partial. */
function incomplete(message: { role: string; outcome: string | null }): boolean {
  return (
    message.role === 'assistant' && !['stop', 'length', 'toolUse'].includes(message.outcome ?? '')
  )
}

/** External pi history is opt-in through the existing explicit PIW_PI_AGENT_DIR.
 * Only SDK's sessions/<cwd>/*.jsonl layout (and sessions/*.jsonl) is inspected. No SDK
 * manager, config/auth loader, DB write, runtime, migration, or authorization is invoked.
 * Opaque path IDs are resolved from discovery; clients never supply filesystem paths.
 */
export class LegacyHistoryService {
  private readonly root: string | null
  private discovered = new Map<string, Discovered>()
  constructor(piAgentDir?: string) {
    this.root = piAgentDir ? join(piAgentDir, 'sessions') : null
  }

  private checked(path: string) {
    if (!this.root) {
      throw fail('未指定旧 pi 历史来源。', 404)
    }
    const rel = relative(this.root, path)
    if (isAbsolute(rel) || rel.split(sep).some((part) => part === '..')) {
      throw fail('历史来源越界。')
    }
    let current = this.root
    for (const part of ['', ...rel.split(sep).filter(Boolean)]) {
      current = part ? join(current, part) : current
      if (lstatSync(current).isSymbolicLink()) {
        throw fail('不跟随历史来源链接；原件保留。')
      }
    }
    // A replaced ancestor must not redirect the explicit source while scanning.
    if (realpathSync(path) !== join(realpathSync(this.root), rel)) {
      throw fail('历史物理来源已变化。')
    }
    return lstatSync(path)
  }

  private snapshot(path: string, headerOnly = false) {
    const before = this.checked(path)
    if (!before.isFile() || before.size > maxBytes) {
      throw fail('历史不是普通文件或超过 16 MiB 只读上限。')
    }
    const fd = openSync(path, 'r')
    try {
      const start = fstatSync(fd)
      if (start.dev !== before.dev || start.ino !== before.ino || start.size !== before.size) {
        throw fail('历史来源已替换，请刷新。')
      }
      const bytes = Buffer.alloc(headerOnly ? Math.min(start.size, 65537) : start.size)
      if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length) {
        throw fail('历史读取不完整，请刷新。')
      }
      const after = fstatSync(fd),
        current = this.checked(path)
      if (
        [after, current].some(
          (value) =>
            value.dev !== start.dev ||
            value.ino !== start.ino ||
            value.size !== start.size ||
            value.mtimeMs !== start.mtimeMs ||
            value.ctimeMs !== start.ctimeMs,
        )
      ) {
        throw fail('CLI 正在写入历史，请刷新；原件保留。')
      }
      return {
        bytes,
        version: hash(
          Buffer.concat([Buffer.from(`${start.dev}:${start.ino}:${start.birthtimeMs}:`), bytes]),
        ),
        modifiedAt: start.mtimeMs,
      }
    } finally {
      closeSync(fd)
    }
  }

  discover() {
    const sessions: LegacySource[] = [],
      diagnostics: { code: string; message: string; line: number }[] = []
    const next = new Map<string, Discovered>()
    if (this.root) {
      try {
        this.checked(this.root)
        let inspected = 0
        const scan = (directory: string, nested: boolean) => {
          this.checked(directory)
          const dir = opendirSync(directory)
          try {
            let entry
            while ((entry = dir.readSync())) {
              inspected += 1
              if (inspected > 2000 || sessions.length >= 200) {
                diagnostics.push({
                  code: 'discovery-limit',
                  message: '最多检查 2000 个目录项、展示 200 个文件；其余来源未检查。',
                  line: 0,
                })
                break
              }
              const path = join(directory, entry.name)
              if (entry.isSymbolicLink()) {
                diagnostics.push({ code: 'source-link', message: '跳过链接来源。', line: 0 })
                continue
              }
              if (entry.isDirectory() && !nested) {
                scan(path, true)
                continue
              }
              if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
                continue
              }
              const id = hash(relative(this.root!, path))
              const source: LegacySource = {
                id,
                path,
                nativeId: null,
                cwd: null,
                timestamp: null,
                modifiedAt: 0,
                readOnly: true,
                diagnostic: null,
              }
              try {
                const snapshot = this.snapshot(path, true)
                source.modifiedAt = snapshot.modifiedAt
                const end = snapshot.bytes.indexOf(10)
                if (end < 0 || end > 64 * 1024) {
                  throw fail('首行未完整或超过 64 KiB，请刷新。')
                }
                const header: unknown = JSON.parse(
                  new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes.subarray(0, end)),
                )
                if (
                  !header ||
                  typeof header !== 'object' ||
                  !('type' in header) ||
                  header.type !== 'session' ||
                  !('id' in header) ||
                  typeof header.id !== 'string' ||
                  !('cwd' in header) ||
                  typeof header.cwd !== 'string'
                ) {
                  throw fail('pi 会话头损坏，原件保留。')
                }
                source.nativeId = header.id
                source.cwd = header.cwd
                source.timestamp =
                  'timestamp' in header && typeof header.timestamp === 'string'
                    ? header.timestamp
                    : null
                if (!('version' in header) || header.version !== 3) {
                  source.diagnostic = '仅支持只读 v3；此版本不兼容，未迁移原件。'
                }
              } catch (error) {
                source.diagnostic =
                  error instanceof HttpException
                    ? error.message
                    : '无法读取历史头；原件保留，请在源位置检查。'
              }
              sessions.push(source)
              next.set(id, { path, source })
            }
          } finally {
            dir.closeSync()
          }
        }
        scan(this.root, false)
      } catch {
        diagnostics.push({
          code: 'source-unavailable',
          message: '旧 pi sessions 目录不可用或为链接；请检查显式来源。',
          line: 0,
        })
      }
    }
    this.discovered = next
    return legacyCatalogSchema.parse({
      source: 'external-pi-jsonl',
      root: this.root,
      enabled: Boolean(this.root),
      sessions: sessions.toSorted((a, b) => b.modifiedAt - a.modifiedAt),
      diagnostics,
    })
  }

  private load(id: string, version?: string) {
    const entry = this.discovered.get(id)
    if (!entry) {
      throw fail('历史来源未发现，请重新扫描。', 404)
    }
    try {
      const snapshot = this.snapshot(entry.path)
      if (version && version !== snapshot.version) {
        throw fail('历史版本已变化（可能由 CLI 写入）；请刷新最新历史。')
      }
      const headerLine = snapshot.bytes.indexOf(10)
      if (headerLine < 0) {
        throw fail('首行未完整，请刷新。')
      }
      // Discovery metadata is never treated as authority for a later read.
      const header: unknown = JSON.parse(snapshot.bytes.subarray(0, headerLine).toString('utf8'))
      if (
        !header ||
        typeof header !== 'object' ||
        !('id' in header) ||
        header.id !== entry.source.nativeId ||
        !('cwd' in header) ||
        header.cwd !== entry.source.cwd
      ) {
        throw fail('历史身份已变化，请重新扫描。')
      }
      const history = readNativeHistory(snapshot.bytes, entry.source.nativeId ?? '')
      return { entry, snapshot, history }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      throw fail('历史暂不可读；请检查源文件后重新扫描，原件未修改。')
    }
  }

  read(id: string, version?: string, cursor?: string) {
    const { entry, snapshot, history } = this.load(id, version)
    const messages = history.records.flatMap((record) =>
      record.message ? [{ id: record.id, ...record.message }] : [],
    )
    const end = cursor ? messages.findIndex((message) => message.id === cursor) : messages.length
    if (end < 0 || (cursor && !version)) {
      throw fail('历史游标失效，请刷新。')
    }
    const start = Math.max(0, end - 100)
    return legacyPageSchema.parse({
      source: 'external-pi-jsonl',
      session: entry.source,
      version: snapshot.version,
      messages: messages
        .slice(start, end)
        .map(({ id: messageId, role, text, bytes, truncated, outcome }) => ({
          id: messageId,
          role,
          text,
          bytes,
          truncated,
          incomplete: incomplete({ role, outcome }),
        })),
      nextCursor: start ? messages[start]!.id : null,
      diagnostics: history.diagnostics.map(({ code, message, line }) => ({
        code,
        message,
        line,
      })),
      canResume: false,
    })
  }

  /** Full content is read from the exact bounded snapshot whose version the user saw.
   * No indexed byte range is reopened against a concurrently changed CLI file. */
  content(id: string, messageId: string, version: string) {
    const { snapshot, history } = this.load(id, version)
    const record = history.records.find((item) => item.id === messageId && item.message)
    if (!record) {
      throw fail('消息不存在或不可读，请刷新历史。', 404)
    }
    return {
      text: readNativeMessage(snapshot.bytes, record),
      incomplete: record.message ? incomplete(record.message) : true,
    }
  }
}
