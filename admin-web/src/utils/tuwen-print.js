import {
  ORDER_STATUSES,
  QUOTE_PLAN_DEFAULTS,
  contentLines,
  dimensionUnitOf,
  formatMoney,
  formatQty,
  lineAmount,
  lineAreaM2,
  lineLengthCm,
  lineLengthM,
  mmToDimension,
  moneyInWords,
  normalizeColumnAlign,
  normalizeQuotePlans,
  orderBalance,
  orderReceivable,
  orderSubtotal,
  orderTax,
  printColPercents,
  brandCompanyNameOf,
  quoteCompanyOf,
  quoteDocTitleOf,
  orderDocTitle,
  quoteLinesOf,
  resolveQuotePlan,
  stripQuoteSeeFigure,
  visibleLineColumnsOf
} from './tuwen-yewu.js'
import { buildStatementXlsx, sniffImageExt } from './tuwen-xlsx.js'

function escapeHtml(raw) {
  return String(raw == null ? '' : raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const PRINT_TEMPLATES = [
  { id: 'a4-1', label: 'A4一等分', sheet: 'a4-full', hint: '整页业务单' },
  { id: 'a4-2-001', label: 'A4二等分-001', sheet: 'a4-half', hint: '半页联单' },
  { id: 'a4-3-001', label: 'A4三等分-001', sheet: 'a4-third', hint: '三等分联单 ①' },
  { id: 'a4-3-002', label: 'A4三等分-002', sheet: 'a4-third', hint: '三等分联单 ②' },
  { id: 'a4-3-003', label: 'A4三等分-003', sheet: 'a4-third', hint: '三等分联单 ③' },
  { id: 'delivery', label: '送货单格式', sheet: 'a4-half', hint: '半页送货单版式' },
  { id: 'statement-print', label: '对账合计版', sheet: 'a4-full', hint: '含合计与签字栏' }
]

export const A4_SHEET_PX = { width: 794, fullHeight: 1123, halfHeight: 560, thirdHeight: 374 }

export const PRINT_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #111; }
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
  .print-sheet { width: 100%; max-width: 794px; margin: 0 auto; background: #fff; color: #111; box-sizing: border-box; }
  .print-sheet--full { min-height: 1123px; padding: 24px 28px 32px; font-size: 12px; }
  .print-sheet--half { min-height: 560px; padding: 16px 20px 20px; font-size: 11px; }
  .print-sheet--third { min-height: 374px; padding: 12px 16px 16px; font-size: 10px; }
  .print-root__inner { width: 100%; }
  .print-header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .print-logo { height: 40px; width: auto; display: block; }
  .print-company { margin-top: 6px; font-size: 14px; font-weight: 600; color: #111; }
  .print-order-no { font-size: 13px; color: #333; text-align: right; }
  .print-order-no__num { color: #c00; font-weight: 700; letter-spacing: .02em; }
  .print-title { text-align: center; font-size: 22px; font-weight: 700; letter-spacing: .2em; margin: 12px 0 14px; color: #111; }
  .print-title--sm { font-size: 18px; }
  .print-sheet--half .print-title, .print-sheet--third .print-title { font-size: 16px; margin: 8px 0 10px; }
  .print-meta-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px 12px; padding: 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; background: #fff; color: #111; }
  .print-meta-grid__full { grid-column: 1 / -1; }
  .print-k { color: #333; margin-right: 6px; }
  .print-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 11px; table-layout: fixed; }
  .print-table th, .print-table td { border: 1px solid #333; padding: 5px 4px; vertical-align: top; word-break: break-word; }
  .print-table th { background: #f0f0f0; font-weight: 600; text-align: center; }
  .print-table td.print-num { font-variant-numeric: tabular-nums; }
  .print-table td.print-unit { white-space: normal; }
  .print-table td.print-center, .print-table th.print-center { text-align: center; }
  .print-table td.print-left, .print-table th.print-left { text-align: left; }
  .print-table td.print-right, .print-table th.print-right { text-align: right; }
  .print-table td.print-material, .print-table td.print-project, .print-table td.print-cell-remark { word-break: break-word; overflow-wrap: anywhere; }
  .print-table td.print-cell-remark .print-remark { display: block; }
  .print-sub { display: block; font-size: 9px; color: #666; margin-top: 2px; }
  .print-sample img { max-width: 72px; max-height: 52px; object-fit: contain; display: inline-block; }
  .print-total-zh { margin-top: 14px; padding: 10px 12px; border: 1px solid #333; display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: 13px; }
  .print-total-zh__label { font-weight: 600; }
  .print-total-zh__text { flex: 1; letter-spacing: .06em; }
  .print-total-zh__num { font-weight: 700; font-size: 15px; }
  .print-finance-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 10px; margin-top: 10px; font-size: 11px; padding: 8px 10px; border: 1px dashed #999; }
  .print-statement__head { text-align: center; margin-bottom: 8px; }
  .print-statement__period { font-size: 13px; color: #333; letter-spacing: .04em; }
  .print-statement__table { font-size: 10px; }
  .print-statement__table th, .print-statement__table td { padding: 4px 3px; }
  .print-statement__sum {
    margin-top: 0; display: grid; grid-template-columns: repeat(4, 1fr);
    border: 1px solid #333; border-top: 0; background: #eee; font-size: 12px; font-weight: 700;
  }
  .print-statement__sum span { padding: 8px 6px; text-align: center; border-right: 1px solid #333; }
  .print-statement__sum span:last-child { border-right: 0; }
  .print-statement__sum .is-due { color: #b91c1c; }
  .print-statement__foot { margin-top: 16px; font-size: 12px; color: #333; line-height: 1.7; }
  .print-qr-row { display: flex; gap: 16px; margin-top: 12px; align-items: flex-start; }
  .print-qr-box { flex-shrink: 0; width: 120px; text-align: center; }
  .print-qr-box img { width: 100px; height: 100px; object-fit: contain; display: block; margin: 0 auto; }
  .print-qr-placeholder { width: 100px; height: 100px; margin: 0 auto; border: 1px dashed #999; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #666; }
  .print-meta-mini { flex: 1; font-size: 11px; line-height: 1.6; color: #333; min-width: 0; }
  .print-sign-row { display: flex; flex-wrap: wrap; gap: 12px 24px; margin-top: 20px; font-size: 12px; justify-content: space-between; color: #111; }
  .print-sheet--delivery { border-top: 3px solid #15803d; }
  .print-title--delivery { color: #14532d; letter-spacing: .35em; }
  .print-delivery-sub { text-align: center; font-size: 10px; color: #166534; margin: -6px 0 10px; letter-spacing: .06em; }
  .print-meta-grid--delivery { grid-template-columns: 1fr 1fr; gap: 5px 10px; padding: 10px; border-color: #86efac; background: linear-gradient(180deg, #f0fdf4, #fff 55%); }
  .print-table--delivery { font-size: 10px; margin-top: 10px; }
  .print-table--delivery th, .print-table--delivery td { padding: 4px 3px; border-color: #14532d; }
  .print-table--delivery th { background: #dcfce7; color: #14532d; }
  .print-total-zh--delivery { margin-top: 10px; padding: 8px 10px; font-size: 12px; border-color: #15803d; background: #f7fee7; }
  .print-finance-row--delivery { grid-template-columns: repeat(2, 1fr); margin-top: 8px; padding: 6px 8px; font-size: 10px; border-style: solid; border-color: #bbf7d0; }
  .print-sign-row--delivery { margin-top: 14px; padding-top: 10px; border-top: 1px dashed #86efac; font-size: 11px; font-weight: 600; color: #14532d; }
  .qsheet { color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .qsheet__foot { margin-top: 22px; font-size: 12px; color: #111 !important; line-height: 1.5; font-weight: 600; opacity: 1; }
  .qsheet__meta { margin-top: 12px; }
  .qsheet__price { margin-top: 14px; padding: 10px 12px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; }
  .qsheet__price b { font-size: 16px; }
  .qsheet-classic__bar {
    background: #1e3a5f; color: #fff; padding: 14px 16px;
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
  }
  .qsheet-classic__co { font-size: 16px; font-weight: 700; letter-spacing: .06em; }
  .qsheet-classic__doc { font-size: 22px; font-weight: 700; letter-spacing: .28em; }
  .qsheet-classic__plan { margin: 10px 0 0; color: #1e3a5f; font-weight: 600; }
  .qsheet--classic .qsheet__price { border: 1px solid #1e3a5f; background: #f4f7fb; }
  .qsheet--classic .print-table th { background: #1e3a5f; color: #fff; border-color: #1e3a5f; }
  .qsheet--classic .print-table td { border-color: #334e68; }
  .qsheet--formal { padding: 16px; }
  .qsheet-formal__frame {
    border: 2px solid #1a1a1a; outline: 1px solid #1a1a1a; outline-offset: 5px;
    padding: 22px 24px 28px; min-height: 1070px;
  }
  .qsheet-formal__co {
    text-align: center; font-family: SimSun, "Songti SC", serif;
    font-size: 20px; font-weight: 700; letter-spacing: .18em;
  }
  .qsheet-formal__doc {
    text-align: center; font-family: SimSun, "Songti SC", serif;
    font-size: 26px; font-weight: 700; letter-spacing: .4em; margin: 10px 0 6px;
  }
  .qsheet-formal__plan { text-align: center; font-family: SimSun, "Songti SC", serif; color: #444; margin-bottom: 8px; }
  .qsheet--formal .qsheet__price { border: 1px solid #111; font-family: SimSun, "Songti SC", serif; }
  .qsheet--formal .print-table th, .qsheet--formal .print-table td { border-color: #111; }
  .qsheet--formal .print-table th { background: #f5f5f5; }
  .qsheet--modern { padding: 0; display: flex; min-height: 1123px; }
  .qsheet-modern__rail { width: 10px; background: #0f766e; flex-shrink: 0; }
  .qsheet-modern__body { flex: 1; padding: 28px 32px 32px 24px; min-width: 0; }
  .qsheet-modern__head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; border-bottom: 3px solid #0f766e; padding-bottom: 12px; }
  .qsheet-modern__co { font-size: 15px; font-weight: 700; color: #0f766e; letter-spacing: .08em; }
  .qsheet-modern__doc { font-size: 28px; font-weight: 800; letter-spacing: .12em; margin-top: 4px; }
  .qsheet-modern__plan { font-size: 13px; color: #0f766e; font-weight: 700; padding: 6px 10px; border: 1px solid #0f766e; border-radius: 999px; }
  .qsheet--modern .qsheet__price { background: #f0fdfa; border: 1px solid #99f6e4; }
  .qsheet--modern .print-table th { background: #0f766e; color: #fff; border-color: #0f766e; }
  .qsheet-compare__title { text-align: center; font-size: 22px; font-weight: 700; letter-spacing: .16em; margin: 8px 0 12px; }
  .qsheet-compare__grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 14px; }
  .qsheet-compare__card { border: 1px solid #ccc; padding: 10px; min-height: 140px; }
  .qsheet-compare__card b { display: block; margin-bottom: 6px; }
  .qsheet-compare__card--classic { border-color: #1e3a5f; }
  .qsheet-compare__card--classic b { color: #1e3a5f; }
  .qsheet-compare__card--formal { border-color: #111; font-family: SimSun, "Songti SC", serif; }
  .qsheet-compare__card--modern { border-color: #0f766e; }
  .qsheet-compare__card--modern b { color: #0f766e; }
  @media print {
    @page { size: A4 portrait; margin: 8mm; }
    body { padding: 0; background: #fff !important; }
    .print-sheet { max-width: none; box-shadow: none !important; border-radius: 0 !important; }
    .print-meta-grid--delivery, .print-table--delivery th, .print-total-zh--delivery,
    .qsheet-classic__bar, .qsheet--classic .print-table th, .qsheet--modern .print-table th, .qsheet-modern__rail {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
`

function settingsOf(settings) {
  return settings && typeof settings === 'object' ? settings : {}
}

function templateOf(id) {
  return PRINT_TEMPLATES.find((t) => t.id === id) || PRINT_TEMPLATES[0]
}

function sheetClass(sheet, isDelivery) {
  const base = sheet === 'a4-half'
    ? 'print-root print-sheet print-sheet--half'
    : sheet === 'a4-third'
      ? 'print-root print-sheet print-sheet--third'
      : 'print-root print-sheet print-sheet--full'
  return isDelivery ? `${base} print-sheet--delivery` : base
}

function printCols(settings) {
  return visibleLineColumnsOf(settings).filter((c) => c.key !== 'actions')
}

function printAlignClass(col) {
  const a = normalizeColumnAlign(col && col.align)
  return a === 'left' ? 'print-left' : a === 'right' ? 'print-right' : 'print-center'
}

function printTdClass(col) {
  const key = col && typeof col === 'object' ? col.key : col
  const align = printAlignClass(typeof col === 'object' ? col : null)
  let extra = ''
  if (key === 'unit') extra = 'print-unit'
  else if (['area', 'qty', 'unitPrice', 'amount', 'widthMm', 'heightMm'].includes(key)) extra = 'print-num'
  else if (key === 'material') extra = 'print-material'
  else if (key === 'projectName' || key === 'productName') extra = 'print-project'
  else if (key === 'remark') extra = 'print-cell-remark'
  else if (key === 'sample') extra = 'print-sample'
  return [extra, align].filter(Boolean).join(' ')
}

function specText(line, decimals, unit) {
  const spec = String((line && line.spec) || '').trim()
  if (spec) return spec
  const w = mmToDimension(line && line.widthMm, unit)
  const h = mmToDimension(line && line.heightMm, unit)
  const f = (n) => formatQty(n, decimals)
  if (w && h) return `${f(w)}*${f(h)}`
  if (w) return f(w)
  return ''
}

function areaPrintText(line, settings) {
  const s = settingsOf(settings)
  if (line.pricingMode === 'by_area') {
    const v = lineAreaM2(line)
    return v > 0 ? formatQty(v, s.areaDecimals || 3) : ''
  }
  if (line.pricingMode === 'by_length') {
    const v = lineLengthM(line)
    return v > 0 ? formatQty(v, s.lengthDecimals || 3) : ''
  }
  if (line.pricingMode === 'by_cm') {
    const v = lineLengthCm(line)
    return v > 0 ? `${formatQty(v, s.lengthDecimals || 3)} cm` : ''
  }
  return ''
}

function sampleHtml(line) {
  const url = line.sampleImageDataUrl || line.sampleImageUrl || ''
  if (/^https?:\/\//i.test(url) || String(url).startsWith('data:image')) {
    return `<img src="${escapeHtml(url)}" alt="">`
  }
  return ''
}

function lineCell(line, key, i, settings, colKeys) {
  const s = settingsOf(settings)
  const dimD = Number(s.dimensionDecimals) || 2
  if (key === 'seq') return String(i + 1)
  if (key === 'outsource') return line.outsource ? '外协' : ''
  if (key === 'code') return line.code || ''
  if (key === 'projectName') return line.projectName || ''
  if (key === 'productName') return line.productName || ''
  if (key === 'spec') return specText(line, dimD, s)
  if (key === 'material') return line.material || ''
  if (key === 'widthMm') {
    const v = mmToDimension(line.widthMm, s)
    return v > 0 ? formatQty(v, dimD) : ''
  }
  if (key === 'heightMm') {
    const v = mmToDimension(line.heightMm, s)
    return v > 0 ? formatQty(v, dimD) : ''
  }
  if (key === 'area') return areaPrintText(line, s)
  if (key === 'qty') return formatQty(line.qty, s.qtyDecimals || 2)
  if (key === 'unit') return line.unitLabel || ''
  if (key === 'unitPrice') return Number(line.unitPrice) ? formatMoney(line.unitPrice) : ''
  if (key === 'amount') return formatMoney(lineAmount(line))
  if (key === 'sample') return sampleHtml(line)
  if (key === 'remark') {
    const remark = String(line.remark || '').trim()
    const hideArea = colKeys && !colKeys.has('area')
    const area = lineAreaM2(line)
    const extra = hideArea && line.pricingMode === 'by_area' && area > 0
      ? `（面积 ${formatQty(area, s.areaDecimals || 3)}㎡）`
      : ''
    if (remark && extra) return `<span class="print-remark">${escapeHtml(remark)}</span><span class="print-sub">${escapeHtml(extra)}</span>`
    if (extra) return `<span class="print-sub">${escapeHtml(extra)}</span>`
    return escapeHtml(remark)
  }
  return ''
}

function cellHtml(line, key, i, settings, colKeys) {
  if (key === 'sample' || key === 'remark') return lineCell(line, key, i, settings, colKeys)
  return escapeHtml(lineCell(line, key, i, settings, colKeys))
}

export function orderSheetHtml(order, settings, templateId = 'a4-1') {
  const s = settingsOf(settings)
  const tpl = templateOf(templateId)
  const cols = printCols(s)
  const percents = printColPercents(cols)
  const colKeys = new Set(cols.map((c) => c.key))
  const lines = Array.isArray(order.lines) ? order.lines : []
  const isDelivery = tpl.id === 'delivery'
  const company = String(s.printCompanyTitle || s.brandCompanyName || '').trim()
  const rec = orderReceivable(order)
  const logo = s.showPrintLogo && s.printLogoDataUrl
    ? `<img src="${escapeHtml(s.printLogoDataUrl)}" alt="" class="print-logo">`
    : (company ? `<div class="print-company">${escapeHtml(company)}</div>` : '')
  const rows = lines.map((line, i) => `
    <tr>
      ${cols.map((col) => {
        const cls = printTdClass(col)
        const extra = col.key === 'sample' ? ' style="text-align:center;vertical-align:middle"' : ''
        return `<td class="${cls}"${extra}>${cellHtml(line, col.key, i, s, colKeys)}</td>`
      }).join('')}
    </tr>
  `).join('')
  const showQr = order.showPaymentQrOnPrint !== false && s.showPaymentQrOnPrint !== false
  const qr = showQr
    ? `<div class="print-qr-box">${s.paymentQrDataUrl
      ? `<img src="${escapeHtml(s.paymentQrDataUrl)}" alt="收款码">`
      : `<div class="print-qr-placeholder">收款码</div>`}</div>`
    : ''
  const footNotes = [
    `${isDelivery ? '开单' : '开单制单'}：${escapeHtml(order.salesperson || '')}`,
    !isDelivery ? `经办制单：${escapeHtml(order.salesperson || '')}` : '',
    `备注：${escapeHtml(order.note || '')}`
  ].filter(Boolean)
  const signs = isDelivery || tpl.id === 'statement-print'
    ? `<div class="print-sign-row${isDelivery ? ' print-sign-row--delivery' : ''}"><div>送货人：__________</div><div>收货人：__________</div><div>签收时间：__________</div><div>客户签字：__________</div></div>`
    : `<div class="print-sign-row"><div>下单人：__________</div><div>送货人：__________</div><div>客户签名：__________</div><div>批准签名：__________</div></div>`
  const d = isDelivery ? ' print-meta-grid--delivery' : ''
  const statusLabel = isDelivery
    ? (order.deliveryMethod || '')
    : (ORDER_STATUSES[order.status] || order.status || '')
  return `
    <div class="${sheetClass(tpl.sheet, isDelivery)}">
      <div class="print-root__inner">
        <div class="print-header-row">
          <div>${logo}</div>
          <div class="print-order-no">NO. <span class="print-order-no__num">${escapeHtml(order.orderNo || '')}</span></div>
        </div>
        <div class="print-title${isDelivery ? ' print-title--sm print-title--delivery' : ''}">${isDelivery ? '送货单' : escapeHtml(orderDocTitle(order, s))}</div>
        ${isDelivery ? '<div class="print-delivery-sub">送货凭证 · 请当面清点货物</div>' : ''}
        <div class="print-meta-grid${d}">
          <div><span class="print-k">客户名称</span>${escapeHtml(order.customerName || '')}</div>
          <div><span class="print-k">联系人</span>${escapeHtml(order.contact || '')}</div>
          <div><span class="print-k">联系电话</span>${escapeHtml(order.phone || '')}</div>
          <div><span class="print-k">订货日期</span>${escapeHtml(order.orderDate || '')}</div>
          <div><span class="print-k">交货日期</span>${escapeHtml(order.deliveryDate || '')}</div>
          <div><span class="print-k">${isDelivery ? '交付方式' : '状态'}</span>${escapeHtml(statusLabel)}</div>
          <div class="print-meta-grid__full"><span class="print-k">${isDelivery ? '送货地址' : '客户地址'}</span>${escapeHtml(order.address || '')}</div>
        </div>
        <table class="print-table${isDelivery ? ' print-table--delivery' : ''}">
          <colgroup>${percents.map((w) => `<col style="width:${w}">`).join('')}</colgroup>
          <thead><tr>${cols.map((c) => `<th class="${printAlignClass(c)}">${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${Math.max(1, cols.length)}">无明细</td></tr>`}</tbody>
        </table>
        <div class="print-total-zh${isDelivery ? ' print-total-zh--delivery' : ''}">
          <div class="print-total-zh__label">合计（大写）</div>
          <div class="print-total-zh__text">${escapeHtml(rec ? moneyInWords(rec) : '')}</div>
          <div class="print-total-zh__num">${escapeHtml(formatMoney(rec))}</div>
        </div>
        <div class="print-finance-row${isDelivery ? ' print-finance-row--delivery' : ''}">
          <div><span class="print-k">金额合计</span>${escapeHtml(formatMoney(orderSubtotal(order)))}</div>
          <div><span class="print-k">优惠</span>${escapeHtml(formatMoney(order.discount))}</div>
          <div><span class="print-k">税率</span>${escapeHtml(String(order.taxRate || 0))}%</div>
          <div><span class="print-k">税费</span>${escapeHtml(formatMoney(orderTax(order)))}</div>
          <div><span class="print-k">预收款</span>${escapeHtml(formatMoney(order.prepay))}</div>
          <div><span class="print-k">本次付款</span>${escapeHtml(formatMoney(order.currentPayment))}</div>
          <div><span class="print-k">未结</span>${escapeHtml(formatMoney(orderBalance(order)))}</div>
          <div><span class="print-k">送货费用</span></div>
        </div>
        <div class="print-qr-row${isDelivery ? ' print-qr-row--delivery' : ''}">
          ${qr}
          <div class="print-meta-mini">${footNotes.map((n) => `<div>${n}</div>`).join('')}</div>
        </div>
        ${signs}
      </div>
    </div>
  `
}

export function printHtml(title, innerHtml, extraCss = '') {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  doc.open()
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}${extraCss}</style></head><body>${innerHtml}</body></html>`)
  doc.close()
  const run = () => {
    iframe.contentWindow.focus()
    iframe.contentWindow.print()
    setTimeout(() => iframe.remove(), 800)
  }
  if (iframe.contentDocument.readyState === 'complete') run()
  else iframe.onload = run
}

export function printOrderSheet(order, settings, templateId = 'a4-1') {
  const s = settingsOf(settings)
  const title = s.printCompanyTitle || orderDocTitle(order, s)
  printHtml(title, orderSheetHtml(order, settings, templateId))
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function waitImages(root) {
  const imgs = [...(root.querySelectorAll ? root.querySelectorAll('img') : [])]
  return Promise.all(imgs.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => resolve()
      img.addEventListener('load', done, { once: true })
      img.addEventListener('error', done, { once: true })
      setTimeout(done, 4000)
    })
  }))
}

async function withSheetElement(order, settings, templateId, existingEl, fn) {
  if (existingEl) {
    await waitImages(existingEl)
    return fn(existingEl)
  }
  const host = document.createElement('div')
  host.className = 'print-export-hidden'
  host.innerHTML = orderSheetHtml(order, settings, templateId)
  document.body.appendChild(host)
  try {
    await waitImages(host)
    return await fn(host.firstElementChild)
  } finally {
    host.remove()
  }
}

export function exportOrderExcel(order, settings) {
  const s = settingsOf(settings)
  const cols = printCols(s)
  const lines = Array.isArray(order.lines) ? order.lines : []
  const head = cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')
  const rows = lines.map((line, i) => `<tr>${cols.map((c) => `<td>${escapeHtml(String(lineCell(line, c.key, i, s, new Set(cols.map((x) => x.key)))).replace(/<[^>]+>/g, ''))}</td>`).join('')}</tr>`).join('')
  const rec = orderReceivable(order)
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>
    <h3>${escapeHtml(s.printCompanyTitle || '业务单')}</h3>
    <p>单号 ${escapeHtml(order.orderNo || '')}　客户 ${escapeHtml(order.customerName || '')}　日期 ${escapeHtml(order.orderDate || '')}</p>
    <table border="1"><tr>${head}</tr>${rows}</table>
    <p>合计 ${formatMoney(orderSubtotal(order))}　优惠 ${formatMoney(order.discount)}　应收 ${formatMoney(rec)}　大写 ${escapeHtml(moneyInWords(rec))}</p>
  </body></html>`
  downloadBlob(`${order.orderNo || '业务单'}.xls`, new Blob([html], { type: 'application/vnd.ms-excel' }))
}

export async function exportOrderJpg(order, settings, templateId = 'a4-1', sheetEl) {
  const { default: html2canvas } = await import('html2canvas')
  await withSheetElement(order, settings, templateId, sheetEl, async (el) => {
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      width: Math.max(A4_SHEET_PX.width, el.scrollWidth),
      windowWidth: A4_SHEET_PX.width
    })
    await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(`${order.orderNo || '业务单'}.jpg`, blob)
        resolve()
      }, 'image/jpeg', 0.88)
    })
  })
}

function statementPeriodText(data) {
  const from = String((data && data.from) || '').trim()
  const to = String((data && data.to) || '').trim()
  return from || to ? `${from || '起'} ~ ${to || '止'}` : '全部期间'
}

function statementCustomerLabel(data) {
  return String((data && data.customerName) || '').trim() || '当前筛选'
}

export function statementExportBasename(data) {
  const raw = String((data && data.customerName) || '').trim()
  const safe = (raw || '对账单').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40)
  return raw ? `${safe}对账单` : '对账单'
}

export const STATEMENT_EXCEL_HEADERS = ['订单日期', '单号', '材料', '内容', '规格', '数量', '单位', '面积', '单价', '金额', '样图', '备注']

export function statementSampleUrl(line) {
  const url = String((line && (line.sampleImageDataUrl || line.sampleImageUrl)) || '').trim()
  if (/^https?:\/\//i.test(url) || url.startsWith('data:image')) return url
  return ''
}

function statementLineCells(line, settings) {
  const s = settingsOf(settings)
  const unit = dimensionUnitOf(settings)
  const dimD = Number(s.dimensionDecimals) || 2
  const content = (line && (line.projectName || line.productName)) || ''
  return [
    (line && line.orderDate) || '',
    (line && line.orderNo) || '',
    (line && line.material) || '',
    content,
    specText(line, dimD, unit),
    formatQty(line && line.qty, s.qtyDecimals || 2),
    (line && line.unitLabel) || '',
    areaPrintText(line, settings),
    Number(line && line.unitPrice) ? formatMoney(line.unitPrice) : '',
    formatMoney(line && line.amount),
    '',
    (line && line.remark) || ''
  ]
}

export function statementExcelModel(data, settings) {
  const s = settingsOf(settings)
  const company = brandCompanyNameOf(s)
  const lines = Array.isArray(data && data.lines) ? data.lines : []
  const customer = statementCustomerLabel(data)
  return {
    title: company ? `${company} ${customer}对账单` : `${customer}对账单`,
    period: statementPeriodText(data),
    company,
    headers: STATEMENT_EXCEL_HEADERS,
    rows: lines.map((line) => statementLineCells(line, s)),
    sampleUrls: lines.map((line) => statementSampleUrl(line)),
    sums: {
      subtotal: data && data.subtotal,
      discount: data && data.discount,
      paid: data && data.paid,
      unpaid: data && data.unpaid,
      subtotalText: formatMoney(data && data.subtotal),
      discountText: formatMoney(data && data.discount),
      paidText: formatMoney(data && data.paid),
      unpaidText: formatMoney(data && data.unpaid)
    }
  }
}

export function statementExcelHtml(data, settings) {
  const model = statementExcelModel(data, settings)
  const rows = model.rows.map((cells) => `<tr>${cells.map((c) => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('')
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>
    <h3>${escapeHtml(model.title)}</h3>
    <p>期间 ${escapeHtml(model.period)}</p>
    <table border="1"><tr>${model.headers.map((h) => `<th>${h}</th>`).join('')}</tr>${rows}</table>
    <p>总金额 ${model.sums.subtotalText}　优惠金额 ${model.sums.discountText}　已收款 ${model.sums.paidText}　欠款 ${model.sums.unpaidText}</p>
    ${model.company ? `<p>公司名称 ${escapeHtml(model.company)}</p>` : ''}
  </body></html>`
}

function decodeDataUrl(url) {
  const m = String(url || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/i)
  if (!m) return null
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const ext = /png/i.test(m[1]) ? 'png' : /gif/i.test(m[1]) ? 'gif' : 'jpeg'
  return { bytes, ext }
}

function sampleFetchCandidates(url) {
  const list = []
  try {
    const u = new URL(url)
    if (
      typeof location !== 'undefined'
      && /cos\.ap-guangzhou\.myqcloud\.com$/i.test(u.hostname)
      && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(location.origin)
    ) {
      list.push(`${location.origin}/cos-proxy${u.pathname}${u.search}`)
    }
  } catch { /* ignore */ }
  list.push(url)
  return list
}

async function downscaleSample(bytes, ext) {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { bytes, ext }
  }
  try {
    const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }))
    const max = 240
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const width = Math.max(1, Math.round(bmp.width * scale))
    const height = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bmp, 0, 0, width, height)
    if (bmp.close) bmp.close()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) return { bytes, ext, width, height }
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'jpeg', width, height }
  } catch {
    return { bytes, ext }
  }
}

export async function loadStatementSampleImage(url) {
  const src = String(url || '').trim()
  if (!src) return null
  if (src.startsWith('data:image')) {
    const decoded = decodeDataUrl(src)
    return decoded ? downscaleSample(decoded.bytes, decoded.ext) : null
  }
  for (const href of sampleFetchCandidates(src)) {
    try {
      const res = await fetch(href)
      if (!res.ok) continue
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (!bytes.length) continue
      return downscaleSample(bytes, sniffImageExt(bytes))
    } catch { /* try next */ }
  }
  try {
    const { api } = await import('../api/client.js')
    const res = await api.proxyTuwenSampleImage(src)
    const decoded = decodeDataUrl(res && res.dataUrl)
    return decoded ? downscaleSample(decoded.bytes, decoded.ext) : null
  } catch {
    return null
  }
}

export async function exportStatementExcel(data, settings) {
  const model = statementExcelModel(data, settings)
  const images = []
  const urls = model.sampleUrls || []
  const jobs = urls.map((url, row) => url ? loadStatementSampleImage(url).then((img) => ({ row, img })) : Promise.resolve({ row, img: null }))
  const loaded = await Promise.all(jobs)
  for (const item of loaded) {
    if (item.img && item.img.bytes) images.push({ row: item.row, ...item.img })
  }
  const bytes = buildStatementXlsx(model, images)
  downloadBlob(`${statementExportBasename(data)}.xlsx`, new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }))
  return { imageCount: images.length }
}

async function withStatementSheetElement(data, settings, existingEl, fn) {
  if (existingEl) {
    await waitImages(existingEl)
    return fn(existingEl)
  }
  const host = document.createElement('div')
  host.className = 'print-export-hidden'
  host.innerHTML = statementSheetHtml(data, settings)
  document.body.appendChild(host)
  try {
    await waitImages(host)
    return await fn(host.firstElementChild)
  } finally {
    host.remove()
  }
}

export async function exportStatementJpg(data, settings, sheetEl) {
  const { default: html2canvas } = await import('html2canvas')
  await withStatementSheetElement(data, settings, sheetEl, async (el) => {
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      width: Math.max(A4_SHEET_PX.width, el.scrollWidth),
      height: Math.max(el.scrollHeight, el.offsetHeight),
      windowWidth: A4_SHEET_PX.width
    })
    await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(`${statementExportBasename(data)}.jpg`, blob)
        resolve()
      }, 'image/jpeg', 0.88)
    })
  })
}

export function statementSheetHtml(data, settings) {
  const s = settingsOf(settings)
  const company = brandCompanyNameOf(s)
  const unit = dimensionUnitOf(settings)
  const dimD = Number(s.dimensionDecimals) || 2
  const lines = Array.isArray(data.lines) ? data.lines : []
  const period = statementPeriodText(data)
  const customer = statementCustomerLabel(data)
  const rows = lines.map((line) => {
    const content = line.projectName || line.productName || ''
    return `<tr>
      <td>${escapeHtml(line.orderDate || '')}</td>
      <td>${escapeHtml(line.orderNo || '')}</td>
      <td>${escapeHtml(line.material || '')}</td>
      <td>${escapeHtml(content)}</td>
      <td>${escapeHtml(specText(line, dimD, unit))}</td>
      <td class="print-num">${escapeHtml(formatQty(line.qty, s.qtyDecimals || 2))}</td>
      <td>${escapeHtml(line.unitLabel || '')}</td>
      <td class="print-num">${escapeHtml(areaPrintText(line, settings))}</td>
      <td class="print-num">${Number(line.unitPrice) ? formatMoney(line.unitPrice) : ''}</td>
      <td class="print-num">${formatMoney(line.amount)}</td>
      <td class="print-sample">${sampleHtml(line)}</td>
      <td>${escapeHtml(line.remark || '')}</td>
    </tr>`
  }).join('')
  return `
    <div class="print-sheet print-sheet--full print-statement">
      <div class="print-statement__head">
        <div class="print-statement__period">${escapeHtml(period)}</div>
        <div class="print-title print-title--sm">${escapeHtml(customer)} 对账单</div>
      </div>
      <table class="print-table print-statement__table">
        <colgroup>
          <col style="width:9%"><col style="width:11%"><col style="width:9%"><col style="width:11%">
          <col style="width:8%"><col style="width:6%"><col style="width:6%"><col style="width:6%">
          <col style="width:7%"><col style="width:8%"><col style="width:10%"><col style="width:9%">
        </colgroup>
        <thead><tr>
          <th>订单日期</th><th>单号</th><th>材料</th><th>内容</th><th>规格</th>
          <th>数量</th><th>单位</th><th>面积</th><th>单价</th><th>金额</th><th>样图</th><th>备注</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="12">无明细</td></tr>'}</tbody>
      </table>
      <div class="print-statement__sum">
        <span>总金额 ${formatMoney(data.subtotal)}</span>
        <span>优惠金额 ${formatMoney(data.discount)}</span>
        <span>已收款 ${formatMoney(data.paid)}</span>
        <span class="is-due">欠款 ${formatMoney(data.unpaid)}</span>
      </div>
      ${company ? `<div class="print-statement__foot"><div>公司名称 ${escapeHtml(company)}</div></div>` : ''}
    </div>
  `
}

export function printStatementSheet(data, settings) {
  const s = settingsOf(settings)
  const company = brandCompanyNameOf(s)
  printHtml(company ? `${company}对账单` : '对账单', statementSheetHtml(data, settings))
}

export function printAfterSaleSheet(row, settings) {
  const s = settingsOf(settings)
  const company = brandCompanyNameOf(s)
  const title = company ? `${company}工程质量保修单` : '工程质量保修单'
  printHtml(title, `
    <div class="print-sheet print-sheet--full">
      <div class="print-title">${escapeHtml(title)}</div>
      <div class="print-meta-grid">
        <div><span class="print-k">工单</span>${escapeHtml(row.ticketNo || '')}</div>
        <div><span class="print-k">登记</span>${escapeHtml(row.registeredAt || '')}</div>
        <div><span class="print-k">关联订单</span>${escapeHtml(row.orderNo || '')}</div>
        <div><span class="print-k">客户</span>${escapeHtml(row.customerName || '')}</div>
        <div><span class="print-k">电话</span>${escapeHtml(row.phone || '')}</div>
        <div class="print-meta-grid__full"><span class="print-k">工程地址</span>${escapeHtml(row.projectAddress || row.address || '')}</div>
      </div>
      <table class="print-table">
        <tbody>
          <tr><th>问题类型</th><td>${escapeHtml(row.issueType || '')}</td><th>跟进人</th><td>${escapeHtml(row.assignee || '')}</td></tr>
          <tr><th>问题摘要</th><td colspan="3">${escapeHtml(row.summary || '')}</td></tr>
          <tr><th>保修起</th><td>${escapeHtml(row.warrantyFrom || '')}</td><th>保修止</th><td>${escapeHtml(row.warrantyTo || '')}</td></tr>
          <tr><th>印刷备注</th><td colspan="3">${escapeHtml(row.printNote || '')}</td></tr>
        </tbody>
      </table>
    </div>
  `)
}

function quoteCompanyName(settings, plan) {
  return quoteCompanyOf(plan, settings)
}

function quoteDocTitleText(plan, spaced) {
  const title = quoteDocTitleOf(plan)
  if (spaced && title === '报价单') return '报　价　单'
  return title
}

function quoteProjectLabel(line) {
  return stripQuoteSeeFigure(String(line && (line.projectName || line.productName) || '').trim()) || '—'
}

function quoteLogoHtml(settings, company) {
  const s = settingsOf(settings)
  const brand = String(s.brandCompanyName || '').trim()
  if (company && brand && company !== brand) return ''
  if (s.showPrintLogo && s.printLogoDataUrl) {
    return `<img src="${escapeHtml(s.printLogoDataUrl)}" alt="" class="print-logo">`
  }
  return ''
}

function quoteItemsTable(order, plan, settings) {
  const lines = quoteLinesOf(order, plan)
  const unit = dimensionUnitOf(settings)
  const rows = lines.map((line, i) => {
    return `<tr>
      <td class="print-num">${i + 1}</td>
      <td class="print-project">${escapeHtml(quoteProjectLabel(line))}</td>
      <td>${escapeHtml(stripQuoteSeeFigure(specText(line, 2, unit)))}</td>
      <td class="print-material">${escapeHtml(stripQuoteSeeFigure(line.material || ''))}</td>
      <td class="print-num">${escapeHtml(formatQty(line.qty, 2))}</td>
      <td class="print-unit">${escapeHtml(line.unitLabel || '')}</td>
      <td class="print-num">${Number(line.unitPrice) ? formatMoney(line.unitPrice) : ''}</td>
      <td class="print-num">${formatMoney(lineAmount(line))}</td>
    </tr>`
  }).join('')
  return `<table class="print-table">
    <colgroup>
      <col style="width:8%"><col style="width:22%"><col style="width:16%"><col style="width:14%">
      <col style="width:10%"><col style="width:8%"><col style="width:11%"><col style="width:11%">
    </colgroup>
    <thead><tr>
      <th>序号</th><th>项目</th><th>规格</th><th>材质</th><th>数量</th><th>单位</th><th>单价</th><th>金额</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="8">无明细</td></tr>'}</tbody>
  </table>`
}

function quotePriceBlock(order, plan) {
  const resolved = resolveQuotePlan(order, plan)
  const note = resolved.note ? `<div class="print-meta-grid__full"><span class="print-k">备注</span>${escapeHtml(resolved.note)}</div>` : ''
  return `
    <div class="qsheet__price">
      <span>合计</span><b>${formatMoney(resolved.total)}</b>
      <span>大写</span><span>${escapeHtml(moneyInWords(resolved.total))}</span>
      ${note}
    </div>
  `
}

function quotePlanBody(order, settings, plan) {
  const company = quoteCompanyName(settings, plan)
  const logo = quoteLogoHtml(settings, company)
  const inner = `${quoteItemsTable(order, plan, settings)}${quotePriceBlock(order, plan)}`
  const def = QUOTE_PLAN_DEFAULTS.find((d) => d.id === plan.id) || QUOTE_PLAN_DEFAULTS[0]
  if (def.styleId === 'formal') {
    return `<div class="print-sheet print-sheet--full qsheet qsheet--formal">
      <div class="qsheet-formal__frame">
        ${logo}
        ${company ? `<div class="qsheet-formal__co">${escapeHtml(company)}</div>` : ''}
        <div class="qsheet-formal__doc">${escapeHtml(quoteDocTitleText(plan, true))}</div>
        ${inner}
      </div>
    </div>`
  }
  if (def.styleId === 'modern') {
    return `<div class="print-sheet print-sheet--full qsheet qsheet--modern">
      <div class="qsheet-modern__rail"></div>
      <div class="qsheet-modern__body">
        <div class="qsheet-modern__head">
          <div>
            ${logo}
            ${company ? `<div class="qsheet-modern__co">${escapeHtml(company)}</div>` : ''}
            <div class="qsheet-modern__doc">${escapeHtml(quoteDocTitleText(plan))}</div>
          </div>
        </div>
        ${inner}
      </div>
    </div>`
  }
  return `<div class="print-sheet print-sheet--full qsheet qsheet--classic">
    <div class="qsheet-classic__bar">
      <div>${logo}${company ? `<div class="qsheet-classic__co">${escapeHtml(company)}</div>` : ''}</div>
      <div class="qsheet-classic__doc">${escapeHtml(quoteDocTitleText(plan))}</div>
    </div>
    ${inner}
  </div>`
}

export function quotePlanSheetHtml(order, settings, planIndex = 0) {
  const plans = normalizeQuotePlans(order && order.quotePlans)
  const idx = Math.max(0, Math.min(plans.length - 1, Number(planIndex) || 0))
  return quotePlanBody(order, settings, plans[idx])
}

export function quoteCompareSheetHtml(order, settings) {
  const company = quoteCompanyName(settings)
  const logo = quoteLogoHtml(settings, company)
  const plans = normalizeQuotePlans(order && order.quotePlans)
  const cards = plans.map((plan, i) => {
    const def = QUOTE_PLAN_DEFAULTS[i] || QUOTE_PLAN_DEFAULTS[0]
    const resolved = resolveQuotePlan(order, plan)
    const letterhead = quoteCompanyName(settings, plan)
    return `<div class="qsheet-compare__card qsheet-compare__card--${def.styleId}">
      <b>${escapeHtml(resolved.name)}</b>
      ${letterhead ? `<div>抬头：${escapeHtml(letterhead)}</div>` : ''}
      <div>版式：${escapeHtml(def.styleLabel)}</div>
      <div>单价：${formatMoney(resolved.unitPrice)}</div>
      <div>报价：<strong>${formatMoney(resolved.total)}</strong></div>
      <div>大写：${escapeHtml(moneyInWords(resolved.total))}</div>
      ${resolved.note ? `<div>说明：${escapeHtml(resolved.note)}</div>` : ''}
    </div>`
  }).join('')
  const lines = contentLines(order && order.lines)
  const rows = lines.map((line, i) => `<tr>
    <td class="print-num">${i + 1}</td>
    <td>${escapeHtml(quoteProjectLabel(line))}</td>
    <td>${escapeHtml(stripQuoteSeeFigure(specText(line, 2)))}</td>
    <td>${escapeHtml(stripQuoteSeeFigure(line.material || ''))}</td>
    <td class="print-num">${escapeHtml(formatQty(line.qty, 2))}</td>
    <td class="print-unit">${escapeHtml(line.unitLabel || '')}</td>
  </tr>`).join('')
  return `<div class="print-sheet print-sheet--full qsheet qsheet--compare">
    ${logo}
    ${company ? `<div class="print-company">${escapeHtml(company)}</div>` : ''}
    <div class="qsheet-compare__title">内部方案对照表</div>
    <table class="print-table">
      <thead><tr><th>序号</th><th>项目</th><th>规格</th><th>材质</th><th>数量</th><th>单位</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">无明细</td></tr>'}</tbody>
    </table>
    <div class="qsheet-compare__grid">${cards}</div>
  </div>`
}

export function quotePreviewHtml(order, settings, view = 'compare') {
  if (view === 'compare') return quoteCompareSheetHtml(order, settings)
  return quotePlanSheetHtml(order, settings, view)
}

export function printQuoteView(order, settings, view = 'compare') {
  const plans = normalizeQuotePlans(order && order.quotePlans)
  const plan = view === 'compare' ? null : plans[Math.max(0, Math.min(plans.length - 1, Number(view) || 0))]
  const company = quoteCompanyName(settings, plan)
  const title = view === 'compare'
    ? `${company || ''}内部方案对照表`
    : `${company || ''}${quoteDocTitleOf(plan)}`
  printHtml(title, quotePreviewHtml(order, settings, view))
}
