/** 图文智能业务：订单金额、状态与导入清洗（与云函数 tuwenYewu.js 对齐） */

export const ORDER_STATUSES = {
  draft: '草稿',
  pending: '待制作',
  producing: '制作中',
  done: '已完成',
  delivered: '已交付',
  cancelled: '已取消'
}

export const PRICING_MODES = [
  { value: 'by_piece', label: '按件', unit: '个' },
  { value: 'by_area', label: '按面积', unit: '平方米' },
  { value: 'by_length', label: '按长度', unit: '米' },
  { value: 'by_cm', label: '按厘米', unit: '厘米' }
]

export const SAMPLE_COS_PREFIX = '图文智能业务/default/samples/'

export const AFTER_SALE_STATUSES = {
  pending: '待受理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭'
}

export const AFTER_SALE_ISSUE_TYPES = ['褪色', '脱落', '尺寸偏差', '内容错误', '安装问题', '其他']

export const CUSTOMER_LEVELS = ['普通', '银卡', '金卡', 'VIP']

export const PAYMENT_METHODS = ['现金', '微信', '支付宝', '转账', '刷卡', '对公', '月结', '其他']

export const RECEIVE_METHODS = ['现金', '微信', '支付宝', '转账', '刷卡', '其他']

export const DELIVERY_METHODS = ['自提', '送货', '快递', '上门安装']

export const SETTLEMENT_METHODS = ['现结', '月结', '按单结', '欠款']

export const INVOICE_TYPES = ['收据', '普通发票', '专用发票', '无票']

export const LINE_CLIPBOARD_KEY = 'tw-order-line-clipboard'

export const PAID_FILTER = '__paid__'

export const AUDIT_ACTION_LABELS = {
  order_create: '新建订单',
  order_update: '更新订单',
  order_delete: '删除订单',
  order_copy: '复制订单',
  order_status: '改状态',
  order_status_batch: '批量改状态',
  payment_received: '登记收款',
  import: '导入备份'
}

export const LINE_COLUMN_KEYS = [
  'seq', 'outsource', 'code', 'projectName', 'productName', 'spec', 'material',
  'widthMm', 'heightMm', 'area', 'qty', 'unit', 'unitPrice', 'amount', 'sample', 'remark', 'actions'
]

export const LINE_COLUMN_DEFS = {
  seq: { defaultLabel: '序号', minW: 42, lockVisible: true },
  outsource: { defaultLabel: '外协', minW: 48 },
  code: { defaultLabel: '编码', minW: 88 },
  projectName: { defaultLabel: '项目名称', minW: 160 },
  productName: { defaultLabel: '产品名称', minW: 180 },
  spec: { defaultLabel: '规格', minW: 120 },
  material: { defaultLabel: '材质', minW: 100 },
  widthMm: { defaultLabel: '宽(mm)', minW: 84 },
  heightMm: { defaultLabel: '高(mm)', minW: 84 },
  area: { defaultLabel: '面积(㎡)', minW: 76 },
  qty: { defaultLabel: '数量', minW: 64 },
  unit: { defaultLabel: '单位', minW: 92 },
  unitPrice: { defaultLabel: '单价', minW: 88 },
  amount: { defaultLabel: '金额', minW: 88 },
  sample: { defaultLabel: '样图', minW: 220 },
  remark: { defaultLabel: '备注', minW: 160 },
  actions: { defaultLabel: '操作', minW: 96, lockVisible: true }
}

export const UNIT_PRESETS = [
  { label: '平方米', mode: 'by_area' },
  { label: '㎡', mode: 'by_area' },
  { label: '平方', mode: 'by_area' },
  { label: '平米', mode: 'by_area' },
  { label: '个', mode: 'by_piece' },
  { label: '套', mode: 'by_piece' },
  { label: '张', mode: 'by_piece' },
  { label: '块', mode: 'by_piece' },
  { label: '条', mode: 'by_piece' },
  { label: '支', mode: 'by_piece' },
  { label: '根', mode: 'by_piece' },
  { label: '组', mode: 'by_piece' },
  { label: '项', mode: 'by_piece' },
  { label: '台', mode: 'by_piece' },
  { label: '幅', mode: 'by_piece' },
  { label: '份', mode: 'by_piece' },
  { label: '卷', mode: 'by_piece' },
  { label: '箱', mode: 'by_piece' },
  { label: '包', mode: 'by_piece' },
  { label: '片', mode: 'by_piece' },
  { label: '盏', mode: 'by_piece' },
  { label: '颗', mode: 'by_piece' },
  { label: '樘', mode: 'by_piece' },
  { label: '扇', mode: 'by_piece' },
  { label: '字', mode: 'by_piece' },
  { label: '米', mode: 'by_length' },
  { label: '延米', mode: 'by_length' },
  { label: '周长米', mode: 'by_length' },
  { label: '厘米', mode: 'by_cm' },
  { label: '公分', mode: 'by_cm' }
]

export const DIMENSION_UNITS = [
  { value: 'mm', label: '毫米 (mm)', suffix: 'mm', toMm: 1 },
  { value: 'cm', label: '厘米 (cm)', suffix: 'cm', toMm: 10 },
  { value: 'm', label: '米 (m)', suffix: 'm', toMm: 1000 }
]

export function normalizeDimensionUnit(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'cm' || v === '厘米' || v === '公分') return 'cm'
  if (v === 'm' || v === '米' || v === 'meter' || v === 'metre') return 'm'
  return 'mm'
}

export function dimensionUnitOf(settings) {
  return normalizeDimensionUnit(settings && settings.dimensionUnit)
}

function unitFrom(unitOrSettings) {
  if (unitOrSettings && typeof unitOrSettings === 'object') return dimensionUnitOf(unitOrSettings)
  return normalizeDimensionUnit(unitOrSettings)
}

