/**
 * utils/text-translate.js — 页面级按需翻译（"翻译/原文"按钮共用，全项目唯一正本）
 * 翻译来源优先级：字段自带预翻译 zh（云端富化，本地秒切）
 * → ll2Query 词典 + translation_cache（免费秒回）
 * → 单条长文本走混元大模型 hy3-preview（质量优先，见 translateTextsSmart）
 * → 腾讯云 TMT 兜底（多条批量场景直接走 TMT，输入输出严格按序对齐）。
 * 失败项保留原文展示。
 */

/** 已含足量中文的文本无需送翻。URL 不计入英文占比：中文短句带长链接不应被误判为英文 */
function isMostlyChinese(text) {
  const s = String(text || '').replace(/https?:\/\/\S+/g, ' ')
  if (!s.trim()) return true
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length
  const latin = (s.match(/[A-Za-z]/g) || []).length
  return cjk > 0 && cjk / (cjk + latin) >= 0.25
}

/** 与云函数 ll2Query translateTexts 的单次上限对齐（TRANSLATE_MAX_ITEMS / TRANSLATE_MAX_TOTAL_CHARS） */
const TRANSLATE_BATCH_MAX_ITEMS = 20
const TRANSLATE_BATCH_MAX_CHARS = 12000

/** 单批调用云端翻译（条数/字符量须已在上限内） */
function translateTextsChunk(texts) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      reject(new Error('云函数能力不可用'))
      return
    }
    wx.cloud.callFunction({
      name: 'll2Query',
      data: { action: 'translateTexts', texts },
      timeout: 30000,
      success: (res) => {
        const r = res && res.result
        if (r && r.success && Array.isArray(r.list)) {
          if (r.tmtConfigured === false && !r.list.some((s) => s)) {
            reject(new Error('云端翻译服务未配置密钥'))
            return
          }
          resolve(r.list.map((s) => String(s || '')))
        } else {
          reject(new Error((r && r.error) || '翻译服务返回为空'))
        }
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '翻译服务调用失败'))
    })
  })
}

/**
 * 批量翻译英文文本。超过云端单次上限时自动分批并行请求后按序合并，
 * 避免长列表（如飞行时间线 40+ 条）只翻译前 20 条的截断问题。
 * @param {string[]} texts
 * @returns {Promise<string[]>} 与输入等长；失败/无需翻译的项为空串
 */
async function translateTexts(texts) {
  const inputs = (Array.isArray(texts) ? texts : []).map((t) => String(t || ''))
  if (!inputs.length) return []

  const chunks = []
  let cur = []
  let curChars = 0
  for (const t of inputs) {
    if (cur.length && (cur.length >= TRANSLATE_BATCH_MAX_ITEMS || curChars + t.length > TRANSLATE_BATCH_MAX_CHARS)) {
      chunks.push(cur)
      cur = []
      curChars = 0
    }
    cur.push(t)
    curChars += t.length
  }
  if (cur.length) chunks.push(cur)

  if (chunks.length === 1) return translateTextsChunk(chunks[0])

  // 各批独立容错：单批失败以空串占位（客户端兜底显示原文），全部失败才整体报错
  let firstError = null
  const lists = await Promise.all(chunks.map((chunk) =>
    translateTextsChunk(chunk).catch((err) => {
      if (!firstError) firstError = err
      return chunk.map(() => '')
    })
  ))
  const merged = [].concat(...lists)
  if (firstError && !merged.some((s) => s)) throw firstError
  return merged
}

// ── 混元大模型翻译（单条长文本优先走此路径） ──────────────────

/** 短于此长度的单条文本（多为专名/短语）走词典+TMT 更快更稳 */
const AI_TRANSLATE_MIN_CHARS = 40

const AI_TRANSLATE_SYSTEM_PROMPT = `你是航天领域的专业中英翻译。把用户消息中的英文原文翻译成简体中文，要求：
1. 只输出译文本身，不要任何解释、注释、前缀或引号
2. 保留 SpaceX、Falcon 9、Starship、Starlink、NASA、ISS 等专有名词、机构缩写与火箭/飞船型号原文
3. 术语准确：booster=助推器，static fire=静态点火，splashdown=溅落，payload=载荷，flyback=返场
4. 语气自然流畅，符合中文航天报道习惯`

