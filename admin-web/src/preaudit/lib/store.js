import { reactive } from 'vue'
import * as checklist from './checklist.js'
import * as orgUtil from './org.js'
import { deleteCloudPhoto, destroyCloudProject, fetchPhotoBlob, getCloudProject, isCloudFileSlot, isDeleteAuthError, isPhotoSlot, listCloudProjects, patchCloudPhotoCaption, PHOTO_SLOTS, pickPhotoSrc, uploadCloudPhoto, upsertCloudProject } from './photo-cloud.js'
import {
  applyCloudMaterials,
  applyCloudScalars,
  cloudRecordIsNewer,
  hasIncomingCloudFiles,
  markCloudSynced,
  wasCloudSynced
} from './project-sync.js'
import { clonePickedFile } from './upload.js'
import { bakeUprightJpeg } from './image-pack.js'
import { uid } from './util.js'

const STATE_KEY = 'preaudit_projects_v1'
const ID_KEY = 'preaudit_project_ids'
const DELETED_KEY = 'preaudit_deleted_ids'
const LEGACY_CLAIM_KEY = 'preaudit_legacy_claimed_by'
const persistLocks = {}
const persistDirty = {}
const persistBusy = {}
const persistProjectTails = {}
const upsertTimers = {}
const upsertPending = {}
const deletedIds = new Set()
const state = reactive({ projects: [] })
let currentScope = ''

function currentUserId() {
  try {
    if (!localStorage.getItem('admin_token')) return ''
    const user = JSON.parse(localStorage.getItem('admin_user') || 'null')
    return String((user && (user.id || user._id)) || '').trim()
  } catch (e) {
    return ''
  }
}

function accountScope() {
  const id = currentUserId()
  return id ? ('u:' + id) : 'guest'
}

function isLoggedIn() {
  return accountScope() !== 'guest'
}

function scopedKey(base) {
  const scope = currentScope || accountScope()
  if (scope === 'guest') return base
  return base + ':' + scope
}

function readJsonArray(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch (e) {
    return []
  }
}

function loadDeletedIds() {
  deletedIds.clear()
  try {
    const raw = JSON.parse(localStorage.getItem(scopedKey(DELETED_KEY)) || '[]')
    if (Array.isArray(raw)) raw.filter(Boolean).forEach((id) => deletedIds.add(id))
  } catch (e) { /* ignore */ }
}

function persistDeletedIds() {
  try {
    localStorage.setItem(scopedKey(DELETED_KEY), JSON.stringify(Array.from(deletedIds)))
  } catch (e) { /* ignore */ }
}

function findProject(id) {
  return state.projects.find((p) => p.id === id) || null
}

function defaultProject(fields) {
  const src = fields || {}
  return {
    id: src.id || uid('p'),
    name: src.name || '待认项目',
    orgType: orgUtil.normalize(src.orgType),
    village: src.village || '',
    year: src.year || String(new Date().getFullYear()),
    contractor: src.contractor || '',
    notes: src.notes || '',
    budgetAmount: src.budgetAmount == null ? '' : src.budgetAmount,
    jointBid: !!src.jointBid,
    partnerVillage: src.partnerVillage || '',
    partnerAmount: src.partnerAmount == null ? '' : src.partnerAmount,
    bidAmount: src.bidAmount == null ? '' : src.bidAmount,
    awardAmount: src.awardAmount == null ? '' : src.awardAmount,
    contractAmount: src.contractAmount == null ? '' : src.contractAmount,
    bidDate: src.bidDate || '',
    awardDate: src.awardDate || '',
    createdAt: src.createdAt || Date.now(),
    updatedAt: src.updatedAt || Date.now(),
    cloudSyncedAt: src.cloudSyncedAt || 0,
    materials: src.materials || {},
    lastAudit: src.lastAudit || null
  }
}

function loadRememberedIds() {
  const scoped = readJsonArray(scopedKey(ID_KEY)).filter(Boolean)
  if (scoped.length || currentScope !== 'guest') return scoped
  return readJsonArray(ID_KEY).filter(Boolean)
}

function persistLocal() {
  try {
    const rows = state.projects.map(slimProject)
    localStorage.setItem(scopedKey(STATE_KEY), JSON.stringify(rows))
    localStorage.setItem(scopedKey(ID_KEY), JSON.stringify(rows.map((row) => row.id)))
    if ((currentScope || accountScope()) === 'guest') {
      localStorage.setItem(STATE_KEY, JSON.stringify(rows))
      localStorage.setItem(ID_KEY, JSON.stringify(rows.map((row) => row.id)))
    }
  } catch (e) { /* 本机空间不够时仍以云端为准 */ }
}

