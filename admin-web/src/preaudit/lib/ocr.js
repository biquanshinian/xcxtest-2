import workerUrl from 'tesseract.js/dist/worker.min.js?url'
import coreSimdUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'
import corePlainUrl from 'tesseract.js-core/tesseract-core-lstm.wasm.js?url'
import { applyParsed, isPlaceholderName } from './ocr-apply.js'
import { isPayloadTooLarge, packJpeg } from './image-pack.js'
import { mergeInvoiceFields, parseOcrText } from './ocr-parse.js'
import { getItem, getItems, getOrgType, itemWritableFields } from './checklist.js'
import { fetchPhotoBlob } from './photo-cloud.js'
import { fileOcrSource, ocrUploadBatch } from './ocr-files.js'
import { getMaterial, getProject, saveMaterial, saveOcrCapture, updateProject } from './store.js'

const DEFAULT_API_BASE = 'https://cloud1-9gdqgdt5bfaa20fb-1397421562.ap-shanghai.app.tcloudbase.com/admin'
const API_BASE = import.meta.env.VITE_ADMIN_API_BASE || DEFAULT_API_BASE
const CLOUD_OCR_MS = 25000
const RATE_LIMIT_RE = /识别太勤了|今天识别次数用完了/

let localWorker = null
let localWorkerPromise = null
let localChain = Promise.resolve()
let cloudBlockedUntil = 0

function publicUrl(name) {
  const base = import.meta.env.BASE_URL || '/'
  return (base.endsWith('/') ? base : base + '/') + name
}

const SAFE_B64 = 140000

export { fileOcrSource, ocrUploadBatch } from './ocr-files.js'

export async function compressForOcr(src, opts) {
  let input = src
  if (typeof src === 'string' && /^https?:/i.test(src)) {
    try { input = await fetchPhotoBlob(src) } catch (e) { /* packJpeg 再试原地址 */ }
  }
  return packJpeg(input, Object.assign({ maxBytes: 100000 }, opts || {}))
}

function readExifAscii(view, offset, length) {
  let s = ''
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

function parseJpegExifDate(buffer) {
  const view = new DataView(buffer)
  if (view.byteLength < 12 || view.getUint16(0) !== 0xffd8) return ''
  let offset = 2
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break
    const marker = view.getUint8(offset + 1)
    const size = view.getUint16(offset + 2)
    if (marker === 0xe1 && offset + 10 < view.byteLength) {
      const head = readExifAscii(view, offset + 4, 4)
      if (head === 'Exif') return readTiffDate(view, offset + 10)
    }
    if (marker === 0xda) break
    offset += 2 + size
  }
  return ''
}

function readTiffDate(view, tiff) {
  if (tiff + 8 > view.byteLength) return ''
  const little = view.getUint16(tiff) === 0x4949
  const u16 = (i) => (little ? view.getUint16(i, true) : view.getUint16(i, false))
  const u32 = (i) => (little ? view.getUint32(i, true) : view.getUint32(i, false))
  if (u16(tiff + 2) !== 0x002a) return ''
  const ifd0 = tiff + u32(tiff + 4)
  const exifPtr = findTagOffset(view, ifd0, tiff, u16, u32, 0x8769)
  const datetime = findTagAscii(view, ifd0, tiff, u16, u32, 0x0132)
  if (exifPtr) {
    const original = findTagAscii(view, tiff + exifPtr, tiff, u16, u32, 0x9003)
    if (original) return exifToIso(original)
  }
  return exifToIso(datetime)
}

function findTagOffset(view, ifd, tiff, u16, u32, tag) {
  if (ifd + 2 > view.byteLength) return 0
  const count = u16(ifd)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > view.byteLength) break
    if (u16(entry) === tag) return u32(entry + 8)
  }
  return 0
}

function findTagAscii(view, ifd, tiff, u16, u32, tag) {
  if (ifd + 2 > view.byteLength) return ''
  const count = u16(ifd)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > view.byteLength) break
    if (u16(entry) !== tag) continue
    const len = u32(entry + 4)
    const valueOff = len <= 4 ? entry + 8 : tiff + u32(entry + 8)
    if (valueOff + len > view.byteLength) return ''
    return readExifAscii(view, valueOff, len)
  }
  return ''
}

function exifToIso(raw) {
  const m = String(raw || '').match(/(20\d{2}|19\d{2}):(\d{2}):(\d{2})/)
  if (!m) return ''
  return m[1] + '-' + m[2] + '-' + m[3]
}

