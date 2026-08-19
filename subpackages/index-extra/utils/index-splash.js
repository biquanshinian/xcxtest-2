/**
 * subpackages/index-extra/utils/index-splash.js
 * 首页开屏动画逻辑（从 pages/index/index.js 拆出）：
 * - 开屏配置：onLaunch 预拉（utils/splash-prefetch.js）+ 本地缓存池，首页短等即可
 * - 弱网（none/2g/3g/weakNet）且无本地片：即刻跳过，不挡首页
 * - 展示 / 倒计时 / 跳过 / 关闭、媒体预下载
 * - 开屏视频对非会员开放（压缩预览片）；仅省流/紧急流量档时非 Pro 降级封面
 *
 * 主包 index.js 通过 require.async + attachTo 委托加载；
 * app.onLaunch 预下载 index-extra，首页 preloadRule 再兜底。
 */
const { isPlaybackAllowed } = require('../../../utils/feature-flags.js')
const {
  SPLASH_CACHE_KEY,
  startSplashPrefetch,
  shouldSkipSplashForWeakNet,
  fileExists,
  normalizeItems,
  resolvePlay,
  pickSplashItem,
  reuseSplashDownload,
  abortSplashPrefetchDownload
} = require('../../../utils/splash-prefetch.js')
const { isMembershipEnabled, isProSync, getMembershipState, isPro } = require('../../../utils/membership.js')
const { getMemberPolicy } = require('../../../utils/member-policy.js')
const {
  getUpcomingMissionsAny,
  findMissionInListSnapshots,
  peekUpcomingMissionsList
} = require('../../../utils/api-launch-list.js')
const { buildMissionDetailUrl } = require('../../../utils/index-mission-nav.js')
const { fetchLaunchStatusSnapshot } = require('../../../utils/api-app-services.js')
const { enrichOneMissionAgencyLogo, peekAgencyLogoById } = require('../../../utils/upcoming-agency-logo-enrich.js')
const { applyLaunchAgencyLogoOverridesToMission } = require('../../../utils/agency-logo-overrides.js')
const { resolveAgencyLogoBgTone, ensureAgencyLogoBgTone } = require('../../../utils/agency-logo-bg.js')
const {
  persistAgencyLogoAfterRemoteLoad,
  isRemoteAgencyLogoUrl,
  getCachedAgencyLogoPath,
  normalizeAgencyLogoCacheKey,
  invalidateAgencyLogoCache
} = require('../../../utils/agency-logo-cache.js')

const SPLASH_NOTICE_FONTS = { default: true, yahei: true, 'yahei-bold': true }
const SPLASH_NOTICE_MAX_LEN = 80

function splashNoticePlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\n+$/g, '')
    .trim()
}

