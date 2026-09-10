/**
 * 图文智能业务：工作区 JSON 存在 COS，后台账号 + tuwen_yewu 权限即可联网查单下单。
 * 前缀：图文智能业务/{workspaceId}/workspace.json
 * 样图：图文智能业务/{workspaceId}/samples/{orderId}/{lineId}.ext
 */

const COS_PREFIX = '图文智能业务'
const WORKSPACE_ID = 'default'
const ORDER_STATUSES = {
  draft: '草稿',
  pending: '待制作',
  producing: '制作中',
  done: '已完成',
  delivered: '已交付',
  cancelled: '已取消'
}

const AUDIT_ACTION_LABELS = {
  order_create: '新建订单',
  order_update: '更新订单',
  order_delete: '删除订单',
  order_copy: '复制订单',
  order_status: '改状态',
  order_status_batch: '批量改状态',
  payment_received: '登记收款',
  import: '导入备份'
}

function auditLogSearchBlob(row) {
  const r = row || {}
  const label = AUDIT_ACTION_LABELS[r.action] || ''
  return `${r.action || ''} ${label} ${r.orderNo || ''} ${r.customerName || ''} ${r.actorLabel || ''} ${r.detail || ''} ${r.amount || ''}`.toLowerCase()
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

function workspaceKey(workspaceId) {
  return `${COS_PREFIX}/${workspaceId || WORKSPACE_ID}/workspace.json`
}

function sampleKeyFromPublicUrl(url, baseUrl) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return ''
    let host = 'mars-1397421562.cos.ap-guangzhou.myqcloud.com'
    try { host = new URL(baseUrl || `https://${host}/`).hostname } catch { /* keep default */ }
    if (u.hostname !== host) return ''
    const key = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
    if (!key.startsWith(`${COS_PREFIX}/`) || !/\/samples\//.test(key)) return ''
    if (key.includes('..') || key.includes('\\')) return ''
    return key
  } catch {
    return ''
  }
}

function sniffImageMime(buf) {
  if (!buf || buf.length < 3) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  return 'image/jpeg'
}

function sampleKey(workspaceId, orderId, lineId, ext) {
  return `${COS_PREFIX}/${workspaceId || WORKSPACE_ID}/samples/${orderId}/${lineId}.${ext || 'jpg'}`
}

function emptyWorkspace() {
  return {
    version: 1,
    workspaceId: WORKSPACE_ID,
    customers: [],
    orders: [],
    expenses: [],
    suppliers: [],
    afterSales: [],
    auditLogs: [],
    appSettings: defaultAppSettings(),
    updatedAt: '',
    updatedBy: ''
  }
}

function normalizeQty(raw) {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(0, n) : 1
}

function isCancelled(order) {
  return String(order && order.status) === 'cancelled'
}

function isBillableOrder(order) {
  return !isCancelled(order)
}

function lineQtyFactor(line) {
  const qty = normalizeQty(line && line.qty)
  const mode = String((line && line.pricingMode) || 'by_piece')
  const wM = (Number(line && line.widthMm) || 0) / 1000
  const hM = (Number(line && line.heightMm) || 0) / 1000
  if (mode === 'by_area') return Math.max(0, wM * hM) * qty
  if (mode === 'by_length') return Math.max(0, wM) * qty
  if (mode === 'by_cm') return Math.max(0, (Number(line && line.widthMm) || 0) / 10) * qty
  return qty
}

function lineAmount(line) {
  return round2((Number(line && line.unitPrice) || 0) * lineQtyFactor(line))
}

function orderSubtotal(order) {
  const lines = Array.isArray(order && order.lines) ? order.lines : []
  return round2(lines.reduce((sum, line) => sum + lineAmount(line), 0))
}

function orderTax(order) {
  const sub = orderSubtotal(order)
  const discount = Number(order && order.discount) || 0
  const rate = Number(order && order.taxRate) || 0
  return round2(Math.max(0, sub - discount) * (rate / 100))
}

function orderReceivable(order) {
  const sub = orderSubtotal(order)
  const discount = Number(order && order.discount) || 0
  return round2(Math.max(0, sub - discount + orderTax(order)))
}

function orderPaid(order) {
  return round2((Number(order && order.prepay) || 0) + (Number(order && order.currentPayment) || 0))
}

function orderBalance(order) {
  return round2(Math.max(0, orderReceivable(order) - orderPaid(order)))
}

function nextOrderNo(orders, at) {
  const d = at ? new Date(at) : new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const prefix = `TW-${y}${m}-`
  const used = new Set((orders || []).map((o) => String(o.orderNo || '')))
  for (let i = 0; i < 40; i++) {
    const n = String(1000 + Math.floor(Math.random() * 9000))
    const no = prefix + n
    if (!used.has(no)) return no
  }
  return prefix + String(Date.now()).slice(-4)
}

function parseDataUrl(raw) {
  const s = String(raw || '')
  const m = s.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) return null
  const mime = m[1] || 'image/jpeg'
  const buf = Buffer.from(m[2], 'base64')
  if (!buf.length || buf.length > 4.5 * 1024 * 1024) return null
  let ext = 'jpg'
  if (/png/i.test(mime)) ext = 'png'
  else if (/webp/i.test(mime)) ext = 'webp'
  else if (/gif/i.test(mime)) ext = 'gif'
  return { mime, buf, ext }
}

function stripLineImages(line) {
  if (!line || typeof line !== 'object') return line
  const out = { ...line }
  const url = String(out.sampleImageDataUrl || '')
  if (url.startsWith('data:')) delete out.sampleImageDataUrl
  return out
}

function firstHttpSample(order) {
  const lines = Array.isArray(order && order.lines) ? order.lines : []
  for (const line of lines) {
    const url = String((line && (line.sampleImageDataUrl || line.sampleImageUrl)) || '')
    if (/^https?:\/\//i.test(url)) return url
  }
  return ''
}

function moneyEps(decimals) {
  const d = Math.min(6, Math.max(0, Number(decimals) || 2))
  return Math.pow(10, -d) / 2
}

function isPaidDisplay(order, decimals) {
  if (!order || !order.paymentModalConfirmedAt) return false
  const eps = moneyEps(decimals)
  const rec = orderReceivable(order)
  if (rec > eps) return orderBalance(order) <= eps
  return true
}

const LINE_COLUMN_KEYS = [
  'seq', 'outsource', 'code', 'projectName', 'productName', 'spec', 'material',
  'widthMm', 'heightMm', 'area', 'qty', 'unit', 'unitPrice', 'amount', 'sample', 'remark', 'actions'
]
const LINE_COLUMN_DEFS = {
  seq: { defaultLabel: '序号', lockVisible: true },
  outsource: { defaultLabel: '外协' },
  code: { defaultLabel: '编码' },
  projectName: { defaultLabel: '项目名称' },
  productName: { defaultLabel: '产品名称' },
  spec: { defaultLabel: '规格' },
  material: { defaultLabel: '材质' },
  widthMm: { defaultLabel: '宽(mm)' },
  heightMm: { defaultLabel: '高(mm)' },
  area: { defaultLabel: '面积(㎡)' },
  qty: { defaultLabel: '数量' },
  unit: { defaultLabel: '单位' },
  unitPrice: { defaultLabel: '单价' },
  amount: { defaultLabel: '金额' },
  sample: { defaultLabel: '样图' },
  remark: { defaultLabel: '备注' },
  actions: { defaultLabel: '操作', lockVisible: true }
}

function defaultLineColumns() {
  return LINE_COLUMN_KEYS.map((key) => ({
    key,
    label: LINE_COLUMN_DEFS[key].defaultLabel,
    visible: true,
    align: 'center'
  }))
}

function normalizeColumnAlign(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'left' || v === 'right') return v
  return 'center'
}

function normalizeLineColumns(raw) {
  const defaults = defaultLineColumns()
  const map = new Map()
  if (Array.isArray(raw)) {
    raw.forEach((col) => {
      if (col && typeof col === 'object' && col.key && LINE_COLUMN_DEFS[col.key]) map.set(col.key, col)
    })
  }
  return defaults.map((col) => {
    const hit = map.get(col.key)
    const def = LINE_COLUMN_DEFS[col.key]
    const label = String((hit && hit.label) || col.label || def.defaultLabel).trim().slice(0, 40) || def.defaultLabel
    const align = normalizeColumnAlign(hit && hit.align)
    if (def.lockVisible) return { key: col.key, label, visible: true, align }
    return { key: col.key, label, visible: !(hit && hit.visible === false), align }
  })
}

