import { canFallbackPhotoUpload, isPayloadTooLarge, packJpeg } from './image-pack.js'
import { slimMaterialsForCloud } from './project-sync.js'
import { PHOTO_SLOTS, friendlyCloudError, pickPhotoSrc } from './photo-slots.js'

export { isCloudFileSlot, isDeleteAuthError, isPhotoSlot, PHOTO_SLOTS, photoStoreLabel, pickPhotoSrc, friendlyCloudError } from './photo-slots.js'

const DEFAULT_API_BASE = 'https://cloud1-9gdqgdt5bfaa20fb-1397421562.ap-shanghai.app.tcloudbase.com/admin'
const API_BASE = import.meta.env.VITE_ADMIN_API_BASE || DEFAULT_API_BASE

async function gateway(path, method, body, query, opts) {
  const token = localStorage.getItem('admin_token')
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const wait = (opts && opts.timeout) || 45000
  const timer = ctrl ? setTimeout(() => ctrl.abort(), wait) : null
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: JSON.stringify({
        path,
        method,
        query: query || {},
        body: body || {},
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      }),
      signal: ctrl ? ctrl.signal : undefined
    })
    let data = null
    try { data = await res.json() } catch (err) { data = null }
    if (!res.ok || !data || data.code !== 0) {
      const err = new Error(friendlyCloudError((data && (data.message || data.code)) || ('云端不可用 ' + res.status)))
      err.code = (data && data.code) || res.status
      throw err
    }
    return data.data || {}
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('云端保存超时，请再试一次')
    if (isPayloadTooLarge(e)) throw new Error('云函数 JSON 超限，改走直传')
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function compressPhoto(src) {
  return packJpeg(src, {
    maxBytes: 280000,
    steps: [
      { max: 1600, quality: 0.74 },
      { max: 1280, quality: 0.66 },
      { max: 1000, quality: 0.58 },
      { max: 820, quality: 0.5 },
      { max: 640, quality: 0.42 },
      { max: 480, quality: 0.36 },
      { max: 360, quality: 0.3 }
    ]
  })
}

// 云函数 JSON 文本上限 100KB，兜底必须压到约 48KB
export function compressPhotoTiny(src) {
  return packJpeg(src, {
    maxBytes: 48000,
    steps: [
      { max: 720, quality: 0.48 },
      { max: 560, quality: 0.4 },
      { max: 440, quality: 0.34 },
      { max: 340, quality: 0.28 },
      { max: 260, quality: 0.24 },
      { max: 200, quality: 0.2 }
    ]
  })
}

function putToCos(url, blob) {
  function once(contentType) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', url, true)
      if (contentType) xhr.setRequestHeader('Content-Type', contentType)
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error('云端直传失败 ' + xhr.status))
      }
      xhr.onerror = () => reject(new Error('CORS'))
      xhr.send(blob)
    })
  }
  return once('image/jpeg').catch(() => once(''))
}

function savedPhoto(file, saved) {
  return {
    id: saved.id || file.id,
    path: saved.url || file.path,
    name: saved.name || file.name,
    caption: file.caption || saved.caption || '',
    createdAt: saved.createdAt || file.createdAt || Date.now(),
    cosKey: saved.key || '',
    stored: true,
    storing: false,
    storeError: '',
    ephemeral: false
  }
}

function projectPayload(project, slot, file, extra) {
  return Object.assign({
    projectId: project.id,
    slot,
    fileId: file.id,
    fileName: file.name,
    caption: file.caption || '',
    orgType: project.orgType,
    village: project.village,
    year: project.year,
    contractor: project.contractor,
    name: project.name
  }, extra || {})
}

function photoMetaFrom(project) {
  const meta = {}
  PHOTO_SLOTS.forEach((slot) => {
    const mat = (project && project.materials && project.materials[slot]) || {}
    meta[slot] = {
      date: mat.date || '',
      peopleCount: mat.peopleCount || '',
      committeeCount: mat.committeeCount || '',
      hasSupervisor: !!mat.hasSupervisor,
      peopleNote: mat.peopleNote || ''
    }
  })
  return meta
}

