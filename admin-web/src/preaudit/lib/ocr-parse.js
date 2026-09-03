const DATE_RE = /((?:19|20)\d{2})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\s*日?/g
const COMPACT_DATE_RE = /((?:19|20)\d{2})(\d{2})(\d{2})/g
const RANGE_RE = /(?:自|从|起)\s*([^\n]{0,18}?)(?:至|到|止)\s*([^\n]{0,18})/g

const AMOUNT_KEYWORD = /价税合计|合计金额|总金额|总价|合同金额|中标(?:价|金额)|成交(?:价|金额)|报价合计|验收金额|验收合计|申请资金|申请金额|请示金额|资金总额|资金合计|含税合计|小写|人民币/
const AMOUNT_NEAR = /合计|金额|价款|报价|标价|验收|资金|请示/
const STRONG_TOTAL_LABEL = /价税合计|合计金额|总金额|总价|合同金额|中标(?:价|金额)|成交(?:价|金额)|报价合计|验收金额|验收合计|申请资金|申请金额|请示金额|资金总额|资金合计|含税合计/
const TOTAL_AMOUNT_LABEL = /价税合计|合计金额|总金额|总价|合同金额|中标(?:价|金额)|成交(?:价|金额)|报价合计|验收金额|验收合计|申请资金|申请金额|请示金额|资金总额|资金合计|含税合计|(?:^|[^小预])合计|总计|总额|价税/
const SKIP_AMOUNT_CONTEXT = /发票代码|发票号码|校验码|纳税人识别|密码区|第\s*\d+\s*联|电话|手机|邮编/
const QTY_AMOUNT_CONTEXT = /数量|单价|规格型号|页码|第\s*\d+\s*页/
const DEPOSIT_AMOUNT_CONTEXT = /保证金|押金|质保金|违约金|滞纳金|罚款/

const CN_DIGIT = {
  零: 0, 〇: 0, 壹: 1, 贰: 2, 两: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9,
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
}
const CN_UNIT = { 拾: 10, 十: 10, 佰: 100, 百: 100, 仟: 1000, 千: 1000 }

function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

function validYmd(y, m, d) {
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  if (year < 1990 || year > 2040 || month < 1 || month > 12 || day < 1 || day > 31) return ''
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return ''
  return year + '-' + pad(month) + '-' + pad(day)
}

function unique(list) {
  const seen = Object.create(null)
  const out = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (!item || seen[item]) continue
    seen[item] = true
    out.push(item)
  }
  return out
}

function lineOf(text, index) {
  const start = text.lastIndexOf('\n', index)
  const end = text.indexOf('\n', index)
  return text.slice(start + 1, end === -1 ? text.length : end)
}

function prevLineOf(text, index) {
  const src = String(text || '')
  const start = src.lastIndexOf('\n', index)
  if (start <= 0) return ''
  const prevStart = src.lastIndexOf('\n', start - 1)
  return src.slice(prevStart + 1, start)
}

function lineHasOwnLabel(line) {
  return STRONG_TOTAL_LABEL.test(line) || TOTAL_AMOUNT_LABEL.test(line) || AMOUNT_KEYWORD.test(line) || AMOUNT_NEAR.test(line) || /预算/.test(line)
}

function labelContext(hit, text) {
  const line = lineOf(text, hit.index)
  if (lineHasOwnLabel(line)) return line
  const prev = prevLineOf(text, hit.index)
  if (!prev || /\d/.test(prev)) return line
  if (STRONG_TOTAL_LABEL.test(prev) || TOTAL_AMOUNT_LABEL.test(prev)) return prev + '\n' + line
  return line
}

function compactIndexToRaw(raw, compactIndex) {
  let seen = 0
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) continue
    if (seen === compactIndex) return i
    seen += 1
  }
  return raw.length
}

