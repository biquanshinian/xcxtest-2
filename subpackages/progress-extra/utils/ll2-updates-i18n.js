/**
 * 分包本地副本（主包 utils/ 已不放此文件，避免「主包未使用 JS」质量检查失败）。
 * 若修改逻辑，请同步更新：
 *   subpackages/progress-extra/utils/ll2-updates-i18n.js
 *   pages/mission-detail/utils/ll2-updates-i18n.js
 * LL2 发射动态短语翻译（与 cloudfunctions/ll2Query/ll2-updates-i18n.js 规则对齐）
 * 小程序端只做结构化回退；完整机翻由 ll2Query 写入 commentZh。
 */

const MONTH_ZH = {
  january: '1月',
  jan: '1月',
  february: '2月',
  feb: '2月',
  march: '3月',
  mar: '3月',
  april: '4月',
  apr: '4月',
  may: '5月',
  june: '6月',
  jun: '6月',
  july: '7月',
  jul: '7月',
  august: '8月',
  aug: '8月',
  september: '9月',
  sep: '9月',
  sept: '9月',
  october: '10月',
  oct: '10月',
  november: '11月',
  nov: '11月',
  december: '12月',
  dec: '12月'
}

const QUARTER_ZH = { 1: '第一季度', 2: '第二季度', 3: '第三季度', 4: '第四季度' }

const EXACT_ZH = {
  'added launch': '已添加发射。',
  liftoff: '升空。',
  'go for launch': '发射就绪。',
  'tweaked t-0': '已微调 T-0。',
  'launch time is to the second': '发射时间已精确到秒。'
}

const LOOSE_PHRASES = [
  [/new marine navigation warnings/gi, '最新海上航行警告'],
  [/marine navigation warnings/gi, '海上航行警告'],
  [/vehicle testing progress/gi, '载具测试进展'],
  [/testing progress/gi, '测试进展'],
  [/launch weather/gi, '发射天气'],
  [/unofficial re-?stream/gi, '非官方转播'],
  [/has started/gi, '已开始'],
  [/successful liftoff and ascent of Starship and Super Heavy/gi, '星舰与超重型助推器成功升空并完成上升段'],
  [/\bStarship\b/gi, '星舰'],
  [/\bSuper Heavy\b/gi, '超重型助推器'],
  [/\bNo Earlier Than\b/gi, '最早不早于'],
  [/\bNET\b/g, '最早不早于'],
  [/\bTBC\b/g, '待确认'],
  [/\bTBD\b/g, '待定']
]

function hasUsableZh(text) {
  const raw = String(text || '').trim()
  if (!raw || !/[\u4e00-\u9fff]/.test(raw)) return false
  const leftover = raw.match(/[A-Za-z]{4,}/g) || []
  const unknown = leftover.filter((w) => !/^(SpaceX|NASA|UTC)$/i.test(w))
  return unknown.length === 0
}

function stripDot(s) {
  return String(s || '').trim().replace(/[.。]+$/g, '').trim()
}

function ensureZhPeriod(s) {
  const t = String(s || '').trim()
  if (!t) return ''
  if (/[。！？]$/.test(t)) return t
  return t + '。'
}

function monthName(en) {
  return MONTH_ZH[String(en || '').toLowerCase()] || ''
}

function peelTbc(raw) {
  let s = String(raw || '').trim()
  let suffix = ''
  if (/[,\s]TBC\.?$/i.test(s)) {
    suffix = '，待确认'
    s = s.replace(/[,\s]+TBC\.?$/i, '').trim()
  } else if (/[,\s]TBD\.?$/i.test(s)) {
    suffix = '，待定'
    s = s.replace(/[,\s]+TBD\.?$/i, '').trim()
  }
  return { body: s, suffix }
}

function translateWhen(raw) {
  const peeled = peelTbc(raw)
  let s = stripDot(peeled.body)
  if (!s) return peeled.suffix ? peeled.suffix.replace(/^，/, '') : ''

  const q = s.match(/^Q([1-4])$/i)
  if (q) return QUARTER_ZH[Number(q[1])] + peeled.suffix

  const eml = s.match(/^(early|mid(?:-?dle)?(?:\s+of)?|late)\s+([A-Za-z]+)(?:\s+(\d{4}))?$/i)
  if (eml && monthName(eml[2])) {
    const w = eml[1].toLowerCase()
    const part = w.startsWith('early') ? '上旬' : w.startsWith('late') ? '下旬' : '中旬'
    return (eml[3] ? eml[3] + '年' : '') + monthName(eml[2]) + part + peeled.suffix
  }

  const md = s.match(
    /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?(?:\s+at\s+(\d{1,2}):(\d{2})\s*UTC)?$/i
  )
  if (md && monthName(md[1])) {
    let out = monthName(md[1]) + Number(md[2]) + '日'
    if (md[3]) out = md[3] + '年' + out
    if (md[4]) out += ' ' + md[4] + ':' + md[5] + ' UTC'
    return out + peeled.suffix
  }

  const monthOnly = s.match(/^([A-Za-z]+)(?:\s+(\d{4}))?$/i)
  if (monthOnly && monthName(monthOnly[1])) {
    return monthName(monthOnly[1]) + (monthOnly[2] ? monthOnly[2] + '年' : '') + peeled.suffix
  }

  return ''
}

