import assert from 'assert'
import { normalizeDegrees, readJpegOrientation } from './image-pack.js'

assert.strictEqual(normalizeDegrees(90), 90)
assert.strictEqual(normalizeDegrees(180), 180)
assert.strictEqual(normalizeDegrees(270), 270)
assert.strictEqual(normalizeDegrees(360), 0)
assert.strictEqual(normalizeDegrees(-90), 270)
assert.strictEqual(normalizeDegrees(0), 0)
assert.strictEqual(readJpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), 1)

function jpegWithOrientation(orient, le) {
  const tiff = le
    ? [
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00,
        0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orient, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
      ]
    : [
        0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
        0x00, 0x01,
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orient, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
      ]
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00].concat(tiff)
  const size = 2 + exif.length
  return Uint8Array.from(
    [0xff, 0xd8, 0xff, 0xe1, (size >> 8) & 0xff, size & 0xff].concat(exif).concat([0xff, 0xd9])
  )
}

assert.strictEqual(readJpegOrientation(jpegWithOrientation(6, false)), 6)
assert.strictEqual(readJpegOrientation(jpegWithOrientation(8, true)), 8)
assert.strictEqual(readJpegOrientation(jpegWithOrientation(3, false)), 3)

console.log('image-pack selfcheck ok')
