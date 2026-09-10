import { getOrg } from './org.js'

const HOME_KEYWORD_KEY = 'preaudit_home_keyword'
let memoryKeyword = ''

function textOf(value) {
  if (value == null) return ''
  return String(value).trim()
}

export function readHomeKeyword() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      return String(sessionStorage.getItem(HOME_KEYWORD_KEY) || '')
    }
  } catch (e) { /* ignore */ }
  return memoryKeyword
}

export function writeHomeKeyword(value) {
  memoryKeyword = String(value || '')
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(HOME_KEYWORD_KEY, memoryKeyword)
    }
  } catch (e) { /* ignore */ }
}

export function projectSearchTokens(keyword) {
  return textOf(keyword).toLowerCase().split(/\s+/).filter(Boolean)
}

export function projectSearchHaystack(item) {
  if (!item) return ''
  const org = getOrg(item.orgType)
  return [
    item.name,
    item.village,
    item.year,
    item.contractor,
    item.notes,
    item.partnerVillage,
    item.orgName,
    org.name,
    org.title,
    org.short,
    item.amountText,
    item.bidDateText,
    item.status,
    item.done ? '已完成' : '进行中',
    item.jointBid ? '两村打包' : ''
  ].map(textOf).join('\n').toLowerCase()
}

export function matchesProjectKeyword(item, keyword) {
  const tokens = projectSearchTokens(keyword)
  if (!tokens.length) return true
  const hay = projectSearchHaystack(item)
  return tokens.every((token) => hay.includes(token))
}

export function filterProjectsByKeyword(items, keyword) {
  return (items || []).filter((item) => matchesProjectKeyword(item, keyword))
}