export function extractDates(text) {
  const src = String(text || '')
  const found = []
  DATE_RE.lastIndex = 0
  let m
  while ((m = DATE_RE.exec(src))) {
    const iso = validYmd(m[1], m[2], m[3])
    if (iso) found.push({ iso, index: m.index, raw: m[0] })
  }
  COMPACT_DATE_RE.lastIndex = 0
  while ((m = COMPACT_DATE_RE.exec(src))) {
    const around = src.slice(Math.max(0, m.index - 1), m.index + m[0].length + 1)
    if (/[0-9]/.test(around[0] || '') || /[0-9]/.test(around[around.length - 1] || '')) continue
    const iso = validYmd(m[1], m[2], m[3])
    if (iso) found.push({ iso, index: m.index, raw: m[0] })
  }
  const cnDates = extractChineseDates(src)
  for (let i = 0; i < cnDates.length; i++) found.push(cnDates[i])
  return found
}

const CN_YEAR_DIGIT = { 零: '0', 〇: '0', 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' }
const CN_DATE_RE = /([〇零一二三四五六七八九]{4})\s*年\s*([〇零一二三四五六七八九十]+)\s*月\s*([〇零一二三四五六七八九十]+)\s*日?/g

function chineseYearToArabic(raw) {
  let out = ''
  const s = String(raw || '')
  for (let i = 0; i < s.length; i++) {
    const d = CN_YEAR_DIGIT[s[i]]
    if (d == null) return ''
    out += d
  }
  return out.length === 4 ? out : ''
}

function extractChineseDates(src) {
  const found = []
  CN_DATE_RE.lastIndex = 0
  let m
  while ((m = CN_DATE_RE.exec(src))) {
    const year = chineseYearToArabic(m[1])
    if (!year) continue
    const iso = validYmd(year, sectionToNumber(m[2]), sectionToNumber(m[3]))
    if (iso) found.push({ iso, index: m.index, raw: m[0] })
  }
  return found
}

const NOISE_DATE_LINE = /有效期|出生|成立|注册|身份证|证号|年满/

export function documentDates(text) {
  const src = String(text || '')
  const found = extractDates(src)
  const kept = []
  for (let i = 0; i < found.length; i++) {
    const hit = found[i]
    const line = lineOf(src, hit.index)
    if (NOISE_DATE_LINE.test(line)) continue
    kept.push(hit.iso)
  }
  return unique(kept)
}

function scoreDate(hit, text) {
  const line = lineOf(text, hit.index)
  let score = 1
  if (/开票日期|签订日期|落款|签署|会议时间|会议日期|公示期|公示时间|验收日期|验收时间|请示日期/.test(line)) score += 8
  if (/日期|时间/.test(line)) score += 4
  if (/有效期|出生|成立/.test(line)) score -= 6
  return score
}

function pickSingleDate(hits, text) {
  if (!hits.length) return ''
  let best = hits[0]
  let bestScore = scoreDate(best, text)
  for (let i = 1; i < hits.length; i++) {
    const score = scoreDate(hits[i], text)
    if (score > bestScore || (score === bestScore && hits[i].index > best.index)) {
      best = hits[i]
      bestScore = score
    }
  }
  return best.iso
}

function extractRange(text, hits) {
  const explicit = extractExplicitRange(text)
  if (explicit.startDate && explicit.endDate) return explicit
  if (isDaysOnlyPublicity(text)) {
    return { startDate: explicit.startDate || '', endDate: explicit.endDate || '' }
  }
  const isos = unique((hits || []).map((h) => h.iso)).sort()
  if (explicit.startDate && !explicit.endDate) return explicit
  if (isos.length >= 2) return { startDate: isos[0], endDate: isos[isos.length - 1] }
  if (isos.length === 1) return { startDate: isos[0], endDate: '' }
  return { startDate: '', endDate: '' }
}

export function extractExplicitRange(text) {
  const raw = String(text || '')
  const compact = raw.replace(/\s+/g, '')
  const sources = compact === raw ? [raw] : [raw, compact]
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]
    RANGE_RE.lastIndex = 0
    let m
    while ((m = RANGE_RE.exec(src))) {
      const left = extractDates(m[1])
      const right = extractDates(m[2])
      if (left.length && right.length) {
        return { startDate: left[0].iso, endDate: right[0].iso }
      }
    }
    const dash = src.match(/((?:19|20)\d{2}\s*[.\-/年]\s*\d{1,2}\s*[.\-/月]\s*\d{1,2}\s*日?)\s*[至到止~\-—–]\s*((?:19|20)\d{2}\s*[.\-/年]\s*\d{1,2}\s*[.\-/月]\s*\d{1,2}\s*日?)/)
    if (dash) {
      const a = extractDates(dash[1])
      const b = extractDates(dash[2])
      if (a.length && b.length) return { startDate: a[0].iso, endDate: b[0].iso }
    }
  }
  return { startDate: '', endDate: '' }
}

