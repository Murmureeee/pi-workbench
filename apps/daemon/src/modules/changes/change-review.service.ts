import type { ChangeProvenanceService } from './change-provenance.service.js'
import type { ChangeService } from './change.service.js'
import type { ChangeDiff, ChangeFile, Redactor } from '@pi-workbench/shared'

import { createHash } from 'node:crypto'

import { changeDiffSchema, changeReviewSchema } from '@pi-workbench/shared'

import { fileKey } from '../../infrastructure/ledger/file-observation.js'

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
const textFile = (value: Buffer) => {
  if (value.includes(0)) {
    return false
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(value)
    return true
  } catch {
    return false
  }
}
type Entry = {
  id: string
  beforePath: string | null
  afterPath: string | null
  before: Buffer
  after: Buffer
  file: ChangeFile
}
const group = (paths: string[], hashes: Map<string, string>) => {
  const result = new Map<string, string[]>()
  for (const path of paths) {
    const key = hashes.get(path)!,
      list = result.get(key) ?? []
    list.push(path)
    result.set(key, list)
  }
  return result
}

/** Read-only historical review. Raw names/bytes remain host-private; opaque IDs select only
 * a member of two verified immutable manifests. Current workspace IO is never a fallback. */
export class ChangeReviewService {
  constructor(
    private readonly changes: ChangeService,
    private readonly provenance: ChangeProvenanceService,
    private readonly redactor: Redactor,
  ) {}

  private async entries(turnId: string) {
    const { record, identity } = this.changes.context(turnId)
    if (
      record.baseline.status !== 'ready' ||
      record.final.status !== 'ready' ||
      !record.baseline.reference ||
      !record.final.reference
    ) {
      return { record, identity, entries: null }
    }
    const before = await this.changes.snapshotFiles(turnId, 'baseline'),
      after = await this.changes.snapshotFiles(turnId, 'final')
    const beforeHashes = new Map([...before].map(([p, b]) => [p, hash(b)])),
      afterHashes = new Map([...after].map(([p, b]) => [p, hash(b)]))
    const raw: { beforePath: string | null; afterPath: string | null }[] = []
    const removed = [...before.keys()].filter((p) => !after.has(p)),
      added = [...after.keys()].filter((p) => !before.has(p)),
      paired = new Set<string>()
    const removedGroups = group(removed, beforeHashes),
      addedGroups = group(added, afterHashes)
    // Only unique byte-identical pairs count as renames. Duplicate blobs and renamed+edited
    // paths remain add/delete instead of guessing identity or relying on today's Git index.
    for (const path of removed) {
      const digest = beforeHashes.get(path)!,
        candidates = addedGroups.get(digest) ?? []
      if (candidates.length === 1 && removedGroups.get(digest)?.length === 1) {
        raw.push({ beforePath: path, afterPath: candidates[0]! })
        paired.add(path)
        paired.add(candidates[0]!)
      }
    }
    for (const path of removed) {
      if (!paired.has(path)) {
        raw.push({ beforePath: path, afterPath: null })
      }
    }
    for (const path of added) {
      if (!paired.has(path)) {
        raw.push({ beforePath: null, afterPath: path })
      }
    }
    for (const [path, bytes] of before) {
      if (after.has(path) && !bytes.equals(after.get(path)!)) {
        raw.push({ beforePath: path, afterPath: path })
      }
    }
    const stats = await this.changes.ledger.diffStats(
      identity,
      record.baseline.reference,
      record.final.reference,
    )
    const sources = new Map(
      (await this.provenance.analyze(turnId, { baseline: before, final: after })).files.map(
        (source) => [source.fileId, source],
      ),
    )
    const entries = raw
      .map(({ beforePath, afterPath }): Entry => {
        const b = beforePath ? before.get(beforePath)! : Buffer.alloc(0),
          a = afterPath ? after.get(afterPath)! : Buffer.alloc(0),
          renamed = beforePath !== null && afterPath !== null && beforePath !== afterPath,
          path = afterPath ?? beforePath!,
          id = hash(JSON.stringify([beforePath, afterPath])),
          binary = !textFile(b) || !textFile(a),
          source = sources.get(fileKey(path)),
          priorSource = beforePath ? sources.get(fileKey(beforePath)) : null,
          count = stats.get(path)
        const file: ChangeFile = {
          id,
          path: this.redactor.text(path),
          previousPath: renamed ? this.redactor.text(beforePath) : null,
          kind: renamed
            ? 'renamed'
            : beforePath === null
              ? 'added'
              : afterPath === null
                ? 'deleted'
                : 'modified',
          binary,
          beforeBytes: b.length,
          afterBytes: a.length,
          additions: binary ? null : renamed ? 0 : (count?.additions ?? null),
          deletions: binary ? null : renamed ? 0 : (count?.deletions ?? null),
          source:
            renamed && priorSource?.source !== source?.source
              ? 'unknown'
              : (source?.source ?? 'unknown'),
          reasons: source?.reasons ?? ['未找到完整文件来源证据。'],
          tools: source?.tools ?? [],
          automaticRollback: false,
        }
        return { id, beforePath, afterPath, before: b, after: a, file }
      })
      .toSorted((a, b) => a.id.localeCompare(b.id))
    return { record, identity, entries }
  }

