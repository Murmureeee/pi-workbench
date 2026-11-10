import { expect, test } from 'vitest'

import { previewPdf } from '../../../e2e/helpers/preview-files.js'
import { renderPdf } from '../../desktop/src/pdf-preview.js'

test('file-04 actual Windows PDF memory stream renders every page to bounded PNG, including active document actions as inert pixels', async () => {
  const pages = await renderPdf(previewPdf(2), () => true)
  expect(pages).toHaveLength(2)
  for (const page of pages) {
    expect(page.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(page.readUInt32BE(16)).toBe(1200)
    expect(page.readUInt32BE(20)).toBeLessThanOrEqual(1800)
    expect(page.length).toBeGreaterThan(1000)
  }
  if (!pages[0] || !pages[1]) {
    throw Error('native PDF pages missing')
  }
  expect(pages[0].equals(pages[1])).toBe(false)
})

test('file-04 native PDF decoder refuses malformed and over-page documents without returning partial pages; next valid render recovers', async () => {
  await expect(renderPdf(Buffer.from('%PDF-1.7\ncorrupt\n%%EOF'), () => true)).rejects.toThrow(
    '损坏',
  )
  await expect(renderPdf(previewPdf(13), () => true)).rejects.toThrow('12 页')
  expect(await renderPdf(previewPdf(1), () => true)).toHaveLength(1)
})

test('file-04 actual in-flight native PDF helper cancellation drains owned process before rejecting and permits another render', async () => {
  let active = true
  const pending = renderPdf(previewPdf(12), () => active)
  const cancel = setTimeout(() => {
    active = false
  }, 10)
  await expect(pending).rejects.toThrow('取消')
  clearTimeout(cancel)
  expect(await renderPdf(previewPdf(1), () => true)).toHaveLength(1)
})