function slimFile(file) {
  if (!file) return null
  const path = String(file.path || '')
  const keepPath = !!(file.cosKey || file.stored || /^https?:/i.test(path))
  if (!keepPath) return null
  return {
    id: file.id,
    path,
    name: file.name,
    caption: file.caption || '',
    createdAt: file.createdAt,
    ocrText: file.ocrText ? String(file.ocrText).slice(0, 4000) : '',
    cosKey: file.cosKey || '',
    stored: true,
    storing: false,
    storeError: file.storeError || '',
    ephemeral: false
  }
}

function slimProject(project) {
  const materials = {}
  Object.keys(project.materials || {}).forEach((key) => {
    const mat = Object.assign({}, project.materials[key])
    mat.files = (mat.files || []).map(slimFile).filter(Boolean)
    materials[key] = mat
  })
  return Object.assign({}, project, { materials })
}

function forgetId(id) {
  try {
    localStorage.setItem(scopedKey(ID_KEY), JSON.stringify(loadRememberedIds().filter((item) => item !== id)))
    if ((currentScope || accountScope()) === 'guest') {
      localStorage.setItem(ID_KEY, JSON.stringify(loadRememberedIds().filter((item) => item !== id)))
    }
  } catch (e) { /* ignore */ }
}

function saveProject(project, opts) {
  if (!opts || opts.touch !== false) project.updatedAt = Date.now()
  const idx = state.projects.findIndex((p) => p.id === project.id)
  if (idx >= 0) state.projects[idx] = project
  else state.projects.unshift(project)
  persistLocal()
  return project
}

function isForbiddenCloud(err) {
  const code = err && err.code
  if (code === 4030 || code === '4030') return true
  return /不是你的项目/.test(String((err && err.message) || ''))
}

async function runCloudUpsert(id) {
  delete upsertPending[id]
  delete upsertTimers[id]
  const live = findProject(id)
  if (!live || deletedIds.has(id)) return null
  try {
    const row = await upsertCloudProject(live)
    const current = findProject(id)
    if (current) {
      markCloudSynced(current, row)
      persistLocal()
    }
    notifyLivePeers()
    return row
  } catch (e) {
    if (isForbiddenCloud(e)) removeLocalOnly(id)
    return null
  }
}

function scheduleCloudUpsert(project) {
  if (!project || !project.id || deletedIds.has(project.id)) return
  const id = project.id
  upsertPending[id] = true
  if (upsertTimers[id]) clearTimeout(upsertTimers[id])
  upsertTimers[id] = setTimeout(() => {
    runCloudUpsert(id)
  }, 350)
}

async function flushCloudUpserts() {
  const ids = Object.keys(upsertPending)
  Object.keys(upsertTimers).forEach((id) => {
    clearTimeout(upsertTimers[id])
    delete upsertTimers[id]
  })
  await Promise.all(ids.map((id) => runCloudUpsert(id)))
}

function removeLocalOnly(id) {
  const project = findProject(id)
  if (project && project.materials) {
    Object.keys(project.materials).forEach((key) => revokeFiles(project.materials[key].files))
  }
  state.projects = state.projects.filter((p) => p.id !== id)
  forgetId(id)
  persistLocal()
}

function hasFilledText(value) {
  const s = String(value || '').trim()
  return !!s && s !== '待认项目'
}

function hasFilledAmount(value) {
  return value === 0 || (value !== '' && value != null)
}

function hasMaterialContent(project) {
  const materials = (project && project.materials) || {}
  return Object.keys(materials).some((key) => {
    const mat = materials[key] || {}
    if ((mat.files || []).length) return true
    if (mat.confirmed || mat.scanFilled) return true
    if (hasFilledText(mat.date) || hasFilledText(mat.startDate) || hasFilledText(mat.endDate)) return true
    if (hasFilledText(mat.contractor) || hasFilledText(mat.remark) || hasFilledText(mat.notes)) return true
    if (hasFilledAmount(mat.amount)) return true
    return false
  })
}

export function isBlankDraft(project) {
  if (!project) return true
  if (hasFilledText(project.name) || hasFilledText(project.village) || hasFilledText(project.contractor) || hasFilledText(project.notes) || hasFilledText(project.partnerVillage)) return false
  if (hasFilledAmount(project.budgetAmount) || hasFilledAmount(project.partnerAmount)) return false
  return !hasMaterialContent(project)
}

export function listProjects() {
  return state.projects.filter((p) => !isBlankDraft(p)).slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
}

export function getProject(id) {
  return findProject(id)
}

export function createProject(fields) {
  const saved = saveProject(defaultProject(fields))
  scheduleCloudUpsert(saved)
  return saved
}

export function updateProject(id, fields) {
  const project = findProject(id)
  if (!project) return null
  Object.assign(project, fields || {})
  const saved = saveProject(project)
  const keys = Object.keys(fields || {})
  const localOnly = keys.length && keys.every((key) => key === 'lastAudit' || key === 'updatedAt')
  if (!localOnly) scheduleCloudUpsert(saved)
  return saved
}

