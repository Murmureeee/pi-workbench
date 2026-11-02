import type { TurnBinding } from '@pi-workbench/shared'

import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

import { z } from 'zod'

import { historyPreviewBytes, turnBindingSchema } from '@pi-workbench/shared'

const headerSchema = z.object({
  type: z.literal('session'),
  version: z.literal(3),
  id: z.string(),
  cwd: z.string(),
})
const entrySchema = z.object({
  type: z.string(),
  id: z.string().min(1),
  parentId: z.string().nullable(),
})
const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'toolResult', 'system']),
  content: z.union([z.string(), z.array(z.unknown())]),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
})
const markerSchema = z.object({
  customType: z.literal('pi-workbench.turn.v1'),
  data: turnBindingSchema,
})
export interface NativeRecord {
  id: string
  parentId: string | null
  offset: number
  length: number
  line: number
  binding: TurnBinding | null
  message?: {
    role: 'user' | 'assistant' | 'toolResult'
    text: string
    bytes: number
    truncated: boolean
    outcome: string | null
    error: string | null
  }
}
export interface NativeDiagnostic {
  code: string
  message: string
  offset: number
  length: number
  line: number
}
export interface NativeHistory {
  records: NativeRecord[]
  diagnostics: NativeDiagnostic[]
  size: number
}

/** UTF-8 prefix bounded in bytes; never cuts a Unicode code point. Original bytes stay in JSONL. */
export function previewText(text: string): string {
  const bytes = Buffer.from(text)
  let end = Math.min(bytes.length, historyPreviewBytes)
  while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
    end -= 1
  }
  return bytes.subarray(0, end).toString('utf8')
}

function contentText(content: string | unknown[]): string {
  if (typeof content === 'string') {
    return content
  }
  return content
    .map((part) => {
      const text = z.object({ type: z.literal('text'), text: z.string() }).safeParse(part)
      return text.success ? text.data.text : JSON.stringify(part)
    })
    .join('')
}

/** Read-only v3 JSONL scan, using a fixed descriptor size and byte offsets for exact raw export.
 * Never calls SessionManager.open (which can migrate/rewrite). Bad lines stay on disk; an
 * incomplete tail is diagnosed and ignored until refresh. Only the latest leaf's branch is shown.
 */
export function readNativeHistory(
  path: string,
  nativeSessionId: string,
  expectedCwd?: string,
): NativeHistory {
  const result: NativeHistory = { records: [], diagnostics: [], size: 0 }
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch (error) {
    result.diagnostics.push({
      code: 'unavailable',
      message: error instanceof Error ? error.message : 'Native history unavailable',
      offset: 0,
      length: 0,
      line: 0,
    })
    return result
  }
  try {
    const size = fstatSync(fd).size
    result.size = size
    const entries = new Map<string, NativeRecord>()
    let offset = 0,
      line = 0,
      pending = Buffer.alloc(0),
      headerValid = false
    const parse = (bytes: Buffer, length: number) => {
      line += 1
      const start = offset
      offset += length
      try {
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        if (line === 1) {
          const header = headerSchema.parse(value)
          if (header.id !== nativeSessionId) {
            throw new Error('Native session identity mismatch')
          }
          if (expectedCwd !== undefined && header.cwd !== expectedCwd) {
            throw new Error('Native session cwd mismatch')
          }
          headerValid = true
          return
        }
        if (!headerValid) {
          return
        }
        const entry = entrySchema.parse(value)
        if (entries.has(entry.id)) {
          throw new Error('Duplicate native entry ID')
        }
        if (entry.parentId !== null && !entries.has(entry.parentId)) {
          result.diagnostics.push({
            code: 'missing-parent',
            message: '父记录不可读；本页仅为部分历史，禁止继续执行。',
            offset: start,
            length,
            line,
          })
        }
        const marker = markerSchema.safeParse(value)
        const record: NativeRecord = {
          id: entry.id,
          parentId: entry.parentId,
          offset: start,
          length,
          line,
          binding: marker.success
            ? marker.data.data
            : entry.parentId
              ? (entries.get(entry.parentId)?.binding ?? null)
              : null,
        }
        // Keep a valid structural envelope even if its message is corrupt, so later readable
        // descendants remain diagnosable without manufacturing a replacement message.
        entries.set(entry.id, record)
        if (
          entry.type === 'custom' &&
          z.object({ customType: z.literal('pi-workbench.turn.v1') }).safeParse(value).success &&
          !marker.success
        ) {
          throw new Error('Invalid workbench turn binding')
        }
        if (entry.type === 'message') {
          const message = messageSchema.parse(
            z.object({ message: z.unknown() }).parse(value).message,
          )
          const text = contentText(message.content)
          if (message.role !== 'system') {
            record.message = {
              role: message.role,
              text: previewText(text),
              bytes: Buffer.byteLength(text),
              truncated: Buffer.byteLength(text) > historyPreviewBytes,
              outcome: message.stopReason ?? null,
              error: message.errorMessage ?? null,
            }
          }
        }
      } catch (error) {
        result.diagnostics.push({
          code: line === 1 ? 'incompatible-header' : 'invalid-record',
          message: error instanceof Error ? error.message : 'Invalid JSONL record',
          offset: start,
          length,
          line,
        })
      }
    }
    const buffer = Buffer.alloc(64 * 1024)
    let position = 0
    while (position < size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position)
      if (!count) {
        break
      }
      position += count
      pending = Buffer.concat([pending, buffer.subarray(0, count)])
      let newline = pending.indexOf(10)
      while (newline >= 0) {
        parse(pending.subarray(0, newline), newline + 1)
        pending = pending.subarray(newline + 1)
        newline = pending.indexOf(10)
      }
    }
    if (pending.length) {
      result.diagnostics.push({
        code: 'incomplete-tail',
        message: '末行未完整写入，保留原件并等待刷新。',
        offset,
        length: pending.length,
        line: line + 1,
      })
    }
    if (size === 0) {
      result.diagnostics.push({
        code: 'empty-history',
        message: '原生历史为空；保留原件并诊断。',
        offset: 0,
        length: 0,
        line: 0,
      })
    }
    const leaf = [...entries.values()].at(-1)
    let record = leaf
    while (record) {
      result.records.push(record)
      record = record.parentId ? entries.get(record.parentId) : undefined
    }
    result.records.reverse()
    if (result.diagnostics.some((diagnostic) => diagnostic.code === 'missing-parent')) {
      result.records = [...entries.values()]
    }
    if (fstatSync(fd).size !== size) {
      result.diagnostics.push({
        code: 'changed-during-read',
        message: '读取期间历史发生变化，请刷新。',
        offset: 0,
        length: 0,
        line: 0,
      })
    }
    return result
  } finally {
    closeSync(fd)
  }
}

/** Reads only a previously indexed byte range; routes never accept arbitrary filesystem paths. */
export function readNativeRange(path: string, offset: number, length: number): Buffer {
  const fd = openSync(path, 'r')
  try {
    const bytes = Buffer.alloc(length)
    const count = readSync(fd, bytes, 0, length, offset)
    if (count !== length) {
      throw new Error('History changed; refresh before exporting')
    }
    return bytes
  } finally {
    closeSync(fd)
  }
}

export function readNativeMessage(path: string, record: NativeRecord): string {
  const value: unknown = JSON.parse(
    readNativeRange(path, record.offset, record.length).toString('utf8'),
  )
  const entry = entrySchema.parse(value)
  if (entry.id !== record.id) {
    throw new Error('History identity changed')
  }
  return contentText(
    messageSchema.parse(z.object({ message: z.unknown() }).parse(value).message).content,
  )
}
