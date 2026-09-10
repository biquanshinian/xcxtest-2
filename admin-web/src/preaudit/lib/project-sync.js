/**
 * 预审项目账号同步：把资料快照压成可上云的 JSON，并按新旧合并到本机。
 * 不含 Vue / localStorage，方便自检。
 */
import { isCloudFileSlot } from './photo-slots.js'

const MATERIAL_SCALARS = [
  'date',
  'startDate',
  'endDate',
  'extraRangeStart',
  'extraRangeEnd',
  'amount',
  'peopleCount',
  'committeeCount',
  'hasSupervisor',
  'peopleNote',
  'remark',
  'notes',
  'pairedPhoto',
  'confirmed',
  'scanFilled',
  'dateReviewOk',
  'dateReviewKey',
  'contractor',
  'ocrText',
  'ocrTried',
  'ocrAt'
]

const BOOL_KEYS = {
  hasSupervisor: true,
  pairedPhoto: true,
  confirmed: true,
  scanFilled: true,
  dateReviewOk: true,
  ocrTried: true
}

const PROJECT_SCALARS = [
  'name',
  'orgType',
  'village',
  'year',
  'contractor',
  'notes',
  'budgetAmount',
  'jointBid',
  'partnerVillage',
  'partnerAmount',
  'bidAmount',
  'awardAmount',
  'contractAmount',
  'bidDate',
  'awardDate'
]

function isEmptyValue(value) {
  if (value == null) return true
  if (value === '') return true
  if (Array.isArray(value) && !value.length) return true
  return false
}

function slimPeople(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map((row) => ({
    name: String((row && row.name) || '').trim().slice(0, 20),
    role: row && row.role === 'supervisor' ? 'supervisor' : (row && row.role === 'village' ? 'village' : '')
  }))
}

export function fileFromCloud(row) {
  if (!row) return null
  const id = String(row.id || '').trim()
  const cosKey = String(row.key || row.cosKey || '').trim()
  const path = String(row.url || row.path || '').trim()
  if (!id) return null
  if (!cosKey && !/^https?:/i.test(path)) return null
  return {
    id,
    path,
    name: row.name || (id + '.jpg'),
    caption: row.caption || '',
    createdAt: row.createdAt || Date.now(),
    ocrText: row.ocrText ? String(row.ocrText).slice(0, 1500) : '',
    cosKey,
    stored: true,
    storing: false,
    storeError: '',
    ephemeral: false
  }
}

export function slimCloudFile(file, ocrMax) {
  if (!file) return null
  const cosKey = String(file.cosKey || file.key || '').trim()
  const path = String(file.path || file.url || '').trim()
  const keepPath = !!(cosKey || /^https?:/i.test(path))
  if (!keepPath) return null
  const cap = ocrMax == null ? 1500 : ocrMax
  const out = {
    id: file.id,
    path,
    url: /^https?:/i.test(path) ? path : '',
    name: file.name || '',
    caption: file.caption || '',
    createdAt: file.createdAt || 0,
    key: cosKey,
    cosKey,
    stored: true
  }
  if (cap > 0 && file.ocrText) out.ocrText = String(file.ocrText).slice(0, cap)
  return out
}

function slimOneMaterial(mat, ocrMax) {
  const src = mat || {}
  const next = {}
  MATERIAL_SCALARS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(src, key)) return
    if (BOOL_KEYS[key]) next[key] = !!src[key]
    else next[key] = src[key]
  })
  if (Array.isArray(src.people) && src.people.length) next.people = slimPeople(src.people)
  const watermark = String(src.watermarkPath || '')
  if (/^https?:/i.test(watermark)) next.watermarkPath = watermark.slice(0, 500)
  next.files = (src.files || []).map((file) => slimCloudFile(file, ocrMax)).filter(Boolean).slice(0, 80)
  return next
}

export function slimMaterialsForCloud(materials) {
  const src = materials || {}
  let ocrMax = 1500
  const build = (max) => {
    const out = {}
    Object.keys(src).forEach((key) => {
      if (!isCloudFileSlot(key)) return
      out[key] = slimOneMaterial(src[key], max)
    })
    return out
  }
  let out = build(ocrMax)
  if (JSON.stringify(out).length > 180000) out = build(0)
  return out
}