export function upsertProject(fields) {
  const patch = {
    name: (fields.name || '').trim() || (fields.id && findProject(fields.id) ? findProject(fields.id).name : '') || '待认项目',
    village: (fields.village || '').trim(),
    year: fields.year || String(new Date().getFullYear()),
    contractor: (fields.contractor || '').trim(),
    notes: (fields.notes || '').trim(),
    budgetAmount: fields.budgetAmount,
    jointBid: !!fields.jointBid,
    partnerVillage: fields.jointBid ? String(fields.partnerVillage || '').trim() : '',
    partnerAmount: fields.jointBid ? fields.partnerAmount : ''
  }
  if (fields.orgType) patch.orgType = orgUtil.normalize(fields.orgType)
  if (fields.id) {
    const updated = updateProject(fields.id, patch)
    if (!updated) throw new Error('项目不存在。')
    return updated
  }
  const created = createProject(patch)
  return created
}

function revokeFiles(files) {
  ;(files || []).forEach((f) => {
    if (f && f.path && String(f.path).startsWith('blob:')) {
      try { URL.revokeObjectURL(f.path) } catch (e) { /* ignore */ }
    }
  })
}

export async function deleteProject(id, password) {
  const project = findProject(id)
  deletedIds.add(id)
  persistDeletedIds()
  if (project && project.materials) {
    Object.keys(project.materials).forEach((key) => {
      revokeFiles(project.materials[key].files)
    })
  }
  state.projects = state.projects.filter((p) => p.id !== id)
  forgetId(id)
  persistLocal()
  try {
    await destroyCloudProject(id, password, { year: project && project.year })
  } catch (err) {
    if (isMissingCloud(err)) return
    if (!isDeleteAuthError(err) && !isForbiddenCloud(err)) return
    deletedIds.delete(id)
    persistDeletedIds()
    if (project && !findProject(id)) {
      state.projects.unshift(project)
      persistLocal()
    }
    throw err
  }
}

export function getMaterial(project, itemId) {
  const base = checklist.emptyMaterial()
  const raw = (project && project.materials && project.materials[itemId]) || {}
  const merged = Object.assign({}, base, raw)
  merged.files = Array.isArray(raw.files) ? raw.files.slice() : []
  return merged
}

function derivePeople(next) {
  const people = next.people
  if (!Array.isArray(people) || !people.length) return next
  let village = 0
  let supervisor = 0
  let named = 0
  people.forEach((person) => {
    if (person && String(person.name || '').trim()) named += 1
    if (person && person.role === 'village') village += 1
    if (person && person.role === 'supervisor') supervisor += 1
  })
  next.peopleCount = named || people.length
  next.committeeCount = village
  next.hasSupervisor = supervisor > 0
  return next
}

export function saveMaterial(projectId, itemId, patch) {
  const project = findProject(projectId)
  if (!project) throw new Error('找不到这个项目。')
  project.materials = project.materials || {}
  const raw = project.materials[itemId] || {}
  const current = getMaterial(project, itemId)
  const next = derivePeople(Object.assign({}, current, patch || {}))
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'files')) next.files = patch.files || []
  else next.files = Array.isArray(raw.files) ? raw.files : []
  project.materials[itemId] = next
  if (itemId === 'bid_notice') {
    if (next.date) {
      project.bidDate = next.date
      project.awardDate = next.date
    }
    if (next.amount !== '' && next.amount != null) {
      project.bidAmount = next.amount
      project.awardAmount = next.amount
    }
  }
  if (itemId === 'compare_sheet') {
    if (next.amount !== '' && next.amount != null) project.awardAmount = next.amount
    if (next.contractor && !String(project.contractor || '').trim()) project.contractor = next.contractor
  }
  if (itemId === 'contract' && next.amount !== '' && next.amount != null) {
    project.contractAmount = next.amount
  }
  saveProject(project)
  scheduleCloudUpsert(project)
  return next
}

function applyCloudPhotos(project, photos) {
  if (!project || !photos) return project
  project.materials = project.materials || {}
  Object.keys(photos).forEach((slot) => {
    if (!isCloudFileSlot(slot)) return
    const incoming = (photos[slot] || []).map((row) => ({
      id: row.id,
      path: row.url || row.path,
      name: row.name || (row.id + '.jpg'),
      caption: row.caption || '',
      createdAt: row.createdAt || Date.now(),
      cosKey: row.key || row.cosKey || '',
      stored: true,
      storing: false,
      storeError: '',
      ephemeral: false
    }))
    if (!incoming.length) return
    const current = getMaterial(project, slot)
    const seen = new Set((current.files || []).map((f) => f.id || f.cosKey || f.path))
    const extra = incoming.filter((row) => !seen.has(row.id) && !seen.has(row.cosKey) && !seen.has(row.path))
    if (!extra.length && (current.files || []).some((f) => f.cosKey)) return
    const merged = (current.files || []).slice()
    incoming.forEach((row) => {
      const idx = merged.findIndex((f) => f.id === row.id || f.cosKey === row.cosKey)
      if (idx >= 0) {
        const prev = merged[idx]
        merged[idx] = Object.assign({}, prev, row, {
          caption: prev.caption || row.caption || ''
        })
      }
      else merged.push(row)
    })
    project.materials[slot] = Object.assign({}, current, { files: merged })
  })
  return project
}