/** 客户端轻量消毒（与网关白名单对齐） */
function sanitizeSplashNoticeHtmlClient(raw) {
  let src = String(raw || '').trim()
  if (!src) return ''
  const ALLOWED_ALIGN = { left: true, center: true, right: true }
  const SIZE_MIN = 12
  const SIZE_MAX = 36
  const isAllowedSize = (px) => {
    const n = Number(px)
    return Number.isFinite(n) && n >= SIZE_MIN && n <= SIZE_MAX
  }
  if (!/<[a-z][\s\S]*>/i.test(src)) {
    const plain = splashNoticePlainText(src).replace(/\n/g, '').slice(0, SPLASH_NOTICE_MAX_LEN)
    if (!plain) return ''
    const esc = plain
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<div style="text-align:center">${esc}</div>`
  }
  src = src
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<\s*\/?\s*p\b/gi, (m) => m.replace(/p/i, 'div'))
    // 必须吃掉到 >，否则会生成残缺标签导致前端把 HTML 当纯文本显示
    .replace(/<\s*strong\b[^>]*>/gi, '<span style="font-weight:700">')
    .replace(/<\s*\/\s*strong\s*>/gi, '</span>')
    .replace(/<\s*b\b(?![a-z])[^>]*>/gi, '<span style="font-weight:700">')
    .replace(/<\s*\/\s*b\s*>/gi, '</span>')
    .replace(/<\/?(?!div\b|span\b|br\b)[a-z0-9]+\b[^>]*>/gi, '')
  src = src.replace(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (full, _q, d1, d2) => {
    const rawStyle = d1 != null ? d1 : d2 || ''
    const parts = []
    const alignM = rawStyle.match(/text-align\s*:\s*(left|center|right)/i)
    if (alignM && ALLOWED_ALIGN[alignM[1].toLowerCase()]) parts.push(`text-align:${alignM[1].toLowerCase()}`)
    const sizeM = rawStyle.match(/font-size\s*:\s*(\d+)\s*px/i)
    if (sizeM && isAllowedSize(Number(sizeM[1]))) parts.push(`font-size:${Number(sizeM[1])}px`)
    if (/font-weight\s*:\s*(bold|700)/i.test(rawStyle)) parts.push('font-weight:700')
    const lhM = rawStyle.match(/line-height\s*:\s*([\d.]+)/i)
    if (lhM) {
      const lh = Number(lhM[1])
      if (Number.isFinite(lh) && lh >= 1 && lh <= 2.5) {
        parts.push(`line-height:${Math.round(lh * 10) / 10}`)
      }
    }
    return parts.length ? ` style="${parts.join(';')}"` : ''
  })
  src = src.replace(/<\s*br\s*\/?\s*>/gi, '<br/>')
  // contenteditable 可能留下真实换行，统一成 br，避免前端拆行丢失
  src = src.replace(/\r\n|\r|\n/g, '<br/>')
  src = src.replace(/(?:<br\/>){3,}/gi, '<br/><br/>').trim()
  if (!splashNoticePlainText(src).replace(/\n/g, '')) return ''
  if (!/text-align\s*:/i.test(src)) src = `<div style="text-align:center">${src}</div>`
  return src
}

function decodeNoticeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

function clampSplashNoticeLineHeight(v, fallback = 1.4) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(2.5, Math.max(1, Math.round(n * 10) / 10))
}

/** 按顶层 div 安全拆块（支持嵌套，避免非贪婪正则吃错） */
function splitSplashNoticeTopDivs(html) {
  const blocks = []
  const s = String(html || '')
  let i = 0
  while (i < s.length) {
    const open = s.slice(i).match(/^<div\b([^>]*)>/i)
    if (!open) {
      const next = s.slice(i).search(/<div\b/i)
      const chunk = next < 0 ? s.slice(i) : s.slice(i, i + next)
      if (String(chunk || '').replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, ' ').trim()) {
        blocks.push({ attrs: '', inner: chunk })
      } else if (/<br\s*\/?>/i.test(chunk)) {
        blocks.push({ attrs: '', inner: '<br/>' })
      }
      if (next < 0) break
      i += next
      continue
    }
    const attrs = open[1] || ''
    i += open[0].length
    let depth = 1
    const start = i
    while (i < s.length && depth > 0) {
      const close = s.slice(i).match(/^<\/\s*div\s*>/i)
      if (close) {
        depth -= 1
        if (depth === 0) {
          blocks.push({ attrs, inner: s.slice(start, i) })
          i += close[0].length
          break
        }
        i += close[0].length
        continue
      }
      const nested = s.slice(i).match(/^<div\b[^>]*>/i)
      if (nested) {
        depth += 1
        i += nested[0].length
        continue
      }
      i += 1
    }
  }
  return blocks
}

/** 后台 contenteditable 的 div 块 / br / 文本换行 → 行数组 */
function buildSplashNoticeLines(html, defaultLineHeight = 1.4) {
  const src = String(html || '')
  const defaultLh = clampSplashNoticeLineHeight(defaultLineHeight, 1.4)
  const lines = []

  function pushLine(frag, lh, ta) {
    const segs = parseSplashNoticeInlineSegs(frag)
    if (!segs.length) return false
    const lineLh = Number(lh) || defaultLh
    // 默认字号与后台编辑器 16px 对齐 → 32rpx；行距用无单位倍数（与 CSS line-height 一致）
    const segsWithLh = segs.map((seg) => {
      const fs = Number(seg.fontSize) || 32
      return {
        text: seg.text,
        bold: !!seg.bold,
        fontSize: fs,
        lineHeight: lineLh
      }
    })
    const maxFs = segsWithLh.reduce((m, s) => Math.max(m, Number(s.fontSize) || 32), 32)
    lines.push({
      empty: false,
      segs: segsWithLh,
      lineHeight: lineLh,
      // 单行文本时，用 min-height 保证行盒高度≈后台（字号×行距）
      minHeightRpx: Math.max(1, Math.round(maxFs * lineLh)),
      align: ta === 'left' || ta === 'right' ? ta : 'center'
    })
    return true
  }

  function pushEmpty(lh, ta) {
    if (lines.length) {
      const lineLh = Number(lh) || defaultLh
      lines.push({
        empty: true,
        segs: [],
        lineHeight: lineLh,
        minHeightRpx: Math.max(1, Math.round(32 * lineLh)),
        align: ta === 'left' || ta === 'right' ? ta : 'center'
      })
    }
  }

  function styleFromAttrs(attrs) {
    let lh = defaultLh
    let ta = 'center'
    const styleM =
      String(attrs || '').match(/style\s*=\s*"([^"]*)"/i) || String(attrs || '').match(/style\s*=\s*'([^']*)'/i)
    if (styleM) {
      const lhM = styleM[1].match(/line-height\s*:\s*([\d.]+)/i)
      if (lhM) lh = clampSplashNoticeLineHeight(lhM[1], defaultLh)
      const taM = styleM[1].match(/text-align\s*:\s*(left|center|right)/i)
      if (taM) ta = taM[1].toLowerCase()
    }
    return { lh, ta }
  }

  function emitParts(inner, lh, ta) {
    let flat = String(inner || '')
      .replace(/<\/div>\s*<div\b[^>]*>/gi, '<br/>')
      .replace(/<\/?div\b[^>]*>/gi, '')
      .replace(/\r\n|\r|\n/g, '<br/>')
    const parts = flat.split(/<br\s*\/?>/i)
    while (parts.length > 1 && !String(parts[parts.length - 1] || '').replace(/&nbsp;/gi, ' ').trim()) {
      parts.pop()
    }
    for (let i = 0; i < parts.length; i++) {
      if (!pushLine(parts[i], lh, ta)) {
        if (i < parts.length - 1) pushEmpty(lh, ta)
      }
    }
  }

  const blocks = splitSplashNoticeTopDivs(src)
  if (blocks.length) {
    for (let b = 0; b < blocks.length; b++) {
      const { lh, ta } = styleFromAttrs(blocks[b].attrs)
      emitParts(blocks[b].inner, lh, ta)
      if (lines.length >= 6) break
    }
  } else {
    emitParts(src, defaultLh, 'center')
  }

  while (lines.length && lines[lines.length - 1].empty) lines.pop()
  return lines.slice(0, 6)
}

function cleanNoticeSegText(s) {
  return decodeNoticeEntities(String(s || ''))
    // 正常标签
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    // 残缺标签（缺 <）：span style="...">xxx
    .replace(/\b(?:span|div|font|strong|b)\b\s*style\s*=\s*("[^"]*"|'[^']*')\s*>/gi, '')
    .replace(/<\/\s*(?:span|div|font|strong|b)\s*>/gi, '')
    // 只折叠空格/制表，保留换行（行拆分后再清）
    .replace(/[ \t\f\v\r]+/g, ' ')
    .trim()
}

/** 栈式解析 span，正确处理字号+加粗嵌套，绝不把标签泄漏到 text */
function parseSplashNoticeInlineSegs(fragment) {
  const segs = []
  let src = String(fragment || '')
  if (!src) return segs

  // 修复历史坏数据：<span style="font-weight:700"文本 → 补上 >
  src = src.replace(/<span(\s+[^>]*?=\s*"[^"]*")([^\s>])/gi, '<span$1>$2')
  src = src.replace(/<span(\s+[^>]*?=\s*'[^']*')([^\s>])/gi, '<span$1>$2')

  const stack = [{ bold: false, fontSize: 32 }]
  let i = 0
  while (i < src.length) {
    if (src[i] === '<') {
      const close = src.slice(i).match(/^<\/\s*span\s*>/i)
      if (close) {
        if (stack.length > 1) stack.pop()
        i += close[0].length
        continue
      }
      const open = src.slice(i).match(/^<span\b([^>]*)>/i)
      if (open) {
        const attrs = open[1] || ''
        const cur = stack[stack.length - 1]
        const next = { bold: cur.bold, fontSize: cur.fontSize }
        if (/font-weight\s*:\s*(bold|700)/i.test(attrs)) next.bold = true
        const sizeM = attrs.match(/font-size\s*:\s*(\d+)\s*px/i)
        if (sizeM) {
          const px = Number(sizeM[1])
          if (Number.isFinite(px) && px >= 12 && px <= 36) next.fontSize = Math.round(px * 2)
        }
        stack.push(next)
        i += open[0].length
        continue
      }
      // 未知标签：整段跳过
      const skip = src.slice(i).match(/^<[^>]+>/)
      if (skip) {
        i += skip[0].length
        continue
      }
      // 孤立 < ：当普通字符丢掉，避免泄漏
      i += 1
      continue
    }
    const nextLt = src.indexOf('<', i)
    const rawText = nextLt === -1 ? src.slice(i) : src.slice(i, nextLt)
    i = nextLt === -1 ? src.length : nextLt
    const text = cleanNoticeSegText(rawText)
    if (!text) continue
    const cur = stack[stack.length - 1]
    const last = segs[segs.length - 1]
    if (last && last.bold === !!cur.bold && last.fontSize === cur.fontSize) {
      last.text += text
    } else {
      segs.push({ text, bold: !!cur.bold, fontSize: cur.fontSize })
    }
  }

  if (!segs.length) {
    const t = cleanNoticeSegText(src)
    if (t) segs.push({ text: t, bold: false, fontSize: 32 })
  }
  return segs
}

function normalizeSplashNotice(cfg) {
  if (!cfg || typeof cfg !== 'object') return null
  const html = sanitizeSplashNoticeHtmlClient(cfg.noticeText)
  if (!html) return null
  const plain = splashNoticePlainText(html).replace(/\n/g, '')
  if (!plain) return null
  const fontRaw = String(cfg.noticeFont || 'default').trim()
  const font = SPLASH_NOTICE_FONTS[fontRaw] ? fontRaw : 'default'
  const alignM = html.match(/text-align\s*:\s*(left|center|right)/i)
  const align = alignM ? alignM[1].toLowerCase() : 'center'
  const lh = Number(cfg.noticeLineHeight)
  const lineHeight = Number.isFinite(lh) ? Math.min(2.5, Math.max(1, Math.round(lh * 10) / 10)) : 1.4
  const lines = buildSplashNoticeLines(html, lineHeight)
  if (!lines.length) return null
  const containerAlign =
    lines[0] && (lines[0].align === 'left' || lines[0].align === 'right' || lines[0].align === 'center')
      ? lines[0].align
      : align
  const ls = Number(cfg.noticeLetterSpacing)
  // 管理端 px → 小程序 rpx（×2），与字号换算一致
  const letterSpacingPx = Number.isFinite(ls) ? Math.min(8, Math.max(0, Math.round(ls))) : 0
  const lg = Number(cfg.noticeLineGap)
  const lineGapPx = Number.isFinite(lg) ? Math.min(24, Math.max(0, Math.round(lg))) : 4
  return {
    text: plain,
    html,
    font,
    align: containerAlign,
    lines,
    lineHeight,
    letterSpacing: letterSpacingPx * 2,
    lineGap: lineGapPx * 2
  }
}

/** 开屏 logo：本地缓存优先，否则用原链（不强制 thumb，避免 CI 404 整张空白） */
function splashLogoForDisplay(rawLogo) {
  const raw = String(rawLogo || '').trim()
  if (!raw) return { display: '', remote: '' }
  if (!isRemoteAgencyLogoUrl(raw)) return { display: raw, remote: '' }
  const key = normalizeAgencyLogoCacheKey(raw) || raw
  const local = getCachedAgencyLogoPath(key) || getCachedAgencyLogoPath(raw)
  return { display: local || raw, remote: raw }
}

function buildSplashMissionPayload(hit) {
  if (!hit || !hit.id) return null
  const patched = applyLaunchAgencyLogoOverridesToMission(hit) || hit
  let rawLogo = String(patched.launchAgencyImage || '').trim()
  if (!rawLogo && patched.launchAgencyId != null) {
    rawLogo = peekAgencyLogoById(patched.launchAgencyId) || ''
  }
  const logo = splashLogoForDisplay(rawLogo)
  return {
    id: patched.id,
    name: patched.missionName || patched.name || '',
    launchTime: patched.launchTime,
    agencyName: String(patched.launchAgency || '').trim(),
    agencyLogo: logo.display,
    agencyLogoRemote: logo.remote || rawLogo,
    agencyLogoBgTone: rawLogo ? resolveAgencyLogoBgTone(rawLogo) : '',
    rocketName: String(patched.rocketName || patched.rocketConfiguration || '').trim()
  }
}

function warmSplashAgencyLogo(rawUrl) {
  const raw = String(rawUrl || '').trim()
  if (!raw || !isRemoteAgencyLogoUrl(raw)) return
  const logo = splashLogoForDisplay(raw)
  if (/^https?:\/\//i.test(logo.display)) {
    try {
      wx.getImageInfo({ src: logo.display, fail() {} })
    } catch (e) {}
  }
  persistAgencyLogoAfterRemoteLoad(raw)
}

// LL2 状态：6 = In Flight（飞行中）；3/4/7/9 = 终态（成功/失败/部分失败/中止）
const SPLASH_STATUS_INFLIGHT = 6
const SPLASH_STATUS_TERMINAL = { 3: true, 4: true, 7: true, 9: true }
// 距发射 ±2 小时内才做实时状态确认（飞行中可能性窗口，避免平时多打一次云函数）
const SPLASH_LIVE_CHECK_WINDOW_MS = 2 * 60 * 60 * 1000
// 开屏视频最长展示 12 秒（与云端预览转码截取一致；原片兜底也硬切）
const SPLASH_VIDEO_MAX_SEC = 12
const SPLASH_VIDEO_MAX_MS = SPLASH_VIDEO_MAX_SEC * 1000
// 图片开屏：跳过倒计时固定秒数（视频则随片长自动判定，不再读后台 countdownSeconds）
const SPLASH_IMAGE_COUNTDOWN_SEC = 5
// 起播保障：超时强制 play；远程流再超时则直接关开屏（弱/慢网不挂封面空等）
const SPLASH_VIDEO_FORCE_PLAY_MS = 1200
const SPLASH_VIDEO_FALLBACK_MS = 1600
// 元数据已就绪（流量在动、即将起播）时，把降级窗口一次性延长，慢网不误降级
const SPLASH_VIDEO_META_EXTEND_MS = 2000
// 仅当 onLaunch 预拉已在下载同一 URL 时再短等；不再为了下载挡住开屏展示
const SPLASH_VIDEO_PREFETCH_MS = 400
const SPLASH_NET_PROBE_MS = 180
const SPLASH_CFG_WAIT_CACHED_MS = 400
const SPLASH_CFG_WAIT_COLD_MS = 800
// isProSync 缓存过期时，短等云端会员状态确认的上限
const SPLASH_PRO_CONFIRM_MS = 1500
const SPLASH_VIDEO_ID = 'splash-video'

// 任务倒计时卡片：上次匹配命中的任务（秒显快路径，云端返回后校正）
const SPLASH_MISSION_HIT_KEY = '_splash_mission_hit'

function delayMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const methods = {
  async loadSplashScreen() {
    try {
      // 用内存变量控制：冷启动时显示，切后台回来不重复显示
      const app = getApp()
      if (app._splashShownThisSession) return
      app._splashShownThisSession = true

      const prefetch = startSplashPrefetch(app)
      if (prefetch && prefetch.netPromise) {
        await Promise.race([prefetch.netPromise, delayMs(SPLASH_NET_PROBE_MS)])
      }

      let cached = (prefetch && prefetch.cached) || null
      if (!cached) {
        try {
          cached = wx.getStorageSync(SPLASH_CACHE_KEY) || null
        } catch (e) {}
      }

      // 弱网且没有可离线播放的本地片：即刻跳过，不挡首页
      if (shouldSkipSplashForWeakNet(prefetch, cached)) return

      const cachedItems = normalizeItems(cached)
      // 只有显式 mediaItems 数组才视为「完整池」；旧单条缓存不能挡住云端多视频
      const cacheHasPool = !!(
        cached &&
        cached.enabled &&
        Array.isArray(cached.mediaItems) &&
        cached.mediaItems.length > 0
      )
      const lastSplashId = cached && cached.lastSplashId ? String(cached.lastSplashId) : ''

      // ── 配置：优先用 onLaunch 预拉结果；有本地池则不再空等云端 ──
      let cfg = prefetch && prefetch.cfg ? prefetch.cfg : null
      if (!cfg && prefetch && prefetch.cfgPromise) {
        const waitMs = cacheHasPool ? SPLASH_CFG_WAIT_CACHED_MS : SPLASH_CFG_WAIT_COLD_MS
        try {
          cfg = await Promise.race([prefetch.cfgPromise, delayMs(waitMs).then(() => null)])
        } catch (e) {
          cfg = null
        }
      } else if (!cfg && wx.cloud && wx.cloud.database) {
        const waitMs = cacheHasPool ? SPLASH_CFG_WAIT_CACHED_MS : SPLASH_CFG_WAIT_COLD_MS
        try {
          const db = wx.cloud.database()
          const res = await Promise.race([
            db.collection('starship_splash_config').doc('current').get(),
            delayMs(waitMs).then(() => null)
          ])
          cfg = res && res.data ? res.data : null
        } catch (e) {
          cfg = null
        }
      }

      if (prefetch && prefetch.skip && shouldSkipSplashForWeakNet(prefetch, cached)) return

      const cloudItems = normalizeItems(cfg)
      // 优先云端完整池，其次本地池，最后旧单条
      let pool = []
      if (cloudItems.length > 1 || (cfg && Array.isArray(cfg.mediaItems) && cfg.mediaItems.length)) {
        pool = cloudItems
      } else if (cacheHasPool) {
        pool = cachedItems
      } else {
        pool = cloudItems.length ? cloudItems : cachedItems
      }

      // 开关：云端优先；无云端时看本地缓存
      if (cfg) {
        if (cfg.enabled === false) {
          try {
            wx.setStorageSync(SPLASH_CACHE_KEY, { enabled: false })
          } catch (e) {}
          return
        }
      } else if (cached && cached.enabled === false) {
        return
      }

      if (!pool.length) return

      // 过审关闭 enableEventVideo：开屏不挑视频项，避免挂载 <video>
      const playbackOk = await isPlaybackAllowed().catch(() => false)
      let pickPool = pool
      if (!playbackOk) {
        const imagesOnly = pool.filter((it) => it && it.mediaType !== 'video')
        if (imagesOnly.length) pickPool = imagesOnly
      }

      const prefetchPick =
        prefetch && prefetch.picked && prefetch.picked.id
          ? pickPool.find((it) => it && String(it.id) === String(prefetch.picked.id))
          : null
      const picked = prefetchPick || pickSplashItem(pickPool, lastSplashId)
      const resolved = resolvePlay(picked)
      if (!resolved) return
      if (prefetch) prefetch.consumed = true

      // 可播门控：过审关视频 → 降级封面，不挂 <video>。
      // 开屏视频对非会员开放（播的是压缩预览片，体积小），不走非会员强制封面策略；
      // 仅省流/紧急流量档收紧为「非 Pro 降级封面」，作为 COS 成本熔断
      let splashVideoAllowed = true
      if (resolved.mediaType === 'video') {
        if (!playbackOk) {
          splashVideoAllowed = false
        } else {
          try {
            const memberEnabled = await isMembershipEnabled()
            if (memberEnabled) {
              const policy = await getMemberPolicy()
              if (policy.mediaTrafficMode !== 'normal' && !isProSync()) {
                // isProSync 只读本地缓存（TTL 10 分钟），冷启动缓存过期会把 Pro 误判成非会员。
                // 短等云端确认一次（复用 isProSync 已触发的 in-flight 请求）；超时按非会员降级
                const state = await Promise.race([
                  getMembershipState().catch(() => null),
                  new Promise((resolve) => setTimeout(() => resolve(null), SPLASH_PRO_CONFIRM_MS))
                ])
                splashVideoAllowed = isPro(state)
              }
            }
          } catch (e) {}
        }
        if (!splashVideoAllowed) {
          if (!resolved.posterUrl) return
          resolved.mediaType = 'image'
          resolved.playUrl = resolved.posterUrl
          resolved.mediaUrl = resolved.posterUrl
        }
      }

      const localMap = cached && cached.localPaths && typeof cached.localPaths === 'object' ? cached.localPaths : {}
      let src = ''
      if (prefetch && prefetch.localPath && prefetch.playUrl === resolved.playUrl && fileExists(prefetch.localPath)) {
        src = prefetch.localPath
      }
      if (!src) {
        src = localMap[resolved.playUrl] || ''
        if (src && !fileExists(src)) src = ''
      }

      // 视频且预览未就绪：不要硬播原片（易长时间缓冲、封面假死），本轮用封面图秒开
      if (
        splashVideoAllowed &&
        resolved.mediaType === 'video' &&
        !src &&
        !(picked && picked.previewUrl) &&
        resolved.posterUrl
      ) {
        resolved.mediaType = 'image'
        resolved.playUrl = resolved.posterUrl
        resolved.mediaUrl = resolved.posterUrl
      }

      // 预拉已在下载同一预览片：再短等一会；未开始则直接用 https 起播，不挡开屏
      let streamingRemote = false
      if (
        splashVideoAllowed &&
        resolved.mediaType === 'video' &&
        !src &&
        resolved.playUrl &&
        /^https?:\/\//i.test(resolved.playUrl) &&
        !(resolved.originalUrl && resolved.playUrl === resolved.originalUrl)
      ) {
        const inflight = prefetch && prefetch.playUrl === resolved.playUrl && prefetch.downloadPromise
        if (inflight) {
          try {
            src = (await this._prefetchSplashPlayUrl(resolved.playUrl, SPLASH_VIDEO_PREFETCH_MS)) || ''
          } catch (e) {
            src = ''
          }
        }
        if (!src) {
          streamingRemote = true
          abortSplashPrefetchDownload(app)
        }
      }

      // 会员确认 / 预拉等待期间网络变差：无本地片则仍即刻跳过
      if (prefetch && prefetch.weakNet && !src) return

      if (prefetch && prefetch.downloadPromise && prefetch.playUrl === resolved.playUrl) {
        this._splashPrefetching = { url: resolved.playUrl, promise: prefetch.downloadPromise }
      }

      // 跳过倒计时：视频先按上限占位，元数据/播放进度到位后按实际片长校正；图片固定秒数
      const countdown =
        resolved.mediaType === 'video' ? SPLASH_VIDEO_MAX_SEC : SPLASH_IMAGE_COUNTDOWN_SEC
      // 有云端配置时以云端为准（含「清空文案」）；仅无云端时才读本地缓存
      const splashNotice = cfg ? normalizeSplashNotice(cfg) : normalizeSplashNotice(cached)
      this._showSplash({
        mediaType: resolved.mediaType,
        mediaUrl: src || resolved.playUrl,
        posterUrl: resolved.posterUrl,
        originalUrl: resolved.originalUrl,
        countdown,
        missionName: resolved.missionName,
        launchId: resolved.launchId,
        notice: splashNotice
      })
      if (typeof this._releaseSplashCountdownGate === 'function') {
        this._releaseSplashCountdownGate(streamingRemote ? 500 : 0)
      }

      // 后台刷新完整配置与本地预下载（不改变本次已展示内容）
      // mediaItems 优先存云端原数组（含 previewStatus），避免二次 normalize 丢状态后误退原片
      const cacheMediaItems =
        cfg && Array.isArray(cfg.mediaItems) && cfg.mediaItems.length
          ? cfg.mediaItems
          : cloudItems.length
            ? cloudItems
            : pool
      // 有云端时强制写云端 notice（空串也写入，禁止回落旧缓存文案）
      let noticeTextForCache = ''
      let noticeFontForCache = 'default'
      let noticeLineHeightForCache = 1.4
      let noticeLetterSpacingForCache = 0
      let noticeLineGapForCache = 4
      if (cfg) {
        noticeTextForCache = String(cfg.noticeText || '').trim()
        const fr = String(cfg.noticeFont || 'default').trim()
        noticeFontForCache = SPLASH_NOTICE_FONTS[fr] ? fr : 'default'
        const lh = Number(cfg.noticeLineHeight)
        noticeLineHeightForCache = Number.isFinite(lh) ? Math.min(2.5, Math.max(1, Math.round(lh * 10) / 10)) : 1.4
        const ls = Number(cfg.noticeLetterSpacing)
        noticeLetterSpacingForCache = Number.isFinite(ls) ? Math.min(8, Math.max(0, Math.round(ls))) : 0
        const lg = Number(cfg.noticeLineGap)
        noticeLineGapForCache = Number.isFinite(lg) ? Math.min(24, Math.max(0, Math.round(lg))) : 4
      } else if (splashNotice) {
        noticeTextForCache = splashNotice.html || splashNotice.text || ''
        noticeFontForCache = splashNotice.font
        noticeLineHeightForCache = Number(splashNotice.lineHeight) || 1.4
        // splashNotice 里 letterSpacing/lineGap 已是 rpx，缓存回写用管理端 px
        noticeLetterSpacingForCache = Math.round((Number(splashNotice.letterSpacing) || 0) / 2)
        noticeLineGapForCache = Math.round((Number(splashNotice.lineGap) || 8) / 2)
      } else if (cached) {
        noticeTextForCache = String(cached.noticeText || '').trim()
        const fr = String(cached.noticeFont || 'default').trim()
        noticeFontForCache = SPLASH_NOTICE_FONTS[fr] ? fr : 'default'
        const lh = Number(cached.noticeLineHeight)
        noticeLineHeightForCache = Number.isFinite(lh) ? Math.min(2.5, Math.max(1, Math.round(lh * 10) / 10)) : 1.4
        const ls = Number(cached.noticeLetterSpacing)
        noticeLetterSpacingForCache = Number.isFinite(ls) ? Math.min(8, Math.max(0, Math.round(ls))) : 0
        const lg = Number(cached.noticeLineGap)
        noticeLineGapForCache = Number.isFinite(lg) ? Math.min(24, Math.max(0, Math.round(lg))) : 4
      }
      this._cacheSplashMedia(
        {
          enabled: true,
          countdownSeconds: resolved.mediaType === 'video' ? SPLASH_VIDEO_MAX_SEC : SPLASH_IMAGE_COUNTDOWN_SEC,
          noticeText: noticeTextForCache,
          noticeFont: noticeFontForCache,
          noticeLineHeight: noticeLineHeightForCache,
          noticeLetterSpacing: noticeLetterSpacingForCache,
          noticeLineGap: noticeLineGapForCache,
          mediaItems: cacheMediaItems,
          lastSplashId: resolved.id || resolved.originalUrl || resolved.playUrl,
          mediaType: resolved.mediaType,
          mediaUrl: resolved.originalUrl,
          originalUrl: resolved.originalUrl,
          playUrl: resolved.playUrl,
          previewUrl: picked && picked.previewUrl ? picked.previewUrl : '',
          posterUrl: resolved.posterUrl
        },
        cached,
        {
          skipMediaDownload: !splashVideoAllowed,
          deferMediaDownload: !!(splashVideoAllowed && streamingRemote)
        }
      )

      // 短等没拿到云端：复用 onLaunch 预拉，避免再打一次库
      if (!cloudItems.length) {
        try {
          let lateCfg = prefetch && prefetch.cfg ? prefetch.cfg : null
          if (!lateCfg && prefetch && prefetch.cfgPromise) {
            lateCfg = await prefetch.cfgPromise.catch(() => null)
          } else if (!lateCfg && wx.cloud && wx.cloud.database) {
            const late = await wx.cloud.database().collection('starship_splash_config').doc('current').get()
            lateCfg = late && late.data ? late.data : null
          }
          const lateItems = normalizeItems(lateCfg)
          if (lateCfg && lateCfg.enabled !== false && lateItems.length) {
            const lateNotice = normalizeSplashNotice(lateCfg)
            this._cacheSplashMedia(
              {
                enabled: true,
                countdownSeconds:
                  resolved.mediaType === 'video' ? SPLASH_VIDEO_MAX_SEC : SPLASH_IMAGE_COUNTDOWN_SEC,
                noticeText: lateNotice ? lateNotice.html || lateCfg.noticeText || '' : String(lateCfg.noticeText || '').trim(),
                noticeFont: lateNotice ? lateNotice.font : String(lateCfg.noticeFont || 'default'),
                noticeLineHeight: Number(lateCfg.noticeLineHeight) || 1.4,
                noticeLetterSpacing: Number(lateCfg.noticeLetterSpacing) || 0,
                noticeLineGap: Number(lateCfg.noticeLineGap) || 4,
                mediaItems:
                  Array.isArray(lateCfg.mediaItems) && lateCfg.mediaItems.length
                    ? lateCfg.mediaItems
                    : lateItems,
                lastSplashId: resolved.id || resolved.originalUrl || resolved.playUrl,
                mediaType: resolved.mediaType,
                mediaUrl: resolved.originalUrl,
                originalUrl: resolved.originalUrl,
                playUrl: resolved.playUrl,
                previewUrl: picked && picked.previewUrl ? picked.previewUrl : '',
                posterUrl: resolved.posterUrl
              },
              wx.getStorageSync(SPLASH_CACHE_KEY) || cached,
              {
                skipMediaDownload: !splashVideoAllowed,
                deferMediaDownload: !!(splashVideoAllowed && streamingRemote)
              }
            )
          }
        } catch (e) {}
      }
    } catch (e) {
      // 静默失败，不影响主页加载
    } finally {
      if (!this._splashUiActive && !this.data.splashVisible && typeof this._releaseSplashCountdownGate === 'function') {
        this._releaseSplashCountdownGate()
      }
    }
  },

  _showSplash(opts) {
    if (this.data.splashVisible || this._splashUiActive) return
    this._splashUiActive = true
    const mediaType = opts.mediaType || 'image'
    const mediaUrl = opts.mediaUrl || ''
    const posterUrl = opts.posterUrl || ''
    const originalUrl = opts.originalUrl || mediaUrl
    // 视频：先按上限占位，loadedmetadata / timeupdate 后按实际片长校正
    const countdown =
      mediaType === 'video'
        ? SPLASH_VIDEO_MAX_SEC
        : Math.min(
            SPLASH_VIDEO_MAX_SEC,
            Math.max(1, Number(opts.countdown || SPLASH_IMAGE_COUNTDOWN_SEC) || SPLASH_IMAGE_COUNTDOWN_SEC)
          )
    this._splashVideoDurationSec = mediaType === 'video' ? SPLASH_VIDEO_MAX_SEC : 0
    const notice =
      opts.notice && Array.isArray(opts.notice.lines) && opts.notice.lines.length
        ? {
            text: String(opts.notice.text || '').trim().slice(0, SPLASH_NOTICE_MAX_LEN),
            html: String(opts.notice.html || '').trim(),
            font: SPLASH_NOTICE_FONTS[opts.notice.font] ? opts.notice.font : 'default',
            align: ['left', 'center', 'right'].indexOf(opts.notice.align) >= 0 ? opts.notice.align : 'center',
            lines: opts.notice.lines,
            lineHeight: Number(opts.notice.lineHeight) || 1.4,
            letterSpacing: Number(opts.notice.letterSpacing) || 0,
            lineGap: Number(opts.notice.lineGap) || 8
          }
        : opts.notice && (opts.notice.html || opts.notice.text)
          ? normalizeSplashNotice({
              noticeText: opts.notice.html || opts.notice.text,
              noticeFont: opts.notice.font,
              noticeLineHeight: opts.notice.lineHeight,
              noticeLetterSpacing:
                opts.notice.letterSpacing != null
                  ? Math.round(Number(opts.notice.letterSpacing) / 2)
                  : undefined,
              noticeLineGap:
                opts.notice.lineGap != null ? Math.round(Number(opts.notice.lineGap) / 2) : undefined
            })
          : null
    // 开屏期间让隐私禁触遮罩让位（遮罩在 root-portal 根层级，会压住开屏层吞掉「跳过」点击）；
    // 开屏自身全屏遮挡 + TabBar 守卫仍读 privacyGateActive，门控不失效
    const app = getApp()
    if (app && typeof app.setSplashActive === 'function') app.setSplashActive(true)
    this.setData({
      splashVisible: true,
      splashVideoReady: mediaType !== 'video',
      splashConfig: {
        mediaType,
        mediaUrl,
        posterUrl,
        originalUrl
      },
      splashCountdown: countdown,
      splashNotice: notice
    })

    // 图片走秒表；视频跳过秒数跟播片进度（timeupdate），不另开墙钟倒计时
    if (mediaType === 'image') {
      this._startSplashTick('image')
    } else if (this._splashTimer) {
      clearInterval(this._splashTimer)
      this._splashTimer = null
    }
    this._armSplashVideoMaxGuard(mediaType)
    this._armSplashVideoPlayGuards(mediaType)
    this._armSplashWeakNetSkip()

    // 运营配置了关联任务：按 launchId / 名称匹配即将发射，叠加可点击倒计时（改期自动跟踪）
    if (opts.launchId || opts.missionName) {
      this._loadSplashMission(String(opts.missionName || '').trim(), String(opts.launchId || '').trim())
    }
  },

  /** 按视频实际时长（上限 12s）收紧硬关屏；可选校正跳过秒数（仅元数据首次就绪时） */
  _applySplashVideoDuration(durationSec, opts) {
    const raw = Number(durationSec)
    if (!Number.isFinite(raw) || raw <= 0) return 0
    const sec = Math.min(SPLASH_VIDEO_MAX_SEC, Math.max(1, Math.ceil(raw)))
    const prev = Number(this._splashVideoDurationSec) || 0
    const changed = prev !== sec
    this._splashVideoDurationSec = sec
    if (changed && this.data.splashVisible && !this.data.splashFading) {
      // 片长短于 12s 时收紧硬上限，避免播完仍挂着等到墙钟
      this._armSplashVideoMaxGuard('video', { durationSec: sec })
      if (opts && opts.resetCountdown) {
        // 若 timeupdate 已推进进度，按剩余秒数校正，禁止回跳到整段片长
        const played = Math.max(0, Number(opts.currentTime) || 0)
        const left = Math.max(0, Math.ceil(sec - played))
        if (Number(this.data.splashCountdown) !== left) {
          this.setData({ splashCountdown: left })
        }
      }
    }
    return sec
  },

  _syncSplashCountdownFromPlayback(currentTime) {
    const dur = Number(this._splashVideoDurationSec) || SPLASH_VIDEO_MAX_SEC
    const t = Math.max(0, Number(currentTime) || 0)
    const left = Math.max(0, Math.ceil(dur - t))
    if (Number(this.data.splashCountdown) !== left) {
      this.setData({ splashCountdown: left })
    }
    return left
  },

  /**
   * 短等预取开屏可播地址；超时返回空，不阻塞展示。
   * 超时后下载不作废：完整 promise 记到 _splashPrefetching，交给 _cacheSplashMedia 复用，
   * 避免同一 URL 再起一路下载与 <video> 拉流抢带宽（慢网下会拖垮起播、触发封面降级）。
   */
  _prefetchSplashPlayUrl(playUrl, maxWaitMs) {
    const wait = Math.max(200, Number(maxWaitMs) || SPLASH_VIDEO_PREFETCH_MS)
    const reused = reuseSplashDownload(playUrl)
    const downloadPromise = reused
      ? reused
      : new Promise((resolve) => {
          try {
            wx.downloadFile({
              url: playUrl,
              success: (res) => {
                resolve(res && res.statusCode === 200 && res.tempFilePath ? res.tempFilePath : '')
              },
              fail: () => resolve('')
            })
          } catch (e) {
            resolve('')
          }
        })
    this._splashPrefetching = { url: playUrl, promise: downloadPromise }
    return Promise.race([downloadPromise, delayMs(wait).then(() => '')])
  },

  /** 展示中途变弱网且视频未起播：即刻关开屏，不空等封面 */
  _armSplashWeakNetSkip() {
    if (this._splashWeakNetHandler) return
    const onWeak = (res) => {
      if (!res || !res.weakNet) return
      if (!this.data.splashVisible || this.data.splashFading) return
      if (this.data.splashVideoReady) return
      this.closeSplash()
    }
    this._splashWeakNetHandler = onWeak
    if (typeof wx.onNetworkWeakChange === 'function') {
      try {
        wx.onNetworkWeakChange(onWeak)
      } catch (e) {}
    }
  },

  _clearSplashWeakNetSkip() {
    const handler = this._splashWeakNetHandler
    this._splashWeakNetHandler = null
    if (handler && typeof wx.offNetworkWeakChange === 'function') {
      try {
        wx.offNetworkWeakChange(handler)
      } catch (e) {}
    }
  },

  _markSplashVideoReady() {
    if (!this.data.splashVisible || this.data.splashFading) return
    if (this.data.splashVideoReady) return
    this.setData({ splashVideoReady: true })
  },

  _forceSplashVideoPlay() {
    try {
      const splashComp =
        (this.selectComponent && this.selectComponent('#indexSplash')) || this
      const ctx = wx.createVideoContext(SPLASH_VIDEO_ID, splashComp)
      if (ctx && typeof ctx.play === 'function') ctx.play()
    } catch (e) {}
  },

  /** 起播失败/缓冲过久：远程流直接关开屏；本地片失败才降级封面 */
  _fallbackSplashVideoToPoster() {
    if (!this.data.splashVisible || this.data.splashFading) return
    if (this.data.splashVideoReady) return
    const cfg = this.data.splashConfig || {}
    if (cfg.mediaType !== 'video') return
    const src = String(cfg.mediaUrl || '')
    const isLocal = src && !/^https?:\/\//i.test(src)
    if (!isLocal) {
      this.closeSplash()
      return
    }
    const poster = cfg.posterUrl || ''
    if (!poster) {
      this.closeSplash()
      return
    }
    this._clearSplashVideoPlayGuards()
    // 已降级为图片：清掉视频墙钟，改走固定图片倒计时
    this._clearSplashVideoMaxGuard()
    this._splashVideoShownAt = 0
    this._splashVideoDurationSec = 0
    this.setData({
      splashVideoReady: true,
      splashCountdown: SPLASH_IMAGE_COUNTDOWN_SEC,
      splashConfig: {
        ...cfg,
        mediaType: 'image',
        mediaUrl: poster
      }
    })
    this._startSplashTick('image')
  },

  _armSplashVideoPlayGuards(mediaType, opts) {
    this._clearSplashVideoPlayGuards({ keepStartedAt: !!(opts && opts.preserveStart) })
    if (mediaType !== 'video') return
    if (!(opts && opts.preserveStart) || !this._splashVideoGuardStartedAt) {
      this._splashVideoGuardStartedAt = Date.now()
    }
    const elapsed = Math.max(0, Date.now() - Number(this._splashVideoGuardStartedAt || Date.now()))
    const forceLeft = Math.max(0, SPLASH_VIDEO_FORCE_PLAY_MS - elapsed)
    // 元数据已就绪过：降级预算包含 loadedmetadata 的延长额度，
    // 否则切后台回来 re-arm 时会按 2.8s 立即降级，吞掉延长窗口
    const fallBudget =
      SPLASH_VIDEO_FALLBACK_MS + (this._splashVideoMetaExtended ? SPLASH_VIDEO_META_EXTEND_MS : 0)
    const fallLeft = Math.max(0, fallBudget - elapsed)
    if (forceLeft <= 0) {
      this._forceSplashVideoPlay()
    } else {
      this._splashVideoForcePlayTimer = setTimeout(() => {
        this._splashVideoForcePlayTimer = null
        if (!this.data.splashVisible || this.data.splashFading || this.data.splashVideoReady) return
        this._forceSplashVideoPlay()
      }, forceLeft)
    }
    if (fallLeft <= 0) {
      // 已超时：下一 macrotask 再降级，避免在 resume/setData 调用栈里同步拆掉 <video>
      this._splashVideoFallbackTimer = setTimeout(() => {
        this._splashVideoFallbackTimer = null
        this._fallbackSplashVideoToPoster()
      }, 0)
    } else {
      this._splashVideoFallbackTimer = setTimeout(() => {
        this._splashVideoFallbackTimer = null
        this._fallbackSplashVideoToPoster()
      }, fallLeft)
    }
  },

  _clearSplashVideoPlayGuards(opts) {
    if (this._splashVideoForcePlayTimer) {
      clearTimeout(this._splashVideoForcePlayTimer)
      this._splashVideoForcePlayTimer = null
    }
    if (this._splashVideoFallbackTimer) {
      clearTimeout(this._splashVideoFallbackTimer)
      this._splashVideoFallbackTimer = null
    }
    if (!(opts && opts.keepStartedAt)) {
      this._splashVideoGuardStartedAt = 0
      this._splashVideoMetaExtended = false
    }
  },

  /** 视频开屏硬上限：到点强制关闭（防预览未就绪时播原片超时、或 timeupdate 丢失） */
  _armSplashVideoMaxGuard(mediaType, opts) {
    if (this._splashVideoMaxTimer) {
      clearTimeout(this._splashVideoMaxTimer)
      this._splashVideoMaxTimer = null
    }
    if (mediaType !== 'video') return
    const durSec = Math.min(
      SPLASH_VIDEO_MAX_SEC,
      Math.max(
        1,
        Number((opts && opts.durationSec) || this._splashVideoDurationSec || SPLASH_VIDEO_MAX_SEC) ||
          SPLASH_VIDEO_MAX_SEC
      )
    )
    // 首次 arm 记展示起点；按片长收紧时保留起点，按剩余墙钟续跑
    if (!this._splashVideoShownAt) this._splashVideoShownAt = Date.now()
    const elapsed = Date.now() - this._splashVideoShownAt
    const leftMs = Math.max(0, durSec * 1000 - elapsed)
    this._splashVideoMaxTimer = setTimeout(() => {
      this._splashVideoMaxTimer = null
      if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
    }, leftMs || 0)
  },

  _clearSplashVideoMaxGuard() {
    if (this._splashVideoMaxTimer) {
      clearTimeout(this._splashVideoMaxTimer)
      this._splashVideoMaxTimer = null
    }
  },

  onSplashVideoPlay() {
    this._markSplashVideoReady()
    this._clearSplashVideoPlayGuards()
  },

  onSplashVideoTimeUpdate(e) {
    const detail = (e && e.detail) || {}
    const t = Number(detail.currentTime) || 0
    const metaDur = Number(detail.duration) || 0
    // 播放中只记片长、不重置倒计时；剩余秒数由进度同步
    if (metaDur > 0) this._applySplashVideoDuration(metaDur)
    const dur = Number(this._splashVideoDurationSec) || SPLASH_VIDEO_MAX_SEC
    this._syncSplashCountdownFromPlayback(t)
    // 播到实际上限立即关闭（截取预览未就绪、或仍在播原片时兜底）
    if (t >= dur || t >= SPLASH_VIDEO_MAX_SEC) {
      if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
      return
    }
    // 仅在真正开播后揭封面；不要仅凭 duration>0（元数据就绪）揭开，否则会露出黑屏缓冲
    if (t > 0) {
      this._markSplashVideoReady()
      this._clearSplashVideoPlayGuards()
    }
  },

  /** 元数据就绪：按片长设定跳过倒计时；再踢 play，并把降级窗口一次性延长 */
  onSplashVideoLoadedMeta(e) {
    const detail = (e && e.detail) || {}
    const metaDur = Number(detail.duration) || 0
    const cur = Number(detail.currentTime) || 0
    if (metaDur > 0) {
      this._applySplashVideoDuration(metaDur, { resetCountdown: true, currentTime: cur })
    }

    if (!this.data.splashVisible || this.data.splashFading) return
    const cfg = this.data.splashConfig || {}
    if (cfg.mediaType !== 'video') return
    // 已起播仍可校正片长；仅未就绪时延长降级窗 / 踢 play
    if (this.data.splashVideoReady) return
    if (this._splashVideoMetaExtended) return
    this._splashVideoMetaExtended = true
    this._forceSplashVideoPlay()
    if (this._splashVideoFallbackTimer) {
      clearTimeout(this._splashVideoFallbackTimer)
      this._splashVideoFallbackTimer = setTimeout(() => {
        this._splashVideoFallbackTimer = null
        this._fallbackSplashVideoToPoster()
      }, SPLASH_VIDEO_META_EXTEND_MS)
    }
  },

  /** 预览版失败：降级封面图，避免黑屏假死 */
  onSplashVideoError() {
    const cfg = this.data.splashConfig || {}
    if (!cfg || cfg.mediaType !== 'video') return
    this._fallbackSplashVideoToPoster()
  },

  /**
   * 按后台关联的 launchId / 任务名，在即将发射列表中匹配并跟踪 NET（改期自动更新倒计时）。
   * 探针确认飞行中 → 关开屏；终态 → 不挂任务卡（云端随后下架该媒体）。
   */
  _collectSplashUpcomingLocals() {
    const seen = {}
    const out = []
    const push = (list) => {
      if (!Array.isArray(list)) return
      for (let i = 0; i < list.length; i++) {
        const m = list[i]
        if (!m || m.id == null) continue
        const id = String(m.id)
        if (seen[id]) continue
        seen[id] = true
        out.push(m)
      }
    }
    push(this.data && this.data.upcomingMissions)
    try {
      push(peekUpcomingMissionsList())
    } catch (e) {}
    return out
  },

  _applySplashMission(payload) {
    if (!payload) return
    this.setData({ splashMission: payload })
    this._startSplashMissionTick()
    warmSplashAgencyLogo(payload.agencyLogoRemote || payload.agencyLogo)
  },

  _persistSplashMissionHit(boundName, payload) {
    if (!payload || !payload.id) return
    const logo = payload.agencyLogoRemote || payload.agencyLogo || ''
    try {
      const prev = wx.getStorageSync(SPLASH_MISSION_HIT_KEY) || null
      const keepLogo = logo || (prev && String(prev.id) === String(payload.id) ? prev.agencyLogo : '')
      wx.setStorageSync(SPLASH_MISSION_HIT_KEY, {
        configName: boundName || String(payload.name || ''),
        id: payload.id,
        name: payload.name,
        launchTime: payload.launchTime,
        agencyName: payload.agencyName,
        agencyLogo: keepLogo,
        rocketName: payload.rocketName,
        savedAt: Date.now()
      })
    } catch (e) {}
  },

  _mergeSplashMissionLogo(payload) {
    if (!payload) return payload
    if (payload.agencyLogo) return payload
    const cur = this.data.splashMission
    if (cur && String(cur.id) === String(payload.id) && cur.agencyLogo) {
      return {
        ...payload,
        agencyLogo: cur.agencyLogo,
        agencyLogoRemote: cur.agencyLogoRemote || payload.agencyLogoRemote,
        agencyLogoBgTone: cur.agencyLogoBgTone || payload.agencyLogoBgTone
      }
    }
    try {
      const cached = wx.getStorageSync(SPLASH_MISSION_HIT_KEY) || null
      if (cached && String(cached.id) === String(payload.id) && cached.agencyLogo) {
        const logo = splashLogoForDisplay(cached.agencyLogo)
        return {
          ...payload,
          agencyLogo: logo.display || cached.agencyLogo,
          agencyLogoRemote: logo.remote || cached.agencyLogo,
          agencyLogoBgTone: payload.agencyLogoBgTone || resolveAgencyLogoBgTone(cached.agencyLogo)
        }
      }
    } catch (e) {}
    return payload
  },

  _refineSplashMissionLogo(hit) {
    if (!hit) return
    enrichOneMissionAgencyLogo(hit, { timeoutMs: 8000 })
      .then((enriched) => {
        const payload = buildSplashMissionPayload(enriched)
        if (!payload || !this.data.splashVisible || this.data.splashFading) return
        const cur = this.data.splashMission
        if (!cur || String(cur.id) !== String(payload.id)) return
        if (cur.agencyLogo === payload.agencyLogo && cur.agencyLogoBgTone === payload.agencyLogoBgTone) return
        this.setData({
          'splashMission.agencyLogo': payload.agencyLogo,
          'splashMission.agencyLogoRemote': payload.agencyLogoRemote,
          'splashMission.agencyLogoBgTone': payload.agencyLogoBgTone
        })
        this._persistSplashMissionHit(cur.name, { ...cur, ...payload })
        warmSplashAgencyLogo(payload.agencyLogoRemote)
      })
      .catch(() => {})
  },

  async _loadSplashMission(missionName, launchId) {
    const boundId = String(launchId || '').trim()
    const boundName = String(missionName || '').trim()
    if (!boundId && !boundName) return

    // 秒显快路径：同 launchId / 同名配置命中缓存 → 先展示（~0ms），云端校正 NET。
    // 距发射 ≤2h 不快显：此时可能已在飞行中/终态，等实时确认，避免卡片闪现后又整屏关闭
    let fastShown = false
    try {
      const cachedHit = wx.getStorageSync(SPLASH_MISSION_HIT_KEY) || null
      const sameBind =
        cachedHit &&
        cachedHit.id &&
        cachedHit.launchTime &&
        ((boundId && String(cachedHit.id) === boundId) ||
          (!boundId && String(cachedHit.configName || '') === boundName))
      if (sameBind) {
        const ts = new Date(cachedHit.launchTime).getTime()
        if (Number.isFinite(ts) && ts - Date.now() > SPLASH_LIVE_CHECK_WINDOW_MS) {
          const cachedLogo = cachedHit.agencyLogo || ''
          const logo = splashLogoForDisplay(cachedLogo)
          this._applySplashMission({
            id: cachedHit.id,
            name: cachedHit.name || '',
            launchTime: cachedHit.launchTime,
            agencyName: cachedHit.agencyName || '',
            agencyLogo: logo.display || cachedLogo,
            agencyLogoRemote: logo.remote || cachedLogo,
            agencyLogoBgTone: cachedLogo ? resolveAgencyLogoBgTone(cachedLogo) : '',
            rocketName: cachedHit.rocketName || ''
          })
          fastShown = true
        }
      }
    } catch (e) {}

    const showFromHit = (hit) => {
      const payload = this._mergeSplashMissionLogo(buildSplashMissionPayload(hit))
      if (!payload) return false
      this._persistSplashMissionHit(boundName, payload)
      if (!this.data.splashVisible || this.data.splashFading) return true
      this._applySplashMission(payload)
      this._refineSplashMissionLogo(hit)
      return true
    }

    // 首页列表 / 内存快照已有任务：立刻出卡，不等再打 upcoming
    if (!fastShown) {
      let locals = this._collectSplashUpcomingLocals()
      if (boundId) {
        try {
          const snap = findMissionInListSnapshots(boundId, 'upcoming')
          if (snap) locals = [snap].concat(locals)
        } catch (e) {}
      }
      const localHit = boundId
        ? locals.find((m) => m && String(m.id) === boundId)
        : null
      if (localHit && localHit.launchTime) {
        if (Number(localHit.statusId) === SPLASH_STATUS_INFLIGHT) {
          if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
          return
        }
        if (showFromHit(localHit)) fastShown = true
      }
    }

    try {
      if (typeof this._waitSplashGateForCountdown === 'function') {
        await this._waitSplashGateForCountdown()
      }
      const result = await getUpcomingMissionsAny(20)
      const list = result && Array.isArray(result.list) ? result.list : []
      // 归一化：小写、去空格与标点，互相包含即视为命中
      const norm = (s) =>
        String(s || '')
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
      // 兼容 "Starship Flight 13" ↔ "Starship Flight Test 13" / "Starship IFT-13"
      // softNorm 已去空格标点，"starshipift13" 里 ift 无词边界，必须用 ift(?=\d)
      const softNorm = (s) =>
        norm(s)
          .replace(/integratedflighttest/g, 'flight')
          .replace(/flighttest/g, 'flight')
          .replace(/ift(?=\d)/g, 'flight')
      const extractFlightNo = (s) => {
        const m = String(s || '').match(/flight\s*(?:test\s*)?#?\s*(\d+)/i) ||
          String(s || '').match(/\bift[-\s]?(\d+)/i)
        return m ? Number(m[1]) : 0
      }
      const target = softNorm(boundName)
      const targetFlight = extractFlightNo(boundName)

      const nowTs = Date.now()
      const nameMatches = (m) => {
        if (boundId && m && String(m.id) === boundId) return true
        if (!target && !targetFlight) return false
        const candidates = [m.name, m.missionName]
        if (targetFlight) {
          const byNo = candidates.some((c) => extractFlightNo(c) === targetFlight) &&
            candidates.some((c) => /starship/i.test(String(c || '')) || /星舰/.test(String(c || '')))
          // 仅当双方都能抽出同一 Flight 号且候选侧含星舰时，用编号命中（避免 Falcon Flight 误配）
          if (byNo) return true
          // 配置侧无星舰关键字时，纯编号命中也放行（运营手填「Flight 13」）
          if (!/starship|星舰/i.test(boundName) && candidates.some((c) => extractFlightNo(c) === targetFlight)) {
            return true
          }
        }
        return candidates.some((c) => {
          const n = softNorm(c)
          return n && target && (n.indexOf(target) !== -1 || target.indexOf(n) !== -1)
        })
      }

      // launchId 优先：改期后仍锁定同一任务（名称/Flight 文案变化也不丢）
      let idHit = null
      if (boundId) {
        idHit = list.find((m) => m && String(m.id) === boundId) || null
      }

      const matches = list.filter((m) => {
        if (!m || !m.id || !m.launchTime) return false
        const ts = new Date(m.launchTime).getTime()
        // 已过点但仍在列表（短暂 hold）：launchId 命中仍跟踪；纯名称匹配要求未来 NET
        if (!Number.isFinite(ts)) return false
        if (ts <= nowTs && !(boundId && String(m.id) === boundId)) return false
        return nameMatches(m)
      })

      // 生命周期：列表缓存里同任务已是飞行中 → 直接关闭开屏（不显示卡片）
      const inflightHit =
        (idHit && Number(idHit.statusId) === SPLASH_STATUS_INFLIGHT && idHit) ||
        list.find((m) => m && m.id && Number(m.statusId) === SPLASH_STATUS_INFLIGHT && nameMatches(m))
      if (inflightHit) {
        if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
        return
      }

      if (!matches.length) {
        // 有 launchId 但已离开 upcoming：用探针确认是否飞行中/终态
        if (boundId) {
          try {
            const rows = await fetchLaunchStatusSnapshot([boundId])
            const row = Array.isArray(rows)
              ? rows.find((r) => r && String(r.id) === boundId)
              : null
            const sid = row && row.status ? Number(row.status.id) : 0
            if (sid === SPLASH_STATUS_INFLIGHT) {
              if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
              return
            }
            if (SPLASH_STATUS_TERMINAL[sid]) {
              if (fastShown) this._clearSplashMissionCard(true)
              return
            }
          } catch (e) {}
        }
        // 快显的缓存卡片已过时（任务不在即将发射列表里了）：移除并清缓存
        if (fastShown) this._clearSplashMissionCard(true)
        return
      }

      // 命中多条：优先 launchId，否则取发射时间最近的
      matches.sort((a, b) => new Date(a.launchTime).getTime() - new Date(b.launchTime).getTime())
      const hit =
        (boundId && matches.find((m) => String(m.id) === boundId)) || matches[0]

      // 先出卡（覆盖 / 列表自带 logo / 本地缓存），不再等 400 家目录
      showFromHit(hit)

      // 临近发射（±2h）：出卡后再探状态；飞行中关开屏，终态撤卡
      const launchTs = new Date(hit.launchTime).getTime()
      if (Math.abs(nowTs - launchTs) <= SPLASH_LIVE_CHECK_WINDOW_MS) {
        try {
          const rows = await fetchLaunchStatusSnapshot([hit.id])
          const row = Array.isArray(rows)
            ? rows.find((r) => r && String(r.id) === String(hit.id))
            : null
          const sid = row && row.status ? Number(row.status.id) : 0
          if (sid === SPLASH_STATUS_INFLIGHT) {
            if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
            return
          }
          if (SPLASH_STATUS_TERMINAL[sid]) {
            this._clearSplashMissionCard(true)
            return
          }
        } catch (e) {}
      }
    } catch (e) {
      // 弱网匹配失败：若快显卡片发射时间已不合理地遥远，清掉避免开屏显示「一千多天」
      if (fastShown) {
        try {
          const shown = this.data.splashMission
          const ts = shown && shown.launchTime ? new Date(shown.launchTime).getTime() : NaN
          const MAX_SPLASH_HORIZON_MS = 400 * 24 * 60 * 60 * 1000
          if (!Number.isFinite(ts) || ts - Date.now() > MAX_SPLASH_HORIZON_MS) {
            this._clearSplashMissionCard(true)
          }
        } catch (e2) {}
      }
    }
  },

  /** 移除任务倒计时卡片；removeCache 为真时同时清掉秒显缓存 */
  _clearSplashMissionCard(removeCache) {
    if (this._splashMissionTimer) {
      clearInterval(this._splashMissionTimer)
      this._splashMissionTimer = null
    }
    if (this.data.splashMission || this.data.splashMissionCd) {
      this.setData({ splashMission: null, splashMissionCd: null })
    }
    if (removeCache) {
      try {
        wx.removeStorageSync(SPLASH_MISSION_HIT_KEY)
      } catch (e) {}
    }
  },

  /** 任务倒计时每秒刷新（独立于开屏跳过倒计时的 timer） */
  _startSplashMissionTick() {
    if (this._splashMissionTimer) {
      clearInterval(this._splashMissionTimer)
      this._splashMissionTimer = null
    }
    const update = () => {
      const mission = this.data.splashMission
      if (!mission || !this.data.splashVisible) {
        if (this._splashMissionTimer) {
          clearInterval(this._splashMissionTimer)
          this._splashMissionTimer = null
        }
        return
      }
      const diff = new Date(mission.launchTime).getTime() - Date.now()
      if (diff <= 0) {
        if (this._splashMissionTimer) {
          clearInterval(this._splashMissionTimer)
          this._splashMissionTimer = null
        }
        this.setData({ splashMissionCd: { imminent: true, d: '0', h: '00', m: '00', s: '00' } })
        return
      }
      const pad2 = (n) => (n < 10 ? '0' + n : String(n))
      const totalSec = Math.floor(diff / 1000)
      const d = Math.floor(totalSec / 86400)
      const h = Math.floor((totalSec % 86400) / 3600)
      const m = Math.floor((totalSec % 3600) / 60)
      const s = totalSec % 60
      this.setData({
        splashMissionCd: {
          imminent: false,
          d: String(d),
          h: pad2(h),
          m: pad2(m),
          s: pad2(s)
        }
      })
    }
    update()
    this._splashMissionTimer = setInterval(update, 1000)
  },

  /** 开屏任务卡发射商 logo：落盘并分析透明底色 */
  onSplashAgencyLogoError() {
    const cur = this.data.splashMission
    if (!cur) return
    const shown = String(cur.agencyLogo || '').trim()
    const remote = String(cur.agencyLogoRemote || '').trim()
    if (shown && shown !== remote) {
      try {
        invalidateAgencyLogoCache(remote || shown)
      } catch (e) {}
    }
    if (remote && shown !== remote) {
      this.setData({ 'splashMission.agencyLogo': remote })
    }
  },

  onSplashAgencyLogoLoad(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const fromComp = (e && e.detail) || {}
    const remote = ds.logoRemote || fromComp.logoRemote || ''
    const url = String(remote || '').trim()
    if (!url || !isRemoteAgencyLogoUrl(url)) return
    const self = this
    persistAgencyLogoAfterRemoteLoad(url, function (localPath) {
      if (!localPath) return
      ensureAgencyLogoBgTone(url, localPath, function (tone) {
        if (!tone) return
        const cur = self.data.splashMission
        if (!cur || cur.agencyLogoBgTone === tone) return
        self.setData({ 'splashMission.agencyLogoBgTone': tone })
      })
    })
  },

  /** 点击开屏任务倒计时卡片：关闭开屏并跳转任务详情 */
  onSplashMissionTap() {
    if (this.data.splashFading) return
    const mission = this.data.splashMission
    if (!mission || !mission.id) return
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {}
    const app = getApp()
    const privacyBlocked = !!(app && app.globalData && app.globalData.privacyGateActive)
    this.closeSplash()
    // 隐私未授权：只关开屏，交给 closeSplash 内的隐私弹窗接力，不跳转
    if (privacyBlocked) return
    wx.navigateTo({
      url: buildMissionDetailUrl({ id: mission.id, detailType: 'upcoming' }),
      fail: () => {}
    })
  },

  /** 启动图片开屏跳过倒计时（视频改由播片进度驱动，见 timeupdate） */
  _startSplashTick(mediaType) {
    if (this._splashTimer) {
      clearInterval(this._splashTimer)
      this._splashTimer = null
    }
    if (mediaType !== 'image') return
    this._splashTimer = setInterval(() => {
      const next = this.data.splashCountdown - 1
      if (next <= 0) {
        this.closeSplash()
      } else {
        this.setData({ splashCountdown: next })
      }
    }, 1000)
  },

  _resumeSplashTimer() {
    const cfg = this.data.splashConfig || {}
    // 图片：剩余秒数 > 0 续跑秒表；视频由 timeupdate 驱动，不恢复墙钟 tick
    if (cfg.mediaType !== 'video' && this.data.splashCountdown > 0) {
      this._startSplashTick('image')
    }
    // 视频硬上限按片长墙钟剩余续跑（切后台期间也计入额度）
    if (cfg.mediaType === 'video' && this.data.splashVisible && !this.data.splashFading) {
      const durSec = Number(this._splashVideoDurationSec) || SPLASH_VIDEO_MAX_SEC
      const startedAt = Number(this._splashVideoShownAt || 0)
      const elapsed = startedAt ? Date.now() - startedAt : durSec * 1000
      const left = Math.max(0, durSec * 1000 - elapsed)
      this._clearSplashVideoMaxGuard()
      if (left <= 0) {
        this.closeSplash()
      } else {
        this._splashVideoMaxTimer = setTimeout(() => {
          this._splashVideoMaxTimer = null
          if (this.data.splashVisible && !this.data.splashFading) this.closeSplash()
        }, left)
      }
      // 回前台若仍未起播：立刻再踢 play，降级定时按首次展示起算剩余时间（不整段重计）
      if (left > 0 && !this.data.splashVideoReady) {
        this._forceSplashVideoPlay()
        this._armSplashVideoPlayGuards('video', { preserveStart: true })
      }
    }
    // 任务倒计时按绝对时间重算，直接重启即可
    if (this.data.splashMission) {
      this._startSplashMissionTick()
    }
  },

  /** 缓存完整媒体池；仅预下载本次开屏用的压缩预览（不再预拉池内其它条） */
  _cacheSplashMedia(cfg, prevCached, opts) {
    const prev = prevCached || {}
    const items = Array.isArray(cfg.mediaItems) ? cfg.mediaItems : []
    const prevLocalPaths = prev.localPaths && typeof prev.localPaths === 'object' ? { ...prev.localPaths } : {}
    const noticeText = String(cfg.noticeText != null ? cfg.noticeText : prev.noticeText || '').trim()
    const noticeFontRaw = String(cfg.noticeFont != null ? cfg.noticeFont : prev.noticeFont || 'default').trim()
    const lhRaw = cfg.noticeLineHeight != null ? cfg.noticeLineHeight : prev.noticeLineHeight
    const lsRaw = cfg.noticeLetterSpacing != null ? cfg.noticeLetterSpacing : prev.noticeLetterSpacing
    const lgRaw = cfg.noticeLineGap != null ? cfg.noticeLineGap : prev.noticeLineGap
    const lhNum = Number(lhRaw)
    const lsNum = Number(lsRaw)
    const lgNum = Number(lgRaw)
    const baseEntry = {
      enabled: true,
      mediaItems: items,
      lastSplashId: cfg.lastSplashId || '',
      mediaUrl: cfg.mediaUrl || '',
      playUrl: cfg.playUrl || '',
      previewUrl: cfg.previewUrl || '',
      posterUrl: cfg.posterUrl || '',
      mediaType: cfg.mediaType || 'image',
      countdownSeconds:
        cfg.mediaType === 'video'
          ? SPLASH_VIDEO_MAX_SEC
          : Number(cfg.countdownSeconds) || SPLASH_IMAGE_COUNTDOWN_SEC,
      noticeText,
      noticeFont: SPLASH_NOTICE_FONTS[noticeFontRaw] ? noticeFontRaw : 'default',
      noticeLineHeight: Number.isFinite(lhNum) ? Math.min(2.5, Math.max(1, Math.round(lhNum * 10) / 10)) : 1.4,
      noticeLetterSpacing: Number.isFinite(lsNum) ? Math.min(8, Math.max(0, Math.round(lsNum))) : 0,
      noticeLineGap: Number.isFinite(lgNum) ? Math.min(24, Math.max(0, Math.round(lgNum))) : 4,
      localPath: prev.localPath || '',
      localPaths: prevLocalPaths,
      cachedAt: Date.now()
    }
    try {
      wx.setStorageSync(SPLASH_CACHE_KEY, baseEntry)
    } catch (e) {}

    // 视频被降级为静态图（过审关视频 / 省流·紧急档非 Pro）：只缓存配置，跳过视频预下载
    if (opts && opts.skipMediaDownload) return
    // 正在用 https 拉流：延后下载，避免和 <video> 抢带宽拖垮首播
    if (opts && opts.deferMediaDownload) {
      this._splashDeferredCache = { cfg, prevCached }
      return
    }

    // 只预下载本次选中的压缩预览，避免冷启动额外拉未播视频；原片不落盘
    const playUrls = []
    if (cfg.playUrl && !(cfg.originalUrl && cfg.playUrl === cfg.originalUrl)) {
      playUrls.push(cfg.playUrl)
    } else if (cfg.previewUrl) {
      playUrls.push(cfg.previewUrl)
    }

    const fs = wx.getFileSystemManager()
    const saveTemp = (playUrl, tempFilePath) => {
      fs.saveFile({
        tempFilePath,
        success: (saveRes) => {
          try {
            const cur = wx.getStorageSync(SPLASH_CACHE_KEY) || baseEntry
            const map = cur.localPaths && typeof cur.localPaths === 'object' ? { ...cur.localPaths } : {}
            if (map[playUrl] && map[playUrl] !== saveRes.savedFilePath) {
              try {
                fs.removeSavedFile({ filePath: map[playUrl], fail: () => {} })
              } catch (e) {}
            }
            map[playUrl] = saveRes.savedFilePath
            const keys = Object.keys(map)
            if (keys.length > 6) {
              const drop = keys.slice(0, keys.length - 6)
              drop.forEach((k) => {
                try {
                  fs.removeSavedFile({ filePath: map[k], fail: () => {} })
                } catch (e) {}
                delete map[k]
              })
            }
            wx.setStorageSync(SPLASH_CACHE_KEY, {
              ...cur,
              mediaItems: cur.mediaItems && cur.mediaItems.length ? cur.mediaItems : items,
              localPaths: map,
              localPath: (cfg.playUrl && map[cfg.playUrl]) || cur.localPath || ''
            })
          } catch (e) {}
        },
        fail: () => {}
      })
    }
    const startDownload = (playUrl) => {
      wx.downloadFile({
        url: playUrl,
        success: (res) => {
          if (!res || res.statusCode !== 200 || !res.tempFilePath) return
          saveTemp(playUrl, res.tempFilePath)
        },
        fail: () => {}
      })
    }
    const downloadOne = (playUrl) => {
      if (!playUrl || !/^https?:\/\//i.test(playUrl)) return
      // 原片不预下（仅缓存 preview 压缩片）
      if (cfg.originalUrl && playUrl === cfg.originalUrl && cfg.playUrl && cfg.playUrl !== cfg.originalUrl) return
      const existing = prevLocalPaths[playUrl]
      if (existing) {
        try {
          fs.accessSync(existing)
          return
        } catch (e) {
          delete prevLocalPaths[playUrl]
        }
      }
      // 开屏前 _prefetchSplashPlayUrl 已在下载同一 URL：复用其结果，不再另起一路下载抢带宽
      const pending = this._splashPrefetching
      if (pending && pending.url === playUrl && pending.promise) {
        this._splashPrefetching = null
        pending.promise.then((tempFilePath) => {
          if (!tempFilePath) return
          const playingSrc = this.data && this.data.splashConfig ? this.data.splashConfig.mediaUrl : ''
          // saveFile 会移动临时文件；正在从该临时文件播放时移动会中断播放，此时退回独立下载
          if (tempFilePath === playingSrc && this.data.splashVisible) {
            startDownload(playUrl)
            return
          }
          saveTemp(playUrl, tempFilePath)
        })
        return
      }
      startDownload(playUrl)
    }

    playUrls.forEach(downloadOne)
  },

  onSplashVideoEnded() {
    this.closeSplash()
  },

  /** 用户手动点「跳过」：中度震动反馈（倒计时自动结束走 closeSplash，不震动） */
  onSplashSkipTap() {
    if (this.data.splashFading) return
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {}
    this.closeSplash()
  },

  closeSplash() {
    if (this.data.splashFading) return
    if (typeof this._releaseSplashCountdownGate === 'function') {
      this._releaseSplashCountdownGate(0)
    }
    this._splashUiActive = false
    if (this._splashTimer) {
      clearInterval(this._splashTimer)
      this._splashTimer = null
    }
    if (this._splashMissionTimer) {
      clearInterval(this._splashMissionTimer)
      this._splashMissionTimer = null
    }
    this._clearSplashVideoMaxGuard()
    this._clearSplashVideoPlayGuards()
    this._clearSplashWeakNetSkip()
    this._splashVideoShownAt = 0
    const deferred = this._splashDeferredCache
    this._splashDeferredCache = null
    if (deferred && deferred.cfg) {
      try {
        this._cacheSplashMedia(
          deferred.cfg,
          (wx.getStorageSync(SPLASH_CACHE_KEY) || deferred.prevCached) || null
        )
      } catch (e) {}
    }
    this.setData({ splashFading: true })
    try {
      if (typeof this._flushSplashDeferredListOnly === 'function') {
        this._flushSplashDeferredListOnly()
      }
    } catch (eList) {}
    setTimeout(() => {
      this.setData({
        splashVisible: false,
        splashFading: false,
        splashVideoReady: false,
        splashNotice: null,
        splashMission: null,
        splashMissionCd: null
      }, () => {
        try {
          if (typeof this._flushSplashDeferredNetwork === 'function') {
            this._flushSplashDeferredNetwork()
          } else if (typeof this._flushSplashDeferredHomeWork === 'function') {
            this._flushSplashDeferredHomeWork()
          }
        } catch (eFlush) {}
        const app = getApp()
        if (app && typeof app.setSplashActive === 'function') app.setSplashActive(false)
        setTimeout(() => this._maybePromptPrivacy(), 200)
      })
    }, 500)
  },
}

module.exports = {
  methods,
  /** 把全部方法挂到页面实例上（委托加载后调用） */
  attachTo(page) {
    page.__splashMethods = methods
    Object.keys(methods).forEach((k) => {
      page[k] = methods[k].bind(page)
    })
    page.__splashAttached = true
  }
}
