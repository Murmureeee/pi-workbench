import { Buffer } from 'node:buffer'
// @env node
import { nativeImage } from 'electron'

/** A bundled monochrome π glyph. No network assets or external runtime. */
export function trayIcon() {
  const pixels = Buffer.alloc(32 * 32 * 4)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const background = x >= 2 && x < 30 && y >= 2 && y < 30
      const glyph =
        (y >= 9 && y < 12 && x >= 7 && x < 25) ||
        (y >= 12 && y < 24 && ((x >= 10 && x < 13) || (x >= 21 && x < 24)))
      const offset = (y * 32 + x) * 4
      pixels.fill(glyph ? 245 : 42, offset, offset + 3)
      pixels[offset + 3] = background ? 255 : 0
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: 32, height: 32, scaleFactor: 1 })
}
