import type { Redactor } from '@pi-workbench/shared'

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

import { fileIdentity, proveFilePath } from '../../infrastructure/file-boundary.js'

/** Read one bounded descriptor, checking both its version and physical ancestor chain
 * before/after IO. No fallback decoder, partial file, ledger access or filesystem writes.
 * Cancellation retains its FileService slot until descriptor cleanup actually settles. */
export async function readFileSnapshot(
  root: string,
  path: string,
  redactor: Redactor,
  expected?: string,
  signal?: AbortSignal,
  capture?: (bytes: Buffer) => void,
) {
  const before = await proveFilePath(root, path)
  if (!before.stat.isFile()) {
    throw new Error('此项不是普通文件。')
  }
  const base = {
    path: redactor.text(path),
    absolutePath: redactor.text(before.absolute),
    checkedAt: Date.now(),
    bytes: before.stat.size,
    version: null as string | null,
    lines: [] as string[],
  }
  if (before.stat.size > 256 * 1024) {
    return {
      ...base,
      status: 'too_large' as const,
      diagnostic: '文件超过只读阅读的 256 KiB 限额；未读取部分内容。',
    }
  }
  signal?.throwIfAborted()
  const fd = await open(before.absolute, constants.O_RDONLY)
  let bytes: Buffer
  try {
    const opened = await fd.stat()
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      fileIdentity(opened) !== fileIdentity(before.stat)
    ) {
      throw new Error('文件已变化。')
    }
    const buffer = Buffer.alloc(256 * 1024 + 1)
    let length = 0
    while (length < buffer.length) {
      signal?.throwIfAborted()
      // oxlint-disable-next-line no-await-in-loop -- short descriptor reads must continue at the exact byte offset within the fixed allocation.
      const result = await fd.read(buffer, length, buffer.length - length, length)
      if (!result.bytesRead) {
        break
      }
      length += result.bytesRead
    }
    // NTFS can defer timestamp updates while a read descriptor remains open. A second
    // full pass also rejects same-length mutations with temporarily unchanged stamps.
    const verification = Buffer.alloc(length)
    let verified = 0
    while (verified < length) {
      signal?.throwIfAborted()
      // oxlint-disable-next-line no-await-in-loop -- Compare the same descriptor at exact offsets within the original fixed bound.
      const result = await fd.read(verification, verified, length - verified, verified)
      if (!result.bytesRead) {
        break
      }
      verified += result.bytesRead
    }
    const after = await proveFilePath(root, path),
      stat = await fd.stat()
    if (
      before.chain !== after.chain ||
      before.stamp !== after.stamp ||
      fileIdentity(stat) !== fileIdentity(opened) ||
      stat.size !== opened.size ||
      stat.mtimeMs !== opened.mtimeMs ||
      stat.ctimeMs !== opened.ctimeMs ||
      stat.nlink !== 1 ||
      length !== opened.size ||
      verified !== length ||
      !verification.equals(buffer.subarray(0, length))
    ) {
      throw new Error('读取期间文件变化，未展示混合内容。')
    }
    bytes = buffer.subarray(0, length)
  } finally {
    await fd.close()
  }
  signal?.throwIfAborted()
  const version = createHash('sha256')
    .update(before.chain)
    .update(before.stamp)
    .update(bytes)
    .digest('hex')
  const result = { ...base, version, checkedAt: Date.now() }
  if (expected && expected !== version) {
    return {
      ...result,
      status: 'changed' as const,
      diagnostic: '文件已在外部变化，旧正文已隐藏。请明确刷新读取新版本。',
    }
  }
  if (bytes.includes(0)) {
    return {
      ...result,
      status: 'binary' as const,
      diagnostic: '二进制或含 NUL 的文件，不作为代码文本展示。',
    }
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return {
      ...result,
      status: 'encoding' as const,
      diagnostic: '不是有效 UTF-8 文本；未猜测编码或展示替换字符。',
    }
  }
  // oxlint-disable-next-line no-control-regex -- reject binary control bytes, preserving text tab/CR/LF.
  if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    return {
      ...result,
      status: 'binary' as const,
      diagnostic: '包含二进制控制字节，不作为代码文本展示。',
    }
  }
  const raw = text.split(/\r\n|\n|\r/),
    visible = redactor.text(text).split(/\r\n|\n|\r/)
  if (raw.length > 10000) {
    return {
      ...result,
      status: 'too_large' as const,
      diagnostic: '文件超过 10,000 行阅读限额；未展示部分文件。',
    }
  }
  if (raw.length !== visible.length) {
    return {
      ...result,
      status: 'redacted_lines' as const,
      diagnostic: '脱敏改变了行数，无法保证真实行号；未展示代码或提供选区。',
    }
  }
  capture?.(bytes)
  return {
    ...result,
    status: 'ready' as const,
    lines: visible,
    diagnostic: '只读文件快照，已统一脱敏；两秒可见复查及加入输入前重验，外部变化需明确刷新。',
  }
}