export async function readExifDate(src) {
  try {
    const res = await fetch(src)
    const buf = await res.arrayBuffer()
    return parseJpegExifDate(buf)
  } catch (e) {
    return ''
  }
}

async function gatewayPost(path, body, timeoutMs) {
  const token = localStorage.getItem('admin_token')
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || CLOUD_OCR_MS) : null
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: JSON.stringify({
        path,
        method: 'POST',
        query: {},
        body: body || {},
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      }),
      signal: ctrl ? ctrl.signal : undefined
    })
    let data = null
    try { data = await res.json() } catch (e) { data = null }
    if (!res.ok || !data || data.code !== 0) {
      const err = new Error((data && (data.message || data.code)) || ('云识别失败 ' + res.status))
      err.code = (data && data.code) || res.status
      throw err
    }
    return data.data || {}
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('云识别超时')
    throw e
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function recognizeViaCloud(payload) {
  try {
    return await gatewayPost('/preaudit/ocr', payload)
  } catch (e) {
    if (isPayloadTooLarge(e)) throw new Error('图太大，云端收不下。请拍近一点或只截有日期金额的那一块再认')
    throw e
  }
}

async function recognizeViaCos(blob, kind) {
  const ticket = await gatewayPost('/preaudit/ocr-sign', {})
  if (!ticket || !ticket.uploadUrl || !ticket.url) throw new Error('没拿到上传地址')
  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob
  })
  if (!put.ok) throw new Error('图没传到云端，请再试一次')
  return recognizeViaCloud({ imageUrl: ticket.url, kind: kind || 'doc' })
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

async function resetLocalWorker() {
  const worker = localWorker
  localWorker = null
  localWorkerPromise = null
  if (worker && typeof worker.terminate === 'function') {
    try { await worker.terminate() } catch (e) { /* ignore */ }
  }
}

async function makeLocalWorker(corePath) {
  const tes = await import('tesseract.js')
  const createWorker = tes.createWorker || (tes.default && tes.default.createWorker)
  if (typeof createWorker !== 'function') throw new Error('本机识别库不可用')
  return createWorker('chi_sim', 1, {
    workerPath: workerUrl,
    corePath: corePath,
    langPath: publicUrl('tesseract'),
    gzip: true
  })
}

async function getLocalWorker() {
  if (localWorker) return localWorker
  if (!localWorkerPromise) {
    localWorkerPromise = (async () => {
      let lastErr = null
      const cores = [coreSimdUrl, corePlainUrl]
      for (let i = 0; i < cores.length; i++) {
        try {
          const worker = await makeLocalWorker(cores[i])
          localWorker = worker
          return worker
        } catch (err) {
          lastErr = err
        }
      }
      throw lastErr || new Error('本机识别库加载失败')
    })().catch((err) => {
      localWorkerPromise = null
      localWorker = null
      throw err
    })
  }
  return localWorkerPromise
}

function isRateLimitError(err) {
  const code = err && err.code
  if (code === 4290 || code === 429 || code === '4290' || code === '429') return true
  return RATE_LIMIT_RE.test(String((err && err.message) || ''))
}

function markCloudBlocked(err) {
  const msg = String((err && err.message) || '')
  cloudBlockedUntil = Date.now() + (/今天识别次数用完了/.test(msg) ? 60 * 60 * 1000 : 15 * 60 * 1000)
}

async function recognizeLocal(blob) {
  const run = async () => {
    try {
      const worker = await withTimeout(getLocalWorker(), 60000, '识别库加载较慢，请再点一次或手填')
      const result = await withTimeout(worker.recognize(blob), 90000, '这张图认了较久没出结果，请手填日期和金额')
      return { text: (result && result.data && result.data.text) || '', engine: 'local' }
    } catch (err) {
      await resetLocalWorker()
      throw err
    }
  }
  const next = localChain.then(run, run)
  localChain = next.then(() => {}, () => {})
  return next
}

async function recognizeViaCloudSmart(packed, type) {
  if (packed.base64.length <= SAFE_B64) {
    try {
      return await recognizeViaCloud({ imageBase64: packed.base64, kind: type })
    } catch (e) {
      if (!isPayloadTooLarge(e) && !/图太大|收不下/.test((e && e.message) || '')) throw e
    }
  }
  return recognizeViaCos(packed.blob, type)
}

export function ocrKindForItem(item) {
  if (!item) return 'doc'
  if (item.role === 'invoice' || item.id === 'invoices') return 'invoice'
  if (item.special === 'photos') return 'photo'
  if (item.role === 'publicity' || itemWritableFields(item).includes('startDate')) return 'notice'
  if (item.role === 'contract' || item.id === 'contract') return 'contract'
  return 'doc'
}