function applyCloudPhotoMeta(project, meta) {
  if (!project || !meta) return project
  project.materials = project.materials || {}
  PHOTO_SLOTS.forEach((slot) => {
    const row = meta[slot]
    if (!row) return
    const current = getMaterial(project, slot)
    const next = Object.assign({}, current)
    if (!next.date && row.date) next.date = row.date
    if (slot === 'photo_accept') {
      if ((next.peopleCount === '' || next.peopleCount == null) && row.peopleCount !== '' && row.peopleCount != null) {
        next.peopleCount = row.peopleCount
      }
      if ((next.committeeCount === '' || next.committeeCount == null) && row.committeeCount !== '' && row.committeeCount != null) {
        next.committeeCount = row.committeeCount
      }
      if (!next.hasSupervisor && row.hasSupervisor) next.hasSupervisor = true
      if (!next.peopleNote && row.peopleNote) next.peopleNote = row.peopleNote
    }
    project.materials[slot] = next
  })
  return project
}

function canUploadFile(file) {
  if (!file || file.cosKey || file.stored) return false
  if (file.source && Number(file.source.size) > 0) return true
  const path = String(file.path || '')
  return path.indexOf('blob:') === 0 || path.indexOf('data:') === 0
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function enqueueProjectPersist(projectId, task) {
  const key = String(projectId || '')
  const prev = persistProjectTails[key] || Promise.resolve()
  const run = prev.then(task, task)
  persistProjectTails[key] = run.then(() => undefined, () => undefined)
  return run
}

function isMissingCloud(err) {
  const code = err && err.code
  if (code === 4004 || code === '4004') return true
  return /找不到/.test(String((err && err.message) || ''))
}

async function deleteCloudPhotoRetry(projectId, fileId) {
  if (!projectId || !fileId) return
  let lastErr = null
  for (let i = 0; i < 3; i++) {
    try {
      await deleteCloudPhoto(projectId, fileId)
      return
    } catch (err) {
      if (isMissingCloud(err)) return
      lastErr = err
      if (i < 2) await waitMs(300 * (i + 1))
    }
  }
  throw lastErr || new Error('云端照片没删掉')
}

function liveSlotFile(projectId, itemId, fileId) {
  const live = findProject(projectId)
  const files = live && live.materials && live.materials[itemId] && live.materials[itemId].files
  return (files || []).find((f) => f && f.id === fileId) || null
}

function patchSlotFile(projectId, itemId, fileId, patch) {
  const live = findProject(projectId)
  if (!live) return null
  const file = liveSlotFile(projectId, itemId, fileId)
  if (!file) return null
  Object.assign(file, patch || {})
  live.updatedAt = Date.now()
  persistLocal()
  return file
}

async function persistOneFile(projectId, itemId, fileId) {
  if (persistBusy[fileId]) return
  persistBusy[fileId] = true
  try {
    const current = liveSlotFile(projectId, itemId, fileId)
    if (!canUploadFile(current)) return
    patchSlotFile(projectId, itemId, fileId, { storing: true, storeError: '' })
    let lastErr = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const file = liveSlotFile(projectId, itemId, fileId)
      if (!file) return
      if (file.cosKey || file.stored) {
        patchSlotFile(projectId, itemId, fileId, { storing: false, storeError: '' })
        return
      }
      if (!canUploadFile(file)) {
        lastErr = new Error('本地照片已丢失，请重新上传')
        break
      }
      try {
        const saved = await enqueueProjectPersist(projectId, () => {
          const live = liveSlotFile(projectId, itemId, fileId)
          if (!live || live.cosKey || live.stored || !canUploadFile(live)) return null
          return uploadCloudPhoto(findProject(projectId), itemId, live)
        })
        if (!saved) {
          const live = liveSlotFile(projectId, itemId, fileId)
          if (!live) return
          if (live.cosKey || live.stored) {
            patchSlotFile(projectId, itemId, fileId, { storing: false, storeError: '' })
            return
          }
          lastErr = new Error('本地照片已丢失，请重新上传')
          break
        }
        if (!liveSlotFile(projectId, itemId, fileId)) {
          try { await deleteCloudPhotoRetry(projectId, saved.id || fileId) } catch (e) { /* 已从本机删掉，云端再清 */ }
          return
        }
        const liveFile = liveSlotFile(projectId, itemId, fileId)
        const oldPath = liveFile && liveFile.path
        const after = patchSlotFile(projectId, itemId, fileId, Object.assign({}, saved, {
          caption: (liveFile && liveFile.caption) || saved.caption || '',
          storing: false,
          storeError: '',
          source: null
        }))
        if (after && oldPath && String(oldPath).startsWith('blob:') && after.path !== oldPath) {
          try { URL.revokeObjectURL(oldPath) } catch (e) { /* ignore */ }
        }
        scheduleCloudUpsert(findProject(projectId))
        return
      } catch (err) {
        lastErr = err
        if (attempt < 4) await waitMs(400 * (attempt + 1) * (attempt + 1))
      }
    }
    patchSlotFile(projectId, itemId, fileId, {
      storing: false,
      storeError: (lastErr && lastErr.message) || '没存上云端'
    })
  } finally {
    delete persistBusy[fileId]
  }
}