/** 去掉模型偶发的"译文："前缀与整段包裹引号 */
function cleanAITranslation(s) {
  let out = String(s || '').trim()
  out = out.replace(/^(译文|翻译|中文译文)[:：]\s*/, '')
  const wrapped =
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith('\u201c') && out.endsWith('\u201d')) ||
    (out.startsWith('「') && out.endsWith('」'))
  if (wrapped) out = out.slice(1, -1).trim()
  return out
}

/**
 * 混元翻译单条文本。任何失败（AI 不可用/超时/输出跑偏）返回空串，由调用方降级 TMT。
 * @returns {Promise<string>}
 */
async function translateViaAI(text) {
  let aiService = null
  try { aiService = require('./aiService.js') } catch (e) {}
  if (!aiService || typeof aiService.generateTextAdvanced !== 'function' || !aiService.isAIAvailable()) {
    return ''
  }
  // 英文原文越长译文 token 越多：按字符量给足，封顶 3000
  const maxTokens = Math.min(3000, Math.max(500, Math.ceil(text.length * 0.8)))
  try {
    const out = await aiService.generateTextAdvanced(AI_TRANSLATE_SYSTEM_PROMPT, text, {
      model: 'hy3-preview',
      temperature: 0.2,
      maxTokens,
      timeout: 20000
    })
    const cleaned = cleanAITranslation(out)
    // 译文必须是像样的中文，防止模型输出英文复述或解释
    return cleaned && !isMostlyChinese(text) && isMostlyChinese(cleaned) ? cleaned : ''
  } catch (e) {
    return ''
  }
}

/** 只查云端词典 + translation_cache（skipTmt），失败或未命中返回 null/空串项，不算错误 */
function lookupCloudPretranslated(texts) {
  return new Promise((resolve) => {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      resolve(null)
      return
    }
    wx.cloud.callFunction({
      name: 'll2Query',
      data: { action: 'translateTexts', texts, skipTmt: true },
      timeout: 10000,
      success: (res) => {
        const r = res && res.result
        resolve(r && r.success && Array.isArray(r.list) ? r.list.map((s) => String(s || '')) : null)
      },
      fail: () => resolve(null)
    })
  })
}

/**
 * 智能翻译入口：单条长文本按「词典/缓存 → 混元 → TMT」优先级；
 * 多条批量或短文本直接走原有 TMT 批量链路（对齐稳定、延迟低）。
 * @param {string[]} texts
 * @returns {Promise<string[]>} 与输入等长；失败项为空串
 */
async function translateTextsSmart(texts) {
  const inputs = (Array.isArray(texts) ? texts : []).map((t) => String(t || ''))
  if (inputs.length !== 1 || inputs[0].length < AI_TRANSLATE_MIN_CHARS) {
    return translateTexts(inputs)
  }
  const text = inputs[0]

  const cached = await lookupCloudPretranslated([text])
  if (cached && cached[0]) return cached

  const ai = await translateViaAI(text)
  if (ai) return [ai]

  return translateTexts([text])
}

/**
 * 页面"翻译/原文"切换的通用实现。
 * 页面 data 需包含 boolean 开关字段（switchKey）与 loading 字段（loadingKey），
 * fields 描述每个待翻译文本的 data 路径、原文与可选的预翻译中文。
 *
 * @param {Page} page 页面实例
 * @param {Object} opts
 *   - switchKey  e.g. 'descTranslated'
 *   - loadingKey e.g. 'descTranslating'
 *   - fields: [{ path: 'descI18n.missionDesc', text: '英文原文', zh: '可选预翻译中文', revert: '' }]
 *     path 推荐用独立 override 字段（WXML 里 override || 原字段 兜底），revert 默认空串；
 *     zh 有值时本地秒切不调云端，只有缺 zh 且判定为英文的字段才批量送翻
 * @returns {Promise<void>}
 */
/** 翻译按钮点击触感：中度震动（不支持 type 的旧机型退化为默认短震） */
function vibrateMedium() {
  try {
    wx.vibrateShort({ type: 'medium' })
  } catch (e) {
    try { wx.vibrateShort() } catch (e2) {}
  }
}

