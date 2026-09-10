import assert from 'assert'
import { bytesLookLikeHeif, ftypBrands, nameLooksHeif, nameLooksImage } from './heif-sniff.js'
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

function ftypBuffer(major, compat) {
  const extra = compat || []
  const size = 16 + extra.length * 4
  const bytes = new Uint8Array(size)
  bytes[0] = (size >> 24) & 0xff
  bytes[1] = (size >> 16) & 0xff
  bytes[2] = (size >> 8) & 0xff
  bytes[3] = size & 0xff
  const tag = 'ftyp'
  for (let i = 0; i < 4; i++) bytes[4 + i] = tag.charCodeAt(i)
  for (let i = 0; i < 4; i++) bytes[8 + i] = major.charCodeAt(i)
  extra.forEach((brand, n) => {
    for (let i = 0; i < 4; i++) bytes[16 + n * 4 + i] = brand.charCodeAt(i)
  })
  return bytes
}

assert.deepStrictEqual(ftypBrands(ftypBuffer('mif1', ['heic'])), ['mif1', 'heic'])
assert.ok(bytesLookLikeHeif(ftypBuffer('mif1', ['heic'])), 'OPPO HEIF 常见 mif1')
assert.ok(bytesLookLikeHeif(ftypBuffer('heic', ['mif1'])))
assert.ok(!bytesLookLikeHeif(ftypBuffer('avif', ['mif1'])))
assert.ok(!bytesLookLikeHeif(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])))
assert.ok(nameLooksImage('现场.HEIC', ''))
assert.ok(nameLooksImage('现场.heif', 'application/octet-stream'))
assert.ok(nameLooksHeif('IMG_001.HIF', ''))
assert.ok(!nameLooksImage('合同.pdf', ''))

console.log('image-pack selfcheck ok')