const DAYS_ONLY_RE = /(?:公示|公开).{0,24}[7七]天|[7七]天(?:公示|公开)|公示期[7七]天|为期[7七]天/

export function isDaysOnlyPublicity(text) {
  const compact = String(text || '').replace(/\s+/g, '')
  if (!DAYS_ONLY_RE.test(compact)) return false
  const range = extractExplicitRange(text)
  return !(range.startDate && range.endDate)
}

function parseArabicAmount(raw) {
  const n = Number(String(raw).replace(/,/g, ''))
  if (!isFinite(n) || n <= 0 || n > 99999999) return null
  return Math.round(n * 100) / 100
}

function sectionToNumber(section) {
  let total = 0
  let current = 0
  let used = false
  for (let i = 0; i < section.length; i++) {
    const ch = section[i]
    if (Object.prototype.hasOwnProperty.call(CN_DIGIT, ch)) {
      current = CN_DIGIT[ch]
      used = true
      continue
    }
    if (Object.prototype.hasOwnProperty.call(CN_UNIT, ch)) {
      const unit = CN_UNIT[ch]
      total += (current || (used ? 0 : 1)) * unit
      current = 0
      used = true
      continue
    }
  }
  return total + current
}

function extractChineseAmounts(text) {
  const raw = String(text || '')
  const src = raw.replace(/\s+/g, '')
  const re = /[零〇壹贰两叁肆伍陆柒捌玖一二三四五六七八九十拾佰仟万亿整正元圆角分]+/g
  const hits = []
  let m
  while ((m = re.exec(src))) {
    if (!m[0] || m[0].length < 2) continue
    const value = chineseAmountValue(m[0])
    if (value == null) continue
    hits.push({
      value,
      index: compactIndexToRaw(raw, m.index),
      hasDecimal: !Number.isInteger(value),
      hasYuan: true,
      hasSymbol: false,
      fromChinese: true
    })
  }
  return hits
}

export function parseChineseAmount(text) {
  const hits = extractChineseAmounts(text)
  return hits.length ? hits[0].value : null
}

function chineseAmountValue(raw) {
  let s = String(raw || '').replace(/整|正/g, '').replace(/圆/g, '元')
  if (!/[元角分]/.test(s) && !/[万亿]/.test(s)) return null
  let yuan = 0
  let jiao = 0
  let fen = 0
  const yuanIdx = s.indexOf('元')
  let rest = s
  if (yuanIdx >= 0) {
    rest = s.slice(0, yuanIdx)
    const tail = s.slice(yuanIdx + 1)
    const jiaoIdx = tail.indexOf('角')
    const fenIdx = tail.indexOf('分')
    if (jiaoIdx >= 0) jiao = sectionToNumber(tail.slice(0, jiaoIdx))
    if (fenIdx >= 0) {
      const from = jiaoIdx >= 0 ? jiaoIdx + 1 : 0
      fen = sectionToNumber(tail.slice(from, fenIdx))
    }
  }
  const yi = rest.split('亿')
  let left = rest
  if (yi.length > 1) {
    yuan += sectionToNumber(yi[0]) * 100000000
    left = yi.slice(1).join('亿')
  }
  const wan = left.split('万')
  if (wan.length > 1) {
    yuan += sectionToNumber(wan[0]) * 10000
    yuan += sectionToNumber(wan.slice(1).join('万'))
  } else {
    yuan += sectionToNumber(left)
  }
  const value = yuan + jiao / 10 + fen / 100
  if (!value || value > 99999999) return null
  return Math.round(value * 100) / 100
}

