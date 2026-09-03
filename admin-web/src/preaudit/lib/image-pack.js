function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (/^https?:/i.test(String(src || ''))) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('读图失败'))
    img.src = src
  })
}

function u16(bytes, offset, le) {
  return le ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1]
}

function u32(bytes, offset, le) {
  return le
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] * 0x1000000)) >>> 0
    : ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
}

function readExifOrientation(bytes, tiffStart, limit) {
  if (tiffStart + 8 > bytes.length) return 1
  const b0 = bytes[tiffStart]
  const b1 = bytes[tiffStart + 1]
  let le = false
  if (b0 === 0x49 && b1 === 0x49) le = true
  else if (b0 === 0x4d && b1 === 0x4d) le = false
  else return 1
  if (u16(bytes, tiffStart + 2, le) !== 42) return 1
  const ifd = tiffStart + u32(bytes, tiffStart + 4, le)
  if (ifd < tiffStart || ifd + 2 > bytes.length || ifd >= limit) return 1
  const count = u16(bytes, ifd, le)
  let entry = ifd + 2
  for (let i = 0; i < count; i++) {
    if (entry + 12 > bytes.length) return 1
    if (u16(bytes, entry, le) === 0x0112) {
      const type = u16(bytes, entry + 2, le)
      const n = u32(bytes, entry + 4, le)
      if (n < 1) return 1
      if (type === 3) return u16(bytes, entry + 8, le)
      if (type === 4) return u32(bytes, entry + 8, le)
      return bytes[entry + 8]
    }
    entry += 12
  }
  return 1
}

export function readJpegOrientation(bytes) {
  if (!bytes || bytes.length < 4) return 1
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  let offset = 2
  const len = bytes.length
  while (offset + 8 < len) {
    if (bytes[offset] !== 0xff) return 1
    const marker = bytes[offset + 1]
    if (marker === 0xda || marker === 0xd9) return 1
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (size < 2) return 1
    if (marker === 0xe1) {
      const start = offset + 4
      if (
        start + 6 < len &&
        bytes[start] === 0x45 && bytes[start + 1] === 0x78 &&
        bytes[start + 2] === 0x69 && bytes[start + 3] === 0x66 &&
        bytes[start + 4] === 0 && bytes[start + 5] === 0
      ) {
        const orient = readExifOrientation(bytes, start + 6, offset + 2 + size)
        if (orient >= 1 && orient <= 8) return orient
      }
    }
    offset += 2 + size
  }
  return 1
}

async function peekJpegOrientation(blob) {
  if (!blob || typeof blob.slice !== 'function') return 1
  try {
    const buf = await blob.slice(0, 128 * 1024).arrayBuffer()
    return readJpegOrientation(new Uint8Array(buf))
  } catch (e) {
    return 1
  }
}

function looksNeedBake(blob, orientation, extra, opts) {
  if (extra) return true
  if (opts && opts.force) return true
  if (orientation > 1) return true
  const type = String((blob && blob.type) || '')
  const name = String((opts && opts.name) || (blob && blob.name) || '')
  return /heic|heif|webp|tiff/i.test(type + ' ' + name)
}