async function persistPhotoSlot(projectId, itemId) {
  if (!isCloudFileSlot(itemId)) return
  const lockKey = projectId + ':' + itemId
  persistDirty[lockKey] = true
  if (persistLocks[lockKey]) return persistLocks[lockKey]
  persistLocks[lockKey] = (async () => {
    const attempted = new Set()
    while (true) {
      persistDirty[lockKey] = false
      const project = findProject(projectId)
      if (!project) return
      const pending = (getMaterial(project, itemId).files || []).filter((f) => {
        return canUploadFile(f) && !persistBusy[f.id] && !attempted.has(f.id)
      })
      if (!pending.length) {
        await Promise.resolve()
        if (persistDirty[lockKey]) continue
        break
      }
      for (let i = 0; i < pending.length; i++) {
        attempted.add(pending[i].id)
        await persistOneFile(projectId, itemId, pending[i].id)
      }
    }
  })().finally(() => {
    delete persistLocks[lockKey]
    if (persistDirty[lockKey]) persistPhotoSlot(projectId, itemId)
    else delete persistDirty[lockKey]
  })
  return persistLocks[lockKey]
}

export function persistPendingPhotos(projectId) {
  if (!projectId) return Promise.resolve()
  const project = findProject(projectId)
  const keys = new Set(PHOTO_SLOTS)
  Object.keys((project && project.materials) || {}).forEach((key) => {
    if (isCloudFileSlot(key)) keys.add(key)
  })
  return Promise.all(Array.from(keys).map((slot) => persistPhotoSlot(projectId, slot)))
}

function pairedPhotoPatch(project, itemId, files) {
  const item = checklist.getItem(itemId, project && project.orgType)
  if (!item || !item.requirePairedPhoto) return {}
  return { pairedPhoto: (files || []).length > 0 }
}

function looksLikeImage(file) {
  if (!file) return false
  const type = String(file.type || (file.source && file.source.type) || '')
  if (/pdf/i.test(type)) return false
  if (type.indexOf('image/') === 0) return true
  const name = String(file.name || '')
  if (/\.pdf$/i.test(name)) return false
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(name)
}

async function orientStoreFile(file, itemId) {
  if (!file || file.oriented) return file
  if (!looksLikeImage(file)) {
    file.oriented = true
    return file
  }
  const src = pickPhotoSrc(file) || file.path
  if (!src) {
    file.oriented = true
    return file
  }
  try {
    const blob = await fetchPhotoBlob(src)
    const baked = await bakeUprightJpeg(blob, {
      name: file.name,
      force: isPhotoSlot(itemId) || (typeof File === 'function' && blob instanceof File && !/第\d+页/i.test(String(file.name || blob.name || '')))
    })
    if (!baked || baked === blob) {
      file.oriented = true
      return file
    }
    const oldPath = file.path
    file.source = baked
    file.path = URL.createObjectURL(baked)
    if (baked.name) file.name = baked.name
    file.oriented = true
    if (oldPath && String(oldPath).startsWith('blob:') && oldPath !== file.path) {
      try { URL.revokeObjectURL(oldPath) } catch (e) { /* ignore */ }
    }
    return file
  } catch (e) {
    file.oriented = true
    return file
  }
}

async function orientIncomingFiles(files, itemId) {
  const list = files || []
  const out = []
  for (let i = 0; i < list.length; i++) out.push(await orientStoreFile(list[i], itemId))
  return out
}

export async function addFiles(projectId, itemId, files) {
  const project = findProject(projectId)
  if (!project) throw new Error('找不到这个项目。')
  const current = getMaterial(project, itemId)
  const item = checklist.getItem(itemId, project.orgType)
  const incoming = await orientIncomingFiles(files || [], itemId)
  let next
  if (item && item.requirePairedPhoto && !current.pairedPhoto && incoming.length) {
    const keep = new Set(incoming.map((f) => f && f.id).filter(Boolean))
    for (let i = 0; i < current.files.length; i++) {
      const file = current.files[i]
      if (file && file.id && !keep.has(file.id)) {
        await deleteCloudPhotoRetry(projectId, file.id)
      }
    }
    revokeFiles(current.files.filter((f) => !f.cosKey && !keep.has(f && f.id)))
    next = incoming
  } else {
    next = current.files.concat(incoming)
  }
  saveMaterial(projectId, itemId, Object.assign({ files: next }, pairedPhotoPatch(project, itemId, next)))
  await persistPhotoSlot(projectId, itemId)
  return files
}