function scoreAmount(hit, text) {
  const line = lineOf(text, hit.index)
  if (SKIP_AMOUNT_CONTEXT.test(line)) return -20
  if (isNoiseAmount(hit, text)) return -12
  let score = hit.hasDecimal ? 3 : 1
  if (hit.hasYuan || hit.hasSymbol) score += 4
  if (STRONG_TOTAL_LABEL.test(line) || TOTAL_AMOUNT_LABEL.test(line)) score += 12
  else if (AMOUNT_KEYWORD.test(line)) score += 8
  else if (AMOUNT_NEAR.test(line)) score += 4
  if (/大写/.test(line) && !hit.fromChinese) score -= 2
  if (hit.fromChinese) score += 5
  if (String(Math.trunc(hit.value)).length >= 10) score -= 12
  return score
}

function isYearLike(hit) {
  return !hit.hasDecimal && !hit.hasYuan && !hit.hasSymbol && !hit.fromChinese && hit.value >= 1990 && hit.value <= 2040
}

function isNoiseAmount(hit, text) {
  const line = lineOf(text, hit.index)
  if (SKIP_AMOUNT_CONTEXT.test(line)) return true
  if (/小计/.test(line) && !STRONG_TOTAL_LABEL.test(line)) return true
  if (DEPOSIT_AMOUNT_CONTEXT.test(line)) return true
  if (isYearLike(hit) && !AMOUNT_KEYWORD.test(line) && !AMOUNT_NEAR.test(line)) return true
  if (QTY_AMOUNT_CONTEXT.test(line) && !TOTAL_AMOUNT_LABEL.test(line) && !STRONG_TOTAL_LABEL.test(line)) return true
  if (!hit.hasDecimal && String(Math.trunc(hit.value)).length >= 10) return true
  return false
}

function isBudgetLine(text) {
  return /预算/.test(text) && !STRONG_TOTAL_LABEL.test(text)
}

function isStrongTotal(hit, text) {
  const ctx = labelContext(hit, text)
  if (isBudgetLine(ctx) || DEPOSIT_AMOUNT_CONTEXT.test(ctx)) return false
  return STRONG_TOTAL_LABEL.test(ctx)
}

function isTotalLabel(hit, text) {
  const ctx = labelContext(hit, text)
  if (/小计/.test(ctx) && !STRONG_TOTAL_LABEL.test(ctx)) return false
  if (isBudgetLine(ctx) || DEPOSIT_AMOUNT_CONTEXT.test(ctx)) return false
  return TOTAL_AMOUNT_LABEL.test(ctx)
}

export function extractAmounts(text) {
  const src = String(text || '')
  const hits = []
  const re = /(?:[￥¥]\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d{2,8})(?:\s*元)?/g
  let m
  while ((m = re.exec(src))) {
    const value = parseArabicAmount(m[1])
    if (value == null) continue
    const raw = m[0]
    hits.push({
      value,
      index: m.index,
      hasDecimal: /\.\d/.test(m[1]),
      hasYuan: /元/.test(raw),
      hasSymbol: /[￥¥]/.test(raw),
      fromChinese: false
    })
  }
  const cnHits = extractChineseAmounts(src)
  for (let i = 0; i < cnHits.length; i++) hits.push(cnHits[i])
  return hits
}

function pickMaxHit(pool, text) {
  let best = pool[0]
  for (let i = 1; i < pool.length; i++) {
    const hit = pool[i]
    if (hit.value > best.value) {
      best = hit
      continue
    }
    if (hit.value === best.value && scoreAmount(hit, text) > scoreAmount(best, text)) best = hit
  }
  return best
}

function pickAmount(hits, text) {
  const valid = []
  for (let i = 0; i < hits.length; i++) {
    if (isNoiseAmount(hits[i], text)) continue
    if (scoreAmount(hits[i], text) < 1) continue
    valid.push(hits[i])
  }
  if (!valid.length) return null
  const strong = valid.filter((hit) => isStrongTotal(hit, text))
  const labeled = valid.filter((hit) => isTotalLabel(hit, text))
  const pool = strong.length ? strong : (labeled.length ? labeled : valid)
  return pickMaxHit(pool, text).value
}

