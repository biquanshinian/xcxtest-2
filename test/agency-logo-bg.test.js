/**
 * 单测：utils/agency-logo-bg.js 像素取色纯函数
 * 运行：node --test test/agency-logo-bg.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

const { pickLogoBgToneFromPixels } = require('../utils/agency-logo-bg.js')

function fillRgba(w, h, fillFn) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const c = fillFn(x, y, i)
      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
      data[i + 3] = c[3]
    }
  }
  return data
}

test('白色透明 logo → dark 底', () => {
  const w = 16
  const h = 16
  const data = fillRgba(w, h, (x, y) => {
    // 中心 8x8 白色不透明，其余全透明
    if (x >= 4 && x < 12 && y >= 4 && y < 12) return [255, 255, 255, 255]
    return [0, 0, 0, 0]
  })
  assert.equal(pickLogoBgToneFromPixels(data, w, h), 'dark')
})

test('蓝色透明 logo → light 底', () => {
  const w = 16
  const h = 16
  const data = fillRgba(w, h, (x, y) => {
    if (x >= 4 && x < 12 && y >= 4 && y < 12) return [0, 102, 204, 255]
    return [0, 0, 0, 0]
  })
  assert.equal(pickLogoBgToneFromPixels(data, w, h), 'light')
})

test('黑色透明 logo → light 底', () => {
  const w = 16
  const h = 16
  const data = fillRgba(w, h, (x, y) => {
    if (x >= 4 && x < 12 && y >= 4 && y < 12) return [20, 20, 20, 255]
    return [0, 0, 0, 0]
  })
  assert.equal(pickLogoBgToneFromPixels(data, w, h), 'light')
})

test('无透明（满幅不透明）→ 空 tone', () => {
  const w = 8
  const h = 8
  const data = fillRgba(w, h, () => [255, 255, 255, 255])
  assert.equal(pickLogoBgToneFromPixels(data, w, h), '')
})

test('透明占比过低 → 空 tone', () => {
  const w = 10
  const h = 10
  // 仅 1 像素透明（1%）
  const data = fillRgba(w, h, (x, y) => {
    if (x === 0 && y === 0) return [0, 0, 0, 0]
    return [0, 80, 200, 255]
  })
  assert.equal(pickLogoBgToneFromPixels(data, w, h), '')
})

test('有效不透明像素过少 → 空 tone', () => {
  const w = 16
  const h = 16
  const data = fillRgba(w, h, (x, y) => {
    if (x === 0 && y === 0) return [255, 255, 255, 255]
    return [0, 0, 0, 0]
  })
  assert.equal(pickLogoBgToneFromPixels(data, w, h), '')
})

test('非法输入 → 空 tone', () => {
  assert.equal(pickLogoBgToneFromPixels(null, 8, 8), '')
  assert.equal(pickLogoBgToneFromPixels(new Uint8ClampedArray(4), 0, 0), '')
  assert.equal(pickLogoBgToneFromPixels(new Uint8ClampedArray(4), 8, 8), '')
})
