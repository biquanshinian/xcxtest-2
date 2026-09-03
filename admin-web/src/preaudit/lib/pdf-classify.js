import { getItems } from './checklist.js'

const RULES = [
  { id: 'bid_notice', weight: 14, words: ['中标通知书', '成交通知书', '中标通知', '成交通知', '成交供应商'], exclude: ['评审报告', '评标报告'] },
  { id: 'invoices', weight: 14, words: ['增值税专用发票', '增值税普通发票', '发票代码', '发票号码', '价税合计', '校验码'] },
  { id: 'contract', weight: 12, words: ['合同编号', '本合同', '发包方', '承包方', '合同金额', '施工合同', '采购合同'], exclude: ['中标通知', '成交通知', '仅供报账彩打'] },
  { id: 'contract_watermark', weight: 16, words: ['仅供报账彩打', '报账水印'] },
  { id: 'license', weight: 12, words: ['营业执照'], exclude: ['发票代码', '价税合计', '增值税'] },
  { id: 'bank_account', weight: 12, words: ['开户许可证', '基本存款账户'] },
  { id: 'legal_id', weight: 12, words: ['居民身份证', '公民身份号码', '签发机关'] },
  { id: 'review_report', weight: 12, words: ['评审报告', '评标报告', '评标委员会'] },
  { id: 'responses', weight: 10, words: ['响应文件', '投标文件', '投标函', '投标人'] },
  { id: 'zbj_procurement', weight: 10, words: ['采购文件', '招标文件', '招标公告', '采购公告'] },
  { id: 'notice_plan', weight: 12, words: ['实施方案公示', '方案公示'], exclude: ['实施结果公示', '实施结果公开', '决议公示'] },
  { id: 'notice_resolution', weight: 12, words: ['使用决议公示', '决议公示'], exclude: ['实施结果公示', '实施结果公开'] },
  { id: 'minutes_villagers', weight: 12, words: ['村民代表会议', '村民代表决议'] },
  { id: 'minutes_party_members', weight: 12, words: ['党员大会审议', '党员大会'] },
  { id: 'minutes_two_committees', weight: 12, words: ['村两委商议', '两委商议', '村两委会议'] },
  { id: 'minutes_party', weight: 12, words: ['党支部提议'] },
  { id: 'fund_briefing', weight: 12, words: ['专题会议简报', '经费使用专题会议'] },
  { id: 'fund_record', weight: 10, words: ['上会专题会议记录', '专题会议记录', '签到表'], exclude: ['中标通知', '成交通知', '发票代码', '合同编号'] },
  { id: 'approval_form', weight: 10, words: ['项目审批表'], exclude: ['合同编号', '发票代码', '中标通知', '成交通知', '营业执照'] },
  { id: 'township_request', weight: 12, words: ['请示批复文件', '乡政府请示批复'] },
  { id: 'zbj_request', weight: 12, words: ['发布招标信息请示', '八戒网发布'] },
  { id: 'township_approval', weight: 12, words: ['同意发布批复', '同意发布招标'] },
  { id: 'construction_plan', weight: 10, words: ['施工方案', '施工组织设计'] },
  { id: 'photo_before', weight: 10, words: ['施工前现场', '施工前照片'] },
  { id: 'photo_during', weight: 10, words: ['施工中现场', '施工中照片'] },
  { id: 'photo_after', weight: 10, words: ['施工后现场', '施工后照片', '竣工现场'] },
  { id: 'accept_sheet', weight: 14, words: ['验收单', '竣工验收单', '工程验收单', '验收报告'], exclude: ['验收照片', '施工前现场', '施工中现场'] },
  { id: 'photo_accept', weight: 10, words: ['现场验收', '验收照片', '验收纪要'], exclude: ['验收单', '竣工验收单'] },
  { id: 'impl_plan', weight: 10, words: ['使用实施方案'], exclude: ['公示'] },
  { id: 'township_letter', weight: 10, words: ['关于乡政府的请示', '乡政府请示'] },
  { id: 'quote_sheet', weight: 10, words: ['报价表', '报价合计'] },
  { id: 'meeting_signin', weight: 10, words: ['会议签到', '签到表'] },
  { id: 'meeting_minutes', weight: 8, words: ['会议纪要'] },
  { id: 'result_public', weight: 12, words: ['实施结果公开', '实施结果公示', '结果公开', '结果公示'], exclude: ['决议公示'] },
  { id: 'budget_quote', weight: 12, words: ['预算金额报价', '预算报价'] },
  { id: 'compare_sheet', weight: 12, words: ['比价清单', '三家比价', '比价表', '手写最低价', '最低价清单', '最低价'] }
]