async function loadDrawable(src) {
  if (typeof createImageBitmap === 'function') {
    try {
      let blob = src
      let made = false
      if (typeof src === 'string') {
        const res = await fetch(src)
        blob = await res.blob()
        made = true
      }
      if (blob && typeof blob.size === 'number') {
        try {
          return await createImageBitmap(blob, { imageOrientation: 'from-image' })
        } catch (e) {
          return await createImageBitmap(blob)
        } finally {
          if (made) blob = null
        }
      }
    } catch (e) { /* 回退 Image */ }
  }
  if (src && typeof src !== 'string' && typeof URL !== 'undefined' && URL.createObjectURL) {
    const url = URL.createObjectURL(src)
    try {
      return await loadImage(url)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  return loadImage(src)
}

function dataUrlToBase64(dataUrl) {
  const raw = String(dataUrl || '')
  const i = raw.indexOf('base64,')
  if (i < 0) throw new Error('压缩失败')
  return raw.slice(i + 7)
}

function jpegFromCanvas(canvas, quality) {
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  canvas.width = 0
  canvas.height = 0
  if (!dataUrl || dataUrl.indexOf('data:image/jpeg') !== 0) throw new Error('压缩失败')
  const base64 = dataUrlToBase64(dataUrl)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return {
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    base64,
    width: 0,
    height: 0,
    bytes: bytes.length
  }
}

export function normalizeDegrees(degrees) {
  const n = Number(degrees) || 0
  const d = ((Math.round(n) % 360) + 360) % 360
  if (d === 90 || d === 180 || d === 270) return d
  return 0
}

export function rotateDrawable(img, degrees) {
  const d = normalizeDegrees(degrees)
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  if (!w || !h) throw new Error('图是空的')
  const canvas = document.createElement('canvas')
  if (d === 90 || d === 270) {
    canvas.width = h
    canvas.height = w
  } else {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (!d) {
    ctx.drawImage(img, 0, 0, w, h)
    return canvas
  }
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(d * Math.PI / 180)
  ctx.drawImage(img, -w / 2, -h / 2)
  return canvas
}

function encodeJpeg(img, maxEdge, quality, degrees) {
  const source = rotateDrawable(img, degrees)
  let width = source.width
  let height = source.height
  let canvas = source
  if (width > maxEdge || height > maxEdge) {
    const scale = maxEdge / Math.max(width, height)
    const next = document.createElement('canvas')
    next.width = Math.round(width * scale)
    next.height = Math.round(height * scale)
    const ctx = next.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, next.width, next.height)
    ctx.drawImage(source, 0, 0, next.width, next.height)
    source.width = 0
    source.height = 0
    canvas = next
    width = next.width
    height = next.height
  }
  const packed = jpegFromCanvas(canvas, quality)
  packed.width = width
  packed.height = height
  return packed
}

export async function bakeUprightJpeg(src, opts) {
  const extra = normalizeDegrees(opts && opts.rotate)
  const blob = src && typeof src.size === 'number' && typeof src.slice === 'function'
    ? src
    : null
  if (!blob) throw new Error('读图失败')
  const orientation = await peekJpegOrientation(blob)
  if (!looksNeedBake(blob, orientation, extra, opts)) return blob
  const img = await loadDrawable(blob)
  const packed = encodeJpeg(img, (opts && opts.maxEdge) || 2560, (opts && opts.quality) || 0.9, extra)
  const rawName = String((opts && opts.name) || blob.name || 'photo.jpg')
  const base = rawName.replace(/\.[^.]+$/, '') || 'photo'
  if (typeof File === 'function') {
    try {
      return new File([packed.blob], base + '.jpg', { type: 'image/jpeg', lastModified: Date.now() })
    } catch (e) { /* 回退 Blob */ }
  }
  return packed.blob
}

export async function packJpeg(src, opts) {
  const img = await loadDrawable(src)
  const maxBytes = (opts && opts.maxBytes) || 100000
  const degrees = normalizeDegrees(opts && opts.rotate)
  const steps = (opts && opts.steps) || [
    { max: 1100, quality: 0.62 },
    { max: 900, quality: 0.54 },
    { max: 760, quality: 0.48 },
    { max: 640, quality: 0.42 },
    { max: 520, quality: 0.38 },
    { max: 420, quality: 0.32 }
  ]
  let last = null
  for (let i = 0; i < steps.length; i++) {
    last = encodeJpeg(img, steps[i].max, steps[i].quality, degrees)
    if (last.bytes <= maxBytes) return last
  }
  if (!last || last.bytes > maxBytes) throw new Error('图太大，请拍近一点再传')
  return last
}

export function isPayloadTooLarge(err) {
  const code = err && err.code
  if (code === 413 || code === '413' || code === 'EXCEED_MAX_PAYLOAD_SIZE') return true
  const msg = String((err && err.message) || err || '')
  return /EXCEED_MAX_PAYLOAD|负载超过|payload size|云函数 JSON 超限/i.test(msg)
}

export function canFallbackPhotoUpload(err) {
  const code = err && err.code
  if (code === 4290 || code === 4000 || code === 4004 || code === 4002) return false
  if (isPayloadTooLarge(err)) return true
  const msg = String((err && err.message) || '')
  return /未知路由|4040|CORS|直传失败|Forbidden|网络|没拿到云端上传地址/i.test(msg)
}