export function upsertCloudProject(project) {
  if (!project || !project.id) return Promise.resolve(null)
  return gateway('/preaudit/project', 'POST', {
    id: project.id,
    name: project.name,
    orgType: project.orgType,
    village: project.village,
    year: project.year,
    contractor: project.contractor,
    notes: project.notes || '',
    jointBid: !!project.jointBid,
    partnerVillage: project.partnerVillage || '',
    partnerAmount: project.partnerAmount,
    budgetAmount: project.budgetAmount,
    bidAmount: project.bidAmount,
    awardAmount: project.awardAmount,
    contractAmount: project.contractAmount,
    bidDate: project.bidDate || '',
    awardDate: project.awardDate || '',
    photoMeta: photoMetaFrom(project),
    materials: slimMaterialsForCloud(project.materials)
  })
}

function bytesFromBase64(raw) {
  const bin = atob(String(raw || ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export async function fetchPhotoBlob(src) {
  if (src && typeof src.size === 'number' && src.size > 0 && typeof src.slice === 'function') return src
  const url = String(src || '')
  if (!url) throw new Error('没有可读取的照片')
  try {
    const res = await fetch(url, /^https?:/i.test(url) ? { mode: 'cors', cache: 'no-cache' } : undefined)
    if (res.ok) {
      const blob = await res.blob()
      if (blob && blob.size) return blob
    }
  } catch (e) { /* 远程图可能没 CORS，改走网关 */ }
  if (!/^https?:/i.test(url)) throw new Error('读图失败')
  const data = await gateway('/preaudit/photos/file', 'POST', { url })
  if (!data || !data.base64) throw new Error('读图失败')
  return new Blob([bytesFromBase64(data.base64)], { type: data.type || 'image/jpeg' })
}

export async function uploadCloudPhoto(project, slot, file) {
  const src = pickPhotoSrc(file)
  if (!project || !file || !src) throw new Error('没有可保存的照片')
  const packed = await compressPhoto(src)
  try {
    const signed = await gateway('/preaudit/photos/sign', 'POST', {
      projectId: project.id,
      slot,
      fileId: file.id,
      year: project.year
    })
    if (!signed || !signed.uploadUrl || !signed.key) throw new Error('没拿到云端上传地址')
    await putToCos(signed.uploadUrl, packed.blob)
    const data = await gateway('/preaudit/photos', 'POST', projectPayload(project, slot, file, {
      fileId: signed.fileId || file.id,
      key: signed.key
    }), null, { timeout: 90000 })
    return savedPhoto(file, data.file || { id: signed.fileId, key: signed.key, url: signed.url })
  } catch (err) {
    if (!canFallbackPhotoUpload(err)) throw err
    try {
      const tiny = packed.bytes <= 48000 ? packed : await compressPhotoTiny(src)
      const data = await gateway('/preaudit/photos', 'POST', projectPayload(project, slot, file, {
        imageBase64: tiny.base64
      }), null, { timeout: 90000 })
      return savedPhoto(file, data.file || {})
    } catch (fallbackErr) {
      if (isPayloadTooLarge(fallbackErr)) throw new Error('这张图还是太大，请拍近一点再传')
      throw fallbackErr
    }
  }
}

export function deleteCloudPhoto(projectId, fileId) {
  return gateway('/preaudit/photos', 'DELETE', { projectId, fileId })
}

export async function destroyCloudProject(projectId, password, extra) {
  if (!projectId) return null
  const payload = {
    id: projectId,
    password: password || '',
    year: extra && extra.year ? extra.year : ''
  }
  try {
    return await gateway('/preaudit/project/destroy', 'POST', payload, null, { timeout: 25000 })
  } catch (e) {
    const msg = String((e && e.message) || '')
    if (e && (e.code === 4040 || /未知路由/.test(msg))) {
      return gateway('/preaudit/project', 'DELETE', payload, null, { timeout: 25000 })
    }
    throw e
  }
}

export function patchCloudPhotoCaption(projectId, fileId, caption) {
  if (!projectId || !fileId) return Promise.resolve(null)
  return gateway('/preaudit/photos', 'PUT', { projectId, fileId, caption: caption || '' })
}

export function listCloudProjects() {
  return gateway('/preaudit/projects', 'GET').then((data) => (data && data.list) || [])
}

export function getCloudProject(id) {
  return gateway('/preaudit/projects/' + encodeURIComponent(id), 'GET')
}