export async function replaceFiles(projectId, itemId, files) {
  const project = findProject(projectId)
  if (!project) throw new Error('找不到这个项目。')
  const current = getMaterial(project, itemId)
  const nextFiles = await orientIncomingFiles(files || [], itemId)
  const keep = new Set(nextFiles.map((f) => f && f.id).filter(Boolean))
  if (isCloudFileSlot(itemId)) {
    for (let i = 0; i < current.files.length; i++) {
      const file = current.files[i]
      if (file && file.id && !keep.has(file.id)) {
        await deleteCloudPhotoRetry(projectId, file.id)
      }
    }
  }
  revokeFiles(current.files.filter((f) => !f.cosKey))
  saveMaterial(projectId, itemId, Object.assign({ files: nextFiles }, pairedPhotoPatch(project, itemId, nextFiles)))
  await persistPhotoSlot(projectId, itemId)
  return nextFiles
}

export function reorderFiles(projectId, itemId, files) {
  const project = findProject(projectId)
  if (!project) throw new Error('找不到这个项目。')
  const next = (files || []).slice()
  saveMaterial(projectId, itemId, { files: next })
  return next
}

export function updateFileMeta(projectId, itemId, fileId, patch) {
  const project = findProject(projectId)
  if (!project) throw new Error('找不到这个项目。')
  const bucket = project.materials && project.materials[itemId]
  const files = bucket && Array.isArray(bucket.files) ? bucket.files : []
  const file = files.find((row) => row && row.id === fileId)
  if (!file) return files
  Object.assign(file, patch || {})
  persistLocal()
  if (isCloudFileSlot(itemId) && (file.cosKey || file.stored) && patch && Object.prototype.hasOwnProperty.call(patch, 'caption')) {
    patchCloudPhotoCaption(projectId, fileId, file.caption || '').catch(() => {})
  }
  return files
}

export function saveOcrCapture(projectId, itemId, opts) {
  const text = String((opts && opts.text) || '').slice(0, 4000)
  const patch = Object.assign({}, (opts && opts.patch) || {}, {
    ocrText: text,
    dateReviewOk: false,
    dateReviewKey: ''
  })
  const saved = saveMaterial(projectId, itemId, patch)
  if (opts && opts.fileId) updateFileMeta(projectId, itemId, opts.fileId, { ocrText: text })
  return saved
}

export async function removeFile(projectId, itemId, fileIdOrPath) {
  const project = findProject(projectId)
  if (!project) throw new Error('找不到这个项目。')
  const current = getMaterial(project, itemId)
  const removed = current.files.filter((f) => f.id === fileIdOrPath || f.path === fileIdOrPath)
  if (isCloudFileSlot(itemId)) {
    for (let i = 0; i < removed.length; i++) {
      const file = removed[i]
      if (file && file.id) await deleteCloudPhotoRetry(projectId, file.id)
    }
  }
  revokeFiles(removed.filter((f) => !f.cosKey && String((f && f.path) || '').startsWith('blob:')))
  const nextFiles = current.files.filter((f) => f.id !== fileIdOrPath && f.path !== fileIdOrPath)
  saveMaterial(projectId, itemId, Object.assign({ files: nextFiles }, pairedPhotoPatch(project, itemId, nextFiles)))
}

export async function rotateStoredFile(projectId, itemId, fileId, degrees) {
  const project = findProject(projectId)
  if (!project) throw new Error('找不到这个项目。')
  const current = liveSlotFile(projectId, itemId, fileId)
  if (!current) throw new Error('找不到这张照片。')
  if (current.storing) throw new Error('正在保存，请稍后再转')
  await enqueueProjectPersist(projectId, async () => {
    const live = liveSlotFile(projectId, itemId, fileId)
    if (!live) throw new Error('找不到这张照片。')
    patchSlotFile(projectId, itemId, fileId, { storing: true, storeError: '' })
    try {
      const blob = await fetchPhotoBlob(pickPhotoSrc(live) || live.path)
      const baked = await bakeUprightJpeg(blob, {
        rotate: degrees == null ? 90 : degrees,
        force: true,
        name: live.name
      })
      const oldPath = live.path
      if (live.cosKey || live.stored) {
        try { await deleteCloudPhotoRetry(projectId, fileId) } catch (e) { /* 仍替换成本地图再传 */ }
      }
      const nextPath = URL.createObjectURL(baked)
      patchSlotFile(projectId, itemId, fileId, {
        path: nextPath,
        source: baked,
        name: baked.name || live.name,
        cosKey: '',
        stored: false,
        ephemeral: true,
        oriented: true,
        storing: false,
        storeError: ''
      })
      if (oldPath && String(oldPath).startsWith('blob:') && oldPath !== nextPath) {
        try { URL.revokeObjectURL(oldPath) } catch (e) { /* ignore */ }
      }
    } catch (err) {
      patchSlotFile(projectId, itemId, fileId, {
        storing: false,
        storeError: (err && err.message) || '旋转失败'
      })
      throw err
    }
  })
  await persistPhotoSlot(projectId, itemId)
  return liveSlotFile(projectId, itemId, fileId)
}