  /** Host-only selection from verified immutable manifests. Never expose raw paths/bytes
   * as execution inputs; callers must revalidate physical targets under a directory lease. */
  rollbackEntries(turnId: string) {
    return this.entries(turnId)
  }

  async list(turnId: string, offset = 0) {
    const { record, entries } = await this.entries(turnId)
    return changeReviewSchema.parse(
      this.redactor.value({
        sessionId: record.sessionId,
        turnId,
        baselineReference: record.baseline.reference,
        finalReference: record.final.reference,
        available: entries !== null,
        diagnostic:
          entries === null
            ? '基线或收尾版本不可用；无法审查完整轮次差异，未读取当前文件代替。'
            : null,
        files: entries?.slice(offset, offset + 100).map((e) => e.file) ?? [],
        total: entries?.length ?? 0,
        next: entries && offset + 100 < entries.length ? offset + 100 : null,
        automaticRollback: false,
      }),
    )
  }

  async diff(turnId: string, id: string) {
    const { record, identity, entries } = await this.entries(turnId),
      entry = entries?.find((e) => e.id === id)
    if (!entry || !record.baseline.reference || !record.final.reference) {
      throw new Error('所选轮次文件或版本不可用。')
    }
    const hunks: ChangeDiff['hunks'] = []
    let diagnostic: string | null = null
    if (entry.file.binary) {
      diagnostic = '二进制或非UTF-8文件：保存原始版本，仅展示字节数，不提供文本Diff或行数。'
    } else if (
      entry.before.length + entry.after.length > 256 * 1024 ||
      entry.before.toString('utf8').split('\n').length +
        entry.after.toString('utf8').split('\n').length >
        4000
    ) {
      diagnostic = '文件超过256 KiB或4000行预览上限；完整版本与行数保留，未截断冒充完整Diff。'
    } else if (entry.file.kind === 'renamed') {
      diagnostic = '唯一且字节完全相同的路径重命名；文件内容未改变。'
    } else {
      // Redact complete file texts BEFORE extracting lines: patch +/- prefixes must not
      // split a known multiline value or PEM block. If filtering changes line structure,
      // withhold preview instead of inventing line numbers or leaking the remaining lines.
      const oldText = entry.before.toString('utf8'),
        newText = entry.after.toString('utf8'),
        oldLines = this.redactor.text(oldText).split('\n'),
        newLines = this.redactor.text(newText).split('\n')
      if (
        oldLines.length !== oldText.split('\n').length ||
        newLines.length !== newText.split('\n').length
      ) {
        return changeDiffSchema.parse({
          sessionId: record.sessionId,
          turnId,
          fileId: id,
          baselineReference: record.baseline.reference,
          finalReference: record.final.reference,
          file: entry.file,
          hunks: [],
          diagnostic: '脱敏改变了多行结构；为保持行号准确已隐藏文本预览，原始版本与统计保留。',
          redacted: true,
          automaticRollback: false,
        })
      }
      const patch = await this.changes.ledger.diffPatch(
        identity,
        record.baseline.reference,
        record.final.reference,
        entry.beforePath,
        entry.afterPath,
      )
      let oldLine = 0,
        newLine = 0,
        current: ChangeDiff['hunks'][number] | undefined
      for (const line of patch.split('\n')) {
        const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
        if (match) {
          oldLine = Number(match[1])
          newLine = Number(match[2])
          current = { header: match[0], lines: [] }
          hunks.push(current)
          continue
        }
        if (!current) {
          continue
        }
        const kind = line.startsWith('+')
          ? 'add'
          : line.startsWith('-')
            ? 'delete'
            : line.startsWith(' ')
              ? 'context'
              : line.startsWith('\\')
                ? 'note'
                : null
        if (!kind) {
          continue
        }
        const safeText =
          kind === 'note'
            ? '文件末尾没有换行'
            : kind === 'delete'
              ? oldLines[oldLine - 1]
              : newLines[newLine - 1]
        if (safeText === undefined) {
          throw new Error('历史Diff行号与完整文件不一致。')
        }
        current.lines.push({
          id: `${hunks.length}:${oldLine}:${newLine}:${kind}`,
          kind,
          text: safeText,
          oldLine: kind === 'add' || kind === 'note' ? null : oldLine++,
          newLine: kind === 'delete' || kind === 'note' ? null : newLine++,
        })
      }
      if (!hunks.length) {
        diagnostic = '零字节文件的路径变更，没有文本行差异。'
      }
    }
    return changeDiffSchema.parse({
      sessionId: record.sessionId,
      turnId,
      fileId: id,
      baselineReference: record.baseline.reference,
      finalReference: record.final.reference,
      file: entry.file,
      hunks,
      diagnostic,
      redacted: true,
      automaticRollback: false,
    })
  }
}