export function mmPerDimensionUnit(unit) {
  const u = unitFrom(unit)
  return u === 'm' ? 1000 : u === 'cm' ? 10 : 1
}

export function dimensionUnitSuffix(unit) {
  const hit = DIMENSION_UNITS.find((item) => item.value === unitFrom(unit))
  return (hit && hit.suffix) || 'mm'
}

export function dimensionInputStep(unit) {
  const u = unitFrom(unit)
  return u === 'm' ? '0.01' : u === 'cm' ? '0.1' : '1'
}

export function mmToDimension(mm, unit) {
  const n = (Number(mm) || 0) / mmPerDimensionUnit(unit)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function dimensionToMm(value, unit) {
  const n = (Number(value) || 0) * mmPerDimensionUnit(unit)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * 1000) / 1000
}

export function dimensionColumnLabel(key, unit) {
  const suffix = dimensionUnitSuffix(unit)
  return key === 'heightMm' ? `高(${suffix})` : `宽(${suffix})`
}

export function isDefaultDimensionLabel(label) {
  return /^[宽高]\((mm|cm|m|毫米|厘米|米)\)$/.test(String(label || '').trim())
}

export function applyDimensionColumnLabels(columns, unit) {
  const u = unitFrom(unit)
  return (Array.isArray(columns) ? columns : []).map((col) => {
    if (!col || (col.key !== 'widthMm' && col.key !== 'heightMm')) return col
    if (!isDefaultDimensionLabel(col.label)) return col
    return { ...col, label: dimensionColumnLabel(col.key, u) }
  })
}

export function withDimensionUnit(settings, unit) {
  const dimensionUnit = normalizeDimensionUnit(unit != null ? unit : settings && settings.dimensionUnit)
  return {
    ...(settings || {}),
    dimensionUnit,
    orderLineColumns: applyDimensionColumnLabels(
      normalizeLineColumns(settings && settings.orderLineColumns),
      dimensionUnit
    )
  }
}

export const COLUMN_ALIGNS = [
  { value: 'center', label: '居中' },
  { value: 'left', label: '左对齐' },
  { value: 'right', label: '右对齐' }
]

export function normalizeColumnAlign(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'left' || v === 'right') return v
  return 'center'
}

export function columnAlignClass(align) {
  const a = normalizeColumnAlign(align)
  return a === 'left' ? 'is-left' : a === 'right' ? 'is-right' : 'is-center'
}

export function defaultLineColumns() {
  return LINE_COLUMN_KEYS.map((key) => ({
    key,
    label: LINE_COLUMN_DEFS[key].defaultLabel,
    visible: true,
    align: 'center'
  }))
}

export const DEFAULT_APP_SETTINGS = {
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

export function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100
}

export function normalizeQty(raw) {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(0, n) : 1
}

export function isCancelled(order) {
  return String(order && order.status) === 'cancelled'
}

export function isBillableOrder(order) {
  return !isCancelled(order)
}

export function lineQtyFactor(line) {
  const qty = normalizeQty(line && line.qty)
  const mode = String((line && line.pricingMode) || 'by_piece')
  const wM = (Number(line && line.widthMm) || 0) / 1000
  const hM = (Number(line && line.heightMm) || 0) / 1000
  if (mode === 'by_area') return Math.max(0, wM * hM) * qty
  if (mode === 'by_length') return Math.max(0, wM) * qty
  if (mode === 'by_cm') return Math.max(0, (Number(line && line.widthMm) || 0) / 10) * qty
  return qty
}

export function lineAmount(line) {
  return round2((Number(line && line.unitPrice) || 0) * lineQtyFactor(line))
}

export function orderSubtotal(order) {
  const lines = Array.isArray(order && order.lines) ? order.lines : []
  return round2(lines.reduce((sum, line) => sum + lineAmount(line), 0))
}

export function orderTax(order) {
  const sub = orderSubtotal(order)
  const discount = Number(order && order.discount) || 0
  const rate = Number(order && order.taxRate) || 0
  return round2(Math.max(0, sub - discount) * (rate / 100))
}

export function orderReceivable(order) {
  const sub = orderSubtotal(order)
  const discount = Number(order && order.discount) || 0
  return round2(Math.max(0, sub - discount + orderTax(order)))
}

export function orderPaid(order) {
  return round2((Number(order && order.prepay) || 0) + (Number(order && order.currentPayment) || 0))
}

export function orderBalance(order) {
  return round2(Math.max(0, orderReceivable(order) - orderPaid(order)))
}

export function formatMoney(n) {
  return `¥${(Number(n) || 0).toFixed(2)}`
}

export function statusTagType(status) {
  if (status === 'done' || status === 'delivered') return 'success'
  if (status === 'producing') return ''
  if (status === 'pending') return 'warning'
  if (status === 'cancelled') return 'info'
  return 'info'
}

