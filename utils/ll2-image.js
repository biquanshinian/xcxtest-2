/**
 * LL2 / 外链配图统一链路：Worker 代理 + 去重兜底链 + binderror 逐级推进。
 * 监控中心卡片与详情页头图共用，避免「卡空白、详情却有图」的字段分裂。
 */
const { workerProxyUrl } = require('./config.js')

/** 自有 COS / 云存储 CDN：国内可直连，无需再包 Worker 代理 */
function isOwnCdnUrl(url) {
  const s = String(url || '')
  return /^cloud:\/\//i.test(s) ||
    s.indexOf('.myqcloud.com/') !== -1 ||
    s.indexOf('.tcb.qcloud.la/') !== -1 ||
    s.indexOf('.tcloudbaseapp.com/') !== -1 ||
    s.indexOf('marsx.com.cn') !== -1
}

/**
 * 外链图 → Cloudflare Worker 图片代理（GET /image?url=...）。
 * 自有 CDN / 非 http(s) 原样返回；无代理基址时返回空串（调用方用原链兜底）。
 */
function proxiedImageUrl(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) return s
  if (isOwnCdnUrl(s)) return s
  const base = String(workerProxyUrl || '').trim().replace(/\/$/, '')
  if (!base) return ''
  return base + '/image?url=' + encodeURIComponent(s)
}

/** 去掉 imageMogr2 / ci-process 压缩参数，保留原图直链 */
function stripImageProcess(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  const q = s.indexOf('?')
  if (q < 0) return s
  if (!/imageMogr2|ci-process=/i.test(s.slice(q + 1))) return s
  return s.slice(0, q)
}

/**
 * 把若干候选 URL 展开为「代理 → 原链」去重链（跳过空值与重复）。
 * @param {...(string|string[]|null|undefined)} candidates
 * @returns {string[]}
 */
function buildLl2ImageChain() {
  const chain = []
  const push = (u) => {
    const s = String(u || '').trim()
    if (!s) return
    if (chain.indexOf(s) < 0) chain.push(s)
  }
  for (let i = 0; i < arguments.length; i++) {
    const item = arguments[i]
    if (Array.isArray(item)) {
      item.forEach(push)
      continue
    }
    const raw = String(item || '').trim()
    if (!raw) continue
    const proxied = proxiedImageUrl(raw)
    if (proxied && proxied !== raw) push(proxied)
    push(raw)
    const stripped = stripImageProcess(raw)
    if (stripped && stripped !== raw) {
      const proxiedStripped = proxiedImageUrl(stripped)
      if (proxiedStripped && proxiedStripped !== stripped) push(proxiedStripped)
      push(stripped)
    }
  }
  return chain
}

/**
 * binderror 推进：返回下一张与剩余链。
 * @param {string} current
 * @param {string[]} fallbacks
 * @returns {{ next: string, remaining: string[] }}
 */
function advanceImageFallback(current, fallbacks) {
  const list = Array.isArray(fallbacks) ? fallbacks.slice() : []
  let next = list.shift() || ''
  // 避免与当前相同导致死循环（本地缓存路径偶发等于远程）
  if (next && next === current) next = list.shift() || ''
  return { next: next || '', remaining: list }
}

module.exports = {
  isOwnCdnUrl,
  proxiedImageUrl,
  stripImageProcess,
  buildLl2ImageChain,
  advanceImageFallback
}
