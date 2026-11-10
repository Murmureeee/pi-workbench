import { deflateSync } from 'node:zlib'

/** Explicitly authored local preview fixtures, independent of SDK output/provenance.
 * PDF uses a real xref table, page objects and active annotations to test raster isolation. */
export function previewPdf(count = 2, destination = 'http://127.0.0.1:1/blocked') {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert\\(FORBIDDEN\\)) >> >>',
    `<< /Type /Pages /Count ${count} /Kids [${Array.from({ length: count }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  for (let i = 0; i < count; i++) {
    const content = `0.2 0.45 0.7 rg 30 150 340 90 re f BT /F1 22 Tf 30 110 Td (LOCAL PDF PAGE ${i + 1}) Tj ET`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R /Annots [<< /Type /Annot /Subtype /Link /Rect [0 0 400 300] /A << /S /URI /URI (${destination}) >> >>] >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    )
  }
  let document = '%PDF-1.7\n',
    offsets = ''
  for (let i = 0; i < objects.length; i++) {
    offsets += `${String(Buffer.byteLength(document)).padStart(10, '0')} 00000 n \n`
    document += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(document)
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(document)
}

/** Small true-color PNG encoder for deterministic local files; optional header geometry
 * intentionally differs from pixel bytes for a decompression-limit attack fixture. */
const crc = (bytes: Buffer) => {
  let value = 0xffffffff
  for (const b of bytes) {
    value ^= b
    for (let i = 0; i < 8; i++) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    }
  }
  return (value ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4),
    sum = Buffer.alloc(4),
    body = Buffer.concat([Buffer.from(type), data])
  length.writeUInt32BE(data.length)
  sum.writeUInt32BE(crc(body))
  return Buffer.concat([length, body, sum])
}
export function previewPng(width = 48, height = 32) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(
      Array.from({ length: 48 * 3 }, (_, i) => (i % 3 === 0 ? 40 : i % 3 === 1 ? 115 : 190)),
    ),
  ])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 32 }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Generated once with Windows System.Drawing (32×24 solid CornflowerBlue JPEG), no
// third-party image or provider. Native decoder and actual rendered dimensions verify it.
export const previewJpeg = () =>
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDq6KKK/os/KgooooAKKKKACiiigD//2Q==',
    'base64',
  )