export function parsedFieldScore(parsed, fields) {
  const want = (fields && fields.length) ? fields : ['date', 'amount', 'startDate', 'endDate']
  let n = 0
  for (let i = 0; i < want.length; i++) {
    const f = want[i]
    if (!f || f === 'people') continue
    if (f === 'amount') {
      if (parsed && parsed.amount != null && parsed.amount !== '') n += 1
    } else if (parsed && parsed[f]) n += 1
  }
  return n
}

async function recognizePacked(packed, type, allowLocal) {
  if (!allowLocal && Date.now() < cloudBlockedUntil) {
    throw new Error('云识别较忙，请稍后再试或手填日期和金额')
  }
  let payload = null
  let cloudErr = null
  if (Date.now() >= cloudBlockedUntil) {
    try {
      payload = await recognizeViaCloudSmart(packed, type)
    } catch (e) {
      if (isPayloadTooLarge(e) || /图太大|收不下/.test((e && e.message) || '')) throw e
      if (isRateLimitError(e)) markCloudBlocked(e)
      cloudErr = e
    }
  }
  if (!payload) {
    if (!allowLocal) throw cloudErr || new Error('云识别较忙，请稍后再试或手填日期和金额')
    try {
      const local = await recognizeLocal(packed.blob)
      payload = { text: local.text, engine: 'local' }
    } catch (e) {
      throw cloudErr || e
    }
  }
  const parsed = mergeInvoiceFields(parseOcrText(payload.text || '', type), payload.invoice || null)
  return { engine: payload.engine || 'tencent', text: payload.text || '', parsed }
}

function wrapRecognizeError(e) {
  const msg = (e && e.message) || ''
  if (isPayloadTooLarge(e) || /图太大|收不下/.test(msg)) throw new Error('图太大，已压过还是超限。请只截有日期金额的那一块再认')
  if (/未授权|4010|过期/.test(msg)) throw new Error('云识别还没部署，请先发布 adminGateway 后再认')
  if (/服务未开通|未开通权限|5003|5004/.test(msg)) throw new Error('腾讯云文字识别还没开通，请到控制台开通 OCR 后再认')
  if (isRateLimitError(e) || /云识别较忙/.test(msg)) throw new Error('云识别较忙，请稍后再试或手填日期和金额')
  if (/超时/.test(msg)) throw new Error('云识别超时，请换张清楚近照或稍后再试')
  throw new Error(msg || '云识别失败，请手填日期和金额')
}

export async function recognizeImage(src, kind, opts) {
  const type = kind || 'doc'
  const allowLocal = !opts || opts.allowLocal !== false
  if (type === 'photo') {
    const shot = await readExifDate(src)
    if (shot) {
      return {
        engine: 'exif',
        text: '',
        parsed: { date: shot, startDate: '', endDate: '', amount: null, dates: [shot], amounts: [] }
      }
    }
  }
  try {
    const packed = await compressForOcr(src, { rotate: opts && opts.rotate })
    return await recognizePacked(packed, type, allowLocal)
  } catch (e) {
    wrapRecognizeError(e)
  }
}

function shouldStopOrientationRetry(err) {
  const msg = (err && err.message) || ''
  return /识别太勤|今天识别次数|云识别较忙|未授权|未开通|图太大|收不下/.test(msg)
}

export async function recognizeImageOriented(src, kind, opts) {
  const orientations = (opts && opts.orientations && opts.orientations.length)
    ? opts.orientations
    : [0, 180, 90, 270]
  const fields = (opts && opts.fields) || []
  const need = fields.filter((f) => f && f !== 'people')
  let best = null
  let bestScore = -1
  let lastErr = null
  for (let i = 0; i < orientations.length; i++) {
    const deg = orientations[i]
    let result
    try {
      result = await recognizeImage(src, kind, Object.assign({}, opts || {}, { rotate: deg }))
    } catch (e) {
      if (shouldStopOrientationRetry(e)) throw e
      lastErr = e
      continue
    }
    result.orientation = deg
    const score = parsedFieldScore(result.parsed, need)
    if (score > bestScore || (score === bestScore && String(result.text || '').length > String((best && best.text) || '').length)) {
      best = result
      bestScore = score
    }
    if (need.length && score >= need.length) return result
    if (!need.length && parsedFieldScore(result.parsed) > 0) return result
  }
  if (best) return best
  throw lastErr || new Error('云识别失败，请手填日期和金额')
}