function applyLoosePhrases(en) {
  let s = String(en || '').trim()
  if (!s) return ''
  for (let i = 0; i < LOOSE_PHRASES.length; i++) {
    s = s.replace(LOOSE_PHRASES[i][0], LOOSE_PHRASES[i][1])
  }
  return s.replace(/\s{2,}/g, ' ').trim()
}

function translateNetBody(body) {
  const peeled = peelTbc(body)
  const s = stripDot(peeled.body)
  const per = s.match(/^(.+?)\s+per\s+(.+)$/i)
  if (per) {
    const when = translateWhen(per[1]) || applyLoosePhrases(per[1])
    const reason = applyLoosePhrases(per[2]) || per[2]
    if (when) return when + '（依据' + reason + '）' + peeled.suffix
  }
  const when = translateWhen(s)
  if (when) return when + (peeled.suffix && !when.includes('待确') && !when.includes('待定') ? peeled.suffix : '')
  const loose = applyLoosePhrases(s)
  if (loose && loose !== s) return loose + peeled.suffix
  return ''
}

function translateUpdateComment(commentEn) {
  const raw = String(commentEn || '').trim()
  if (!raw) return ''
  if (hasUsableZh(raw)) return raw

  const s = stripDot(raw)
  const exact = EXACT_ZH[s.toLowerCase()]
  if (exact) return exact

  let m = s.match(/^NET\s+(.+)$/i)
  if (m) {
    const body = translateNetBody(m[1])
    if (body) return ensureZhPeriod('最早不早于' + body)
  }

  m = s.match(/^Next attempt\s+NET\s+(.+)$/i)
  if (m) {
    const body = translateNetBody(m[1])
    if (body) return ensureZhPeriod('下一次尝试最早不早于' + body)
  }

  m = s.match(/^(?:Now\s+)?targeting\s+(.+)$/i)
  if (m) {
    const when = translateWhen(m[1]) || translateNetBody(m[1])
    if (when) return ensureZhPeriod('当前目标发射时间：' + when)
  }

  m = s.match(/^Confirmed rescheduled for\s+(.+)$/i)
  if (m) {
    const when = translateWhen(m[1]) || translateNetBody(m[1])
    if (when) return ensureZhPeriod('已确认改期至' + when)
  }

  m = s.match(/^Moved to NET\s+(.+?)(?:\s+based on\s+(.+))?$/i)
  if (m) {
    const when = translateNetBody(m[1])
    if (when) {
      const reason = m[2] ? applyLoosePhrases(m[2]) : ''
      return ensureZhPeriod('已调整为最早不早于' + when + (reason ? '，依据' + reason : ''))
    }
  }

  m = s.match(/^Scrub for the day after hold at\s+(T[+\-]?\d+)\.?$/i)
  if (m) return ensureZhPeriod('在 ' + m[1] + ' 保持后取消当日发射')

  m = s.match(/^Updated launch weather,\s*(\d+)%\s*GO\.?$/i)
  if (m) return ensureZhPeriod('已更新发射天气，' + m[1] + '% 具备发射条件')

  m = s.match(/^Unofficial Re-stream by\s+(.+?)\s+has started$/i)
  if (m) return ensureZhPeriod(m[1].trim() + ' 的非官方转播已开始')

  if (/^Successful liftoff and ascent of Starship and Super Heavy/i.test(s)) {
    return '星舰与超重型助推器成功升空并完成上升段。'
  }

  const loose = applyLoosePhrases(raw)
  if (loose && loose !== raw && hasUsableZh(loose)) return ensureZhPeriod(loose)
  return loose || raw
}

function pickDisplayComment(commentEn, commentZhStored) {
  const stored = String(commentZhStored || '').trim()
  if (hasUsableZh(stored)) return stored
  const phrased = translateUpdateComment(commentEn)
  if (hasUsableZh(phrased)) return phrased
  return stored || phrased || String(commentEn || '').trim()
}

module.exports = {
  translateUpdateComment,
  pickDisplayComment,
  hasUsableZh
}