const PATTERNS = [
  { id: 'invoices', re: /发票代码\s*\d{8,}|密码区|价税合计[（(]小写/, w: 16 },
  { id: 'legal_id', re: /公民身份号码\s*\d{15,18}|签发机关/, w: 14 },
  { id: 'license', re: /统一社会信用代码\s*[0-9A-Z]{15,18}/, w: 10, exclude: /发票代码|价税合计/ },
  { id: 'bank_account', re: /基本存款账户|开户许可证/, w: 12 },
  { id: 'bid_notice', re: /中标通知书|成交通知书/, w: 16 },
  { id: 'notice_resolution', re: /决议公示|使用决议公示/, w: 10, exclude: /实施结果公示|实施结果公开/ },
  { id: 'notice_plan', re: /实施方案公示/, w: 12, exclude: /实施结果公示|实施结果公开|决议公示/ },
  { id: 'result_public', re: /实施结果公示|实施结果公开|结果公示/, w: 12, exclude: /决议公示/ },
  { id: 'contract', re: /合同编号|本合同一式/, w: 12, exclude: /中标通知|成交通知/ },
  { id: 'accept_sheet', re: /验收单|竣工验收单|工程验收单/, w: 16, exclude: /验收照片/ }
]

const PHOTO_IDS = ['photo_before', 'photo_during', 'photo_after', 'photo_accept']
const STRONG = 8
const MEDIUM = 5
const SPARSE_LEN = 20
const COMBOS = [
  { id: 'notice_resolution', all: ['决议公示', '实施方案公示'], w: 28 },
  { id: 'result_public', all: ['实施方案公示'], any: ['实施结果公示', '实施结果公开'], w: 28 }
]

function compact(text) {
  return String(text || '').replace(/\s+/g, '')
}

export function isSparseText(text) {
  return compact(text).length < SPARSE_LEN
}

export function pickSparseOcrPages(pages, maxCount) {
  const limit = Math.max(0, Number(maxCount) || 0)
  const sparse = (pages || []).filter((page) => page && !page.engine && isSparseText(page.text))
  if (!sparse.length || !limit) return []
  if (sparse.length <= limit) return sparse.slice()
  const chosen = []
  const seen = Object.create(null)
  function add(page) {
    if (!page || seen[page.index] || chosen.length >= limit) return
    seen[page.index] = true
    chosen.push(page)
  }
  if (limit === 1) {
    add(sparse[0])
  } else {
    for (let i = 0; i < limit; i++) {
      add(sparse[Math.round(i * (sparse.length - 1) / (limit - 1))])
    }
  }
  for (let i = 0; i < sparse.length && chosen.length < limit; i++) add(sparse[i])
  chosen.sort((a, b) => (a.index || 0) - (b.index || 0))
  return chosen
}

function allowedIds(orgType) {
  return getItems(orgType).map((item) => item.id)
}

export function isSkipText(text) {
  const src = compact(text)
  if (src.length < 4) return true
  const cover = /^(目录|封面|卷宗封面|资料汇编|材料目录|附件目录|归档目录)/.test(src)
  const toc = /目录/.test(src.slice(0, 8)) && src.length < 100
  if (!cover && !toc) return false
  const hasDoc = /中标通知|成交通知|合同编号|发票代码|项目审批表|决议公示|营业执照|党支部提议/.test(src)
  const hasBody = /项目名称|成交供应商|中标人|价税合计|合同金额|发包方|公示期/.test(src)
  if (hasDoc && (hasBody || src.length > 40)) return false
  return true
}

export function isNewDocHint(text) {
  const head = compact(text).slice(0, 48)
  return /通知书|合同书|审批表|公示|发票|营业执照|身份证|签到表|纪要|报告|请示|批复|比价|最低价|验收单/.test(head)
}

function secondBest(scores, best) {
  let id = ''
  let score = 0
  Object.keys(scores).forEach((key) => {
    if (key === best) return
    if (scores[key] > score) {
      id = key
      score = scores[key]
    }
  })
  return { id, score }
}

export function scorePage(text, orgType) {
  const src = compact(text)
  const allow = allowedIds(orgType)
  const scores = {}
  allow.forEach((id) => { scores[id] = 0 })
  RULES.forEach((rule) => {
    if (!Object.prototype.hasOwnProperty.call(scores, rule.id)) return
    if (rule.exclude && rule.exclude.some((w) => src.indexOf(w) >= 0)) return
    let hit = 0
    ;(rule.words || []).forEach((word) => {
      if (src.indexOf(word) >= 0) hit += 1
    })
    if (hit) scores[rule.id] += hit * (rule.weight || 4)
  })
  PATTERNS.forEach((rule) => {
    if (!Object.prototype.hasOwnProperty.call(scores, rule.id)) return
    if (rule.exclude && rule.exclude.test(src)) return
    if (rule.re.test(src)) scores[rule.id] += rule.w
  })
  COMBOS.forEach((rule) => {
    if (!Object.prototype.hasOwnProperty.call(scores, rule.id)) return
    const allOk = !(rule.all || []).some((word) => src.indexOf(word) < 0)
    const anyOk = !rule.any || rule.any.some((word) => src.indexOf(word) >= 0)
    if (allOk && anyOk) scores[rule.id] += rule.w
  })
  let best = ''
  let bestScore = 0
  Object.keys(scores).forEach((id) => {
    if (scores[id] > bestScore) {
      best = id
      bestScore = scores[id]
    }
  })
  const runner = secondBest(scores, best)
  return {
    scores,
    best,
    bestScore,
    second: runner.id,
    secondScore: runner.score,
    textLen: src.length,
    ambiguous: bestScore >= STRONG && runner.score >= STRONG && bestScore - runner.score < 4
  }
}

export function classifyPage(text, orgType) {
  if (isSkipText(text)) return { id: '', score: 0, source: 'skip' }
  const ranked = scorePage(text, orgType)
  if (ranked.bestScore >= STRONG && !ranked.ambiguous) {
    return { id: ranked.best, score: ranked.bestScore, source: 'keyword' }
  }
  if (ranked.bestScore >= STRONG && ranked.ambiguous) {
    return { id: ranked.best, score: ranked.bestScore, source: 'keyword' }
  }
  if (ranked.bestScore >= MEDIUM) {
    return { id: ranked.best, score: ranked.bestScore, source: 'medium' }
  }
  return { id: '', score: ranked.bestScore, source: 'none' }
}

export function isPhotoLike(text, classified) {
  if (classified && classified.score >= STRONG && PHOTO_IDS.indexOf(classified.id) < 0) return false
  return compact(text).length < 18
}

export function pickPhotoSlot(orgType, counts) {
  const allow = allowedIds(orgType)
  for (let i = 0; i < PHOTO_IDS.length; i++) {
    const id = PHOTO_IDS[i]
    if (allow.indexOf(id) < 0) continue
    if ((counts[id] || 0) < 1) return id
  }
  if (allow.indexOf('photo_after') >= 0) return 'photo_after'
  return ''
}

export function defaultFirstItem(orgType) {
  const items = getItems(orgType)
  return (items[0] && items[0].id) || ''
}

function confidentId(row) {
  return row.id && row.source !== 'continue' && row.source !== 'photo' ? row.id : ''
}

function assignedId(row) {
  return (row && row.id) || ''
}

function nearestAssignedIndex(rows, idx, dir) {
  for (let i = idx + dir; i >= 0 && i < rows.length; i += dir) {
    if (rows[i].source === 'skip') continue
    if (rows[i].id) return i
  }
  return -1
}

function canFillBookend(rows, leftIdx, rightIdx, itemId) {
  if (rightIdx - leftIdx > 12) return false
  for (let j = leftIdx + 1; j < rightIdx; j++) {
    const row = rows[j]
    if (row.source === 'skip') continue
    if (row.id && row.id !== itemId) return false
    if (isNewDocHint(row.page && row.page.text)) return false
    const best = row.ranked && row.ranked.best
    const bestScore = row.ranked && row.ranked.bestScore
    if (best && best !== itemId && bestScore >= MEDIUM) return false
  }
  return true
}

export function assignPages(pages, orgType) {
  const list = Array.isArray(pages) ? pages : []
  const rows = list.map((page) => {
    const bookmark = String((page && page.bookmark) || '').trim()
    const body = String((page && page.text) || '')
    const ranked = scorePage(bookmark ? bookmark + '\n' + body : body, orgType)
    if (bookmark) {
      const mark = scorePage(bookmark, orgType)
      if (mark.bestScore >= STRONG && mark.bestScore >= ranked.bestScore) {
        ranked.best = mark.best
        ranked.bestScore = mark.bestScore + 20
        ranked.ambiguous = false
        ranked.source = 'bookmark'
      }
    }
    return {
      page,
      ranked,
      id: '',
      source: ''
    }
  })

  rows.forEach((row) => {
    const bookmarkStrong = row.ranked.source === 'bookmark' && row.ranked.bestScore >= STRONG
    if (isSkipText(row.page && row.page.text) && !bookmarkStrong) {
      row.source = 'skip'
      return
    }
    if (row.ranked.bestScore >= MEDIUM && row.ranked.best) {
      row.id = row.ranked.best
      row.source = row.ranked.source || (row.ranked.bestScore >= STRONG ? 'keyword' : 'medium')
    }
  })

  rows.forEach((row, idx) => {
    if (row.id || row.source === 'skip') return
    const leftIdx = nearestAssignedIndex(rows, idx, -1)
    const rightIdx = nearestAssignedIndex(rows, idx, 1)
    if (leftIdx < 0 || rightIdx < 0) return
    const itemId = rows[leftIdx].id
    if (!itemId || itemId !== rows[rightIdx].id) return
    if (!canFillBookend(rows, leftIdx, rightIdx, itemId)) return
    row.id = itemId
    row.source = 'continue'
  })

  let changed = true
  let guard = 0
  while (changed && guard < 6) {
    changed = false
    guard += 1
    rows.forEach((row, idx) => {
      if (row.id || row.source === 'skip') return
      const leftA = assignedId(rows[idx - 1])
      const rightA = assignedId(rows[idx + 1])
      const left = confidentId(rows[idx - 1] || {})
      const right = confidentId(rows[idx + 1] || {})
      const scores = row.ranked.scores || {}
      if (leftA && rightA && leftA === rightA) {
        if (isNewDocHint(row.page && row.page.text) && (scores[leftA] || 0) < 3) return
        if (row.ranked.best && row.ranked.best !== leftA && row.ranked.bestScore >= MEDIUM) return
        row.id = leftA
        row.source = 'continue'
        changed = true
        return
      }
      if (left && right && left !== right) {
        const sL = scores[left] || 0
        const sR = scores[right] || 0
        if (sL >= 3 && sL > sR) {
          row.id = left
          row.source = 'continue'
          changed = true
        } else if (sR >= 3 && sR > sL) {
          row.id = right
          row.source = 'continue'
          changed = true
        }
        return
      }
      const only = left || right
      if (!only) return
      if (isNewDocHint(row.page && row.page.text) && (scores[only] || 0) < 3) return
      if ((scores[only] || 0) >= 1) {
        row.id = only
        row.source = 'continue'
        changed = true
      }
    })
  }

  const hasPhoto = rows.some((row) => PHOTO_IDS.indexOf(row.id) >= 0)
  const counts = {}
  rows.forEach((row) => {
    if (row.id) counts[row.id] = (counts[row.id] || 0) + 1
  })
  if (hasPhoto) {
    rows.forEach((row) => {
      if (row.id || row.source === 'skip') return
      if (!isPhotoLike(row.page && row.page.text, { id: row.ranked.best, score: row.ranked.bestScore })) return
      const slot = pickPhotoSlot(orgType, counts)
      if (!slot) return
      row.id = slot
      row.source = 'photo'
      counts[slot] = (counts[slot] || 0) + 1
    })
  }

  return rows.map((row) => ({
    index: row.page && row.page.index,
    itemId: row.id || '',
    source: row.source || 'none',
    score: row.ranked.bestScore
  }))
}