function parsedAmountValue(parsed) {
  if (!parsed || parsed.amount == null || parsed.amount === '') return null
  const n = Number(parsed.amount)
  return isFinite(n) ? n : null
}

function mergeAmountScanResults(hits, kind) {
  const list = hits || []
  if (!list.length) return null
  let best = list[0]
  let bestAmt = parsedAmountValue(best.parsed)
  for (let i = 1; i < list.length; i++) {
    const amt = parsedAmountValue(list[i].parsed)
    if (bestAmt == null || (amt != null && amt > bestAmt)) {
      best = list[i]
      bestAmt = amt
    }
  }
  const texts = list.map((hit) => String(hit.text || '').trim()).filter(Boolean)
  const combined = texts.join('\n')
  const parsed = texts.length > 1
    ? parseOcrText(combined, kind || 'doc')
    : Object.assign({}, best.parsed || {})
  if (texts.length > 1 && parsed.amount == null) {
    for (let i = 0; i < list.length; i++) {
      const amt = parsedAmountValue(list[i].parsed)
      if (amt == null) continue
      if (parsed.amount == null || amt > Number(parsed.amount)) parsed.amount = amt
    }
  }
  if (texts.length > 1) {
    const fillKeys = ['date', 'startDate', 'endDate', 'name', 'contractor', 'village']
    for (let i = 0; i < list.length; i++) {
      const src = list[i].parsed || {}
      for (let k = 0; k < fillKeys.length; k++) {
        const key = fillKeys[k]
        if (!parsed[key] && src[key]) parsed[key] = src[key]
      }
    }
  }
  return Object.assign({}, best, {
    text: combined || best.text,
    parsed
  })
}

export async function recognizeBestUpload(files, kind, fields, opts) {
  const batch = ocrUploadBatch(files)
  if (!batch.length) throw new Error('没有可识别的照片')
  const need = (fields || []).filter((f) => f && f !== 'people')
  const needAmount = need.includes('amount')
  const hits = []
  let best = null
  let bestScore = -1
  let lastErr = null
  for (let i = 0; i < batch.length; i++) {
    try {
      const result = await recognizeImageOriented(fileOcrSource(batch[i]), kind, Object.assign({}, opts || {}, {
        fields: need
      }))
      hits.push(result)
      const score = parsedFieldScore(result.parsed, need)
      if (!best || score > bestScore) {
        best = result
        bestScore = score
      }
      if (!needAmount && need.length && score >= need.length) return result
    } catch (e) {
      lastErr = e
      if (shouldStopOrientationRetry(e)) throw e
    }
  }
  if (needAmount && hits.length) return mergeAmountScanResults(hits, kind)
  if (best) return best
  throw lastErr || new Error('云识别失败，请手填日期和金额')
}

export { applyParsed, isPlaceholderName } from './ocr-apply.js'

export function applyProjectMeta(projectId, parsed) {
  const project = getProject(projectId)
  if (!project || !parsed) return null
  const patch = {}
  if (parsed.name && isPlaceholderName(project.name)) patch.name = parsed.name
  if (parsed.contractor && !String(project.contractor || '').trim()) patch.contractor = parsed.contractor
  if (parsed.village && !String(project.village || '').trim()) patch.village = parsed.village
  if (!Object.keys(patch).length) return null
  return updateProject(projectId, patch)
}

export function ocrEngineHint(engine) {
  if (engine === 'exif') return '已按拍摄时间填写，请核对'
  if (engine === 'local') return '本机识别，请核对'
  if (engine === 'tencent') return '云识别已填，请核对'
  return '已识别，请核对'
}

function emptyValue(v) {
  return v == null || v === ''
}

function isAwardDoc(item) {
  return !!(item && (item.id === 'bid_notice' || item.role === 'award' || item.id === 'compare_sheet' || item.id === 'contract'))
}

function ocrFilesOf(project, item, mat) {
  if (item && item.special === 'compare' && project) {
    const low = getMaterial(project, 'compare_low')
    if ((low.files || []).length) return low.files || []
  }
  return (mat && mat.files) || []
}

function itemNeedsOcr(item, mat, project) {
  const files = ocrFilesOf(project, item, mat)
  if (isAwardDoc(item) && isPlaceholderName(project && project.name) && files.length) return true
  const fields = itemWritableFields(item)
  if (!fields.length) return false
  if (fields.includes('date') && emptyValue(mat.date)) return true
  if (fields.includes('startDate') && emptyValue(mat.startDate)) return true
  if (fields.includes('amount') && emptyValue(mat.amount) && mat.amount !== 0) return true
  if (fields.includes('endDate') && emptyValue(mat.endDate)) return true
  if (fields.includes('contractor') && emptyValue(mat.contractor)) return true
  return false
}

