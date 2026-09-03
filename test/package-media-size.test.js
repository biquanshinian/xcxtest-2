/**
 * 微信代码质量：代码包内图片解码体积宽×高×4 不得超过 200KB。
 * 运行：node --test test/package-media-size.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const LIMIT = 200 * 1024
const ROOTS = ['images', 'pages', 'subpackages', 'components', 'custom-tab-bar']
const SKIP_DIR = new Set(['node_modules'])
const MEDIA = /\.(png|jpe?g|gif|webp|bmp)$/i

function walk(dir, acc) {
  let ents
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    return
  }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) walk(p, acc)
    } else if (MEDIA.test(e.name)) acc.push(p)
  }
}

function pngSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  return null
}

function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) {
      i += 1
      continue
    }
    const m = buf[i + 1]
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}

test('代码包图片解码体积不超过 200KB', () => {
  const files = []
  for (const r of ROOTS) walk(path.join(ROOT, r), files)
  assert.ok(files.length > 0)
  const over = []
  for (const p of files) {
    const buf = fs.readFileSync(p)
    const dim = pngSize(buf) || jpegSize(buf)
    if (!dim) continue
    const decoded = dim.w * dim.h * 4
    if (decoded >= LIMIT) {
      over.push(`${path.relative(ROOT, p)} ${dim.w}x${dim.h} ${(decoded / 1024).toFixed(1)}KB`)
    }
  }
  assert.deepEqual(over, [])
})