export function fileFromBlob(blob, name) {
  const copy = clonePickedFile(blob) || blob
  const label = name || 'page.jpg'
  return {
    id: uid('f'),
    path: URL.createObjectURL(copy),
    source: copy || null,
    name: label,
    caption: '',
    createdAt: Date.now(),
    ephemeral: true
  }
}

export function filesFromInput(fileList) {
  return Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith('image/')).map((file) => fileFromBlob(file, file.name))
}

export function applyCloudRecord(base, row, preferCloud) {
  if (!base || !row) return base
  const takeCloud = preferCloud !== false
  applyCloudScalars(base, row, takeCloud)
  base.orgType = orgUtil.normalize(base.orgType || row.orgType)
  applyCloudMaterials(base, row.materials, takeCloud)
  applyCloudPhotos(base, row.photos)
  applyCloudPhotoMeta(base, row.photoMeta)
  if (row.updatedAt) base.updatedAt = takeCloud ? row.updatedAt : (base.updatedAt || row.updatedAt)
  markCloudSynced(base, row)
  return base
}

export function mergeCloudProject(row, opts) {
  if (!row || !row.id || deletedIds.has(row.id)) return null
  const existing = findProject(row.id)
  const live = !!(opts && opts.live)
  const pending = !!upsertPending[row.id]
  if (live && existing) {
    const cloudTs = Number(row.updatedAt || 0)
    const localTs = Number(existing.updatedAt || 0)
    const newFiles = hasIncomingCloudFiles(existing, row)
    if (!newFiles && (pending || cloudTs <= localTs)) return existing
  }
  const base = existing || defaultProject(row)
  const preferCloud = live
    ? (!pending && (!existing || Number(row.updatedAt || 0) > Number(existing.updatedAt || 0)))
    : (!existing || cloudRecordIsNewer(existing, row))
  applyCloudRecord(base, row, preferCloud)
  return saveProject(base, { touch: false })
}

export async function ensureProjectReady(id) {
  if (!id) return null
  const project = await hydrateProject(id)
  await persistPendingPhotos(id)
  return project || findProject(id)
}

export async function hydrateFromCloud() {
  syncAccountStore()
  await flushCloudUpserts()
  const restored = []
  const seen = new Set()
  const keep = new Set()

  const mergeRow = (row) => {
    if (!row || !row.id || deletedIds.has(row.id) || seen.has(row.id)) return
    seen.add(row.id)
    const merged = mergeCloudProject(row)
    if (merged) {
      keep.add(merged.id)
      restored.push(merged)
    }
  }

  const idsBefore = new Set(loadRememberedIds().concat(state.projects.map((p) => p.id)))
  if (isLoggedIn()) {
    try {
      const list = await listCloudProjects()
      list.forEach((row) => {
        if (!row || !row.id) return
        const known = !!findProject(row.id) || idsBefore.has(row.id)
        if (!known && !Object.prototype.hasOwnProperty.call(row, 'materials')) return
        mergeRow(row)
      })
    } catch (e) { /* 列表失败时仍按本机 id 补拉 */ }
  }

  const ids = Array.from(new Set(loadRememberedIds().concat(state.projects.map((p) => p.id))))
  await Promise.all(ids.map(async (id) => {
    if (!id || deletedIds.has(id) || seen.has(id)) return
    try {
      const row = await getCloudProject(id)
      if (deletedIds.has(id)) return
      mergeRow(row)
    } catch (e) {
      const local = findProject(id)
      if (isForbiddenCloud(e)) {
        removeLocalOnly(id)
        return
      }
      if (isMissingCloud(e)) {
        if (local && wasCloudSynced(local)) removeLocalOnly(id)
        else if (local) {
          const row = await runCloudUpsert(id)
          if (row) mergeRow(row)
          else if (local) keep.add(local.id)
        }
        return
      }
      if (local) keep.add(local.id)
    }
  }))

  if (isLoggedIn()) {
    const pending = state.projects.filter((p) => p && p.id && !seen.has(p.id) && !deletedIds.has(p.id))
    await Promise.all(pending.map(async (project) => {
      const row = await runCloudUpsert(project.id)
      if (row) mergeRow(row)
      else if (findProject(project.id)) keep.add(project.id)
    }))
    state.projects.slice().forEach((project) => {
      if (!project || keep.has(project.id) || seen.has(project.id)) return
      if (wasCloudSynced(project)) removeLocalOnly(project.id)
    })
  }

  return restored
}