function parsePresetLines(raw, maxItems, maxLen) {
  const src = Array.isArray(raw) ? raw : String(raw || '').split(/\r?\n/)
  const out = []
  for (const item of src) {
    const s = String(item || '').trim().slice(0, maxLen)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= maxItems) break
  }
  return out
}

function httpUrls(list) {
  return (Array.isArray(list) ? list : [])
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 8)
}

function summarizeOrder(order) {
  const receivable = orderReceivable(order)
  const paid = orderPaid(order)
  const balance = orderBalance(order)
  const status = String(order.status || 'pending')
  const paidShown = isPaidDisplay(order)
  return {
    id: order.id,
    orderNo: order.orderNo,
    customerId: order.customerId || '',
    customerName: order.customerName || '',
    contact: order.contact || '',
    phone: order.phone || '',
    salesperson: order.salesperson || '',
    orderDate: order.orderDate || String(order.createdAt || '').slice(0, 10),
    status,
    statusLabel: paidShown ? '已收款' : (ORDER_STATUSES[status] || status),
    displayStatus: paidShown ? 'paid' : status,
    paidLocked: paidShown,
    paymentModalConfirmedAt: order.paymentModalConfirmedAt || '',
    sortIndex: Number(order.sortIndex) || 0,
    lineCount: Array.isArray(order.lines) ? order.lines.length : 0,
    sampleImageUrl: firstHttpSample(order),
    receivable,
    paid,
    balance,
    createdAt: order.createdAt || '',
    updatedAt: order.updatedAt || ''
  }
}

function normalizeLine(raw, fallbackId) {
  const e = raw && typeof raw === 'object' ? raw : {}
  const qty = normalizeQty(e.qty)
  const pricingMode = String(e.pricingMode || 'by_piece')
  let unitLabel = String(e.unitLabel || '').trim()
  if (!unitLabel) {
    unitLabel = pricingMode === 'by_area' ? '平方米'
      : pricingMode === 'by_length' ? '米'
        : pricingMode === 'by_cm' ? '厘米' : '个'
  }
  const sample = String(e.sampleImageDataUrl || e.sampleImageUrl || '').trim()
  const out = {
    id: String(e.id || fallbackId || newId()),
    outsource: !!e.outsource,
    code: String(e.code || ''),
    projectName: String(e.projectName || ''),
    productName: String(e.productName || ''),
    spec: String(e.spec || ''),
    material: String(e.material || ''),
    widthMm: Number(e.widthMm) || 0,
    heightMm: Number(e.heightMm) || 0,
    qty,
    unitLabel,
    pricingMode,
    unitPrice: Number(e.unitPrice) || 0,
    remark: e.remark == null ? '' : String(e.remark),
    sampleNote: e.sampleNote == null ? '' : String(e.sampleNote)
  }
  if (sample && !sample.startsWith('data:')) out.sampleImageDataUrl = sample
  if (sample.startsWith('data:')) out._dataUrl = sample
  return out
}

const QUOTE_PLAN_DEFAULTS = [
  { id: 'economy', name: '经济方案' },
  { id: 'standard', name: '标准方案' },
  { id: 'rush', name: '加急方案' }
]

function normalizeQuoteItem(raw) {
  const e = raw && typeof raw === 'object' ? raw : {}
  const pricingMode = String(e.pricingMode || 'by_piece')
  let unitLabel = String(e.unitLabel || '').trim()
  if (!unitLabel) {
    unitLabel = pricingMode === 'by_area' ? '平方米'
      : pricingMode === 'by_length' ? '米'
        : pricingMode === 'by_cm' ? '厘米' : '个'
  }
  return {
    id: String(e.id || newId()),
    projectName: String(e.projectName || '').slice(0, 80),
    productName: String(e.productName || '').slice(0, 80),
    spec: String(e.spec || '').slice(0, 80),
    material: String(e.material || '').slice(0, 80),
    widthMm: Number(e.widthMm) || 0,
    heightMm: Number(e.heightMm) || 0,
    qty: normalizeQty(e.qty),
    unitLabel: unitLabel.slice(0, 20),
    pricingMode,
    unitPrice: Math.max(0, round2(Number(e.unitPrice) || 0))
  }
}

function normalizeQuotePlans(raw) {
  const incoming = Array.isArray(raw) ? raw : []
  return QUOTE_PLAN_DEFAULTS.map((d, i) => {
    const e = incoming[i] || incoming.find((x) => x && x.id === d.id) || {}
    return {
      id: d.id,
      name: String(e.name || d.name).trim().slice(0, 20) || d.name,
      companyName: String(e.companyName || '').trim().slice(0, 40),
      customerName: String(e.customerName || '').trim().slice(0, 80),
      contact: String(e.contact || '').trim().slice(0, 40),
      phone: String(e.phone || '').trim().slice(0, 30),
      address: String(e.address || '').trim().slice(0, 120),
      orderDate: String(e.orderDate || '').trim().slice(0, 20),
      deliveryDate: String(e.deliveryDate || '').trim().slice(0, 20),
      orderNo: String(e.orderNo || '').trim().slice(0, 40),
      docTitle: String(e.docTitle || '').trim().slice(0, 20),
      unitPrice: Math.max(0, round2(Number(e.unitPrice) || 0)),
      total: Math.max(0, round2(Number(e.total) || 0)),
      note: String(e.note || '').trim().slice(0, 80),
      items: (Array.isArray(e.items) ? e.items : []).slice(0, 40).map(normalizeQuoteItem)
    }
  })
}

function normalizeOrder(raw, { existingNo, nowIso, actor }) {
  const e = raw && typeof raw === 'object' ? raw : {}
  const createdAt = e.createdAt || nowIso
  const id = String(e.id || newId())
  const lines = Array.isArray(e.lines)
    ? e.lines.map((line, i) => normalizeLine(line, `${id}-l${i}`))
    : []
  const status = ORDER_STATUSES[e.status] ? e.status : 'pending'
  return {
    id,
    orderNo: String(e.orderNo || existingNo || '').trim(),
    customerId: String(e.customerId || ''),
    customerName: String(e.customerName || '').trim(),
    contact: String(e.contact || ''),
    phone: String(e.phone || '').trim(),
    address: String(e.address || ''),
    isNewCustomer: !!e.isNewCustomer,
    orderDate: String(e.orderDate || createdAt.slice(0, 10)),
    deliveryMethod: String(e.deliveryMethod || ''),
    settlementMethod: String(e.settlementMethod || ''),
    salesperson: String(e.salesperson || (actor && actor.username) || ''),
    invoiceType: String(e.invoiceType || ''),
    status,
    prepay: Number(e.prepay) || 0,
    currentPayment: Number(e.currentPayment) || 0,
    paymentMethod: String(e.paymentMethod || ''),
    discount: Number(e.discount) || 0,
    taxRate: Number(e.taxRate) || 0,
    deliveryDate: String(e.deliveryDate || ''),
    createdAt,
    updatedAt: nowIso,
    note: String(e.note || ''),
    showPaymentQrOnPrint: e.showPaymentQrOnPrint !== false,
    paymentModalConfirmedAt: e.paymentModalConfirmedAt || '',
    lastPaymentRemark: String(e.lastPaymentRemark || ''),
    lastPaymentRemarkImages: httpUrls(e.lastPaymentRemarkImages),
    sortIndex: Number(e.sortIndex) || 0,
    printDocTitle: String(e.printDocTitle || '').trim().slice(0, 20),
    quotePlans: normalizeQuotePlans(e.quotePlans),
    lines
  }
}

function defaultAppSettings() {
  return {
    brandCompanyName: '',
    printCompanyTitle: '',
    printDocTitle: '业务单',
    paymentQrDataUrl: '',
    showPaymentQrOnPrint: true,
    moneyDecimals: 2,
    areaDecimals: 3,
    qtyDecimals: 2,
    dimensionDecimals: 2,
    dimensionUnit: 'mm',
    lengthDecimals: 3,
    defaultTaxRate: 0,
    reportExpenseLabels: ['房租物业', '材料采购', '人工提成', '水电杂费'],
    orderLineColumns: defaultLineColumns(),
    orderLineMaterialPresets: [],
    orderLineSpecPresets: [],
    orderLineUnitExtraLabels: []
  }
}

