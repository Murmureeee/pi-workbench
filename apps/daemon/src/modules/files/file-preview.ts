import type { FileReadInput, PreviewSnapshot, Redactor } from '@pi-workbench/shared'

import { join } from 'node:path'

import { previewKind } from '@pi-workbench/shared'

import { readFileBytes, readFileSnapshot } from './file-reading.js'

/** Same stable descriptor, exact-byte version, physical path and redaction boundary as
 * FILE-02. Capture remains host-only; no raw HTML transport or persistent preview cache. */
export async function capturePreview(
  root: string,
  path: string,
  input: FileReadInput,
  redactor: Redactor,
): Promise<PreviewSnapshot> {
  const kind = previewKind(path)
  if (!kind) {
    throw Error(
      '不支持此预览类型；支持 PNG、JPEG、PDF、静态 HTML 和 UTF-8 TXT／MD／JSON／CSV／LOG。请使用 IDE 或文件管理器。',
    )
  }
  let bytes: Buffer = Buffer.alloc(0)
  let version: string, checkedAt: number, absolutePath: string
  if (kind === 'html' || kind === 'text') {
    const snapshot = await readFileSnapshot(root, path, redactor, input.version, undefined, (b) => {
      bytes = b
    })
    if (snapshot.status !== 'ready' || !snapshot.version) {
      throw Error(snapshot.diagnostic)
    }
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    if (redactor.text(text) !== text) {
      throw Error('原件含需要脱敏的内容，无法安全预览；请在本机自行核对原件。')
    }
    ;({ version, checkedAt, absolutePath } = snapshot)
  } else {
    const snapshot = await readFileBytes(root, path, 8 * 1024 * 1024)
    ;({ bytes, version, checkedAt } = snapshot)
    absolutePath = snapshot.proof.absolute
    if (input.version && version !== input.version) {
      throw Error('文件已在外部变化，旧内容已隐藏；请明确重新打开当前版本。')
    }
    const signatureOK =
      kind === 'png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : kind === 'jpeg'
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : /^%PDF-1\.[0-9]|^%PDF-2\.0/.test(bytes.subarray(0, 12).toString('ascii')) &&
            bytes.subarray(-1024).includes(Buffer.from('%%EOF'))
    if (!signatureOK) {
      throw Error('文件签名不匹配或原件不完整；未安全预览，请使用原件入口。')
    }
    const raw = bytes.toString('latin1')
    if (redactor.text(raw) !== raw) {
      throw Error('原件含需要脱敏的文本内容，未预览；请在本机自行核对原件。')
    }
  }
  if (redactor.text(absolutePath) !== absolutePath || absolutePath !== join(root, path)) {
    throw Error('原件路径需要脱敏，无法安全预览；请在本机自行核对原件。')
  }
  return {
    target: input.target,
    path,
    absolutePath,
    source: 'current-disk-uncertain',
    version,
    checkedAt,
    expiresAt: Date.now() + 5000,
    kind,
    bytes: bytes.length,
    content: bytes.toString('base64'),
  }
}
