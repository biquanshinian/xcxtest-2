import * as date from './date.js'
import * as format from './format.js'

export function typingInField() {
  if (typeof document === 'undefined') return false
  const el = document.activeElement
  if (!el) return false
  const tag = String(el.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable
}

export function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function clampPercent(done, total) {
  if (!total) return 0
  let p = Math.round((done / total) * 100)
  if (p < 0) return 0
  if (p > 100) return 100
  return p
}

export const parseDate = date.parseDate
export const formatDate = date.formatDate
export const today = date.today
export const addDays = date.addDays
export const compare = date.compare
export const lte = date.lte
export const lt = date.lt
export const inRangeInclusive = date.inRangeInclusive
export const noticeEnd = date.noticeEnd
export const inclusiveDayCount = date.inclusiveDayCount
export const formatMoney = format.formatMoney
export const parseMoney = format.parseMoney
export const moneyClose = format.moneyClose
export const absDiff = format.absDiff
export const yearOptions = format.yearOptions
export const displayMoney = format.displayMoney
