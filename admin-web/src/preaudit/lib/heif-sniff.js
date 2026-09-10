const HEIF_BRANDS = {
  heic: true,
  heix: true,
  hevc: true,
  hevx: true,
  heim: true,
  heis: true,
  hevm: true,
  hevs: true,
  mif1: true,
  msf1: true,
  heif: true
}

export const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|heic|heif|hif)$/i

function brandAt(bytes, offset) {
  if (!bytes || offset + 4 > bytes.length) return ''
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
    .replace(/\0/g, '')
    .trim()
    .toLowerCase()
}

export function nameLooksHeif(name, type) {
  return /heic|heif|\.hif(\b|$)/i.test(String(type || '') + ' ' + String(name || ''))
}

export function nameLooksImage(name, type) {
  const mime = String(type || '').toLowerCase()
  if (mime.indexOf('image/') === 0) return true
  return IMAGE_EXT_RE.test(String(name || ''))
}

export function ftypBrands(bytes) {
  if (!bytes || bytes.length < 12) return []
  let start = -1
  const max = Math.min(bytes.length - 12, 96)
  for (let i = 0; i <= max; i += 4) {
    if (brandAt(bytes, i + 4) === 'ftyp') {
      start = i
      break
    }
  }
  if (start < 0) return []
  const size = ((bytes[start] << 24) | (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3]) >>> 0
  const end = Math.min(bytes.length, start + (size >= 16 ? size : 16))
  const out = [brandAt(bytes, start + 8)]
  for (let i = start + 16; i + 4 <= end; i += 4) out.push(brandAt(bytes, i))
  return out.filter(Boolean)
}

export function bytesLookLikeHeif(bytes) {
  if (!bytes || bytes.length < 12) return false
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return false
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return false
  const brands = ftypBrands(bytes)
  if (!brands.length) return false
  if (brands.some((b) => b === 'avif' || b === 'avis')) return false
  return brands.some((b) => HEIF_BRANDS[b])
}

export async function blobLooksLikeHeif(blob, opts) {
  const hinted = nameLooksHeif((opts && opts.name) || (blob && blob.name), blob && blob.type)
  if (!blob || typeof blob.slice !== 'function') return hinted
  try {
    const bytes = new Uint8Array(await blob.slice(0, 128).arrayBuffer())
    if (bytesLookLikeHeif(bytes)) return true
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return false
    return hinted
  } catch {
    return hinted
  }
}

export const HEIF_JPEG_ERROR = '这张是手机高效格式（HEIF/HEIC），没转成 JPG。请在系统相册导出成 JPG 再传'
