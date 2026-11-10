import type { PreviewSnapshot } from '@pi-workbench/shared'

import { nativeImage } from 'electron'

import { renderPdf } from './pdf-preview.js'

export const escapePreviewText = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

function dimensions(kind: 'png' | 'jpeg', bytes: Buffer) {
  if (
    kind === 'png' &&
    bytes.length >= 33 &&
    bytes.subarray(12, 16).toString('ascii') === 'IHDR' &&
    bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex')) &&
    !bytes.includes(Buffer.from('acTL'))
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (
    kind === 'jpeg' &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[bytes.length - 2] === 255 &&
    bytes[bytes.length - 1] === 217
  ) {
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 255) {
        break
      }
      const marker = bytes[offset + 1]!,
        length = bytes.readUInt16BE(offset + 2)
      if (length < 2 || offset + 2 + length > bytes.length) {
        break
      }
      if ([192, 193, 194].includes(marker) && length >= 8) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
      }
      offset += 2 + length
    }
  }
  throw Error('图片损坏、不完整或属于不支持的动画／编码；请使用原件入口。')
}

/** Validate dimensions before decoding; only normalized static PNG rasters reach the
 * isolated viewer. HTML keeps the FILE-07 policy without image/resource permissions. */
export async function renderPreview(
  snapshot: PreviewSnapshot,
  bytes: Buffer,
  active: () => boolean,
  base: string,
) {
  if (snapshot.kind === 'html') {
    return { document: bytes, assets: [] as Buffer[], summary: 'HTML · 离线静态原件' }
  }
  if (snapshot.kind === 'text') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return {
      document: Buffer.from(
        `<meta charset="utf-8"><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:14px monospace">${escapePreviewText(text)}</pre>`,
      ),
      assets: [] as Buffer[],
      summary: 'UTF-8 纯文本 · 不执行 Markdown／HTML',
    }
  }
  let assets: Buffer[], summary: string
  if (snapshot.kind === 'pdf') {
    assets = await renderPdf(bytes, active)
    // The helper output remains untrusted; check every raster before protocol exposure.
    for (const page of assets) {
      const size = dimensions('png', page)
      if (size.width > 1200 || size.height > 1800 || !size.width || !size.height) {
        throw Error('PDF 页面结果无法核验。')
      }
    }
    summary = `PDF · 全部 ${assets.length} 页静态渲染 · 每页最多 1200×1800 · 非可选择文本`
  } else {
    const size = dimensions(snapshot.kind, bytes)
    if (
      !size.width ||
      !size.height ||
      size.width > 8192 ||
      size.height > 8192 ||
      size.width * size.height > 16000000
    ) {
      throw Error('图片超过边长 8192／1600 万像素限额；未解码，请使用原件入口。')
    }
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) {
      throw Error('图片无法完整解码；请使用原件入口。')
    }
    const decoded = image.getSize()
    if (decoded.width * decoded.height !== size.width * size.height) {
      throw Error('图片实际尺寸不匹配，未展示不完整结果。')
    }
    const normalized = image.toPNG()
    if (normalized.length > 16 * 1024 * 1024) {
      throw Error('图片渲染超过 16 MiB；请使用原件入口。')
    }
    assets = [normalized]
    summary = `${snapshot.kind.toUpperCase()} · ${decoded.width}×${decoded.height} · 静态图片`
  }
  return {
    assets,
    summary,
    document: Buffer.from(
      `<meta charset="utf-8"><style>body{margin:0;background:#ddd}figure{margin:12px;text-align:center}img{max-width:100%;height:auto;background:white}figcaption{font:13px system-ui;color:#222}</style>${assets.map((_, i) => `<figure><figcaption>${snapshot.kind === 'pdf' ? `第 ${i + 1} 页／共 ${assets.length} 页` : escapePreviewText(summary)}</figcaption><img src="${base}/asset/${i}" alt="${snapshot.kind === 'pdf' ? `PDF 第 ${i + 1} 页` : '图片'}"></figure>`).join('')}`,
    ),
  }
}