function normalizeDimensionUnit(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'cm' || v === '厘米' || v === '公分') return 'cm'
  if (v === 'm' || v === '米' || v === 'meter' || v === 'metre') return 'm'
  return 'mm'
}

function dimensionColumnLabel(key, unit) {
  const suffix = normalizeDimensionUnit(unit)
  return key === 'heightMm' ? `高(${suffix})` : `宽(${suffix})`
}

function isDefaultDimensionLabel(label) {
  return /^[宽高]\((mm|cm|m|毫米|厘米|米)\)$/.test(String(label || '').trim())
}

function applyDimensionColumnLabels(columns, unit) {
  const u = normalizeDimensionUnit(unit)
  return (Array.isArray(columns) ? columns : []).map((col) => {
    if (!col || (col.key !== 'widthMm' && col.key !== 'heightMm')) return col
    if (!isDefaultDimensionLabel(col.label)) return col
    return { ...col, label: dimensionColumnLabel(col.key, u) }
  })
}

function normalizeAppSettings(raw) {
  const incoming = raw && typeof raw === 'object' ? raw : {}
  const merged = { ...defaultAppSettings(), ...incoming }
  merged.brandCompanyName = String(merged.brandCompanyName || '').trim().slice(0, 60)
  merged.printCompanyTitle = String(merged.printCompanyTitle || '').trim().slice(0, 80)
  merged.printDocTitle = String(merged.printDocTitle || '').trim().slice(0, 20) || '业务单'
  merged.paymentQrDataUrl = String(merged.paymentQrDataUrl || '')
  merged.showPaymentQrOnPrint = merged.showPaymentQrOnPrint !== false
  merged.moneyDecimals = Math.min(4, Math.max(0, Number(merged.moneyDecimals) || 2))
  merged.areaDecimals = Math.min(4, Math.max(0, Number(merged.areaDecimals) || 3))
  merged.qtyDecimals = Math.min(4, Math.max(0, Number(merged.qtyDecimals) || 2))
  merged.dimensionDecimals = Math.min(4, Math.max(0, Number(merged.dimensionDecimals) || 2))
  merged.dimensionUnit = normalizeDimensionUnit(merged.dimensionUnit)
  merged.lengthDecimals = Math.min(4, Math.max(0, Number(merged.lengthDecimals) || 3))
  merged.defaultTaxRate = Number(merged.defaultTaxRate) || 0
  merged.orderLineColumns = applyDimensionColumnLabels(normalizeLineColumns(merged.orderLineColumns), merged.dimensionUnit)
  merged.orderLineSpecPresets = parsePresetLines(merged.orderLineSpecPresets, 120, 80)
  merged.orderLineMaterialPresets = parsePresetLines(merged.orderLineMaterialPresets, 120, 80)
  merged.orderLineUnitExtraLabels = parsePresetLines(merged.orderLineUnitExtraLabels, 40, 56)
  if (Array.isArray(incoming.reportExpenseLabels)) {
    merged.reportExpenseLabels = incoming.reportExpenseLabels.map((x) => String(x || '').trim()).filter(Boolean)
  }
  return merged
}

const AFTER_SALE_STATUSES = {
  pending: '待受理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭'
}

function inDateRange(dateStr, from, to) {
  const d = String(dateStr || '').slice(0, 10)
  if (from && d < from) return false
  if (to && d > to) return false
  return true
}