export function formatAmountField(value) {
  if (value == null || value === '' || isNaN(Number(value))) return ''
  const n = Math.round(Number(value) * 100) / 100
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function cleanLabel(raw) {
  return String(raw || '')
    .replace(/[。．.；;，,、:：]+$/g, '')
    .replace(/\s+/g, '')
    .replace(/^(名称|为|是)/, '')
    .slice(0, 40)
}

function extractContractor(src, kind) {
  if (kind === 'invoice') {
    const seller = src.match(/销售方[\s\S]{0,160}?名称\s*[:：]?\s*([^\n]{2,40})/)
      || src.match(/(?:销货单位|销售单位|销货方名称)\s*[:：]\s*([^\n]{2,40})/)
    if (seller) {
      const name = cleanLabel(seller[1])
      if (name && !/购买方|购买单位/.test(name)) return name
    }
  }
  const win = src.match(/(?:中标(?:人|单位|供应商)|成交(?:人|供应商|单位)|供应商名称|报价单位|报价人|最低价(?:单位|公司|供应商))\s*[:：]\s*([^\n]{2,40})/)
  if (win) return cleanLabel(win[1])
  return ''
}

export function extractProjectMeta(text, kind) {
  const src = String(text || '')
  let name = ''
  const labeled = src.match(/(?:项目名称|工程名称|采购项目名称|成交项目名称|采购项目|标的名称)\s*[:：]\s*([^\n]{2,40})/)
  if (labeled) name = cleanLabel(labeled[1])
  if (!name) {
    const about = src.match(/关于\s*([^\n]{2,32}?(?:工程|项目))/)
    if (about) name = cleanLabel(about[1])
  }
  if (!name) {
    const titled = src.match(/([^\n]{2,28}(?:工程|项目))\s*(?:中标|成交)?通知/)
    if (titled) name = cleanLabel(titled[1])
  }
  if (name && (/^(本|该|此|上述)?(工程|项目)$/.test(name) || /根据|政府采购法|招标投标法/.test(name))) name = ''
  const contractor = extractContractor(src, kind)
  let village = ''
  const buyer = src.match(/(?:采购人|招标人)\s*[:：]\s*([^\n]{2,30})/)
  if (buyer) {
    const v = String(buyer[1]).match(/([\u4e00-\u9fff]{2,8}?村)/)
    if (v) village = v[1]
  }
  return { name, contractor, village }
}

export function parseOcrText(text, kind) {
  const src = String(text || '').replace(/\r/g, '\n')
  const dates = extractDates(src)
  const amounts = extractAmounts(src)
  const range = extractRange(src, dates)
  const date = pickSingleDate(dates, src)
  const amount = pickAmount(amounts, src)
  const meta = extractProjectMeta(src, kind)
  const out = {
    date: date || '',
    startDate: range.startDate || '',
    endDate: range.endDate || '',
    amount: amount,
    name: meta.name || '',
    contractor: meta.contractor || '',
    village: meta.village || '',
    dates: unique(dates.map((d) => d.iso)),
    amounts: unique(amounts.map((a) => formatAmountField(a.value)))
  }
  if (kind === 'notice' && !isDaysOnlyPublicity(src)) {
    if (out.startDate && !out.endDate && out.date && out.date !== out.startDate) {
      out.endDate = out.date
    }
    if (!out.startDate && out.date) out.startDate = out.date
  }
  return out
}

export function mergeInvoiceFields(parsed, invoice) {
  const next = Object.assign({}, parsed)
  if (!invoice) return next
  if (invoice.date) next.date = invoice.date
  if (invoice.amount != null && invoice.amount !== '') next.amount = Number(invoice.amount)
  return next
}

export function summarizeParsed(parsed) {
  const bits = []
  if (parsed.startDate && parsed.endDate) {
    bits.push(parsed.startDate + ' 至 ' + parsed.endDate)
  } else if (parsed.date || parsed.startDate) {
    bits.push(parsed.date || parsed.startDate)
  }
  if (parsed.amount != null) bits.push(formatAmountField(parsed.amount) + ' 元')
  if (parsed.name) bits.push(parsed.name)
  return bits.join(' · ')
}