export function mergeCloudFiles(localFiles, cloudFiles, preferCloud) {
  const local = Array.isArray(localFiles) ? localFiles.filter(Boolean) : []
  const incoming = (Array.isArray(cloudFiles) ? cloudFiles : []).map(fileFromCloud).filter(Boolean)
  if (!incoming.length) return local.slice()
  const merged = []
  const seen = new Set()
  const mark = (file) => {
    ;[file.id, file.cosKey, file.path].filter(Boolean).forEach((key) => seen.add(key))
  }
  const has = (file) => {
    return [file.id, file.cosKey, file.path].filter(Boolean).some((key) => seen.has(key))
  }
  const push = (file) => {
    if (!file || has(file)) return
    merged.push(file)
    mark(file)
  }
  if (preferCloud) {
    incoming.forEach(push)
    local.forEach((file) => {
      if (!file.cosKey && !file.stored) push(file)
    })
    return merged
  }
  local.forEach(push)
  incoming.forEach((file) => {
    if (has(file)) {
      const idx = merged.findIndex((row) => row.id === file.id || (file.cosKey && row.cosKey === file.cosKey))
      if (idx < 0) return
      const prev = merged[idx]
      merged[idx] = Object.assign({}, prev, {
        path: prev.path || file.path,
        cosKey: prev.cosKey || file.cosKey,
        stored: !!(prev.stored || file.stored || file.cosKey),
        caption: prev.caption || file.caption || '',
        ocrText: prev.ocrText || file.ocrText || '',
        name: prev.name || file.name
      })
      return
    }
    push(file)
  })
  return merged
}

function copyMaterialFields(target, source, preferCloud) {
  MATERIAL_SCALARS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      if (preferCloud && BOOL_KEYS[key] && !Object.prototype.hasOwnProperty.call(target, key)) target[key] = false
      return
    }
    const val = source[key]
    if (preferCloud) {
      target[key] = BOOL_KEYS[key] ? !!val : (val == null ? '' : val)
      return
    }
    if (BOOL_KEYS[key]) {
      if (!target[key] && val) target[key] = true
      return
    }
    if (isEmptyValue(target[key]) && !isEmptyValue(val)) target[key] = val
  })
  if (Array.isArray(source.people) && source.people.length && (preferCloud || !(target.people && target.people.length))) {
    target.people = slimPeople(source.people)
  }
  const watermark = String(source.watermarkPath || '')
  if (/^https?:/i.test(watermark) && (preferCloud || !target.watermarkPath)) {
    target.watermarkPath = watermark
  }
}

export function applyCloudMaterials(project, materials, preferCloud) {
  if (!project || !materials) return project
  project.materials = project.materials || {}
  Object.keys(materials).forEach((slot) => {
    if (!isCloudFileSlot(slot)) return
    const incoming = materials[slot] || {}
    const current = Object.assign({}, project.materials[slot] || {})
    if (!Array.isArray(current.files)) current.files = []
    copyMaterialFields(current, incoming, !!preferCloud)
    current.files = mergeCloudFiles(current.files, incoming.files, !!preferCloud)
    project.materials[slot] = current
  })
  return project
}

export function applyCloudScalars(project, row, preferCloud) {
  if (!project || !row) return project
  PROJECT_SCALARS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(row, key) && key !== 'jointBid') return
    const val = row[key]
    if (key === 'jointBid') {
      if (preferCloud) project.jointBid = !!val
      else if (val) project.jointBid = true
      return
    }
    if (preferCloud) {
      if (val === 0 || !isEmptyValue(val)) project[key] = val
      else if (val === '' || val == null) {
        if (key === 'partnerVillage' || key === 'notes' || key === 'contractor' || key === 'village') {
          if (Object.prototype.hasOwnProperty.call(row, key)) project[key] = val == null ? '' : val
        }
      }
      return
    }
    if (isEmptyValue(project[key]) && (val === 0 || !isEmptyValue(val))) project[key] = val
  })
  return project
}

export function cloudRecordIsNewer(local, row) {
  if (!local) return true
  return Number((row && row.updatedAt) || 0) >= Number(local.updatedAt || 0)
}

export function hasIncomingCloudFiles(local, row) {
  const have = new Set()
  Object.keys((local && local.materials) || {}).forEach((slot) => {
    const files = (local.materials[slot] && local.materials[slot].files) || []
    files.forEach((file) => {
      if (file && file.id) have.add(String(file.id))
    })
  })
  const missing = (list) => (list || []).some((file) => file && file.id && !have.has(String(file.id)))
  const photos = (row && row.photos) || {}
  if (Object.keys(photos).some((slot) => missing(photos[slot]))) return true
  const materials = (row && row.materials) || {}
  return Object.keys(materials).some((slot) => missing((materials[slot] && materials[slot].files) || []))
}

export function hasCloudSyncedFile(project) {
  const materials = (project && project.materials) || {}
  return Object.keys(materials).some((slot) => {
    const files = (materials[slot] && materials[slot].files) || []
    return files.some((file) => file && (file.cosKey || file.stored || /^https?:/i.test(String(file.path || ''))))
  })
}

export function wasCloudSynced(project) {
  if (!project) return false
  if (Number(project.cloudSyncedAt) > 0) return true
  return hasCloudSyncedFile(project)
}

export function markCloudSynced(project, row) {
  if (!project) return project
  project.cloudSyncedAt = Number((row && row.updatedAt) || Date.now()) || Date.now()
  return project
}