export async function hydrateProject(id) {
  if (!id) return null
  try {
    const row = await getCloudProject(id)
    return mergeCloudProject(row)
  } catch (e) {
    if (isForbiddenCloud(e) || isMissingCloud(e)) {
      if (isForbiddenCloud(e) || wasCloudSynced(findProject(id))) removeLocalOnly(id)
      return findProject(id)
    }
    return findProject(id)
  }
}

export function restoreLocal() {
  loadDeletedIds()
  state.projects = []
  let rows = readJsonArray(scopedKey(STATE_KEY))
  let importedLegacy = false
  if ((!rows.length) && isLoggedIn()) {
    const claimed = String(localStorage.getItem(LEGACY_CLAIM_KEY) || '')
    const uid = currentUserId()
    if (!claimed || claimed === uid) {
      rows = readJsonArray(STATE_KEY)
      if (!rows.length) rows = readJsonArray(STATE_KEY + ':guest')
      if (rows.length) {
        importedLegacy = true
        try { localStorage.setItem(LEGACY_CLAIM_KEY, uid) } catch (e) { /* ignore */ }
      }
    }
  } else if (!rows.length) {
    rows = readJsonArray(STATE_KEY)
  }
  rows.forEach((row) => {
    if (!row || !row.id || deletedIds.has(row.id)) return
    const project = Object.assign(defaultProject(row), row)
    project.materials = row.materials || {}
    const idx = state.projects.findIndex((p) => p.id === project.id)
    if (idx >= 0) state.projects[idx] = project
    else state.projects.push(project)
  })
  if (importedLegacy) {
    persistLocal()
    try {
      localStorage.removeItem(STATE_KEY)
      localStorage.removeItem(ID_KEY)
      localStorage.removeItem(DELETED_KEY)
    } catch (e) { /* ignore */ }
  }
}

export function syncAccountStore() {
  const next = accountScope()
  if (currentScope && next === currentScope) return false
  if (currentScope) persistLocal()
  currentScope = next
  restoreLocal()
  return true
}

export async function flushPreauditCloud() {
  await flushCloudUpserts()
}

const LIVE_MS = 2500
let liveWanted = false
let liveTimer = null
let livePullBusy = null
let liveChannel = null

function notifyLivePeers() {
  try {
    if (liveChannel) liveChannel.postMessage({ user: currentUserId(), at: Date.now() })
  } catch (e) { /* ignore */ }
}

function bindLiveChannel() {
  if (liveChannel || typeof BroadcastChannel === 'undefined') return
  try {
    liveChannel = new BroadcastChannel('preaudit-live-v1')
    liveChannel.onmessage = (ev) => {
      const data = ev && ev.data
      if (!data || String(data.user || '') !== currentUserId()) return
      pullLiveFromCloud()
    }
  } catch (e) {
    liveChannel = null
  }
}

export async function pullLiveFromCloud() {
  if (!isLoggedIn()) return []
  if (livePullBusy) return livePullBusy
  livePullBusy = (async () => {
    let list = []
    try {
      list = await listCloudProjects()
    } catch (e) {
      return []
    }
    if (!Array.isArray(list)) list = []
    const cloudIds = new Set()
    list.forEach((row) => {
      if (!row || !row.id || deletedIds.has(row.id)) return
      if (!Object.prototype.hasOwnProperty.call(row, 'materials')) return
      cloudIds.add(row.id)
      mergeCloudProject(row, { live: true })
    })
    state.projects.slice().forEach((project) => {
      if (!project || cloudIds.has(project.id) || upsertPending[project.id] || deletedIds.has(project.id)) return
      if (wasCloudSynced(project)) removeLocalOnly(project.id)
    })
    return list
  })().finally(() => {
    livePullBusy = null
  })
  return livePullBusy
}

function scheduleLivePull(delay) {
  if (liveTimer) clearTimeout(liveTimer)
  liveTimer = setTimeout(() => {
    liveTimer = null
    tickLiveSync()
  }, delay)
}

async function tickLiveSync() {
  if (!liveWanted) return
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  if (!hidden && isLoggedIn()) {
    try { await pullLiveFromCloud() } catch (e) { /* 下一轮再拉 */ }
  }
  if (liveWanted) scheduleLivePull(hidden ? LIVE_MS * 6 : LIVE_MS)
}

export function startLiveSync() {
  bindLiveChannel()
  if (liveWanted) return
  liveWanted = true
  tickLiveSync()
}

export function stopLiveSync() {
  liveWanted = false
  if (liveTimer) {
    clearTimeout(liveTimer)
    liveTimer = null
  }
}

export function clearAll() {
  state.projects.forEach((p) => {
    if (!p.materials) return
    Object.keys(p.materials).forEach((key) => revokeFiles(p.materials[key].files))
  })
  state.projects = []
  persistLocal()
}

currentScope = accountScope()
restoreLocal()

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushCloudUpserts()
      return
    }
    if (liveWanted) tickLiveSync()
  })
  window.addEventListener('focus', () => {
    if (liveWanted) pullLiveFromCloud()
  })
}
