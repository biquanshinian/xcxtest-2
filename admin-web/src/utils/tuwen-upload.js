import { api } from '../api/client'
import { SAMPLE_COS_PREFIX } from './tuwen-yewu.js'

export function putToPresign(uploadUrl, blob, mime) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl, true)
    xhr.setRequestHeader('Content-Type', mime || 'application/octet-stream')
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('上传失败'))
    xhr.send(blob)
  })
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(blob)
  })
}

export function fileFromClipboard(e) {
  const items = e && e.clipboardData && e.clipboardData.items
  if (!items) return null
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'file' && /^image\//i.test(item.type || '')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return null
}

export function fileFromDrop(e) {
  const files = e && e.dataTransfer && e.dataTransfer.files
  if (!files || !files.length) return null
  const file = files[0]
  if (!file || !/^image\//i.test(file.type || file.name || '')) return null
  return file
}

export async function uploadTuwenImage(file, prefix = SAMPLE_COS_PREFIX) {
  if (!file) throw new Error('没有图片')
  const ext = ((file.name && file.name.split('.').pop()) || (file.type === 'image/png' ? 'png' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const key = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  try {
    const presign = await api.cosPresign({ key })
    await putToPresign(presign.uploadUrl, file, file.type || 'application/octet-stream')
    return { url: presign.cosUrl, fallback: false }
  } catch (err) {
    if (file.size > 2.5 * 1024 * 1024) throw err
    const dataUrl = await blobToDataUrl(file)
    if (String(dataUrl).length > 45e5) throw new Error('图片过大，请换一张或缩小截图范围')
    return { url: dataUrl, fallback: true }
  }
}