export function todayDate() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function newLineId() {
  return `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function emptyLine() {
  return {
    id: newLineId(),
    outsource: false,
    code: '',
    projectName: '',
    productName: '',
    spec: '',
    material: '',
    widthMm: 0,
    heightMm: 0,
    qty: 1,
    unitLabel: '平方米',
    pricingMode: 'by_area',
    unitPrice: 0,
    remark: '',
    sampleNote: '',
    sampleImageDataUrl: ''
  }
}

export const QUOTE_PLAN_DEFAULTS = [
  { id: 'economy', name: '经济方案', styleId: 'classic', styleLabel: '商务蓝表', hint: '深蓝表头 · 竖版 A4' },
  { id: 'standard', name: '标准方案', styleId: 'formal', styleLabel: '公文衬线', hint: '宋体双边框 · 竖版 A4' },
  { id: 'rush', name: '加急方案', styleId: 'modern', styleLabel: '现代色块', hint: '左侧色条 · 竖版 A4' }
]

export const QUOTE_TIER_RATIOS = [0.85, 1, 1.2]

export function emptyQuoteItem() {
  return {
    id: newLineId(),
    projectName: '',
    productName: '',
    spec: '',
    material: '',
    widthMm: 0,
    heightMm: 0,
    qty: 1,
    unitLabel: '个',
    pricingMode: 'by_piece',
    unitPrice: 0
  }
}

export function stripQuoteLine(line) {
  const e = line && typeof line === 'object' ? line : {}
  const pricingMode = String(e.pricingMode || 'by_piece')
  let unitLabel = String(e.unitLabel || '').trim()
  if (!unitLabel) {
    unitLabel = pricingMode === 'by_area' ? '平方米'
      : pricingMode === 'by_length' ? '米'
        : pricingMode === 'by_cm' ? '厘米' : '个'
  }
  return {
    id: String(e.id || newLineId()),
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

function fillQuoteHeaderIfEmpty(plan, order) {
  const o = order || {}
  if (!String(plan.customerName || '').trim()) plan.customerName = String(o.customerName || '')
  if (!String(plan.contact || '').trim()) plan.contact = String(o.contact || '')
  if (!String(plan.phone || '').trim()) plan.phone = String(o.phone || '')
  if (!String(plan.address || '').trim()) plan.address = String(o.address || '')
  if (!String(plan.orderDate || '').trim()) plan.orderDate = String(o.orderDate || '')
  if (!String(plan.deliveryDate || '').trim()) plan.deliveryDate = String(o.deliveryDate || '')
  if (!String(plan.orderNo || '').trim()) plan.orderNo = String(o.orderNo || '')
  return plan
}

export function emptyQuotePlans() {
  return QUOTE_PLAN_DEFAULTS.map((d) => ({
    id: d.id,
    name: d.name,
    companyName: '',
    customerName: '',
    contact: '',
    phone: '',
    address: '',
    orderDate: '',
    deliveryDate: '',
    orderNo: '',
    docTitle: '',
    unitPrice: 0,
    total: 0,
    note: '',
    items: []
  }))
}

export function normalizeQuotePlans(raw) {
  const incoming = Array.isArray(raw) ? raw : []
  return QUOTE_PLAN_DEFAULTS.map((d, i) => {
    const e = incoming[i] || incoming.find((x) => x && x.id === d.id) || {}
    const items = Array.isArray(e.items) ? e.items.slice(0, 40).map(stripQuoteLine) : []
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
      items
    }
  })
}

export function brandCompanyNameOf(settings) {
  return String((settings && settings.brandCompanyName) || '').trim()
}

export function quoteCompanyOf(plan, settings) {
  const custom = String((plan && plan.companyName) || '').trim()
  if (custom) return custom
  return brandCompanyNameOf(settings)
}

export function quoteDocTitleOf(plan) {
  const custom = String((plan && plan.docTitle) || '').trim()
  return custom || '报价单'
}

export function orderDocTitle(order, settings) {
  const fromOrder = String((order && order.printDocTitle) || '').trim()
  if (fromOrder) return fromOrder
  const s = settings && typeof settings === 'object' ? settings : {}
  return String(s.printDocTitle || '').trim() || '业务单'
}

export function quoteHeaderOf(order, plan) {
  const o = order || {}
  const p = plan || {}
  return {
    customerName: String(p.customerName || o.customerName || '').trim(),
    contact: String(p.contact || o.contact || '').trim(),
    phone: String(p.phone || o.phone || '').trim(),
    address: String(p.address || o.address || '').trim(),
    orderDate: String(p.orderDate || o.orderDate || '').trim(),
    deliveryDate: String(p.deliveryDate || o.deliveryDate || '').trim(),
    orderNo: String(p.orderNo || o.orderNo || '').trim()
  }
}

const FIGURE_NUM = '[一二三四五六七八九十零〇壹贰叁肆伍陆柒捌玖拾0-9０-９①②③④⑤⑥⑦⑧⑨⑩]'
const FIGURE_WORD = '(?:附图|附圖|图纸|圖紙|图|圖)'
const FIGURE_TAIL = `${FIGURE_NUM}+(?:\\s*[、，,及和与到至～~\\-—/／]\\s*${FIGURE_NUM}+)*`

export function stripQuoteSeeFigure(text) {
  let s = String(text || '').replace(/\u3000/g, ' ')
  const paren = new RegExp(`[（(【\\[]\\s*(?:请)?(?:参看|参见|参阅|见|看|附)?\\s*${FIGURE_WORD}[^)）】\\]]{0,24}\\s*[)）】\\]]`, 'g')
  const inline = new RegExp(`(?:请)?(?:参看|参见|参阅|见|看)\\s*${FIGURE_WORD}\\s*${FIGURE_TAIL}`, 'g')
  const attached = new RegExp(`(?:附图|附圖|见图|見圖|看图|看圖)\\s*${FIGURE_TAIL}`, 'g')
  s = s.replace(paren, '')
  s = s.replace(inline, '')
  s = s.replace(attached, '')
  s = s.replace(/[（(【\[]\s*[)）】\]]/g, '')
  s = s.replace(/[，、.。；;]+\s*$/g, '')
  return s
    .split(/[\r\n]+/)
    .map((line) => line.replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .trim()
}

export function quoteLinesOf(order, plan) {
  const items = plan && Array.isArray(plan.items) && plan.items.length
    ? plan.items
    : contentLines(order && order.lines)
  return items.map((line) => {
    const item = stripQuoteLine(line)
    item.projectName = stripQuoteSeeFigure(item.projectName)
    item.productName = stripQuoteSeeFigure(item.productName)
    item.spec = stripQuoteSeeFigure(item.spec)
    item.material = stripQuoteSeeFigure(item.material)
    return item
  })
}

export function recaclQuotePlan(plan) {
  const items = Array.isArray(plan && plan.items) ? plan.items : []
  const total = round2(items.reduce((sum, line) => sum + lineAmount(line), 0))
  plan.total = total
  plan.unitPrice = items.length ? round2(Number(items[0].unitPrice) || 0) : 0
  return plan
}

export function applyQuoteUnitPrice(plan, price) {
  const next = Math.max(0, round2(Number(price) || 0))
  const items = Array.isArray(plan && plan.items) ? plan.items : []
  if (items.length === 1) {
    items[0].unitPrice = next
  } else if (items.length > 1) {
    const old = Number(items[0].unitPrice) || 0
    if (old > 0) {
      const factor = next / old
      items.forEach((item) => {
        item.unitPrice = round2((Number(item.unitPrice) || 0) * factor)
      })
    } else {
      items[0].unitPrice = next
    }
  } else {
    plan.unitPrice = next
    plan.total = next
    return plan
  }
  return recaclQuotePlan(plan)
}

export function seedQuotePlanFromOrder(order, plan, ratio = 1) {
  const r = Number(ratio) > 0 ? Number(ratio) : 1
  const storedTotal = Number(plan && plan.total) || 0
  const storedPrice = Number(plan && plan.unitPrice) || 0
  const lines = contentLines(order && order.lines)
  plan.items = lines.map((line) => {
    const item = stripQuoteLine(line)
    item.id = newLineId()
    item.unitPrice = round2((Number(item.unitPrice) || 0) * r)
    return item
  })
  if (!plan.items.length && storedPrice > 0) {
    plan.items = [stripQuoteLine({
      projectName: '报价项目',
      qty: 1,
      unitPrice: round2(storedPrice * (r === 1 ? 1 : r)),
      pricingMode: 'by_piece',
      unitLabel: '项'
    })]
  }
  const itemSum = round2(plan.items.reduce((sum, line) => sum + lineAmount(line), 0))
  if (r === 1 && storedTotal > 0 && itemSum > 0 && Math.abs(storedTotal - itemSum) > 0.009) {
    const scale = storedTotal / itemSum
    plan.items.forEach((item) => {
      item.unitPrice = round2((Number(item.unitPrice) || 0) * scale)
    })
  } else if (r === 1 && storedPrice > 0 && plan.items.length === 1) {
    plan.items[0].unitPrice = storedPrice
  }
  fillQuoteHeaderIfEmpty(plan, order)
  return recaclQuotePlan(plan)
}

export function ensureQuotePlansReady(order) {
  const plans = Array.isArray(order && order.quotePlans) ? order.quotePlans : []
  plans.forEach((plan) => {
    if (!plan || typeof plan !== 'object') return
    if (!Array.isArray(plan.items)) plan.items = []
    if (!plan.items.length) seedQuotePlanFromOrder(order, plan, 1)
    else recaclQuotePlan(plan)
  })
  return plans
}

export function resolveQuotePlan(order, plan) {
  const lines = quoteLinesOf(order, plan)
  const first = lines[0] || {}
  const fromItems = lines.length ? round2(lines.reduce((sum, line) => sum + lineAmount(line), 0)) : 0
  const unitPrice = Number(plan && plan.unitPrice) > 0
    ? Number(plan.unitPrice)
    : (Number(first.unitPrice) || 0)
  const total = fromItems > 0
    ? fromItems
    : (Number(plan && plan.total) > 0 ? Number(plan.total) : orderReceivable(order))
  return {
    name: String((plan && plan.name) || '').trim() || '方案',
    companyName: String((plan && plan.companyName) || '').trim(),
    note: String((plan && plan.note) || '').trim(),
    unitPrice: round2(Math.max(0, unitPrice)),
    total: round2(Math.max(0, total))
  }
}

export function suggestQuotePlans(order, existing) {
  const prev = normalizeQuotePlans(existing || (order && order.quotePlans))
  return prev.map((plan, i) => {
    const next = { ...plan, items: [] }
    return seedQuotePlanFromOrder(order, next, QUOTE_TIER_RATIOS[i] || 1)
  })
}

export function emptyOrder() {
  return {
    customerId: '',
    customerName: '',
    contact: '',
    phone: '',
    address: '',
    isNewCustomer: false,
    salesperson: '',
    orderDate: todayDate(),
    deliveryDate: '',
    status: 'pending',
    deliveryMethod: '',
    settlementMethod: '',
    invoiceType: '',
    paymentMethod: '',
    prepay: 0,
    currentPayment: 0,
    discount: 0,
    taxRate: 0,
    note: '',
    showPaymentQrOnPrint: true,
    lastPaymentRemark: '',
    lastPaymentRemarkImages: [],
    paymentModalConfirmedAt: '',
    sortIndex: 0,
    printDocTitle: '',
    quotePlans: emptyQuotePlans(),
    lines: [emptyLine()]
  }
}

export function lineAreaM2(line) {
  const w = (Number(line && line.widthMm) || 0) / 1000
  const h = (Number(line && line.heightMm) || 0) / 1000
  return round2(Math.max(0, w * h))
}

export function monthRange() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return {
    from: `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`,
    to: todayDate()
  }
}

export function deepStripDataUrls(value) {
  if (typeof value === 'string') return value.startsWith('data:') ? '' : value
  if (Array.isArray(value)) return value.map(deepStripDataUrls)
  if (value && typeof value === 'object') {
    const out = {}
    Object.keys(value).forEach((k) => {
      out[k] = deepStripDataUrls(value[k])
    })
    return out
  }
  return value
}

export function stripDataUrlFromLine(line) {
  if (!line || typeof line !== 'object') return line
  const url = String(line.sampleImageDataUrl || '')
  if (!url.startsWith('data:')) return line
  const next = { ...line }
  delete next.sampleImageDataUrl
  return next
}

export function stripDataUrlsFromOrders(orders) {
  return (Array.isArray(orders) ? orders : []).map((order) => ({
    ...order,
    lines: Array.isArray(order && order.lines) ? order.lines.map(stripDataUrlFromLine) : []
  }))
}

function asArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export function workspaceBackupOf(data) {
  const src = data && typeof data === 'object' ? data : {}
  const orders = Array.isArray(src.orders) ? src.orders : []
  const customers = Array.isArray(src.customers) ? src.customers : []
  const expenses = Array.isArray(src.expenses) ? src.expenses : []
  const suppliers = Array.isArray(src.suppliers) ? src.suppliers : []
  const afterSales = Array.isArray(src.afterSales) ? src.afterSales : []
  const auditLogs = Array.isArray(src.auditLogs) ? src.auditLogs : []
  const appSettings = src.appSettings && typeof src.appSettings === 'object' ? src.appSettings : null
  return {
    kind: 'tuwen-workspace',
    exportedAt: src.exportedAt || new Date().toISOString(),
    workspaceId: src.workspaceId || 'default',
    version: src.version || 0,
    updatedAt: src.updatedAt || '',
    updatedBy: src.updatedBy || '',
    counts: {
      orders: orders.length,
      customers: customers.length,
      expenses: expenses.length,
      suppliers: suppliers.length,
      afterSales: afterSales.length,
      auditLogs: auditLogs.length
    },
    orders,
    customers,
    expenses,
    suppliers,
    afterSales,
    appSettings,
    auditLogs
  }
}

export function workspaceBackupSummary(backup) {
  const c = (backup && backup.counts) || {}
  return `订单 ${Number(c.orders) || 0}、客户 ${Number(c.customers) || 0}、支出 ${Number(c.expenses) || 0}、供应商 ${Number(c.suppliers) || 0}、售后 ${Number(c.afterSales) || 0}、记录 ${Number(c.auditLogs) || 0}`
}

export function extractImportPayload(raw) {
  const json = raw && typeof raw === 'object' ? raw : {}
  const nested = json.workspace && typeof json.workspace === 'object' ? json.workspace : json
  const orders = Array.isArray(json)
    ? json
    : asArray(nested.orders || json.orders || json.orders_json)
  const customers = asArray(nested.customers || json.customers || json.customers_json)
  const expenses = asArray(nested.expenses || json.expenses || json.expenses_json)
  const suppliers = asArray(nested.suppliers || json.suppliers || json.suppliers_json)
  const afterSales = asArray(nested.afterSales || json.afterSales || json.after_sales_json || json.afterSalesTickets)
  const auditLogs = asArray(nested.auditLogs || json.auditLogs || json.audit_logs_json)
  const settingsRaw = nested.appSettings || json.appSettings || json.app_settings_json
  let appSettings = null
  if (settingsRaw && typeof settingsRaw === 'object' && !Array.isArray(settingsRaw)) appSettings = settingsRaw
  else if (typeof settingsRaw === 'string' && settingsRaw.trim()) {
    try {
      const parsed = JSON.parse(settingsRaw)
      if (parsed && typeof parsed === 'object') appSettings = parsed
    } catch { /* ignore */ }
  }
  return { orders, customers, expenses, suppliers, afterSales, auditLogs, appSettings }
}

export function hasImportPayload(payload) {
  const p = payload || {}
  return !!(
    (Array.isArray(p.orders) && p.orders.length)
    || (Array.isArray(p.customers) && p.customers.length)
    || (Array.isArray(p.expenses) && p.expenses.length)
    || (Array.isArray(p.suppliers) && p.suppliers.length)
    || (Array.isArray(p.afterSales) && p.afterSales.length)
    || (Array.isArray(p.auditLogs) && p.auditLogs.length)
    || (p.appSettings && typeof p.appSettings === 'object')
  )
}

export function parseImportPayload(raw) {
  const extracted = extractImportPayload(raw)
  return deepStripDataUrls({
    orders: stripDataUrlsFromOrders(extracted.orders),
    customers: extracted.customers,
    expenses: extracted.expenses,
    suppliers: extracted.suppliers,
    afterSales: extracted.afterSales,
    auditLogs: extracted.auditLogs,
    appSettings: extracted.appSettings
  })
}

export function collectLineDataUrls(orders) {
  const out = []
  for (const order of orders || []) {
    const orderId = String((order && order.id) || 'na')
    const lines = Array.isArray(order && order.lines) ? order.lines : []
    for (const line of lines) {
      const url = String((line && (line.sampleImageDataUrl || line.sampleImageUrl)) || '')
      if (url.startsWith('data:')) out.push({ orderId, line, dataUrl: url })
    }
  }
  return out
}

export function parseDataUrlMeta(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,/)
  if (!m) return null
  const mime = m[1] || 'image/jpeg'
  let ext = 'jpg'
  if (/png/i.test(mime)) ext = 'png'
  else if (/webp/i.test(mime)) ext = 'webp'
  else if (/gif/i.test(mime)) ext = 'gif'
  return { mime, ext }
}

export const IMPORT_ORDER_BATCH = 5

export function chunkImportBatches(payload, orderSize = IMPORT_ORDER_BATCH) {
  const orders = Array.isArray(payload && payload.orders) ? payload.orders : []
  const customers = Array.isArray(payload && payload.customers) ? payload.customers : []
  const expenses = Array.isArray(payload && payload.expenses) ? payload.expenses : []
  const suppliers = Array.isArray(payload && payload.suppliers) ? payload.suppliers : []
  const afterSales = Array.isArray(payload && payload.afterSales) ? payload.afterSales : []
  const auditLogs = Array.isArray(payload && payload.auditLogs) ? payload.auditLogs : []
  const appSettings = payload && payload.appSettings && typeof payload.appSettings === 'object' ? payload.appSettings : null
  const extras = () => ({
    customers,
    expenses,
    suppliers,
    afterSales,
    auditLogs,
    ...(appSettings ? { appSettings } : {})
  })
  if (!orders.length) {
    if (!customers.length && !expenses.length && !suppliers.length && !afterSales.length && !auditLogs.length && !appSettings) return []
    return [{ orders: [], ...extras() }]
  }
  const batches = []
  for (let i = 0; i < orders.length; i += orderSize) {
    batches.push({
      orders: orders.slice(i, i + orderSize),
      ...(i === 0 ? extras() : { customers: [], expenses: [], suppliers: [], afterSales: [], auditLogs: [] })
    })
  }
  return batches
}

export function moneyEps(decimals = 2) {
  const d = Math.min(6, Math.max(0, Number(decimals) || 2))
  return Math.pow(10, -d) / 2
}

export function isMoneySettled(order, decimals = 2) {
  const eps = moneyEps(decimals)
  const rec = orderReceivable(order)
  if (rec <= eps) return false
  return orderBalance(order) <= eps
}

export function isPaidDisplay(order, decimals = 2) {
  if (!order || !order.paymentModalConfirmedAt) return false
  const eps = moneyEps(decimals)
  const rec = orderReceivable(order)
  if (rec > eps) return orderBalance(order) <= eps
  return true
}

export function displayStatus(order, decimals = 2) {
  return isPaidDisplay(order, decimals) ? 'paid' : String((order && order.status) || 'pending')
}

export function displayStatusLabel(order, decimals = 2) {
  const st = displayStatus(order, decimals)
  return st === 'paid' ? '已收款' : (ORDER_STATUSES[st] || st)
}

export function paidLocked(order, decimals = 2) {
  return isPaidDisplay(order, decimals)
}

export function debounce(fn, wait = 220) {
  let timer
  function run(...args) {
    clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), wait)
  }
  run.cancel = () => { clearTimeout(timer) }
  run.flush = (...args) => {
    clearTimeout(timer)
    fn.apply(this, args)
  }
  return run
}

export function matchesKeyword(row, q, keys) {
  const k = String(q || '').trim().toLowerCase()
  if (!k) return true
  const blob = (Array.isArray(keys) && keys.length
    ? keys.map((key) => (row && row[key] != null ? row[key] : ''))
    : Object.values(row || {})
  ).join(' ')
  return String(blob).toLowerCase().includes(k)
}

export function matchesAuditLog(row, q) {
  return matchesKeyword({
    ...(row || {}),
    actionLabel: AUDIT_ACTION_LABELS[row && row.action] || ''
  }, q, ['action', 'actionLabel', 'orderNo', 'customerName', 'actorLabel', 'detail', 'amount'])
}

export function sortStatementOrders(orders) {
  return (Array.isArray(orders) ? orders : []).slice().sort((a, b) => {
    const d = String(b.orderDate || '').localeCompare(String(a.orderDate || ''))
    if (d) return d
    return String(b.orderNo || b.id || '').localeCompare(String(a.orderNo || a.id || ''))
  })
}

export function filterStatementOrders(orders, { q, unpaidOnly } = {}) {
  return sortStatementOrders((Array.isArray(orders) ? orders : []).filter((o) => {
    if (unpaidOnly && !(Number(o.balance) > 0)) return false
    return matchesKeyword(o, q, ['customerName', 'orderNo', 'phone', 'contact', 'projectNames'])
  }))
}

export function statementOrderSubtotal(order) {
  const o = order || {}
  return Number(o.subtotal) || Number(o.receivable) || round2((Number(o.paid) || 0) + (Number(o.balance) || 0) + (Number(o.discount) || 0))
}

export function statementTotals(orders) {
  return (Array.isArray(orders) ? orders : []).reduce((acc, o) => {
    acc.subtotal = round2(acc.subtotal + statementOrderSubtotal(o))
    acc.discount = round2(acc.discount + (Number(o.discount) || 0))
    acc.paid = round2(acc.paid + (Number(o.paid) || 0))
    acc.unpaid = round2(acc.unpaid + (Number(o.balance) || 0))
    return acc
  }, { subtotal: 0, discount: 0, paid: 0, unpaid: 0 })
}

export function uniqueStatementCustomers(orders) {
  return [...new Set((Array.isArray(orders) ? orders : [])
    .map((o) => String(o.customerName || '').trim())
    .filter(Boolean))]
}

export function uniqueStatementParty(orders) {
  const rows = Array.isArray(orders) ? orders : []
  const names = uniqueStatementCustomers(rows)
  if (names.length !== 1) return null
  const ids = [...new Set(rows.map((o) => String(o.customerId || '').trim()).filter(Boolean))]
  if (ids.length > 1) return null
  return { customerId: ids[0] || '', customerName: names[0] }
}

export function statementPrintCustomer(orders, keyword) {
  const names = uniqueStatementCustomers(orders)
  if (names.length === 1) return names[0]
  const k = String(keyword || '').trim()
  if (k && names.includes(k)) return k
  return names.length ? `${names.length} 个客户` : (k || '当前筛选')
}

export function statementLinesForOrders(lines, orders) {
  const list = Array.isArray(orders) ? orders : []
  const ids = new Set(list.map((o) => o.id).filter(Boolean))
  const nos = new Set(list.map((o) => o.orderNo).filter(Boolean))
  const raw = (Array.isArray(lines) ? lines : []).filter((line) => (
    ids.size ? (ids.has(line.orderId) || ids.has(line.orderNo)) : nos.has(line.orderNo)
  ))
  return raw.slice().sort((a, b) => {
    const d = String(b.orderDate || '').localeCompare(String(a.orderDate || ''))
    if (d) return d
    return String(b.orderNo || '').localeCompare(String(a.orderNo || ''))
  })
}

export function ordersFromStatementLines(lines) {
  const map = new Map()
  for (const line of Array.isArray(lines) ? lines : []) {
    const id = line.orderId || line.orderNo
    if (!id) continue
    if (!map.has(id)) {
      map.set(id, {
        id,
        orderNo: line.orderNo || id,
        orderDate: line.orderDate || '',
        customerName: line.customerName || '',
        phone: line.phone || '',
        contact: '',
        projectNames: [],
        lineCount: 0,
        subtotal: 0,
        discount: 0,
        paid: 0,
        balance: 0,
        statusLabel: ''
      })
    }
    const row = map.get(id)
    row.lineCount += 1
    row.subtotal = round2(row.subtotal + (Number(line.amount) || 0))
    const name = line.projectName || line.productName
    if (name && !row.projectNames.includes(name)) row.projectNames.push(name)
  }
  return [...map.values()].map((o) => ({
    ...o,
    projectNames: o.projectNames.slice(0, 4).join('、'),
    balance: o.subtotal
  }))
}

export function hydrateStatementOrders(orders, lines) {
  const grouped = new Map()
  for (const line of Array.isArray(lines) ? lines : []) {
    const key = line.orderId || line.orderNo
    if (!key) continue
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(line)
  }
  return (Array.isArray(orders) ? orders : []).map((o) => {
    const mine = grouped.get(o.id) || grouped.get(o.orderNo) || []
    const names = String(o.projectNames || '').trim()
      || [...new Set(mine.map((l) => l.projectName || l.productName).filter(Boolean))].slice(0, 4).join('、')
    const fromLines = mine.reduce((sum, l) => sum + (Number(l.amount) || 0), 0)
    return {
      ...o,
      projectNames: names,
      subtotal: round2(Number(o.subtotal) || Number(o.receivable) || fromLines || 0)
    }
  })
}

export function ordersFromStatementPayload(res) {
  if (res && Array.isArray(res.orders)) return hydrateStatementOrders(res.orders, res.lines)
  return ordersFromStatementLines(res && res.lines)
}

export function normalizeLineColumns(raw) {
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

export function visibleLineColumns(raw) {
  return normalizeLineColumns(raw).filter((col) => col.visible)
}

export function visibleLineColumnsOf(settings) {
  return applyDimensionColumnLabels(
    visibleLineColumns(settings && settings.orderLineColumns),
    dimensionUnitOf(settings)
  )
}

export function lineTableMinWidth(cols) {
  return (Array.isArray(cols) ? cols : []).reduce((sum, col) => {
    const def = LINE_COLUMN_DEFS[col.key] || { minW: 80 }
    return sum + (def.minW || 80)
  }, 0)
}

export function colWidthPercents(cols, leadingWeights = []) {
  const list = Array.isArray(cols) ? cols : []
  const weights = [
    ...leadingWeights.map((w) => Math.max(Number(w) || 1, 1)),
    ...list.map((col) => Math.max((LINE_COLUMN_DEFS[col.key] && LINE_COLUMN_DEFS[col.key].minW) || 48, 1))
  ]
  if (!weights.length) return []
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map((w) => (w / sum) * 100)
  const floors = raw.map((x) => Math.floor(x))
  let remain = 100 - floors.reduce((a, b) => a + b, 0)
  const frac = raw.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f)
  const out = [...floors]
  for (let i = 0; i < remain; i++) out[frac[i % frac.length].i] += 1
  return out.map((n) => `${n}%`)
}

export function printColPercents(cols) {
  return colWidthPercents(cols)
}

export function parsePresetLines(raw, maxItems, maxLen) {
  const src = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/\r?\n/).map((x) => x.trim())
  const out = []
  for (const item of src) {
    const s = String(item || '').trim().slice(0, maxLen)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= maxItems) break
  }
  return out
}

export function pricingModeFromUnit(label) {
  const t = String(label || '').trim()
  if (!t) return 'by_piece'
  if (t.includes('㎡') || t.includes('平方') || t.includes('平米')) return 'by_area'
  if (t === '厘米' || t === '公分') return 'by_cm'
  if (t === '延米' || t.includes('延米') || /周长|线长|围边|边条/.test(t) || t === '米') return 'by_length'
  if (/毫米|微米|分米/.test(t)) return 'by_piece'
  if (t.endsWith('米') && !t.includes('平方') && !t.includes('平米')) return 'by_length'
  return 'by_piece'
}

export function parseUnitExtra(raw) {
  const lines = parsePresetLines(raw, 40, 56)
  return lines.map((line) => {
    const parts = line.split('|').map((x) => x.trim()).filter(Boolean)
    const label = parts[0] || line
    const hint = String(parts[1] || '').toLowerCase()
    let mode = null
    if (hint === '面积' || hint === '㎡' || hint === '平方' || hint === '平米') mode = 'by_area'
    else if (hint === '件' || hint === '个' || hint === '套') mode = 'by_piece'
    else if (hint === '米' || hint === '延米' || hint === '长度' || hint === '周长') mode = 'by_length'
    else if (hint === '厘米' || hint === '公分') mode = 'by_cm'
    else mode = pricingModeFromUnit(label)
    return { label, mode }
  }).filter((x) => x.label)
}

export function unitOptionsFromSettings(settings) {
  const extras = parseUnitExtra((settings && settings.orderLineUnitExtraLabels) || [])
  const seen = new Set()
  const out = []
  UNIT_PRESETS.concat(extras).forEach((item) => {
    const label = String(item.label || '').trim()
    if (!label || seen.has(label)) return
    seen.add(label)
    out.push({ label, mode: item.mode || pricingModeFromUnit(label) })
  })
  return out
}

export function applyUnitToLine(line, label) {
  const unitLabel = String(label || '').trim()
  const mode = pricingModeFromUnit(unitLabel)
  return {
    ...line,
    unitLabel,
    pricingMode: mode
  }
}

export function isLineEmpty(line) {
  if (!line || typeof line !== 'object') return true
  return !String(line.code || '').trim()
    && !String(line.projectName || '').trim()
    && !String(line.productName || '').trim()
    && !String(line.spec || '').trim()
    && !String(line.material || '').trim()
    && !String(line.remark || '').trim()
    && !String(line.sampleImageDataUrl || line.sampleImageUrl || '').trim()
    && !(Number(line.widthMm) || 0)
    && !(Number(line.heightMm) || 0)
    && !(Number(line.unitPrice) || 0)
}

export function contentLines(lines) {
  return (Array.isArray(lines) ? lines : []).filter((line) => !isLineEmpty(line))
}

export function reverseFromAmount(line, amountRaw) {
  const amount = Number(amountRaw)
  const qty = normalizeQty(line && line.qty)
  const mode = String((line && line.pricingMode) || 'by_piece')
  if (!Number.isFinite(amount) || amount < 0) return { unitPrice: 0 }
  if (amount === 0) return { unitPrice: 0 }
  const factor = lineQtyFactor(line)
  if (factor > 1e-9) return { unitPrice: amount / factor }
  const price = Number(line && line.unitPrice) || 0
  if (price > 1e-9) {
    if (mode === 'by_area' && lineAreaM2(line) <= 1e-9) {
      const area = amount / (price * qty)
      if (area > 1e-9) {
        const side = Math.sqrt(area) * 1000
        return { unitPrice: price, widthMm: side, heightMm: side }
      }
    }
    if (mode === 'by_length' && ((Number(line && line.widthMm) || 0) / 1000) <= 1e-9) {
      const meters = amount / (price * qty)
      if (meters > 1e-9) return { unitPrice: price, widthMm: meters * 1000, heightMm: 0 }
    }
    if (mode === 'by_cm' && ((Number(line && line.widthMm) || 0) / 10) <= 1e-9) {
      const cm = amount / (price * qty)
      if (cm > 1e-9) return { unitPrice: price, widthMm: cm * 10, heightMm: 0 }
    }
    return { unitPrice: price, qty: Math.max(1, amount / price), pricingMode: 'by_piece', unitLabel: '个' }
  }
  return { unitPrice: amount / qty, pricingMode: 'by_piece', unitLabel: '个' }
}

export function lineLengthM(line) {
  return Math.max(0, (Number(line && line.widthMm) || 0) / 1000)
}

export function lineLengthCm(line) {
  return Math.max(0, (Number(line && line.widthMm) || 0) / 10)
}

export function formatQty(n, decimals = 2) {
  const v = Number(n) || 0
  const d = Math.min(4, Math.max(0, Number(decimals) || 2))
  return v.toFixed(d).replace(/\.?0+$/, '') || '0'
}

const CN_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const CN_SMALL = ['', '拾', '佰', '仟']

function cnBlock(n) {
  if (n === 0) return ''
  let out = ''
  let zero = false
  for (let i = 0; i < 4; i++) {
    const d = n % 10
    n = Math.floor(n / 10)
    if (d !== 0) {
      if (zero) out = CN_DIGITS[0] + out
      out = CN_DIGITS[d] + CN_SMALL[i] + out
      zero = false
    } else if (out) {
      zero = true
    }
  }
  return out
}

function cnInt(n) {
  if (n === 0) return CN_DIGITS[0]
  if (n < 0) return `负${cnInt(-n)}`
  let rest = Math.floor(n)
  const yi = Math.floor(rest / 1e8)
  rest %= 1e8
  const wan = Math.floor(rest / 1e4)
  const ge = rest % 1e4
  let out = ''
  if (yi) out += `${cnBlock(yi)}亿`
  if (wan) {
    if (yi && cnBlock(wan).length < 4 && ge) out += CN_DIGITS[0]
    out += `${cnBlock(wan)}万`
  } else if (yi && ge) {
    out += CN_DIGITS[0]
  }
  if (ge) out += cnBlock(ge)
  return out || CN_DIGITS[0]
}

export function moneyInWords(n) {
  if (!Number.isFinite(Number(n))) return '零元整'
  const v = Math.round(Number(n) * 100) / 100
  if (v === 0) return '零元整'
  if (v < 0) return `负${moneyInWords(-v)}`
  const yuan = Math.floor(v + 1e-8)
  const cents = Math.round((v - yuan) * 100)
  const jiao = Math.floor(cents / 10)
  const fen = cents % 10
  let out = `${cnInt(yuan)}元`
  if (jiao === 0 && fen === 0) return `${out}整`
  if (jiao) out += `${CN_DIGITS[jiao]}角`
  else if (fen) out += '零'
  if (fen) out += `${CN_DIGITS[fen]}分`
  else out += '整'
  return out
}

export function copyLinesToClipboard(lines, sourceOrderNo) {
  const payload = {
    lines: (Array.isArray(lines) ? lines : []).map((line) => ({ ...line, id: '' })),
    sourceOrderNo: String(sourceOrderNo || '').trim() || undefined,
    copiedAt: new Date().toISOString()
  }
  try {
    sessionStorage.setItem(LINE_CLIPBOARD_KEY, JSON.stringify(payload))
    return payload.lines.length
  } catch {
    return 0
  }
}

export function readLinesClipboard() {
  try {
    const raw = sessionStorage.getItem(LINE_CLIPBOARD_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.lines) || !parsed.lines.length) return null
    return parsed
  } catch {
    return null
  }
}

export function cloneClipboardLines(payload) {
  const lines = payload && Array.isArray(payload.lines) ? payload.lines : []
  return lines.map((line) => ({ ...emptyLine(), ...line, id: newLineId() }))
}