export function fillProjectFromCachedOcr(projectId) {
  const project = getProject(projectId)
  if (!project) return null
  getItems(getOrgType(project)).forEach((item) => {
    const mat = getMaterial(project, item.id)
    if (!mat.ocrText) return
    const parsed = parseOcrText(mat.ocrText, ocrKindForItem(item))
    const patch = applyParsed(mat, parsed, itemWritableFields(item), item.minDays)
    if (Object.keys(patch.next).length) saveMaterial(projectId, item.id, patch.next)
    if (isAwardDoc(item)) applyProjectMeta(projectId, parsed)
  })
  return getProject(projectId)
}

export function listOcrJobs(project, opts) {
  if (!project) return []
  const force = !!(opts && opts.force)
  const org = getOrgType(project)
  return getItems(org).filter((item) => {
    const mat = getMaterial(project, item.id)
    const files = ocrFilesOf(project, item, mat)
    if (!files.length) return false
    if (force) {
      if (itemNeedsOcr(item, mat, project)) return true
      return !!(isAwardDoc(item) || item.role === 'invoice' || item.id === 'invoices')
    }
    if (!itemNeedsOcr(item, mat, project)) return false
    const newest = Math.max.apply(null, files.map((f) => Number(f.createdAt) || 0))
    if (mat.ocrTried && mat.ocrAt && newest && newest <= Number(mat.ocrAt)) {
      if (!(isAwardDoc(item) && isPlaceholderName(project.name) && !mat.ocrText && !mat.ocrEngine)) return false
    }
    return true
  }).map((item) => {
    const mat = getMaterial(project, item.id)
    const files = ocrFilesOf(project, item, mat)
    return {
      item,
      mat,
      file: files[files.length - 1],
      fields: itemWritableFields(item)
    }
  }).sort((a, b) => {
    const rank = (id) => {
      if (id === 'bid_notice') return 0
      if (id === 'compare_sheet') return 1
      if (id === 'contract' || id === 'invoices') return 2
      return 3
    }
    return rank(a.item.id) - rank(b.item.id)
  })
}

export async function recognizeProject(projectId, onProgress, opts) {
  fillProjectFromCachedOcr(projectId)
  const filled = []
  const failed = []
  const jobs = listOcrJobs(getProject(projectId), opts)
  for (let i = 0; i < jobs.length; i++) {
    const live = getProject(projectId)
    const item = getItem(jobs[i].item.id, live)
    const mat = getMaterial(live, jobs[i].item.id)
    const files = ocrFilesOf(live, item || jobs[i].item, mat)
    const file = files[files.length - 1]
    if (onProgress) onProgress({ current: i + 1, total: jobs.length, name: item ? item.name : jobs[i].item.name })
    if (!file) continue
    try {
      const result = await recognizeBestUpload(files, ocrKindForItem(item || jobs[i].item), jobs[i].fields)
      const patch = applyParsed(mat, result.parsed, jobs[i].fields, item && item.minDays)
      saveOcrCapture(projectId, jobs[i].item.id, {
        fileId: file.id,
        text: result.text,
        patch: Object.assign({}, patch.next, {
          ocrTried: true,
          ocrAt: Date.now(),
          ocrEngine: result.engine,
          ocrSummary: patch.summary
        })
      })
      const before = getProject(projectId) || {}
      if (isAwardDoc(item || jobs[i].item)) applyProjectMeta(projectId, result.parsed)
      const after = getProject(projectId) || {}
      const extra = []
      if (after.name && after.name !== before.name) extra.push('项目名称')
      if (after.contractor && after.contractor !== before.contractor) extra.push('中标单位')
      if (after.village && after.village !== before.village) extra.push('村名')
      if (patch.filled.length || extra.length) {
        filled.push({
          id: jobs[i].item.id,
          name: (item && item.name) || jobs[i].item.name,
          filled: patch.filled.concat(extra),
          summary: patch.summary
        })
      }
    } catch (e) {
      saveMaterial(projectId, jobs[i].item.id, { ocrTried: true, ocrAt: Date.now() })
      failed.push({
        id: jobs[i].item.id,
        name: (item && item.name) || jobs[i].item.name,
        message: (e && e.message) || '识别失败'
      })
    }
  }
  return { total: jobs.length, filled, failed }
}
