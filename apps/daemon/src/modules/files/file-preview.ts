import type { FileReadInput, PreviewSnapshot, Redactor } from '@pi-workbench/shared'

import { join } from 'node:path'

import { readFileSnapshot } from './file-reading.js'

/** Same stable descriptor, exact-byte version, physical path and redaction boundary as
 * FILE-02. Capture remains host-only; no raw HTML transport or persistent preview cache. */
export async function capturePreview(
  root: string,
  path: string,
  input: FileReadInput,
  redactor: Redactor,
): Promise<PreviewSnapshot> {
  if (!/\.html?$/i.test(path)) {
    throw Error('隔离预览目前支持 UTF-8 HTML（256 KiB）；请使用代码阅读、IDE 或文件管理器。')
  }
  let bytes: Buffer = Buffer.alloc(0)
  const snapshot = await readFileSnapshot(root, path, redactor, input.version, undefined, (b) => {
    bytes = b
  })
  if (snapshot.status !== 'ready' || !snapshot.version) {
    throw Error(snapshot.diagnostic)
  }
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  if (redactor.text(text) !== text || snapshot.absolutePath !== join(root, path)) {
    throw Error('原件含需要脱敏的内容或路径，无法安全预览；请在本机自行核对原件。')
  }
  return {
    target: input.target,
    path: snapshot.path,
    absolutePath: snapshot.absolutePath,
    source: 'current-disk-uncertain',
    version: snapshot.version,
    checkedAt: snapshot.checkedAt,
    expiresAt: Date.now() + 5000,
    kind: 'html',
    bytes: bytes.length,
    content: bytes.toString('base64'),
  }
}