function chinaYmd(raw, nowMs) {
  const s = String(raw || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const t = Date.parse(s)
  const ms = Number.isFinite(t) ? t : (Number(nowMs) || Date.now())
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function normalizeCustomer(raw, nowIso) {
  const e = raw && typeof raw === 'object' ? raw : {}
  return {
    id: String(e.id || newId()),
    name: String(e.name || e.customerName || '').trim(),
    phone: String(e.phone || ''),
    company: String(e.company || ''),
    contact: String(e.contact || ''),
    address: String(e.address || ''),
    level: String(e.level || '普通'),
    starred: !!(e.starred || e.star),
    balance: Number(e.balance) || 0,
    note: String(e.note || ''),
    createdAt: e.createdAt || nowIso,
    updatedAt: nowIso
  }
}

function normalizeSupplier(raw, nowIso) {
  const e = raw && typeof raw === 'object' ? raw : {}
  return {
    id: String(e.id || newId()),
    name: String(e.name || '').trim(),
    contact: String(e.contact || ''),
    phone: String(e.phone || ''),
    address: String(e.address || ''),
    note: String(e.note || ''),
    createdAt: e.createdAt || nowIso,
    updatedAt: nowIso
  }
}

function normalizeExpense(raw, nowIso) {
  const e = raw && typeof raw === 'object' ? raw : {}
  return {
    id: String(e.id || newId()),
    expenseDate: String(e.expenseDate || nowIso).slice(0, 10),
    category: String(e.category || '材料采购'),
    amount: Number(e.amount) || 0,
    note: String(e.note || ''),
    createdAt: e.createdAt || nowIso,
    updatedAt: nowIso
  }
}

function normalizeAfterSale(raw, nowIso) {
  const e = raw && typeof raw === 'object' ? raw : {}
  const status = AFTER_SALE_STATUSES[e.status] ? e.status : 'pending'
  return {
    id: String(e.id || newId()),
    ticketNo: String(e.ticketNo || e.afterSaleNo || ''),
    customerName: String(e.customerName || '').trim(),
    contact: String(e.contact || ''),
    phone: String(e.phone || ''),
    address: String(e.address || ''),
    orderNo: String(e.orderNo || e.relatedOrderNo || ''),
    issueType: String(e.issueType || ''),
    summary: String(e.summary || e.issueSummary || ''),
    description: String(e.description || ''),
    status,
    assignee: String(e.assignee || e.follower || ''),
    result: String(e.result || ''),
    registeredAt: String(e.registeredAt || nowIso).slice(0, 10),
    closedAt: String(e.closedAt || ''),
    companyName: String(e.companyName || ''),
    legalName: String(e.legalName || ''),
    projectAddress: String(e.projectAddress || e.address || ''),
    designLead: String(e.designLead || ''),
    constructLead: String(e.constructLead || ''),
    startDate: String(e.startDate || ''),
    endDate: String(e.endDate || ''),
    warrantyFrom: String(e.warrantyFrom || ''),
    warrantyTo: String(e.warrantyTo || ''),
    supervisePhone: String(e.supervisePhone || ''),
    printNote: String(e.printNote || ''),
    createdAt: e.createdAt || nowIso,
    updatedAt: nowIso
  }
}

function nextAfterSaleNo(list, at) {
  const d = at ? new Date(at) : new Date()
  const prefix = `AS-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-`
  const used = new Set((list || []).map((x) => String(x.ticketNo || '')))
  for (let i = 0; i < 40; i++) {
    const no = prefix + String(1000 + Math.floor(Math.random() * 9000))
    if (!used.has(no)) return no
  }
  return prefix + String(Date.now()).slice(-4)
}

function mergeById(existing, incoming, normalize, nowIso) {
  const map = new Map((existing || []).map((row) => [row.id, row]))
  for (const raw of incoming || []) {
    if (!raw) continue
    const row = normalize(raw, nowIso)
    if (!row.id) continue
    map.set(row.id, row)
  }
  return [...map.values()]
}

function normalizeAuditLog(raw) {
  const e = raw && typeof raw === 'object' ? raw : {}
  return {
    ...e,
    id: String(e.id || newId()),
    at: e.at || '',
    action: String(e.action || '')
  }
}

function appendAudit(ws, entry) {
  const logs = Array.isArray(ws.auditLogs) ? ws.auditLogs : []
  logs.unshift(entry)
  ws.auditLogs = logs.slice(0, 400)
}

function createTuwenYewuApi({
  ok, fail, now, writeOpLog, checkPerm,
  createCOSClient, COS_BUCKET, COS_REGION, COS_BASE_URL
}) {
  function deny(user) {
    return checkPerm(user, 'tuwen_yewu')
  }

  function publicUrl(key) {
    return `${COS_BASE_URL}${encodeURI(String(key || '').replace(/^\/+/, ''))}`
  }

  const WS_CACHE_TTL_MS = Math.max(0, Number(process.env.TUWEN_WS_CACHE_MS) || 15000)
  let wsCache = null
  let wsInflight = null

  function putObject(key, body, contentType) {
    const cos = createCOSClient()
    return new Promise((resolve, reject) => {
      cos.putObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Body: body,
        ContentType: contentType || 'application/octet-stream'
      }, (err, data) => (err ? reject(err) : resolve(data)))
    })
  }

  function isNotModified(err) {
    const status = Number(err && (err.statusCode || err.status))
    const code = String((err && (err.code || err.Code)) || '')
    return status === 304 || code === 'NotModified' || code === '304'
  }

  function getObject(key, etag) {
    const cos = createCOSClient()
    const params = {
      Bucket: COS_BUCKET,
      Region: COS_REGION,
      Key: key
    }
    if (etag) params.IfNoneMatch = etag
    return new Promise((resolve, reject) => {
      cos.getObject(params, (err, data) => {
        if (err) {
          if (isNotModified(err)) return resolve({ notModified: true })
          const code = String((err && (err.code || err.Code)) || '')
          const msg = String((err && err.message) || '')
          if (code === 'NoSuchKey' || /not exist|NoSuchKey/i.test(msg)) return resolve(null)
          return reject(err)
        }
        resolve(data)
      })
    })
  }

  function parseWorkspace(parsed) {
    return {
      ...emptyWorkspace(),
      ...parsed,
      workspaceId: WORKSPACE_ID,
      customers: Array.isArray(parsed.customers) ? parsed.customers : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
      afterSales: Array.isArray(parsed.afterSales) ? parsed.afterSales : [],
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
      appSettings: { ...defaultAppSettings(), ...(parsed.appSettings && typeof parsed.appSettings === 'object' ? parsed.appSettings : {}) }
    }
  }

  function rememberWorkspace(ws, etag) {
    wsCache = { ws, etag: etag || (wsCache && wsCache.etag) || '', at: Date.now() }
    return ws
  }

  async function loadWorkspace() {
    if (wsCache && (Date.now() - wsCache.at) < WS_CACHE_TTL_MS) return wsCache.ws
    if (wsInflight) return wsInflight
    wsInflight = (async () => {
      try {
        const data = await getObject(workspaceKey(WORKSPACE_ID), wsCache && wsCache.etag)
        if (data && data.notModified && wsCache) return rememberWorkspace(wsCache.ws, wsCache.etag)
        if (!data || !data.Body) return rememberWorkspace(emptyWorkspace(), '')
        try {
          const parsed = JSON.parse(Buffer.from(data.Body).toString('utf8'))
          return rememberWorkspace(parseWorkspace(parsed), data.ETag || data.etag || '')
        } catch (e) {
          return rememberWorkspace(emptyWorkspace(), '')
        }
      } finally {
        wsInflight = null
      }
    })()
    return wsInflight
  }

  async function saveWorkspace(ws, user) {
    const next = {
      ...ws,
      workspaceId: WORKSPACE_ID,
      version: Number(ws.version || 0) + 1,
      updatedAt: new Date(now()).toISOString(),
      updatedBy: (user && user.username) || ''
    }
    const put = await putObject(workspaceKey(WORKSPACE_ID), Buffer.from(JSON.stringify(next)), 'application/json; charset=utf-8')
    rememberWorkspace(next, (put && (put.ETag || put.etag)) || '')
    return next
  }

  function decorateOrder(order) {
    return {
      ...order,
      receivable: orderReceivable(order),
      paid: orderPaid(order),
      balance: orderBalance(order)
    }
  }

  function sortedCustomers(list) {
    return (list || []).slice().sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || String(a.name || '').localeCompare(String(b.name || ''), 'zh'))
  }

  function workspaceVersion(ws) {
    return Number(ws && ws.version) || 0
  }

  function versionMeta(ws) {
    return { version: workspaceVersion(ws), updatedAt: (ws && ws.updatedAt) || '' }
  }

  function sameVersion(ws, query) {
    const since = Number(query && (query.sinceVersion || query.since))
    return since > 0 && since === workspaceVersion(ws)
  }

  async function persistLineImages(order) {
    const lines = []
    for (const line of order.lines || []) {
      const dataUrl = line._dataUrl
      const copy = { ...line }
      delete copy._dataUrl
      if (dataUrl) {
        const parsed = parseDataUrl(dataUrl)
        if (parsed) {
          const key = sampleKey(WORKSPACE_ID, order.id, copy.id, parsed.ext)
          await putObject(key, parsed.buf, parsed.mime)
          copy.sampleImageDataUrl = publicUrl(key)
        }
      }
      lines.push(copy)
    }
    return { ...order, lines }
  }

  async function status(user) {
    const blocked = deny(user)
    if (blocked) return blocked
    const ws = await loadWorkspace()
    return ok({
      storage: 'cos',
      bucket: COS_BUCKET,
      prefix: `${COS_PREFIX}/${WORKSPACE_ID}/`,
      workspaceKey: workspaceKey(WORKSPACE_ID),
      orderCount: ws.orders.length,
      customerCount: ws.customers.length,
      expenseCount: ws.expenses.length,
      updatedAt: ws.updatedAt || '',
      updatedBy: ws.updatedBy || ''
    })
  }

  async function listOrders(user, query) {
    const blocked = deny(user)
    if (blocked) return blocked
    const ws = await loadWorkspace()
    if (sameVersion(ws, query)) return ok({ unchanged: true, ...versionMeta(ws) })
    const q = String((query && (query.q || query.keyword)) || '').trim().toLowerCase()
    const statusFilter = String((query && query.status) || '').trim()
    let list = ws.orders.slice()
    if (statusFilter === 'paid' || statusFilter === '__paid__') {
      list = list.filter((o) => isPaidDisplay(o))
    } else if (statusFilter && statusFilter !== 'all' && ORDER_STATUSES[statusFilter]) {
      list = list.filter((o) => String(o.status) === statusFilter && !isPaidDisplay(o))
    }
    const from = String((query && (query.from || query.dateFrom)) || '').slice(0, 10)
    const to = String((query && (query.to || query.dateTo)) || '').slice(0, 10)
    const paid = String((query && query.paid) || '')
    if (from) list = list.filter((o) => inDateRange(o.orderDate || o.createdAt, from, ''))
    if (to) list = list.filter((o) => inDateRange(o.orderDate || o.createdAt, '', to))
    if (paid === '1' || paid === 'paid') list = list.filter((o) => isBillableOrder(o) && orderBalance(o) <= 0)
    if (paid === '0' || paid === 'unpaid') list = list.filter((o) => isBillableOrder(o) && orderBalance(o) > 0)
    if (q) {
      list = list.filter((o) => {
        const extra = (o.lines || []).map((l) => `${l.projectName || ''} ${l.productName || ''} ${l.material || ''}`).join(' ')
        const blob = `${o.orderNo} ${o.customerName} ${o.phone} ${o.contact} ${o.salesperson} ${o.note} ${extra}`.toLowerCase()
        return blob.includes(q)
      })
    }
    list.sort((a, b) => {
      const sa = Number(a.sortIndex) || 0
      const sb = Number(b.sortIndex) || 0
      if (sa !== sb) {
        if (sa && sb) return sa - sb
        if (sa) return -1
        if (sb) return 1
      }
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    })
    const page = Math.max(1, parseInt(query && query.page, 10) || 1)
    const pageSize = Math.min(500, Math.max(1, parseInt(query && query.pageSize, 10) || 100))
    const total = list.length
    const slice = list.slice((page - 1) * pageSize, page * pageSize).map((order) => ({
      ...summarizeOrder(order),
      lines: (order.lines || []).map((l) => ({
        id: l.id,
        outsource: !!l.outsource,
        code: l.code || '',
        projectName: l.projectName || '',
        productName: l.productName || '',
        spec: l.spec || '',
        material: l.material || '',
        widthMm: Number(l.widthMm) || 0,
        heightMm: Number(l.heightMm) || 0,
        qty: l.qty,
        unitLabel: l.unitLabel || '',
        pricingMode: l.pricingMode || '',
        unitPrice: l.unitPrice,
        amount: lineAmount(l),
        remark: l.remark || '',
        sampleImageUrl: /^https?:\/\//i.test(String(l.sampleImageDataUrl || '')) ? l.sampleImageDataUrl : ''
      }))
    }))
    return ok({
      list: slice,
      total,
      page,
      pageSize,
      settings: normalizeAppSettings(ws.appSettings || {}),
      ...versionMeta(ws)
    })
  }

  async function getOrder(user, id) {
    const blocked = deny(user)
    if (blocked) return blocked
    const ws = await loadWorkspace()
    const order = ws.orders.find((o) => o.id === id)
    if (!order) return fail(4040, '订单不存在')
    return ok({ order: decorateOrder(order) })
  }

  async function getEditBootstrap(user, query) {
    const ws = await loadWorkspace()
    if (sameVersion(ws, query)) return ok({ unchanged: true, ...versionMeta(ws) })
    const settings = normalizeAppSettings(ws.appSettings || {})
    const customers = sortedCustomers(ws.customers)
    const id = String((query && query.id) || '').trim()
    const copyFrom = String((query && query.copyFrom) || '').trim()
    if (id && id !== 'new') {
      const order = ws.orders.find((o) => o.id === id)
      if (!order) return fail(4040, '订单不存在')
      return ok({ order: decorateOrder(order), customers, settings, ...versionMeta(ws) })
    }
    const source = copyFrom ? (ws.orders.find((o) => o.id === copyFrom) || null) : null
    return ok({
      order: source ? decorateOrder(source) : null,
      customers,
      settings,
      copied: !!source,
      ...versionMeta(ws)
    })
  }

  async function upsertOrder(user, body, idFromPath) {
    const blocked = deny(user)
    if (blocked) return blocked
    const ws = await loadWorkspace()
    const nowIso = new Date(now()).toISOString()
    const incoming = body && body.order ? body.order : body
    const id = String(idFromPath || incoming.id || '')
    const existing = id ? ws.orders.find((o) => o.id === id) : null
    let order = normalizeOrder({ ...incoming, id: existing ? existing.id : (incoming.id || newId()) }, {
      existingNo: existing && existing.orderNo,
      nowIso,
      actor: user
    })
    if (!order.orderNo) order.orderNo = nextOrderNo(ws.orders, order.orderDate)
    if (!order.customerName) return fail(4001, '请填写客户名称')
    if (!order.lines.length) return fail(4001, '请至少添加一行明细')
    if (existing && isPaidDisplay(existing)) return fail(4001, '已收款订单不可修改')
    order = await persistLineImages(order)
    order.lines = order.lines.map(stripLineImages)
    if (order.customerName) {
      const forceNew = !!order.isNewCustomer
      const hit = forceNew
        ? null
        : (ws.customers || []).find((c) => c.id === order.customerId || c.name === order.customerName)
      const row = normalizeCustomer({
        ...(hit || {}),
        id: hit ? hit.id : newId(),
        name: order.customerName,
        phone: order.phone || (hit && hit.phone) || '',
        contact: order.contact || (hit && hit.contact) || '',
        address: order.address || (hit && hit.address) || ''
      }, nowIso)
      order.customerId = row.id
      order.isNewCustomer = false
      const cidx = ws.customers.findIndex((c) => c.id === row.id)
      if (cidx >= 0) ws.customers[cidx] = { ...ws.customers[cidx], ...row }
      else ws.customers.unshift(row)
    }

    const idx = ws.orders.findIndex((o) => o.id === order.id)
    if (idx >= 0) ws.orders[idx] = order
    else ws.orders.unshift(order)

    appendAudit(ws, {
      id: newId(),
      at: nowIso,
      actorUserId: (user && (user.id || user._id)) || '',
      actorLabel: (user && user.username) || '',
      action: existing ? 'order_update' : 'order_create',
      orderId: order.id,
      orderNo: order.orderNo,
      customerName: order.customerName,
      amount: orderReceivable(order)
    })

    const saved = await saveWorkspace(ws, user)
    await writeOpLog({
      user,
      module: 'tuwen_yewu',
      action: existing ? 'update_order' : 'create_order',
      targetId: order.id,
      after: { orderNo: order.orderNo, customerName: order.customerName }
    })
    return ok({
      order: { ...order, receivable: orderReceivable(order), paid: orderPaid(order), balance: orderBalance(order) },
      version: saved.version
    })
  }

  async function removeOrder(user, id) {
    const blocked = deny(user)
    if (blocked) return blocked
    const ws = await loadWorkspace()
    const existing = ws.orders.find((o) => o.id === id)
    if (!existing) return fail(4040, '订单不存在')
    ws.orders = ws.orders.filter((o) => o.id !== id)
    appendAudit(ws, {
      id: newId(),
      at: new Date(now()).toISOString(),
      actorUserId: (user && (user.id || user._id)) || '',
      actorLabel: (user && user.username) || '',
      action: 'order_delete',
      orderId: id,
      orderNo: existing.orderNo,
      customerName: existing.customerName
    })
    await saveWorkspace(ws, user)
    await writeOpLog({ user, module: 'tuwen_yewu', action: 'delete_order', targetId: id, before: { orderNo: existing.orderNo } })
    return ok(true)
  }

  async function getWorkspace(user) {
    const blocked = deny(user)
    if (blocked) return blocked
    const ws = await loadWorkspace()
    return ok({
      workspaceId: ws.workspaceId,
      version: ws.version,
      updatedAt: ws.updatedAt,
      updatedBy: ws.updatedBy,
      orders: (ws.orders || []).map((order) => ({
        ...order,
        lines: (order.lines || []).map(stripLineImages)
      })),
      customers: Array.isArray(ws.customers) ? ws.customers : [],
      expenses: Array.isArray(ws.expenses) ? ws.expenses : [],
      suppliers: Array.isArray(ws.suppliers) ? ws.suppliers : [],
      afterSales: Array.isArray(ws.afterSales) ? ws.afterSales : [],
      appSettings: ws.appSettings || defaultAppSettings(),
      auditLogs: Array.isArray(ws.auditLogs) ? ws.auditLogs : []
    })
  }

  async function importWorkspace(user, body) {
    const blocked = deny(user)
    if (blocked) return blocked
    const replace = !!(body && body.replace)
    const incomingOrders = Array.isArray(body && body.orders) ? body.orders : []
    const incomingCustomers = Array.isArray(body && body.customers) ? body.customers : []
    const incomingExpenses = Array.isArray(body && body.expenses) ? body.expenses : []
    const incomingSuppliers = Array.isArray(body && body.suppliers) ? body.suppliers : []
    const incomingAfterSales = Array.isArray(body && (body.afterSales || body.afterSalesTickets)) ? (body.afterSales || body.afterSalesTickets) : []
    const incomingSettings = body && body.appSettings && typeof body.appSettings === 'object' ? body.appSettings : null
    const incomingLogs = Array.isArray(body && body.auditLogs) ? body.auditLogs : []
    if (!incomingOrders.length && !incomingCustomers.length && !incomingExpenses.length && !incomingSuppliers.length && !incomingAfterSales.length && !incomingSettings && !incomingLogs.length) {
      return fail(4001, '没有可导入的数据')
    }
    const ws = replace ? emptyWorkspace() : await loadWorkspace()
    const nowIso = new Date(now()).toISOString()
    const byId = new Map(ws.orders.map((o) => [o.id, o]))
    let imported = 0
    for (const raw of incomingOrders) {
      let order = normalizeOrder(raw, { existingNo: raw && raw.orderNo, nowIso, actor: user })
      if (!order.orderNo) order.orderNo = nextOrderNo([...byId.values()], order.orderDate)
      order.lines = (order.lines || []).map(stripLineImages)
      byId.set(order.id, order)
      imported += 1
    }
    ws.orders = [...byId.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    if (incomingCustomers.length) {
      ws.customers = mergeById(ws.customers, incomingCustomers, normalizeCustomer, nowIso)
    }
    if (incomingExpenses.length) {
      ws.expenses = mergeById(ws.expenses, incomingExpenses, normalizeExpense, nowIso)
    }
    if (incomingSuppliers.length) {
      ws.suppliers = mergeById(ws.suppliers, incomingSuppliers, normalizeSupplier, nowIso)
    }
    if (incomingAfterSales.length) {
      ws.afterSales = mergeById(ws.afterSales, incomingAfterSales, normalizeAfterSale, nowIso)
    }
    if (incomingSettings) {
      ws.appSettings = { ...defaultAppSettings(), ...(ws.appSettings || {}), ...incomingSettings }
    }
    if (incomingLogs.length) {
      ws.auditLogs = mergeById(ws.auditLogs, incomingLogs, (row) => normalizeAuditLog(row), nowIso)
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
        .slice(0, 400)
    }
    appendAudit(ws, {
      id: newId(),
      at: nowIso,
      actorUserId: (user && (user.id || user._id)) || '',
      actorLabel: (user && user.username) || '',
      action: 'import',
      amount: imported
    })
    const saved = await saveWorkspace(ws, user)
    await writeOpLog({
      user,
      module: 'tuwen_yewu',
      action: 'import',
      targetId: WORKSPACE_ID,
      after: { imported, replace, orderCount: saved.orders.length }
    })
    return ok({
      imported,
      orderCount: saved.orders.length,
      customerCount: (saved.customers || []).length,
      expenseCount: (saved.expenses || []).length,
      supplierCount: (saved.suppliers || []).length,
      afterSaleCount: (saved.afterSales || []).length,
      auditLogCount: (saved.auditLogs || []).length,
      version: saved.version
    })
  }

  async function dashboard(user, query) {
    const ws = await loadWorkspace()
    if (sameVersion(ws, query)) return ok({ unchanged: true, ...versionMeta(ws) })
    const today = chinaYmd('', now())
    const todayCount = ws.orders.filter((o) => chinaYmd(o.createdAt || o.orderDate, now()) === today).length
    let receivable = 0
    let paid = 0
    let unpaid = 0
    const nameSet = new Set()
    const statusCounts = {}
    Object.keys(ORDER_STATUSES).forEach((k) => { statusCounts[k] = 0 })
    const dayMap = {}
    for (const order of ws.orders) {
      const st = ORDER_STATUSES[order.status] ? order.status : 'pending'
      statusCounts[st] = (statusCounts[st] || 0) + 1
      const name = String(order.customerName || '').trim()
      if (name) nameSet.add(name)
      if (!isBillableOrder(order)) continue
      const rec = orderReceivable(order)
      receivable += rec
      paid += orderPaid(order)
      unpaid += orderBalance(order)
      const day = String(order.orderDate || order.createdAt || '').slice(0, 10)
      if (day) dayMap[day] = round2((dayMap[day] || 0) + rec)
    }
    const trend = Object.keys(dayMap).sort().slice(-14).map((date) => ({ date, amount: dayMap[date] }))
    return ok({
      todayCount,
      orderCount: ws.orders.length,
      receivable: round2(receivable),
      paid: round2(paid),
      unpaid: round2(unpaid),
      statusCounts,
      trend,
      customerCount: Math.max(ws.customers.length, nameSet.size),
      expenseCount: ws.expenses.length,
      ...versionMeta(ws)
    })
  }

  async function setOrderStatus(user, id, body) {
    const ws = await loadWorkspace()
    const order = ws.orders.find((o) => o.id === id)
    if (!order) return fail(4040, '订单不存在')
    if (isPaidDisplay(order)) return fail(4001, '已收款订单不可改状态')
    const status = String((body && body.status) || '')
    if (!ORDER_STATUSES[status]) return fail(4001, '无效状态')
    const before = order.status
    order.status = status
    order.updatedAt = new Date(now()).toISOString()
    appendAudit(ws, {
      id: newId(), at: order.updatedAt,
      actorUserId: (user && (user.id || user._id)) || '',
      actorLabel: (user && user.username) || '',
      action: 'order_status', orderId: order.id, orderNo: order.orderNo,
      customerName: order.customerName, amount: 0, detail: `${before}→${status}`
    })
    await saveWorkspace(ws, user)
    return ok({ order: { ...order, receivable: orderReceivable(order), paid: orderPaid(order), balance: orderBalance(order) } })
  }

  async function batchStatus(user, body) {
    const ids = Array.isArray(body && body.ids) ? body.ids.map(String) : []
    const status = String((body && body.status) || '')
    if (!ids.length) return fail(4001, '请先选择订单')
    if (!ORDER_STATUSES[status]) return fail(4001, '请先选择目标状态')
    const ws = await loadWorkspace()
    const nowIso = new Date(now()).toISOString()
    let changed = 0
    for (const order of ws.orders) {
      if (!ids.includes(order.id)) continue
      if (isPaidDisplay(order)) continue
      order.status = status
      order.updatedAt = nowIso
      changed += 1
    }
    if (changed) {
      appendAudit(ws, {
        id: newId(), at: nowIso,
        actorUserId: (user && (user.id || user._id)) || '',
        actorLabel: (user && user.username) || '',
        action: 'order_status_batch', amount: changed, detail: status
      })
      await saveWorkspace(ws, user)
    }
    return ok({ changed })
  }

  async function payOrder(user, id, body) {
    const ws = await loadWorkspace()
    const order = ws.orders.find((o) => o.id === id)
    if (!order) return fail(4040, '订单不存在')
    if (isCancelled(order)) return fail(4001, '已取消订单不能收款')
    const bal = orderBalance(order)
    if (isPaidDisplay(order) && bal <= 0) return fail(4001, '该订单已结清')
    const amount = Number(body && body.amount) || 0
    if (bal > 0 && !(amount > 0)) return fail(4001, '请填写收款金额')
    const take = bal > 0 ? round2(Math.min(amount, bal)) : 0
    if (take > 0) order.currentPayment = round2((Number(order.currentPayment) || 0) + take)
    if (body.paymentMethod) order.paymentMethod = String(body.paymentMethod)
    if (body.remark != null) order.lastPaymentRemark = String(body.remark)
    if (Array.isArray(body.images)) order.lastPaymentRemarkImages = httpUrls(body.images)
    order.paymentModalConfirmedAt = new Date(now()).toISOString()
    order.updatedAt = order.paymentModalConfirmedAt
    appendAudit(ws, {
      id: newId(), at: order.updatedAt,
      actorUserId: (user && (user.id || user._id)) || '',
      actorLabel: (user && user.username) || '',
      action: 'payment_received', orderId: order.id, orderNo: order.orderNo,
      customerName: order.customerName, amount: take, paymentMethod: order.paymentMethod || ''
    })
    await saveWorkspace(ws, user)
    return ok({ order: { ...order, receivable: orderReceivable(order), paid: orderPaid(order), balance: orderBalance(order) } })
  }

  async function copyOrder(user, id) {
    const ws = await loadWorkspace()
    const existing = ws.orders.find((o) => o.id === id)
    if (!existing) return fail(4040, '订单不存在')
    const nowIso = new Date(now()).toISOString()
    const today = chinaYmd('', now())
    const cloned = normalizeOrder({
      ...existing,
      id: newId(),
      orderNo: '',
      orderDate: today,
      status: 'pending',
      prepay: 0,
      currentPayment: 0,
      paymentModalConfirmedAt: '',
      lastPaymentRemark: '',
      lastPaymentRemarkImages: [],
      sortIndex: 0,
      createdAt: nowIso,
      lines: (existing.lines || []).map((l) => ({ ...l, id: newId() })),
      quotePlans: (existing.quotePlans || []).map((p) => ({ ...p, orderDate: today }))
    }, { nowIso, actor: user })
    cloned.orderNo = nextOrderNo(ws.orders, cloned.orderDate)
    ws.orders.unshift(cloned)
    appendAudit(ws, {
      id: newId(), at: nowIso,
      actorUserId: (user && (user.id || user._id)) || '',
      actorLabel: (user && user.username) || '',
      action: 'order_copy', orderId: cloned.id, orderNo: cloned.orderNo,
      customerName: cloned.customerName
    })
    await saveWorkspace(ws, user)
    return ok({ order: { ...cloned, receivable: orderReceivable(cloned), paid: 0, balance: orderReceivable(cloned) } })
  }

  async function listCustomers(user, query) {
    const ws = await loadWorkspace()
    if (sameVersion(ws, query)) return ok({ unchanged: true, ...versionMeta(ws) })
    const q = String((query && query.q) || '').trim().toLowerCase()
    let list = sortedCustomers(ws.customers)
    if (q) list = list.filter((c) => `${c.name} ${c.phone} ${c.company}`.toLowerCase().includes(q))
    return ok({ list, total: list.length, ...versionMeta(ws) })
  }

  async function upsertCustomer(user, body) {
    const ws = await loadWorkspace()
    const nowIso = new Date(now()).toISOString()
    const row = normalizeCustomer(body && body.customer ? body.customer : body, nowIso)
    if (!row.name) return fail(4001, '请填写客户名称')
    const idx = ws.customers.findIndex((c) => c.id === row.id)
    if (idx >= 0) ws.customers[idx] = { ...ws.customers[idx], ...row }
    else ws.customers.unshift(row)
    await saveWorkspace(ws, user)
    return ok({ customer: row })
  }

  async function removeCustomer(user, id) {
    const ws = await loadWorkspace()
    ws.customers = (ws.customers || []).filter((c) => c.id !== id)
    await saveWorkspace(ws, user)
    return ok(true)
  }

  async function listSuppliers(user) {
    const ws = await loadWorkspace()
    const list = (ws.suppliers || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'))
    return ok({ list, total: list.length })
  }

  async function upsertSupplier(user, body) {
    const ws = await loadWorkspace()
    const nowIso = new Date(now()).toISOString()
    const row = normalizeSupplier(body && body.supplier ? body.supplier : body, nowIso)
    if (!row.name) return fail(4001, '请填写供应商名称')
    const idx = ws.suppliers.findIndex((c) => c.id === row.id)
    if (idx >= 0) ws.suppliers[idx] = { ...ws.suppliers[idx], ...row }
    else ws.suppliers.unshift(row)
    await saveWorkspace(ws, user)
    return ok({ supplier: row })
  }

  async function removeSupplier(user, id) {
    const ws = await loadWorkspace()
    ws.suppliers = (ws.suppliers || []).filter((c) => c.id !== id)
    await saveWorkspace(ws, user)
    return ok(true)
  }

  async function listExpenses(user, query) {
    const ws = await loadWorkspace()
    const from = String((query && query.from) || '').slice(0, 10)
    const to = String((query && query.to) || '').slice(0, 10)
    let list = (ws.expenses || []).slice()
    if (from || to) list = list.filter((e) => inDateRange(e.expenseDate, from, to))
    list.sort((a, b) => String(b.expenseDate || '').localeCompare(String(a.expenseDate || '')))
    return ok({ list, total: list.length, labels: (ws.appSettings && ws.appSettings.reportExpenseLabels) || defaultAppSettings().reportExpenseLabels })
  }

  async function upsertExpense(user, body) {
    const ws = await loadWorkspace()
    const nowIso = new Date(now()).toISOString()
    const row = normalizeExpense(body && body.expense ? body.expense : body, nowIso)
    if (!row.category) return fail(4001, '请选择支出分类')
    if (!Number.isFinite(row.amount) || row.amount === 0) return fail(4001, '请填写有效金额（可为负数冲正）')
    const idx = ws.expenses.findIndex((c) => c.id === row.id)
    if (idx >= 0) ws.expenses[idx] = { ...ws.expenses[idx], ...row }
    else ws.expenses.unshift(row)
    await saveWorkspace(ws, user)
    return ok({ expense: row })
  }

  async function removeExpense(user, id) {
    const ws = await loadWorkspace()
    ws.expenses = (ws.expenses || []).filter((c) => c.id !== id)
    await saveWorkspace(ws, user)
    return ok(true)
  }

  async function listAfterSales(user) {
    const ws = await loadWorkspace()
    const list = (ws.afterSales || []).slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    return ok({ list, total: list.length })
  }

  async function upsertAfterSale(user, body) {
    const ws = await loadWorkspace()
    const nowIso = new Date(now()).toISOString()
    const incoming = body && body.afterSale ? body.afterSale : body
    const existing = incoming.id ? ws.afterSales.find((x) => x.id === incoming.id) : null
    const row = normalizeAfterSale({ ...incoming, id: existing ? existing.id : (incoming.id || newId()) }, nowIso)
    if (!row.customerName) return fail(4001, '请填写客户名称')
    if (!row.issueType) return fail(4001, '请选择或填写问题类型')
    if (!row.ticketNo) row.ticketNo = nextAfterSaleNo(ws.afterSales, row.registeredAt)
    const idx = ws.afterSales.findIndex((c) => c.id === row.id)
    if (idx >= 0) ws.afterSales[idx] = row
    else ws.afterSales.unshift(row)
    await saveWorkspace(ws, user)
    return ok({ afterSale: row })
  }

  async function removeAfterSale(user, id) {
    const ws = await loadWorkspace()
    ws.afterSales = (ws.afterSales || []).filter((c) => c.id !== id)
    await saveWorkspace(ws, user)
    return ok(true)
  }

  async function getStatements(user, query) {
    const ws = await loadWorkspace()
    const customer = String((query && (query.customer || query.customerName)) || '').trim()
    const from = String((query && query.from) || '').slice(0, 10)
    const to = String((query && query.to) || '').slice(0, 10)
    const q = String((query && query.q) || '').trim().toLowerCase()
    let orders = ws.orders.slice()
    if (customer) orders = orders.filter((o) => o.customerName === customer || o.customerId === customer)
    if (q) {
      orders = orders.filter((o) => {
        const extra = (o.lines || []).map((l) => `${l.projectName || ''} ${l.productName || ''} ${l.material || ''}`).join(' ')
        return `${o.customerName || ''} ${o.orderNo || ''} ${o.phone || ''} ${o.contact || ''} ${extra}`.toLowerCase().includes(q)
      })
    }
    if (from || to) orders = orders.filter((o) => inDateRange(o.orderDate || o.createdAt, from, to))
    orders.sort((a, b) => {
      const d = String(b.orderDate || '').localeCompare(String(a.orderDate || ''))
      if (d) return d
      return String(b.orderNo || b.id || '').localeCompare(String(a.orderNo || a.id || ''))
    })
    const lines = []
    let subtotal = 0
    let discount = 0
    let paid = 0
    let unpaid = 0
    const billable = []
    for (const order of orders) {
      if (!isBillableOrder(order)) continue
      const pay = orderPaid(order)
      const bal = orderBalance(order)
      const sub = orderSubtotal(order)
      const off = Number(order.discount) || 0
      subtotal = round2(subtotal + sub)
      discount = round2(discount + off)
      paid = round2(paid + pay)
      unpaid = round2(unpaid + bal)
      const names = (order.lines || []).map((l) => l.projectName || l.productName || '').filter(Boolean)
      billable.push({
        ...summarizeOrder(order),
        subtotal: sub,
        discount: off,
        projectNames: names.slice(0, 4).join('、')
      })
      for (const line of order.lines || []) {
        lines.push({
          orderId: order.id,
          orderNo: order.orderNo,
          orderDate: order.orderDate,
          customerName: order.customerName,
          projectName: line.projectName || '',
          productName: line.productName || '',
          material: line.material || '',
          spec: line.spec || '',
          remark: line.remark || '',
          qty: line.qty,
          unitLabel: line.unitLabel || '',
          unitPrice: line.unitPrice,
          pricingMode: line.pricingMode || '',
          widthMm: Number(line.widthMm) || 0,
          heightMm: Number(line.heightMm) || 0,
          amount: lineAmount(line),
          sampleImageUrl: /^https?:\/\//i.test(String(line.sampleImageDataUrl || '')) ? line.sampleImageDataUrl : ''
        })
      }
    }
    const customers = [...new Set(ws.orders.filter(isBillableOrder).map((o) => o.customerName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
    return ok({
      orders: billable,
      lines, subtotal, discount, paid, unpaid, customers
    })
  }

  async function collectStatement(user, body) {
    const customer = String((body && (body.customer || body.customerName)) || '').trim()
    const customerId = String((body && body.customerId) || '').trim()
    const amount = Number(body && body.amount)
    const paymentMethod = String((body && body.paymentMethod) || '微信')
    const orderIds = [...new Set((Array.isArray(body && body.orderIds) ? body.orderIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean))]
    if (!customer && !customerId && !orderIds.length) return fail(4001, '请选择客户')
    if (!(amount > 0)) return fail(4001, '请填写本次收款金额')
    const ws = await loadWorkspace()
    const from = String((body && body.from) || '').slice(0, 10)
    const to = String((body && body.to) || '').slice(0, 10)
    const due = ws.orders
      .filter((o) => {
        if (!isBillableOrder(o) || !inDateRange(o.orderDate || o.createdAt, from, to) || !(orderBalance(o) > 0)) return false
        if (orderIds.length) {
          if (!orderIds.includes(o.id) && !orderIds.includes(o.orderNo)) return false
          if (customerId && o.customerId && o.customerId !== customerId) return false
          if (customer && o.customerName && o.customerName !== customer) return false
          return true
        }
        if (customerId) return o.customerId === customerId
        if (customer) return o.customerName === customer
        return false
      })
      .sort((a, b) => String(a.orderDate || a.createdAt || '').localeCompare(String(b.orderDate || b.createdAt || '')))
    if (!due.length) return fail(4001, '当前筛选范围内没有可收款的欠款')
    let left = round2(amount)
    const nowIso = new Date(now()).toISOString()
    for (const order of due) {
      if (left <= 0) break
      const bal = orderBalance(order)
      const take = Math.min(bal, left)
      order.currentPayment = round2((Number(order.currentPayment) || 0) + take)
      order.paymentMethod = paymentMethod
      order.paymentModalConfirmedAt = nowIso
      order.updatedAt = nowIso
      left = round2(left - take)
      appendAudit(ws, {
        id: newId(), at: nowIso,
        actorUserId: (user && (user.id || user._id)) || '',
        actorLabel: (user && user.username) || '',
        action: 'payment_received', orderId: order.id, orderNo: order.orderNo,
        customerName: order.customerName, amount: take, paymentMethod
      })
    }
    await saveWorkspace(ws, user)
    return ok({ applied: round2(amount - left), leftover: left })
  }

  async function getReports(user, query) {
    const ws = await loadWorkspace()
    const from = String((query && query.from) || '').slice(0, 10)
    const to = String((query && query.to) || '').slice(0, 10)
    const orders = ws.orders.filter((o) => isBillableOrder(o) && inDateRange(o.orderDate || o.createdAt, from, to))
    const expenses = (ws.expenses || []).filter((e) => inDateRange(e.expenseDate, from, to))
    let income = 0
    const materials = {}
    const customers = {}
    const staff = {}
    for (const order of orders) {
      const rec = orderReceivable(order)
      income = round2(income + rec)
      const cname = order.customerName || '未指定'
      if (!customers[cname]) customers[cname] = { name: cname, orderCount: 0, amount: 0 }
      customers[cname].orderCount += 1
      customers[cname].amount = round2(customers[cname].amount + rec)
      const sname = order.salesperson || '未指定'
      if (!staff[sname]) staff[sname] = { name: sname, orderCount: 0, amount: 0 }
      staff[sname].orderCount += 1
      staff[sname].amount = round2(staff[sname].amount + rec)
      for (const line of order.lines || []) {
        const key = String(line.material || line.projectName || '未归类').trim() || '未归类'
        if (!materials[key]) materials[key] = { name: key, qty: 0, amount: 0 }
        materials[key].qty = round2(materials[key].qty + (Number(line.qty) || 0))
        materials[key].amount = round2(materials[key].amount + lineAmount(line))
      }
    }
    const labels = (ws.appSettings && ws.appSettings.reportExpenseLabels) || defaultAppSettings().reportExpenseLabels
    const byCat = {}
    labels.forEach((l) => { byCat[l] = 0 })
    let expenseTotal = 0
    for (const e of expenses) {
      const cat = e.category || '未归类支出'
      byCat[cat] = round2((byCat[cat] || 0) + (Number(e.amount) || 0))
      expenseTotal = round2(expenseTotal + (Number(e.amount) || 0))
    }
    return ok({
      from, to, income, expenseTotal, remainder: round2(income - expenseTotal),
      expenseByCategory: Object.keys(byCat).map((name) => ({ name, amount: byCat[name] })),
      materials: Object.values(materials).sort((a, b) => b.amount - a.amount),
      customers: Object.values(customers).sort((a, b) => b.amount - a.amount),
      staff: Object.values(staff).sort((a, b) => b.amount - a.amount)
    })
  }

  async function listAuditLogs(user, query) {
    const ws = await loadWorkspace()
    const page = Math.max(1, parseInt(query && query.page, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(query && query.pageSize, 10) || 50))
    const q = String((query && (query.q || query.keyword)) || '').trim().toLowerCase()
    let logs = ws.auditLogs || []
    if (q) {
      logs = logs.filter((row) => auditLogSearchBlob(row).includes(q))
    }
    return ok({
      list: logs.slice((page - 1) * pageSize, page * pageSize),
      total: logs.length,
      page,
      pageSize
    })
  }

  async function getSettings(user, query) {
    const ws = await loadWorkspace()
    if (sameVersion(ws, query)) return ok({ unchanged: true, ...versionMeta(ws) })
    return ok({ settings: normalizeAppSettings(ws.appSettings || {}), ...versionMeta(ws) })
  }

  async function saveSettings(user, body) {
    const ws = await loadWorkspace()
    const incoming = body && body.settings ? body.settings : body
    ws.appSettings = normalizeAppSettings({ ...(ws.appSettings || {}), ...(incoming || {}) })
    const saved = await saveWorkspace(ws, user)
    return ok({ settings: saved.appSettings, version: saved.version })
  }

  async function proxySampleImage(user, body) {
    const key = sampleKeyFromPublicUrl(body && body.url, COS_BASE_URL)
    if (!key) return fail(4000, '样图地址无效')
    const data = await getObject(key)
    if (!data || !data.Body) return fail(4040, '样图不存在')
    const buf = Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body)
    if (buf.length > 2.5 * 1024 * 1024) return fail(4000, '样图过大')
    const mime = String(data.ContentType || '').startsWith('image/')
      ? String(data.ContentType).split(';')[0]
      : sniffImageMime(buf)
    return ok({ dataUrl: `data:${mime};base64,${buf.toString('base64')}` })
  }

  async function sortOrders(user, body) {
    const ids = Array.isArray(body && body.ids) ? body.ids.map(String).filter(Boolean) : []
    if (!ids.length) return fail(4001, '请提供排序后的订单')
    const ws = await loadWorkspace()
    const map = new Map((ws.orders || []).map((o) => [o.id, o]))
    ids.forEach((id, i) => {
      const order = map.get(id)
      if (order) order.sortIndex = i + 1
    })
    await saveWorkspace(ws, user)
    return ok({ changed: ids.length })
  }

  function guard(fn) {
    return async (user, ...args) => {
      const blocked = deny(user)
      if (blocked) return blocked
      try {
        return await fn(user, ...args)
      } catch (e) {
        return fail(5001, '图文业务失败: ' + ((e && e.message) || String(e)))
      }
    }
  }

  return {
    status: guard(status),
    listOrders: guard(listOrders),
    getOrder: guard(getOrder),
    getEditBootstrap: guard(getEditBootstrap),
    _expireWorkspaceCache() {
      if (wsCache) wsCache.at = 0
    },
    _resetWorkspaceCache() {
      wsCache = null
      wsInflight = null
    },
    upsertOrder: guard(upsertOrder),
    removeOrder: guard(removeOrder),
    setOrderStatus: guard(setOrderStatus),
    batchStatus: guard(batchStatus),
    payOrder: guard(payOrder),
    copyOrder: guard(copyOrder),
    getWorkspace: guard(getWorkspace),
    importWorkspace: guard(importWorkspace),
    dashboard: guard(dashboard),
    listCustomers: guard(listCustomers),
    upsertCustomer: guard(upsertCustomer),
    removeCustomer: guard(removeCustomer),
    listSuppliers: guard(listSuppliers),
    upsertSupplier: guard(upsertSupplier),
    removeSupplier: guard(removeSupplier),
    listExpenses: guard(listExpenses),
    upsertExpense: guard(upsertExpense),
    removeExpense: guard(removeExpense),
    listAfterSales: guard(listAfterSales),
    upsertAfterSale: guard(upsertAfterSale),
    removeAfterSale: guard(removeAfterSale),
    getStatements: guard(getStatements),
    collectStatement: guard(collectStatement),
    proxySampleImage: guard(proxySampleImage),
    getReports: guard(getReports),
    listAuditLogs: guard(listAuditLogs),
    getSettings: guard(getSettings),
    saveSettings: guard(saveSettings),
    sortOrders: guard(sortOrders)
  }
}

module.exports = {
  COS_PREFIX,
  WORKSPACE_ID,
  ORDER_STATUSES,
  AUDIT_ACTION_LABELS,
  AFTER_SALE_STATUSES,
  defaultAppSettings,
  chinaYmd,
  round2,
  newId,
  workspaceKey,
  sampleKeyFromPublicUrl,
  lineAmount,
  orderSubtotal,
  orderReceivable,
  orderPaid,
  orderBalance,
  nextOrderNo,
  summarizeOrder,
  normalizeOrder,
  stripLineImages,
  isPaidDisplay,
  createTuwenYewuApi
}
