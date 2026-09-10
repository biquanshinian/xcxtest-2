/**
 * 图文业务前端缓存：按工作区 version 失效，未变更不换数据。
 */
const PREFIX = 'tw-ws-v1'
const MAX_STORE = 1.5 * 1024 * 1024
const mem = new Map()

function storage() {
  try {
    if (typeof sessionStorage === 'undefined') return null
    return sessionStorage
  } catch {
    return null
  }
}

function clone(value) {
  if (value == null) return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

function storeGet(key) {
  if (mem.has(key)) return clone(mem.get(key))
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(`${PREFIX}:${key}`)
    if (!raw) return null
    const row = JSON.parse(raw)
    if (!row || typeof row !== 'object') return null
    mem.set(key, row)
    return clone(row)
  } catch {
    return null
  }
}

function storeSet(key, row) {
  const snap = { version: Number(row && row.version) || 0, data: clone(row && row.data) }
  mem.set(key, snap)
  const s = storage()
  if (!s) return
  try {
    const raw = JSON.stringify(snap)
    if (raw.length > MAX_STORE) return
    s.setItem(`${PREFIX}:${key}`, raw)
  } catch { /* quota / private mode */ }
}

function storeDel(key) {
  mem.delete(key)
  const s = storage()
  if (!s) return
  try { s.removeItem(`${PREFIX}:${key}`) } catch { /* ignore */ }
}

function storeClear(prefix) {
  for (const key of [...mem.keys()]) {
    if (!prefix || key.startsWith(prefix)) mem.delete(key)
  }
  const s = storage()
  if (!s) return
  try {
    const keys = []
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i)
      if (k && k.startsWith(`${PREFIX}:`) && (!prefix || k.startsWith(`${PREFIX}:${prefix}`))) keys.push(k)
    }
    keys.forEach((k) => s.removeItem(k))
  } catch { /* ignore */ }
}

export function listQueryKey(query) {
  const q = query || {}
  return [
    String(q.q || q.keyword || '').trim(),
    String(q.status || ''),
    String(q.from || q.dateFrom || ''),
    String(q.to || q.dateTo || ''),
    String(q.page || 1),
    String(q.pageSize || 100)
  ].join('|')
}

export function editQueryKey(query) {
  const q = query || {}
  const id = String(q.id || '').trim()
  if (id && id !== 'new') return id
  return `new:${String(q.copyFrom || '').trim()}`
}

export function peekList(query) {
  return storeGet(`list:${listQueryKey(query)}`)
}

export function putList(query, data) {
  if (!data || data.unchanged) return
  storeSet(`list:${listQueryKey(query)}`, { version: data.version, data })
  if (data.settings) putSettings(data)
}

export function peekEdit(query) {
  return storeGet(`edit:${editQueryKey(query)}`)
}

export function putEdit(query, data) {
  if (!data || data.unchanged) return
  storeSet(`edit:${editQueryKey(query)}`, { version: data.version, data })
  if (data.settings) putSettings(data)
  if (Array.isArray(data.customers)) putCustomers({ list: data.customers, total: data.customers.length, version: data.version })
}

export function peekSettings() {
  return storeGet('settings')
}

export function putSettings(data) {
  if (!data || !data.settings || data.unchanged) return
  storeSet('settings', { version: data.version, data: { settings: data.settings, version: data.version } })
}

export function peekCustomers() {
  return storeGet('customers')
}

export function putCustomers(data) {
  if (!data || !Array.isArray(data.list) || data.unchanged) return
  storeSet('customers', { version: data.version, data })
}

export function peekDashboard() {
  return storeGet('dashboard')
}

export function putDashboard(data) {
  if (!data || data.unchanged) return
  storeSet('dashboard', { version: data.version, data })
}

export function invalidateReads() {
  storeClear('list:')
  storeDel('dashboard')
  storeDel('customers')
}

export function invalidateAll() {
  storeClear('')
}

export function resetTuwenCache() {
  invalidateAll()
}
