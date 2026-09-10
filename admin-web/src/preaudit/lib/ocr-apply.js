import { formatAmountField, summarizeParsed } from './ocr-parse.js'

export function isPlaceholderName(name) {
  const s = String(name || '').trim()
  return !s || s === '待认项目' || s === '未命名预审'
}

export function applyParsed(current, parsed, fields, noticeDays) {
  const next = {}
  const filled = []
  const skipped = []
  const want = fields || []
  const empty = (v) => v == null || v === ''

  if (want.includes('date') && parsed.date) {
    if (empty(current.date)) {
      next.date = parsed.date
      filled.push('日期')
    } else skipped.push('日期')
  }
  if (want.includes('startDate') || want.includes('endDate')) {
    const start = parsed.startDate || ''
    const end = parsed.endDate || ''
    if (want.includes('startDate') && start) {
      if (empty(current.startDate)) {
        next.startDate = start
        filled.push('起始日')
      } else skipped.push('起始日')
    }
    if (want.includes('endDate') && end) {
      if (empty(current.endDate)) {
        next.endDate = end
        filled.push('截止日')
      } else skipped.push('截止日')
    }
  }
  if (want.includes('amount') && parsed.amount != null) {
    if (empty(current.amount) && current.amount !== 0) {
      next.amount = formatAmountField(parsed.amount)
      filled.push('金额')
    } else skipped.push('金额')
  }
  if (want.includes('contractor') && parsed.contractor) {
    if (empty(current.contractor)) {
      next.contractor = String(parsed.contractor).slice(0, 40)
      filled.push('单位名称')
    } else skipped.push('单位名称')
  }
  const shown = Object.assign({}, parsed)
  if (!want.includes('amount')) delete shown.amount
  return { next, filled, skipped, summary: summarizeParsed(shown) }
}

export function pickBetterText(cloud, local) {
  if (isPlaceholderName(cloud) && !isPlaceholderName(local)) return local
  if (cloud) return cloud
  return local
}