/** 翻译门控产品 id：不在 PRODUCTS 单品表内 → 弹窗只提供开通星际通行证 / 看广告 */
const TRANSLATE_GATE_PRODUCT_ID = 'text_translate'
const TRANSLATE_GATE_PRODUCT_NAME = '外文翻译'

/**
 * 翻译功能门控：PRO / 已购放行；免费用户弹开通引导（含「看广告免费体验10分钟」，
 * 广告解锁窗口内所有翻译按钮共享免检）。查询异常按现有 gateCheck 语义 fail-open。
 * @returns {Promise<boolean>} true=放行
 */
function translateGateCheck() {
  try {
    const { gateCheck } = require('./membership.js')
    return gateCheck(TRANSLATE_GATE_PRODUCT_ID, TRANSLATE_GATE_PRODUCT_NAME)
  } catch (e) {
    return Promise.resolve(true)
  }
}

function togglePageTranslation(page, opts) {
  vibrateMedium()
  const switchKey = opts.switchKey

  // 已是译文 → 切回原文（免门控，override 字段清空即可露出原文）
  if (page.data[switchKey]) {
    const fields = (opts.fields || []).filter((f) => f && f.path)
    const patch = {}
    patch[switchKey] = false
    for (const f of fields) patch[f.path] = f.revert != null ? f.revert : ''
    page.setData(patch)
    return Promise.resolve()
  }

  // 翻译消耗云端 token：切到译文前统一走会员/看广告门控
  return translateGateCheck().then((allowed) => {
    if (!allowed) return
    return _applyTranslation(page, opts)
  })
}

function _applyTranslation(page, opts) {
  const switchKey = opts.switchKey
  const loadingKey = opts.loadingKey
  const fields = (opts.fields || []).filter((f) => f && f.path && String(f.text || '').trim())

  // 预翻译命中的字段本地直切；剩余英文字段才需要云端翻译
  const localPatch = {}
  const needCloud = []
  for (const f of fields) {
    const zh = f.zh != null ? String(f.zh).trim() : ''
    if (zh) {
      localPatch[f.path] = zh
    } else if (!isMostlyChinese(f.text)) {
      needCloud.push(f)
    }
  }
  const localHit = Object.keys(localPatch).length

  if (!needCloud.length) {
    if (!localHit) {
      wx.showToast({ title: '当前内容已是中文', icon: 'none' })
      return Promise.resolve()
    }
    localPatch[switchKey] = true
    page.setData(localPatch)
    return Promise.resolve()
  }

  // 命中本页缓存的云端译文 → 直接切换（key 含原文，切换数据后自动失效）
  const cacheKey = needCloud.map((f) => f.path + ':' + f.text).join('|')
  const cached = page._textTranslateCache
  if (cached && cached.key === cacheKey) {
    const patch = Object.assign({}, localPatch)
    patch[switchKey] = true
    for (let i = 0; i < needCloud.length; i++) {
      if (cached.list[i]) patch[needCloud[i].path] = cached.list[i]
    }
    page.setData(patch)
    return Promise.resolve()
  }

  const loadingPatch = {}
  loadingPatch[loadingKey] = true
  page.setData(loadingPatch)

  return translateTextsSmart(needCloud.map((f) => f.text))
    .then((list) => {
      const patch = Object.assign({}, localPatch)
      patch[loadingKey] = false
      let hit = 0
      for (let i = 0; i < needCloud.length; i++) {
        if (list[i]) {
          patch[needCloud[i].path] = list[i]
          hit++
        }
      }
      if (hit + localHit > 0) {
        patch[switchKey] = true
        if (hit >= needCloud.length) {
          page._textTranslateCache = { key: cacheKey, list }
        } else {
          // 部分失败不缓存，下次点击可重试失败项
          page._textTranslateCache = null
          wx.showToast({ title: '部分内容翻译失败，可稍后重试', icon: 'none' })
        }
      } else {
        wx.showToast({ title: '翻译暂不可用，请稍后再试', icon: 'none' })
      }
      page.setData(patch)
    })
    .catch((err) => {
      const patch = {}
      patch[loadingKey] = false
      page.setData(patch)
      wx.showToast({ title: (err && err.message) || '翻译失败', icon: 'none' })
    })
}

module.exports = {
  translateTexts,
  translateTextsSmart,
  togglePageTranslation,
  translateGateCheck,
  isMostlyChinese,
  vibrateMedium
}
