/**
 * 公众号内容创作中台 API（挂载于 adminGateway）
 */
const { generateText, renderTemplate } = require('./oaContentLlm')
const {
  markdownToWechatHtml,
  stripTitleFromMarkdown,
  extractJsonBlock,
  ensureImageSlotsInBody,
  placeImagesInMarkdown,
  placeImagesAlignedToSource,
  ensureHeroImagePlacement
} = require('./oaContentFormat')
const wechatApi = require('./oaWechatApi')
const oaFetch = require('./oaFetchArticle')
const {
  COLS,
  LEGACY_BRAND_PERSONAS,
  LEGACY_BRAND_FOOTERS,
  LEGACY_MINIPROGRAM_CTAS,
  LEGACY_LEAD_DISCLAIMER_TEXTS,
  DEFAULT_LEAD_DISCLAIMER_TEXT,
  DEFAULT_BRANDS,
  ANTI_AI_VOICE,
  GROUNDING_RULES,
  DEFAULT_CONFIG,
  SEED_PROMPTS,
  SEED_STRATEGIES,
  isPromoBrandFooter,
  stripPromoBrandFooterMarkdown,
  matchStrategyFromContent
} = require('./oaContentSeeds')
const helpers = require('./oaStudioHelpers')
const {
  coerceBool,
  pickImageUrls,
  pickVideoEntries,
  videoPosterUrls,
  annotateVideoPostersInMarkdown,
  normalizeImgSrc,
  collectHtmlImgSrcs,
  isWechatCdnUrl,
  isOwnedWxImage,
  collectMarkdownImageUrls,
  isDefaultOrCoverOnlyUrl,
  resolveBodyImageUrls,
  applyImageMapToMarkdown,
  stripMarkdownImages,
  decodeImageMap,
  decodeFailMap,
  encodeImageEntries,
  encodeFailEntries,
  looksLikeLlmFallbackMarkdown,
  stripLlmFallbackNotice,
  looksLikeUnrewrittenSource,
  sanitizeWxTitle,
  credentialMissingMsg,
  appendTimeline
} = helpers

const CONFIG_DOC = COLS.CONFIG_DOC
const GLOBAL_COL = COLS.GLOBAL_COL
const PROMPTS_COL = COLS.PROMPTS_COL
const STRATEGIES_COL = COLS.STRATEGIES_COL
const DRAFTS_COL = COLS.DRAFTS_COL
const JOBS_COL = COLS.JOBS_COL
const ACCOUNTS_COL = COLS.ACCOUNTS_COL
const VIRAL_COL = COLS.VIRAL_COL
const TITLES_COL = COLS.TITLES_COL
const COLLECT_COL = COLS.COLLECT_COL

function createOaContentStudioApi({ db, _, ok, fail, now, writeOpLog, cloud, checkPerm }) {
  function normalizeBrands(rawBrands) {
    const incoming = Array.isArray(rawBrands) ? rawBrands : []
    const byKey = new Map()
    for (const d of DEFAULT_BRANDS) byKey.set(d.key, { ...d })
    for (const b of incoming) {
      if (!b || !b.key) continue
      const key = String(b.key)
      const base = byKey.get(key) || {
        key,
        name: key,
        author: '',
        persona: '',
        footer: '',
        defaultStrategyKey: 'launch_brief',
        credentialSlot: '1',
        miniprogramCta: '',
        defaultCoverUrl: '',
        enabled: true
      }
      const merged = {
        ...base,
        ...b,
        key,
        credentialSlot: wechatApi.normalizeSlot(b.credentialSlot || base.credentialSlot || '1'),
        enabled: b.enabled !== false
      }
      // 种子品牌：空人设/旧硬广文末/旧 CTA → 升级为「文末不引流」默认
      const def = DEFAULT_BRANDS.find((d) => d.key === key)
      if (def) {
        const persona = String(merged.persona || '').trim()
        if (!persona || LEGACY_BRAND_PERSONAS.includes(persona)) {
          merged.persona = def.persona
        }
        const footer = String(merged.footer || '')
        if (!footer.trim() || isPromoBrandFooter(footer)) {
          merged.footer = ''
        }
        const cta = String(merged.miniprogramCta || '').trim()
        if (LEGACY_MINIPROGRAM_CTAS.includes(cta) || /打开小程序/.test(cta)) {
          merged.miniprogramCta = ''
        }
      }
      byKey.set(key, merged)
    }
    return [...byKey.values()]
  }

  function normalizeTrackSources(list) {
    const defaults = DEFAULT_CONFIG.trackSources || []
    const raw = Array.isArray(list) && list.length ? list : defaults
    return raw
      .map((s, i) => {
        const d = defaults.find((x) => x.key === (s && s.key)) || defaults[0] || {}
        const row = { ...d, ...(s || {}) }
        return {
          key: String(row.key || `track_${i}`).slice(0, 64),
          name: String(row.name || row.key || '追踪源').slice(0, 80),
          site: String(row.site || '').slice(0, 40),
          authorPage: String(row.authorPage || '').slice(0, 300),
          rssUrl: String(row.rssUrl || '').slice(0, 300),
          authorMatch: String(row.authorMatch || '').slice(0, 80),
          enabled: coerceBool(row.enabled, true),
          autoWash: coerceBool(row.autoWash, false),
          brandKey: String(row.brandKey || 'mars_log').slice(0, 40),
          strategyKey: String(row.strategyKey || 'auto').slice(0, 40),
          maxPerRun: Math.min(10, Math.max(1, Number(row.maxPerRun) || 3))
        }
      })
      .filter((s) => s.key && s.rssUrl)
  }

  function normalizeConfig(raw) {
    const cfg = { ...DEFAULT_CONFIG, ...(raw || {}) }
    cfg.brands = normalizeBrands(cfg.brands)
    if (!cfg.defaultBrandKey || !cfg.brands.some((b) => b.key === cfg.defaultBrandKey)) {
      cfg.defaultBrandKey = (cfg.brands.find((b) => b.enabled) || cfg.brands[0] || DEFAULT_BRANDS[0]).key
    }
    cfg.linkAllImagesToMiniprogram = coerceBool(cfg.linkAllImagesToMiniprogram, true)
    cfg.leadDisclaimerEnabled = coerceBool(cfg.leadDisclaimerEnabled, true)
    {
      const leadRaw =
        cfg.leadDisclaimerText == null ? DEFAULT_LEAD_DISCLAIMER_TEXT : String(cfg.leadDisclaimerText)
      const leadTrim = leadRaw.trim()
      cfg.leadDisclaimerText = (
        !leadTrim || LEGACY_LEAD_DISCLAIMER_TEXTS.includes(leadTrim)
          ? DEFAULT_LEAD_DISCLAIMER_TEXT
          : leadRaw
      ).slice(0, 300)
    }
    // 旧默认文末引流（mode=image + 空/旧 CTA）→ none；自定义 link/card/image+文案保留
    {
      let mode = String(cfg.miniprogramCtaMode || '').trim() || 'none'
      if (!['none', 'image', 'link', 'card'].includes(mode)) mode = 'none'
      const topCta = String(cfg.miniprogramCta || '').trim()
      const anyBrandCta = (cfg.brands || []).some((b) => String((b && b.miniprogramCta) || '').trim())
      const topIsLegacyOrEmpty = !topCta || LEGACY_MINIPROGRAM_CTAS.includes(topCta)
      if (mode === 'image' && topIsLegacyOrEmpty && !anyBrandCta) mode = 'none'
      cfg.miniprogramCtaMode = mode
    }
    if (LEGACY_MINIPROGRAM_CTAS.includes(String(cfg.miniprogramCta || '').trim()) ||
        /打开小程序/.test(String(cfg.miniprogramCta || ''))) {
      cfg.miniprogramCta = ''
    }
    if (!String(cfg.footer || '').trim() || isPromoBrandFooter(cfg.footer)) {
      cfg.footer = ''
    }
    cfg.openComment = coerceBool(cfg.openComment, true)
    cfg.onlyFansCanComment = coerceBool(cfg.onlyFansCanComment, false)
    cfg.autoPushToWechatDraft = coerceBool(cfg.autoPushToWechatDraft, false)
    // 强制关闭自动群发：避免配置地雷
    cfg.autoFreepublish = false
    cfg.enabled = coerceBool(cfg.enabled, false)
    cfg.trackSources = normalizeTrackSources(cfg.trackSources)
    // 兼容旧客户端：顶层 author/persona/footer 同步自默认发稿号
    // 注意：空字符串是合法值，不能用 || 回退到旧硬广
    const def = cfg.brands.find((b) => b.key === cfg.defaultBrandKey) || cfg.brands[0]
    if (def) {
      cfg.author = def.author || cfg.author
      cfg.persona = def.persona || cfg.persona
      cfg.footer = String(def.footer || '')
      cfg.defaultStrategyKey = def.defaultStrategyKey || cfg.defaultStrategyKey
      cfg.miniprogramCta = String(def.miniprogramCta || '')
      if (def.defaultCoverUrl) cfg.defaultCoverUrl = def.defaultCoverUrl
    }
    return cfg
  }

  /** 仅非引流文末才允许拼进成稿 */
  function safeBrandFooter(brand, cfg) {
    const raw = String((brand && brand.footer) || (cfg && cfg.footer) || '').trim()
    if (!raw || isPromoBrandFooter(raw)) return ''
    return raw
  }

  function resolveBrand(cfg, brandKey) {
    const list = Array.isArray(cfg.brands) ? cfg.brands : DEFAULT_BRANDS
    const key = String(brandKey || cfg.defaultBrandKey || '').trim()
    let brand = list.find((b) => b.key === key)
    if (!brand) brand = list.find((b) => b.enabled) || list[0] || DEFAULT_BRANDS[0]
    return {
      ...DEFAULT_BRANDS[0],
      ...brand,
      credentialSlot: wechatApi.normalizeSlot(brand.credentialSlot || '1')
    }
  }

  /** 文首提示语 HTML（信息向免责；纯文不挂小程序文字链）。关闭或空文案返回 '' */
  function buildLeadHtml(cfg, mpPath) {
    if (!cfg || cfg.leadDisclaimerEnabled === false) return ''
    const text = String(cfg.leadDisclaimerText || '').trim()
    if (!text) return ''
    return wechatApi.buildLeadDisclaimerHtml({
      text,
      path: mpPath || cfg.miniprogramPath || 'pages/index/index'
    })
  }

  /** 是否附加文末小程序引流（none=关；仅配图跳转时不走文末） */
  function shouldAppendMiniprogramCta(cfg) {
    const mode = String((cfg && cfg.miniprogramCtaMode) || 'none').trim()
    return mode === 'image' || mode === 'link' || mode === 'card'
  }

  async function appendMiniprogramCtaHtml(html, cfg, brand, opts = {}) {
    if (!shouldAppendMiniprogramCta(cfg)) return String(html || '')
    const mode = String(cfg.miniprogramCtaMode || 'none')
    const extra = await wechatApi.buildMiniprogramCtaHtml({
      path: opts.path || cfg.miniprogramPath || 'pages/index/index',
      text: (brand && brand.miniprogramCta) || cfg.miniprogramCta,
      title: opts.title,
      imageUrl: opts.imageUrl,
      mode: opts.mode || mode,
      credentialSlot: opts.credentialSlot || (brand && brand.credentialSlot) || '1',
      trustMmbiz: !!opts.trustMmbiz
    })
    return String(html || '') + (extra || '')
  }

  async function ensureCols() {
    for (const name of [
      PROMPTS_COL,
      STRATEGIES_COL,
      DRAFTS_COL,
      JOBS_COL,
      ACCOUNTS_COL,
      VIRAL_COL,
      TITLES_COL,
      COLLECT_COL
    ]) {
      try {
        await db.createCollection(name)
      } catch (e) {}
    }
  }

  async function readConfig() {
    try {
      const res = await db.collection(GLOBAL_COL).doc(CONFIG_DOC).get()
      const raw = res.data || {}
      const normalized = normalizeConfig(raw)
      // 云端仍存旧硬广结语时静默写回清空，避免生成继续拼接
      const rawBrands = Array.isArray(raw.brands) ? raw.brands : []
      const dirtyFooter =
        isPromoBrandFooter(raw.footer) ||
        rawBrands.some((b) => isPromoBrandFooter(b && b.footer)) ||
        /打开小程序/.test(String(raw.miniprogramCta || '')) ||
        rawBrands.some((b) => /打开小程序/.test(String((b && b.miniprogramCta) || '')))
      if (dirtyFooter) {
        try {
          await writeConfig({
            brands: normalized.brands,
            footer: '',
            miniprogramCta: '',
            miniprogramCtaMode: normalized.miniprogramCtaMode,
            leadDisclaimerText: normalized.leadDisclaimerText
          })
        } catch (e) {
          console.warn('[oaContent] persist anti-promo footer fail', e.message || e)
        }
      }
      return normalized
    } catch (e) {
      return normalizeConfig({})
    }
  }

  async function writeConfig(patch) {
    const data = { ...patch, updatedAt: now() }
    delete data._id
    if (Object.prototype.hasOwnProperty.call(data, 'brands')) {
      data.brands = normalizeBrands(data.brands)
    }
    if (Object.prototype.hasOwnProperty.call(data, 'trackSources')) {
      data.trackSources = normalizeTrackSources(data.trackSources)
    }
    try {
      const existing = await db.collection(GLOBAL_COL).doc(CONFIG_DOC).get().catch(() => null)
      if (existing && existing.data) {
        await db.collection(GLOBAL_COL).doc(CONFIG_DOC).update({ data })
      } else {
        await db.collection(GLOBAL_COL).doc(CONFIG_DOC).set({
          data: normalizeConfig({ ...DEFAULT_CONFIG, ...data })
        })
      }
    } catch (e) {
      const clean = normalizeConfig({ ...DEFAULT_CONFIG, ...data })
      delete clean._id
      await db.collection(GLOBAL_COL).doc(CONFIG_DOC).set({ data: clean })
    }
    return ok(await readConfig())
  }

  async function getConfig() {
    await ensureCols()
    const cfg = await readConfig()
    return ok({
      ...cfg,
      wechatReady: wechatApi.credentialsReady('1'),
      wechatReadyBySlot: wechatApi.credentialsStatus(),
      miniAppId: wechatApi.getMiniAppId()
    })
  }

  async function updateConfig(body, user) {
    await ensureCols()
    const before = await readConfig()
    const allowed = Object.keys(DEFAULT_CONFIG).filter((k) => k !== 'updatedAt')
    const patch = {}
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(body || {}, k)) patch[k] = body[k]
    }
    // 自动群发永久关闭（服务端硬关）
    if (Object.prototype.hasOwnProperty.call(patch, 'autoFreepublish')) {
      patch.autoFreepublish = false
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'linkAllImagesToMiniprogram')) {
      patch.linkAllImagesToMiniprogram = coerceBool(patch.linkAllImagesToMiniprogram, true)
    }
    // 若只改 brands，同步顶层兼容字段
    if (patch.brands) {
      const next = normalizeConfig({ ...before, ...patch })
      const def = resolveBrand(next, next.defaultBrandKey)
      patch.author = def.author
      patch.persona = def.persona
      patch.footer = def.footer
      patch.defaultStrategyKey = def.defaultStrategyKey
      patch.miniprogramCta = def.miniprogramCta
      patch.defaultBrandKey = next.defaultBrandKey
    }
    const result = await writeConfig(patch)
    await writeOpLog({
      user,
      module: 'oa_content',
      action: 'update_config',
      targetId: CONFIG_DOC,
      before: { defaultBrandKey: before.defaultBrandKey, brands: (before.brands || []).map((b) => b.key) },
      after: patch
    })
    return result
  }

  /** 列表时解开长时间卡住的 pushing（排队/续传给足窗口，避免误标失败） */
  async function healStalePushingDrafts() {
    try {
      const res = await db.collection(DRAFTS_COL).where({ status: 'pushing' }).limit(30).get()
      const rows = res.data || []
      const t = now()
      for (const row of rows) {
        const lease = Number(row.pushLeaseAt || 0)
        const updated = Number(row.updatedAt || 0)
        const err = String(row.error || '')
        const hardFail = /启动失败|FUNCTION_NOT_FOUND|未部署|凭证槽.*未配置/i.test(err)
        // lease=0 表示排队待领取，用 updatedAt 判断；执行中看租约
        // 与 oaPushDraft.STALE_MS 对齐（5min），避免列表 heal 误杀仍在跑的推送
        const stale = lease
          ? t - lease > 5 * 60 * 1000
          : !updated || t - updated > 8 * 60 * 1000
        if (!hardFail && !stale) continue
        const prev = row.pushPrevStatus || 'ready'
        await db
          .collection(DRAFTS_COL)
          .doc(row._id)
          .update({
            data: {
              // 显式失败态：已推过微信的保留 pushed_to_wechat，其余进 push_failed
              status: prev === 'pushed_to_wechat' ? 'pushed_to_wechat' : 'push_failed',
              pushLeaseAt: 0,
              error: err || '推送未完成，请重试',
              pushTimeline: appendTimeline(row, 'push_fail', err || '推送超时'),
              updatedAt: t
            }
          })
          .catch(() => null)
      }
    } catch (e) {}
  }

  async function listCollection(col, query = {}, orderField = 'updatedAt') {
    await ensureCols()
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
    const where = {}
    if (query.status) where.status = String(query.status)
    if (query.kind) where.kind = String(query.kind)
    if (query.type) where.type = String(query.type)
    if (query.brandKey) where.brandKey = String(query.brandKey)
    if (query.enabled === 'true') where.enabled = true
    if (query.enabled === 'false') where.enabled = false
    if (query.lowFollower === 'true') where.isLowFollower = true
    if (query.accountBiz) where.accountBiz = String(query.accountBiz)
    if (query.accountName) where.accountName = String(query.accountName)
    let q = db.collection(col)
    if (Object.keys(where).length) q = q.where(where)
    const countRes = await q.count().catch(() => ({ total: 0 }))
    let listRes = { data: [] }
    try {
      listRes = await q
        .orderBy(orderField, 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
    } catch (e) {
      try {
        listRes = await q.skip((page - 1) * pageSize).limit(pageSize).get()
        listRes.data = (listRes.data || []).sort(
          (a, b) => Number(b[orderField] || 0) - Number(a[orderField] || 0)
        )
      } catch (e2) {
        listRes = { data: [] }
      }
    }
    return ok({ list: listRes.data || [], total: countRes.total || 0, page, pageSize })
  }

  async function getById(col, id) {
    await ensureCols()
    const res = await db.collection(col).doc(id).get().catch(() => null)
    if (!res || !res.data) return fail(4040, '记录不存在')
    return ok({ ...res.data, _id: id })
  }

  async function createDoc(col, body, user, defaults = {}) {
    await ensureCols()
    const data = {
      ...defaults,
      ...body,
      createdAt: now(),
      updatedAt: now(),
      createdBy: (user && user.username) || ''
    }
    delete data._id
    const add = await db.collection(col).add({ data })
    await writeOpLog({
      user,
      module: 'oa_content',
      action: 'create',
      targetId: add._id,
      after: { col, ...data }
    })
    return ok({ _id: add._id, ...data })
  }

  async function updateDoc(col, id, body, user, allowKeys) {
    await ensureCols()
    const patch = { updatedAt: now() }
    const src = body || {}
    const keys = allowKeys || Object.keys(src)
    for (const k of keys) {
      if (k === '_id' || k === 'createdAt') continue
      if (Object.prototype.hasOwnProperty.call(src, k)) patch[k] = src[k]
    }
    await db.collection(col).doc(id).update({ data: patch })
    await writeOpLog({
      user,
      module: 'oa_content',
      action: 'update',
      targetId: id,
      after: { col, ...patch }
    })
    return getById(col, id)
  }

  async function deleteDoc(col, id, user) {
    await ensureCols()
    await db.collection(col).doc(id).remove()
    await writeOpLog({
      user,
      module: 'oa_content',
      action: 'delete',
      targetId: id,
      after: { col }
    })
    return ok({ deleted: true })
  }

  async function seedPrompts(user, opts = {}) {
    await ensureCols()
    let created = 0
    let updated = 0
    let skipped = 0
    // 默认只补缺失，不碰用户已改过的条目；overwrite=true 才覆盖重置
    const overwrite = coerceBool(opts && opts.overwrite, false)
    for (const p of SEED_PROMPTS) {
      const exist = await db
        .collection(PROMPTS_COL)
        .where({ key: p.key })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))
      if (exist.data && exist.data[0] && exist.data[0]._id) {
        if (!overwrite) {
          skipped += 1
          continue
        }
        await db.collection(PROMPTS_COL).doc(exist.data[0]._id).update({
          data: {
            name: p.name,
            kind: p.kind,
            system: p.system,
            user: p.user,
            enabled: true,
            updatedAt: now()
          }
        })
        updated += 1
      } else {
        await db.collection(PROMPTS_COL).add({
          data: { ...p, enabled: true, createdAt: now(), updatedAt: now() }
        })
        created += 1
      }
    }
    await writeOpLog({
      user,
      module: 'oa_content',
      action: 'seed_prompts',
      targetId: 'seed',
      after: { created, updated, skipped, overwrite }
    })
    return ok({ seeded: created + updated, created, updated, skipped, overwrite })
  }

  async function seedStrategies(user, opts = {}) {
    await ensureCols()
    let created = 0
    let updated = 0
    let skipped = 0
    const overwrite = coerceBool(opts && opts.overwrite, false)
    for (const s of SEED_STRATEGIES) {
      const exist = await db
        .collection(STRATEGIES_COL)
        .where({ key: s.key })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))
      if (exist.data && exist.data[0] && exist.data[0]._id) {
        if (!overwrite) {
          skipped += 1
          continue
        }
        await db.collection(STRATEGIES_COL).doc(exist.data[0]._id).update({
          data: {
            name: s.name,
            promptKey: s.promptKey,
            themeId: s.themeId,
            structureHint: s.structureHint,
            titleHint: s.titleHint,
            enabled: s.enabled !== false,
            priority: s.priority,
            updatedAt: now()
          }
        })
        updated += 1
      } else {
        await db.collection(STRATEGIES_COL).add({
          data: { ...s, createdAt: now(), updatedAt: now() }
        })
        created += 1
      }
    }
    await writeOpLog({
      user,
      module: 'oa_content',
      action: 'seed_strategies',
      targetId: 'seed',
      after: { created, updated, skipped, overwrite }
    })
    return ok({ seeded: created + updated, created, updated, skipped, overwrite })
  }

  async function readCacheDoc(cacheKey) {
    try {
      const res = await db.collection('space_devs_cache').doc(cacheKey).get()
      if (res && res.data) return res.data
    } catch (e) {}
    try {
      const res = await db
        .collection('space_devs_cache')
        .where({ cacheKey })
        .limit(1)
        .get()
      if (res.data && res.data.length) return res.data[0]
    } catch (e) {}
    return null
  }

  function pickLaunchTopics(cacheDoc, limit = 5) {
    const raw = (cacheDoc && (cacheDoc.data || cacheDoc.list || cacheDoc.results)) || []
    const list = Array.isArray(raw) ? raw : []
    return list.slice(0, limit).map((item, idx) => {
      const name =
        item.name ||
        item.missionName ||
        (item.mission && item.mission.name) ||
        item.title ||
        `发射任务 ${idx + 1}`
      const rocket =
        (item.rocket && (item.rocket.name || item.rocket.configuration?.name)) ||
        item.rocketName ||
        ''
      const pad =
        (item.pad && (item.pad.name || item.pad.location?.name)) ||
        item.padName ||
        item.location ||
        ''
      const net = item.net || item.window_start || item.launchTime || ''
      const body = [
        `任务：${name}`,
        rocket ? `火箭：${rocket}` : '',
        pad ? `发射场：${pad}` : '',
        net ? `时间：${net}` : '',
        item.status && item.status.name ? `状态：${item.status.name}` : '',
        item.mission && item.mission.description ? `简介：${item.mission.description}` : ''
      ]
        .filter(Boolean)
        .join('\n')
      const imageUrls = pickImageUrls(
        item.image,
        item.rocket && item.rocket.image_url,
        item.pad && item.pad.map_image
      )
      return {
        sourceType: 'launch',
        sourceId: String(item.id || item._id || name),
        title: String(name).slice(0, 80),
        summary: body.slice(0, 200),
        body,
        coverUrl: imageUrls[0] || '',
        imageUrls
      }
    })
  }

  async function gatherTopics(query = {}) {
    await ensureCols()
    const topics = []
    const limit = Math.min(20, Math.max(1, Number(query.limit) || 10))

    const upcoming = await readCacheDoc('upcoming')
    topics.push(...pickLaunchTopics(upcoming, Math.ceil(limit / 2)))

    try {
      const events = await db
        .collection('starship_event_updates')
        .where({ status: 'published' })
        .orderBy('publishedAt', 'desc')
        .limit(Math.ceil(limit / 2))
        .get()
      for (const ev of events.data || []) {
        // 视频事件不再「无图」：封面截图（缩略图/万象截帧）并入配图池，长视频也有封面
        const videos = pickVideoEntries(ev.mediaList, ev.videos)
        const imageUrls = pickImageUrls(ev.cover, ev.mediaList, ev.images, videoPosterUrls(videos))
        topics.push({
          sourceType: 'starship_event',
          sourceId: String(ev._id),
          title: String(ev.title || '星舰事件').slice(0, 80),
          summary: String(ev.content || '').slice(0, 200),
          body: String(ev.content || ev.title || ''),
          coverUrl: imageUrls[0] || '',
          imageUrls,
          videos
        })
      }
    } catch (e) {}

    try {
      const articles = await db
        .collection('news_articles')
        .where({ published: true })
        .orderBy('publishedAt', 'desc')
        .limit(5)
        .get()
      for (const a of articles.data || []) {
        const imageUrls = pickImageUrls(a.image, a.images, a.cover)
        topics.push({
          sourceType: 'news_article',
          sourceId: String(a._id),
          title: String(a.title || '手写稿').slice(0, 80),
          summary: String(a.summary || a.content || '').slice(0, 200),
          body: String(a.content || a.summary || ''),
          coverUrl: imageUrls[0] || '',
          imageUrls
        })
      }
    } catch (e) {}

    try {
      const collected = await db
        .collection(COLLECT_COL)
        .orderBy('createdAt', 'desc')
        .limit(5)
        .get()
      for (const c of collected.data || []) {
        topics.push({
          sourceType: 'collected',
          sourceId: String(c._id),
          title: String(c.title || '采集稿').slice(0, 80),
          summary: String(c.content || '').slice(0, 200),
          body: String(c.content || ''),
          coverUrl: (c.coverUrl || '') + '',
          imageUrls: pickImageUrls(c.coverUrl, c.images),
          sourceUrl: c.sourceUrl || ''
        })
      }
    } catch (e) {}

    return ok({ list: topics.slice(0, limit) })
  }

  async function findPrompt(key) {
    const res = await db
      .collection(PROMPTS_COL)
      .where({ key: String(key) })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    if (res.data && res.data[0]) return res.data[0]
    return SEED_PROMPTS.find((p) => p.key === key) || SEED_PROMPTS[0]
  }

  async function findStrategy(keyOrId) {
    if (!keyOrId) return SEED_STRATEGIES[0]
    try {
      const byId = await db.collection(STRATEGIES_COL).doc(keyOrId).get()
      if (byId && byId.data) return { _id: keyOrId, ...byId.data }
    } catch (e) {}
    const res = await db
      .collection(STRATEGIES_COL)
      .where({ key: String(keyOrId) })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    if (res.data && res.data[0]) return res.data[0]
    return SEED_STRATEGIES.find((s) => s.key === keyOrId) || SEED_STRATEGIES[0]
  }

  async function resolveTopicImages(source) {
    let urls = pickImageUrls(
      source.imageUrls,
      source.images,
      source.coverUrl,
      source.mediaList,
      videoPosterUrls(pickVideoEntries(source.videos, source.mediaList))
    )
    // 正文若仍是 HTML，从中抠图
    const rawBody = String(source.body || source.content || '')
    if (/<img\b/i.test(rawBody)) {
      urls = pickImageUrls(urls, oaFetch.collectImgUrls(rawBody, source.sourceUrl || ''))
    }
    if (urls.length >= 2) return urls
    if (source.sourceType === 'viral' && source.sourceId) {
      try {
        const res = await db.collection(VIRAL_COL).doc(source.sourceId).get()
        const a = res && res.data
        if (a) {
          urls = pickImageUrls(urls, a.images, a.imageUrls, a.coverUrl, a.cover)
          if (/<img\b/i.test(String(a.content || ''))) {
            urls = pickImageUrls(urls, oaFetch.collectImgUrls(a.content, a.url || a.sourceUrl || ''))
          }
        }
      } catch (e) {}
    }
    if (source.sourceType === 'collected' && source.sourceId) {
      try {
        const res = await db.collection(COLLECT_COL).doc(source.sourceId).get()
        const a = res && res.data
        if (a) {
          urls = pickImageUrls(urls, a.images, a.imageUrls, a.coverUrl, a.cover)
          if (/<img\b/i.test(String(a.content || ''))) {
            urls = pickImageUrls(
              urls,
              oaFetch.collectImgUrls(a.content, a.sourceUrl || a.url || '')
            )
          }
        }
      } catch (e) {}
    }
    if (urls.length >= 1) return urls
    if (source.sourceType === 'starship_event' && source.sourceId) {
      try {
        const res = await db.collection('starship_event_updates').doc(source.sourceId).get()
        const ev = res && res.data
        if (ev) {
          urls = pickImageUrls(
            ev.cover,
            ev.mediaList,
            ev.images,
            videoPosterUrls(pickVideoEntries(ev.mediaList, ev.videos))
          )
        }
      } catch (e) {}
    }
    if (source.sourceType === 'news_article' && source.sourceId) {
      try {
        const res = await db.collection('news_articles').doc(source.sourceId).get()
        const a = res && res.data
        if (a) urls = pickImageUrls(a.image, a.images, a.cover)
      } catch (e) {}
    }
    return urls
  }

  /** 选题视频素材：优先取选题自带，缺省回读事件 mediaList（长视频仅缩略图+链接也在内） */
  async function resolveTopicVideos(source) {
    let videos = pickVideoEntries(source.videos, source.mediaList)
    if (!videos.length && source.sourceType === 'starship_event' && source.sourceId) {
      try {
        const res = await db.collection('starship_event_updates').doc(source.sourceId).get()
        const ev = res && res.data
        if (ev) videos = pickVideoEntries(ev.mediaList, ev.videos)
      } catch (e) {}
    }
    return videos
  }

  /**
   * 抓外链补正文/多图：
   * - 单行 URL
   * - 或有 sourceUrl 且（正文过短 / 配图不足 3 张）
   */
  async function enrichTopicFromUrl(topic) {
    const src = topic || {}
    const body = String(src.body || src.content || src.manualText || '').trim()
    const sourceUrl = String(src.sourceUrl || '').trim()
    let existingImgs = pickImageUrls(src.imageUrls, src.images, src.coverUrl)
    if (/<img\b/i.test(body)) {
      existingImgs = pickImageUrls(existingImgs, oaFetch.collectImgUrls(body, sourceUrl))
    }

    let url = ''
    if (oaFetch.looksLikeLoneUrl(body)) url = body
    else if (oaFetch.isHttpUrl(sourceUrl) && (body.length < 120 || existingImgs.length < 3)) {
      url = sourceUrl
    }

    if (!url) {
      if (existingImgs.length > pickImageUrls(src.imageUrls, src.images, src.coverUrl).length) {
        return { ...src, imageUrls: existingImgs, coverUrl: src.coverUrl || existingImgs[0] || '' }
      }
      return src
    }

    try {
      const art = await oaFetch.fetchArticle(url)
      const keepTitle =
        src.title &&
        src.title !== '手动选题' &&
        String(src.title).trim() &&
        !oaFetch.looksLikeLoneUrl(src.title)
      const keepBody = body.length >= 120 && !oaFetch.looksLikeLoneUrl(body)
      const mergedImgs = pickImageUrls(art.imageUrls, existingImgs, art.coverUrl)
      // 优先用带 [[IMG:n]] 的抓取正文；若保留旧正文则事后补占位
      let nextBody = keepBody ? body : art.text || body
      if (mergedImgs.length) {
        nextBody = ensureImageSlotsInBody(nextBody, mergedImgs, 8)
      }
      return {
        ...src,
        sourceType: src.sourceType === 'manual' || !src.sourceType ? 'external_url' : src.sourceType,
        title: keepTitle ? src.title : art.title || src.title,
        body: nextBody,
        content: nextBody,
        coverUrl: art.coverUrl || src.coverUrl || mergedImgs[0] || '',
        imageUrls: mergedImgs,
        sourceUrl: art.sourceUrl || url,
        sourceSite: art.sourceSite || src.sourceSite || '',
        sourceLabel: art.sourceSite || src.sourceLabel || 'external'
      }
    } catch (e) {
      console.warn('[oaContent] enrichTopicFromUrl', e.message || e)
      if (oaFetch.looksLikeLoneUrl(body)) {
        throw new Error('外链抓取失败: ' + (e.message || e))
      }
      if (existingImgs.length) {
        return { ...src, imageUrls: existingImgs, coverUrl: src.coverUrl || existingImgs[0] || '' }
      }
      return src
    }
  }

  async function rewriteHtmlImagesForWechat(html, fallbackUrls, wxOpts = {}, persist = {}) {
    // 外链必转存；他人 mmbiz 也须本槽 uploadimg（否则配图点进小程序失效）。
    // 同一张失败 ≥2 次则丢弃该图，避免永远卡在「3/5」。
    const MAX_BODY_IMAGES = 8
    const CONCURRENCY = 5
    const FAIL_DROP_AFTER = 2
    const draftId = persist.draftId || ''
    const currentSlot = wechatApi.normalizeSlot(
      (wxOpts && wxOpts.credentialSlot) || persist.uploadSlot || '1'
    )
    let out = String(html || '')
    // 统一 &amp;
    out = out.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (_, a, src, b) => {
      return a + normalizeImgSrc(src) + b
    })
    // 仅封面稿：剥掉误注入正文的默认封面图（封面只走 thumb，不进 content）
    if (persist.skipCoverFallbacks) {
      const allow = new Set((fallbackUrls || []).map((u) => normalizeImgSrc(u)).filter(Boolean))
      out = out.replace(/<img\b[^>]*>/gi, (tag) => {
        const sm = tag.match(/\bsrc=["']([^"']+)["']/i)
        if (!sm) return tag
        const src = normalizeImgSrc(sm[1])
        if (
          isDefaultOrCoverOnlyUrl(src, persist.draft, persist.brand, persist.cfg) &&
          !allow.has(src)
        ) {
          return ''
        }
        return tag
      })
    }
    let srcs = collectHtmlImgSrcs(out)

    if (!srcs.length && fallbackUrls && fallbackUrls.length) {
      // 仅注入「真正的正文配图」；封面/默认封面绝不灌进正文（否则会 0/N 卡死）
      const blocks = []
      for (const u of fallbackUrls) {
        const s = normalizeImgSrc(u)
        if (!/^https?:\/\//i.test(s)) continue
        if (persist.skipCoverFallbacks && isDefaultOrCoverOnlyUrl(s, persist.draft, persist.brand, persist.cfg)) {
          continue
        }
        blocks.push(
          `<p style="margin:16px 0;text-align:center;"><img src="${s}" style="max-width:100%;height:auto;border-radius:4px;" /></p>`
        )
        if (blocks.length >= MAX_BODY_IMAGES) break
      }
      if (blocks.length) out = blocks.join('\n') + '\n' + out
      srcs = collectHtmlImgSrcs(out)
    }

    srcs = srcs.slice(0, MAX_BODY_IMAGES)
    const map = new Map()
    const failMap = { ...(persist.failMap || {}) }
    const cached = persist.imageMap || {}
    for (const [k, v] of Object.entries(cached)) {
      const key = normalizeImgSrc(k)
      if (/^https?:\/\//i.test(key) && isWechatCdnUrl(v) && v !== key) map.set(key, String(v))
    }
    // 已是本槽 uploadimg 产物的 mmbiz：可直用
    for (const src of srcs) {
      if (isOwnedWxImage(src, Object.fromEntries(map), persist.uploadSlot, currentSlot)) {
        map.set(src, src)
      } else if (
        isOwnedWxImage(src, cached, persist.uploadSlot, currentSlot) &&
        isWechatCdnUrl(src)
      ) {
        map.set(src, src)
      }
    }

    const needUpload = srcs.filter((src) => {
      if (map.has(src) && map.get(src) !== src) return false
      if (isOwnedWxImage(src, Object.fromEntries(map), persist.uploadSlot, currentSlot)) {
        return false
      }
      if (isOwnedWxImage(src, cached, persist.uploadSlot, currentSlot)) return false
      return true
    })

    // 已卡在「3/5」的稿：再全力试一轮，仍失败则丢弃坏图，避免无限续传
    if (persist.priorIncomplete) {
      for (const src of needUpload) {
        failMap[src] = Math.max(Number(failMap[src] || 0), FAIL_DROP_AFTER - 1)
      }
    }

    const flushProgress = async () => {
      if (!draftId) return
      const obj = {}
      for (const [k, v] of map.entries()) obj[k] = v
      const hasOwned = Object.keys(obj).some((k) => obj[k] && obj[k] !== k)
      await db
        .collection(DRAFTS_COL)
        .doc(draftId)
        .update({
          data: {
            wxImageEntries: encodeImageEntries(obj),
            wxImageFailEntries: encodeFailEntries(failMap),
            wxImageMap: {},
            wxImageFail: {},
            ...(hasOwned ? { wxImageUploadSlot: currentSlot } : {}),
            pushLeaseAt: now(),
            updatedAt: now()
          }
        })
        .catch(() => null)
    }

    for (let i = 0; i < needUpload.length; i += CONCURRENCY) {
      const batch = needUpload.slice(i, i + CONCURRENCY)
      await Promise.all(
        batch.map(async (src) => {
          try {
            const wxUrl = await wechatApi.uploadContentImageFromUrl(src, wxOpts)
            if (wxUrl) {
              map.set(src, wxUrl)
              delete failMap[src]
            }
          } catch (e) {
            failMap[src] = Number(failMap[src] || 0) + 1
            console.warn(
              '[oaContent] upload body image fail',
              src,
              e.message || e,
              'failCount=',
              failMap[src]
            )
          }
        })
      )
      await flushProgress()
    }

    // 仍失败且已达阈值：从正文去掉，解除卡死
    const dropped = []
    let pending = 0
    let uploaded = 0
    out = out.replace(/<img\b[^>]*>/gi, (tag) => {
      const sm = tag.match(/\bsrc=["']([^"']+)["']/i)
      if (!sm) return tag
      const src = normalizeImgSrc(sm[1])
      if (map.has(src)) {
        const next = map.get(src)
        // 仅本槽 uploadimg 产物计 uploaded；禁止他人 mmbiz identity 伪成功
        if (
          next &&
          next !== src &&
          isWechatCdnUrl(next)
        ) {
          uploaded += 1
          return tag.replace(sm[1], next)
        }
        if (isOwnedWxImage(src, Object.fromEntries(map), persist.uploadSlot || currentSlot, currentSlot)) {
          uploaded += 1
          return tag
        }
      }
      if (Number(failMap[src] || 0) >= FAIL_DROP_AFTER) {
        dropped.push(src)
        return ''
      }
      pending += 1
      return tag
    })

    await flushProgress()
    return {
      html: out,
      imageMap: Object.fromEntries(map),
      failMap,
      pending,
      uploaded,
      wanted: srcs.length,
      dropped
    }
  }

  /**
   * 配图预转存到微信 CDN（与推送解耦）。
   * imagesReady=true 后，推送只做 thumb + draft/add，不再卡在下图。
   */
  async function prepareDraftImages(id, opts = {}) {
    await ensureCols()
    const res = await db.collection(DRAFTS_COL).doc(id).get().catch(() => null)
    if (!res || !res.data) return fail(4040, '草稿不存在')
    const draft = res.data
    const cfg = await readConfig()
    const brand = resolveBrand(cfg, draft.brandKey || cfg.defaultBrandKey)
    const slot = wechatApi.normalizeSlot(
      opts.credentialSlot || draft.credentialSlot || brand.credentialSlot
    )
    if (!wechatApi.credentialsReady(slot)) {
      return fail(4000, credentialMissingMsg(slot))
    }
    const wxOpts = { credentialSlot: slot }
    const forceSkip = !!(opts.forceSkip === true || opts.forceSkip === 'true' || opts.forceSkip === 1)
    // 非强制：至少失败 2 次再丢图；forceSkip 才 1 次丢弃
    const FAIL_DROP_AFTER = forceSkip ? 1 : 2
    // 正文配图才转存；默认封面只作 thumb，不进这张清单
    const list = resolveBodyImageUrls(draft, brand, cfg)

    const map = decodeImageMap(draft)
    const failMap = decodeFailMap(draft)

    // 仅封面/无正文配图：直接就绪，清掉误报的「配图上传未完成」
    if (!list.length) {
      const clearErr = /配图上传未完成|配图尚未就绪|转存中/i.test(String(draft.error || ''))
      await db
        .collection(DRAFTS_COL)
        .doc(id)
        .update({
          data: {
            imagesReady: true,
            imagePrepStatus: 'ready',
            imagePrepStats: { total: 0, ready: 0, pending: 0, dropped: 0, coverOnly: true },
            ...(clearErr ? { error: '' } : {}),
            // 卡在 pushing 且无正文图：放回可推状态
            ...(String(draft.status) === 'pushing' && !opts.fromPush
              ? { status: draft.pushPrevStatus || 'ready' }
              : {}),
            updatedAt: now()
          }
        })
        .catch(() => null)
      return ok({
        imagesReady: true,
        imagePrepStatus: 'ready',
        total: 0,
        warmed: 0,
        pending: 0,
        dropped: 0,
        ready: 0,
        coverOnly: true,
        attempts: Number(draft.imagePrepAttempts || 0)
      })
    }

    // 已就绪且归属完整：no-op，避免把 imagesReady 打回 false 造成竞态
    const alreadyOwned =
      !forceSkip &&
      draft.imagesReady === true &&
      list.length > 0 &&
      list.every((src) => isOwnedWxImage(src, map, draft.wxImageUploadSlot, slot))
    if (alreadyOwned || (!list.length && draft.imagesReady === true && !forceSkip)) {
      return ok({
        imagesReady: true,
        imagePrepStatus: draft.imagePrepStatus || 'ready',
        total: list.length,
        warmed: 0,
        pending: 0,
        dropped: 0,
        ready: list.length,
        skipped: true,
        attempts: Number(draft.imagePrepAttempts || 0)
      })
    }
    // 推送执行中禁止无关 prepare（push 内调用须 opts.fromPush）
    if (
      String(draft.status || '') === 'pushing' &&
      !opts.fromPush &&
      !forceSkip &&
      draft.pushLeaseAt &&
      now() - Number(draft.pushLeaseAt) < 5 * 60 * 1000
    ) {
      return ok({
        imagesReady: !!draft.imagesReady,
        imagePrepStatus: draft.imagePrepStatus || 'preparing',
        skipped: true,
        reason: 'pushing',
        total: list.length,
        pending: list.length,
        ready: 0,
        dropped: 0,
        warmed: 0,
        attempts: Number(draft.imagePrepAttempts || 0)
      })
    }

    // 旧稿可能累计了「转存次数」
    const prepAttempts = Number(draft.imagePrepAttempts || 0) + 1

    await db
      .collection(DRAFTS_COL)
      .doc(id)
      .update({
        data: {
          imagePrepStatus: 'preparing',
          imagesReady: false,
          imagePrepAttempts: prepAttempts,
          updatedAt: now()
        }
      })
      .catch(() => null)

    // 他人 mmbiz 不能 identity 直通：须本槽 uploadimg，否则配图小程序锚点无点击
    for (const src of Object.keys(map)) {
      if (!isOwnedWxImage(src, map, draft.wxImageUploadSlot, slot)) {
        // 仅清掉「u→u」的伪就绪；保留已转存 u→w
        if (map[src] === src) delete map[src]
      }
    }

    const need = list.filter((src) => !isOwnedWxImage(src, map, draft.wxImageUploadSlot, slot))
    let warmed = 0
    const failedThisRound = []
    for (let i = 0; i < need.length; i += 5) {
      const batch = need.slice(i, i + 5)
      await Promise.all(
        batch.map(async (src) => {
          try {
            const wxUrl = await wechatApi.uploadContentImageFromUrl(src, wxOpts)
            if (wxUrl) {
              map[src] = wxUrl
              delete failMap[src]
              warmed += 1
            } else {
              failMap[src] = Number(failMap[src] || 0) + 1
              failedThisRound.push(src)
            }
          } catch (e) {
            failMap[src] = Number(failMap[src] || 0) + 1
            failedThisRound.push(src)
            console.warn('[oaContent] prepare image fail', src, e.message || e, failMap[src])
          }
        })
      )
      await db
        .collection(DRAFTS_COL)
        .doc(id)
        .update({
          data: {
            wxImageEntries: encodeImageEntries(map),
            wxImageFailEntries: encodeFailEntries(failMap),
            wxImageMap: {},
            wxImageFail: {},
            imagePrepStatus: 'preparing',
            updatedAt: now()
          }
        })
        .catch(() => null)
    }

    const uploadSlotForReady = warmed > 0 ? slot : draft.wxImageUploadSlot
    const readyCount = list.filter((src) =>
      isOwnedWxImage(src, map, uploadSlotForReady, slot)
    ).length
    const dropped = []
    let pending = []
    for (const src of list) {
      if (isOwnedWxImage(src, map, uploadSlotForReady, slot)) continue
      if (
        Number(failMap[src] || 0) >= FAIL_DROP_AFTER ||
        forceSkip ||
        (readyCount > 0 && failedThisRound.includes(src)) ||
        prepAttempts >= 2
      ) {
        dropped.push(src)
        continue
      }
      pending.push(src)
    }
    // 第 2 次转存仍有 pending：全部跳过，允许推送
    if (pending.length && (forceSkip || prepAttempts >= 2 || (readyCount > 0 && !warmed && failedThisRound.length))) {
      for (const src of pending) dropped.push(src)
      pending = []
    }

    const imagesReady = pending.length === 0
    const imagePrepStatus = !imagesReady ? 'preparing' : dropped.length ? 'partial' : 'ready'
    const patch = {
      wxImageEntries: encodeImageEntries(map),
      wxImageFailEntries: encodeFailEntries(failMap),
      wxImageMap: {},
      wxImageFail: {},
      imagesReady,
      imagePrepStatus,
      imagePrepAttempts: prepAttempts,
      imagePrepAt: now(),
      imagePrepStats: {
        total: list.length,
        ready: readyCount,
        pending: pending.length,
        dropped: dropped.length,
        warmed
      },
      updatedAt: now()
    }
    if (imagesReady) {
      patch.pushTimeline = appendTimeline(
        draft,
        dropped.length ? 'prep_partial' : 'prep_ready',
        `ok=${readyCount}/${list.length}${dropped.length ? ` dropped=${dropped.length}` : ''}`
      )
    }
    if (readyCount > 0 || warmed > 0) patch.wxImageUploadSlot = slot
    if (imagesReady) {
      let markdown = draft.markdown || ''
      if (dropped.length) markdown = stripMarkdownImages(markdown, dropped)
      if (Object.keys(map).length) markdown = applyImageMapToMarkdown(markdown, map)
      markdown = ensureHeroImagePlacement(markdown, {
        coverUrl: draft.coverUrl || brand.defaultCoverUrl || cfg.defaultCoverUrl || ''
      })
      if (markdown) {
        patch.markdown = markdown
        let preparedHtml = markdownToWechatHtml(markdown, 'clean')
        const mpPath = draft.miniprogramPath || cfg.miniprogramPath || 'pages/index/index'
        if (cfg.linkAllImagesToMiniprogram !== false) {
          preparedHtml = wechatApi.wrapAllImagesWithMiniprogram(preparedHtml, { path: mpPath })
        }
        patch.html =
          buildLeadHtml(cfg, mpPath) +
          preparedHtml
        patch.html = await appendMiniprogramCtaHtml(patch.html, cfg, brand, {
          path: mpPath,
          mode: 'link',
          credentialSlot: slot
        })
      }
      // 同步 imageUrls 为已成功的本槽图，避免推送再捡回坏链/他人 mmbiz
      const okUrls = list
        .filter((u) => isOwnedWxImage(u, map, slot, slot))
        .map((u) => map[u])
        .filter((u) => isWechatCdnUrl(u))
      if (okUrls.length) {
        patch.imageUrls = okUrls
        if (!isWechatCdnUrl(draft.coverUrl) && okUrls[0]) patch.coverUrl = okUrls[0]
      }
      // 跳过防盗链图不算推送失败，写入 note，避免红字吓人
      patch.error = ''
      patch.imagePrepNote =
        dropped.length > 0
          ? `配图：成功 ${readyCount}/${list.length}，跳过 ${dropped.length} 张（多为防盗链 403，可换图或用默认封面）`
          : ''
    } else {
      patch.error = `配图转存中（${readyCount}/${list.length}），完成后即可推送`
      patch.imagePrepNote = ''
    }

    await db.collection(DRAFTS_COL).doc(id).update({ data: patch })
    return ok({
      imagesReady,
      imagePrepStatus,
      total: list.length,
      warmed,
      pending: pending.length,
      dropped: dropped.length,
      ready: readyCount,
      mapSize: Object.keys(map).length,
      attempts: prepAttempts
    })
  }

  function kickPrepareOrPush(id, action) {
    if (typeof cloud === 'undefined' || !cloud || typeof cloud.callFunction !== 'function') {
      return Promise.reject(new Error('cloud.callFunction unavailable'))
    }
    return cloud.callFunction({
      name: 'oaPushDraft',
      data: { id, action: action || 'push' },
      config: { timeout: 90000 }
    })
  }

  /**
   * 管理端预览：微信图床防盗链 / NSF Cloudflare 拦图。
   * 统一走 fetchBuffer（内含 Photon/wsrv 候选），转 data URL。
   */
  async function proxyImage(body = {}) {
    const url = normalizeImgSrc(body.url || body.src || '')
    if (!/^https?:\/\//i.test(url)) return fail(4000, '无效图片 URL')
    await wechatApi.assertSafeFetchUrl(url, 0)
    const needsProxy =
      /qpic\.cn|qlogo\.cn|mp\.weixin\.qq\.com|nasaspaceflight\.com/i.test(url) ||
      /i[0-3]\.wp\.com/i.test(url)
    if (!needsProxy) return ok({ url, dataUrl: url, proxied: false })
    try {
      const buf = await wechatApi.fetchBuffer(url)
      if (!buf || !buf.length) return fail(5000, '图片为空')
      if (buf.length > 2.5 * 1024 * 1024) return fail(4000, '图片过大，无法预览')
      let mime = 'image/jpeg'
      if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png'
      else if (buf[0] === 0x47 && buf[1] === 0x49) mime = 'image/gif'
      else if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg'
      else if (buf.toString('ascii', 0, 4) === 'RIFF') mime = 'image/webp'
      return ok({
        url,
        dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
        proxied: true,
        bytes: buf.length
      })
    } catch (e) {
      return fail(5000, '图片代理失败: ' + (e.message || e))
    }
  }

  async function runGenerate({ topic, strategyKey, manualSource, user, brandKey }) {
    await ensureCols()
    const cfg = await readConfig()
    const brand = resolveBrand(cfg, brandKey || cfg.defaultBrandKey)
    const source = await enrichTopicFromUrl(topic || manualSource || {})
    const videos = await resolveTopicVideos(source)
    // 视频封面截图并入配图池（去重）：视频事件的正文配图与封面都有着落
    const imageUrls = pickImageUrls(await resolveTopicImages(source), videoPosterUrls(videos))
    const rawBody = String(source.body || source.content || '')

    // 策略：空 / auto → 按正文自动匹配；显式传入则尊重人工选择
    const requestedKey = String(strategyKey || '').trim()
    const strategyAuto = !requestedKey || requestedKey === 'auto'
    const resolvedStrategyKey = strategyAuto
      ? matchStrategyFromContent({
          title: source.title,
          body: rawBody,
          brandKey: brand.key,
          sourceType: source.sourceType
        })
      : requestedKey
    const strategy = await findStrategy(
      resolvedStrategyKey || brand.defaultStrategyKey || cfg.defaultStrategyKey
    )
    const prompt = await findPrompt(strategy.promptKey || 'create_from_data')
    // 原稿已有 [[IMG:n]] 则原样保留；仅纯文本才均匀补位
    const slottedBody = (
      /\[\[IMG:\s*\d+\s*\]\]/i.test(rawBody)
        ? rawBody
        : ensureImageSlotsInBody(rawBody, imageUrls, 8)
    ).slice(0, 8000)
    const vars = {
      persona: brand.persona || cfg.persona || DEFAULT_CONFIG.persona,
      strategyName: strategy.name || '',
      structureHint: strategy.structureHint || '',
      titleHint: strategy.titleHint || '',
      sourceTitle: source.title || '',
      sourceLabel: source.sourceType || source.sourceLabel || 'manual',
      sourceBody: slottedBody
    }
    const system = renderTemplate(prompt.system, vars)
    let userMsg = renderTemplate(prompt.user, vars)
    if (imageUrls.length === 1) {
      userMsg +=
        '\n\n【配图要求】仅 1 张图：把 [[IMG:1]] 单独放在正文最开头作头图，之后再写正文。禁止删改编号，不要输出 http 图片链接。'
    } else if (imageUrls.length) {
      userMsg +=
        `\n\n【配图要求】素材中有 ${imageUrls.length} 张图，占位为 [[IMG:1]]…[[IMG:${imageUrls.length}]]，位置已与原稿对齐。` +
        '成稿必须在相同叙述位置保留这些占位（单独成行），禁止删改编号、禁止把图挪到文首或文末堆放，不要输出 http 图片链接。'
    }
    if (videos.length) {
      const posterIdxs = videoPosterUrls(videos)
        .map((u) => imageUrls.indexOf(u) + 1)
        .filter((n) => n > 0)
      const longCount = videos.filter((v) => v.isLong).length
      userMsg +=
        `\n\n【视频素材】素材含 ${videos.length} 段视频${longCount ? `（其中 ${longCount} 段为长视频）` : ''}，` +
        `文中只放视频封面截图${posterIdxs.length ? `，对应占位 ${posterIdxs.map((n) => `[[IMG:${n}]]`).join('、')}` : ''}。` +
        '提及这些画面时用「视频画面/视频截图」表述，不要写成读者可在文内直接播放的视频。'
    }

    const draftDoc = {
      status: 'generating',
      brandKey: brand.key,
      brandName: brand.name,
      credentialSlot: brand.credentialSlot,
      strategyKey: strategy.key || resolvedStrategyKey || '',
      strategyName: strategy.name || '',
      strategyAuto: !!strategyAuto,
      promptKey: prompt.key || '',
      sourceType: source.sourceType || 'manual',
      sourceId: source.sourceId || '',
      sourceTitle: source.title || '',
      // 视频选题无来源页时，「阅读原文」兜底指向视频观看链（COS 原片优先）
      sourceUrl: source.sourceUrl || (videos[0] && videos[0].watchUrl) || '',
      videos,
      sourceSlottedBody: slottedBody,
      /** 原始图序（与 [[IMG:n]] 下标一一对应；prepare 换链后仍可按 n 定位） */
      sourceImageUrls: imageUrls.slice(0, 8),
      coverUrl:
        imageUrls[0] || source.coverUrl || brand.defaultCoverUrl || cfg.defaultCoverUrl || '',
      imageUrls,
      title: '',
      markdown: '',
      html: '',
      digest: '',
      author: brand.author || cfg.author || '火星探索日志',
      miniprogramPath: cfg.miniprogramPath || 'pages/index/index',
      error: '',
      wxMediaId: '',
      wxPublishId: '',
      createdAt: now(),
      updatedAt: now(),
      createdBy: (user && user.username) || 'system'
    }
    const add = await db.collection(DRAFTS_COL).add({ data: draftDoc })
    const draftId = add._id

    try {
      let usedFallback = false
      const gen = await generateText({
        system,
        user: userMsg,
        // 0.85 实测会脑补事实；0.55 兼顾文风随机性与事实稳定
        temperature: 0.55,
        maxTokens: 2500
      })
      let raw = (gen && gen.text) || ''
      if (!raw) {
        usedFallback = true
        const llmHint = String((gen && gen.error) || '混元/外部 AI 均未返回正文').slice(0, 240)
        raw =
          `# ${vars.sourceTitle || '航天速递'}\n\n` +
          `> 自动生成暂不可用（${llmHint}）。以下为素材整理稿，请人工改写后保存再推送。\n\n` +
          `${vars.sourceBody || '（无素材）'}`
      }
      const parsed = stripTitleFromMarkdown(raw)
      const title = (parsed.title || vars.sourceTitle || '未命名').slice(0, 64)
      // 严格按原稿占位落图，避免成稿后重排错位
      let bodyMd = placeImagesAlignedToSource(parsed.body || '', slottedBody, imageUrls, 8)
      bodyMd = ensureHeroImagePlacement(bodyMd, {
        coverUrl: draftDoc.coverUrl || imageUrls[0] || brand.defaultCoverUrl || cfg.defaultCoverUrl || ''
      })
      // 视频封面截图下补「▶ …」说明行（阅读原文指向该视频时一并提示）
      bodyMd = annotateVideoPostersInMarkdown(bodyMd, videos, { readMoreUrl: draftDoc.sourceUrl })
      bodyMd = stripPromoBrandFooterMarkdown(bodyMd)
      const foot = safeBrandFooter(brand, cfg)
      const markdown =
        bodyMd + (foot ? `\n\n---\n\n${foot}` : '')
      let html = buildLeadHtml(cfg) + markdownToWechatHtml(markdown, strategy.themeId || 'clean')
      html = await appendMiniprogramCtaHtml(html, cfg, brand, {
        path: cfg.miniprogramPath,
        mode: 'link',
        credentialSlot: brand.credentialSlot
      })
      const digest = String(parsed.body || '')
        .replace(/[#>*`\[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)

      const status = usedFallback ? 'needs_review' : 'ready'
      await db.collection(DRAFTS_COL).doc(draftId).update({
        data: {
          status,
          pushTimeline: appendTimeline(null, usedFallback ? 'generated_fallback' : 'generated', title),
          title,
          markdown,
          html,
          digest,
          coverUrl: draftDoc.coverUrl,
          imageUrls,
          sourceSlottedBody: slottedBody,
          generatedByAi: !usedFallback,
          updatedAt: now(),
          error: usedFallback
            ? `LLM 不可用，已写入素材整理稿，需人工改写。${String((gen && gen.error) || '').slice(0, 200)}`
            : ''
        }
      })
      // 洗稿 HTTP 易超 60s：异步转存。他人 mmbiz 也必须本槽 uploadimg，不能标就绪直通
      const imagesReadyOut = !imageUrls.length
      await db
        .collection(DRAFTS_COL)
        .doc(draftId)
        .update({
          data: {
            imagePrepStatus: imagesReadyOut ? 'ready' : 'preparing',
            imagesReady: imagesReadyOut,
            wxImageEntries: [],
            wxImageMap: {},
            wxImageFail: {},
            wxImageUploadSlot: '',
            error: usedFallback
              ? `LLM 不可用，已写入素材整理稿，需人工改写。${String((gen && gen.error) || '').slice(0, 200)}`
              : imagesReadyOut
                ? ''
                : '配图转存中，完成后即可推送',
            updatedAt: now()
          }
        })
        .catch(() => null)
      if (imageUrls.length && !imagesReadyOut) {
        kickPrepareOrPush(draftId, 'prepare').catch((e) =>
          console.warn('[oaContent] kick prepare', e.message || e)
        )
      }
      return ok({
        _id: draftId,
        status,
        title,
        digest,
        brandKey: brand.key,
        strategyKey: draftDoc.strategyKey,
        strategyName: draftDoc.strategyName,
        strategyAuto: !!draftDoc.strategyAuto,
        imageCount: imageUrls.length,
        videoCount: videos.length,
        generatedByAi: !usedFallback,
        imagesReady: imagesReadyOut,
        // 兜底时带回 LLM 失败原因，前端可提示（否则用户只看到「需改写」不知为何）
        llmError: usedFallback ? String((gen && gen.error) || 'LLM 未返回正文').slice(0, 240) : ''
      })
    } catch (e) {
      // 系统性生成失败进 generate_failed，不再占用人工「已拒绝」语义
      await db.collection(DRAFTS_COL).doc(draftId).update({
        data: {
          status: 'generate_failed',
          error: e.message || String(e),
          pushTimeline: appendTimeline(null, 'generate_failed', e.message || String(e)),
          updatedAt: now()
        }
      })
      return fail(5000, '生成失败: ' + (e.message || e), { _id: draftId })
    }
  }

  async function generateFromBody(body, user) {
    const topics = []
    if (Array.isArray(body.topics) && body.topics.length) {
      topics.push(...body.topics)
    } else if (body.topic) {
      topics.push(body.topic)
    } else if (body.sourceUrl || body.manualText || body.title) {
      const manual = String(body.manualText || body.content || '').trim()
      const srcUrl = String(body.sourceUrl || '').trim()
      topics.push({
        sourceType: 'manual',
        title: body.title || '手动选题',
        body: manual,
        coverUrl: body.coverUrl || '',
        imageUrls: pickImageUrls(body.imageUrls, body.images, body.coverUrl),
        sourceUrl: srcUrl || (oaFetch.looksLikeLoneUrl(manual) ? manual : '')
      })
    } else {
      const gathered = await gatherTopics({ limit: Number(body.count) || 3 })
      topics.push(...((gathered.data && gathered.data.list) || []))
    }
    const strategyKey = body.strategyKey || ''
    const brandKey = body.brandKey || ''
    const results = []
    for (const t of topics.slice(0, Math.min(8, Number(body.count) || topics.length || 1))) {
      const r = await runGenerate({ topic: t, strategyKey, brandKey, user })
      results.push(r)
    }
    return ok({
      results: results.map((r) => r.data || r),
      count: results.length
    })
  }

  /**
   * 推送微信草稿（HTTP 入口）：
   * 1) 配图未就绪 → 先转存（不占 pushing），worker 续跑
   * 2) 配图就绪 → 入队推送（此时只剩封面+draft/add，很快）
   */
  async function pushDraftToWechat(id, user, opts = {}) {
    await ensureCols()
    // execute 旁路仅内部/同步回退可用，禁止客户端 body.execute 直推
    if (opts && (opts.execute === true || opts.execute === 'true') && opts._internal) {
      return executePushDraft(id, user, opts)
    }
    const res = await db.collection(DRAFTS_COL).doc(id).get().catch(() => null)
    if (!res || !res.data) return fail(4040, '草稿不存在')
    const draft = res.data
    const st = String(draft.status || '')
    const force = !!(opts && (opts.force === true || opts.force === 'true' || opts.force === 1))
    if (!['ready', 'pushed_to_wechat', 'pushing', 'push_failed'].includes(st)) {
      return fail(4000, '仅待审核 / 已推微信 / 推送失败状态可推送')
    }
    if (!draft.html && !draft.markdown) return fail(4000, '正文为空')
    if (looksLikeLlmFallbackMarkdown(draft.markdown) && draft.generatedByAi === false) {
      return fail(4000, '素材整理稿尚未实质改写，请编辑后再推送')
    }
    const leaseMs = 100 * 1000
    if (st === 'pushing' && !force && draft.pushLeaseAt && now() - Number(draft.pushLeaseAt) < leaseMs) {
      const left = Math.ceil((leaseMs - (now() - Number(draft.pushLeaseAt))) / 1000)
      return fail(4090, `正在推送中，约 ${left}s 后可强制重试`)
    }

    // —— 阶段 1：配图必须先就绪 ——
    if (!draft.imagesReady) {
      const prep = await prepareDraftImages(id)
      if (!(prep && prep.code === 0 && prep.data && prep.data.imagesReady)) {
        kickPrepareOrPush(id, 'prepare')
        return ok({
          async: true,
          preparing: true,
          message:
            (prep && prep.data && prep.message) ||
            (prep && prep.data && prep.data.pending != null
              ? `正在转存配图（剩余 ${prep.data.pending} 张）。就绪后列表会提示「配图就绪」，再点推送即可。`
              : '正在转存配图，请稍候刷新；就绪后再推送。')
        })
      }
    }

    const prevStatus = st === 'pushing' ? draft.pushPrevStatus || 'ready' : st
    // 入队即占租约，避免 kick 与定时器双开 executePushDraft
    await db.collection(DRAFTS_COL).doc(id).update({
      data: {
        status: 'pushing',
        pushPrevStatus: ['pushing', 'push_failed'].includes(prevStatus) ? 'ready' : prevStatus,
        pushLeaseAt: now(),
        error: '',
        pushTimeline: appendTimeline(draft, 'push_queued', ''),
        updatedAt: now()
      }
    })

    try {
      const kick = kickPrepareOrPush(id, 'push')
      const early = await Promise.race([
        kick.then((r) => ({ type: 'done', r })).catch((e) => ({ type: 'err', e })),
        new Promise((resolve) => setTimeout(() => resolve({ type: 'pending' }), 1800))
      ])
      if (early.type === 'err') {
        const msg = String((early.e && early.e.message) || early.e || '')
        if (/FUNCTION_NOT_FOUND|FunctionName|未找到|不存在|unavailable/i.test(msg)) {
          return executePushDraft(id, user, { ...(opts || {}), _internal: true })
        }
        console.warn('[oaContent] kick push', msg)
      } else if (early.type === 'done' && early.r && early.r.result) {
        const result = early.r.result
        const again = await db.collection(DRAFTS_COL).doc(id).get().catch(() => null)
        const row = (again && again.data) || {}
        if (row.status === 'pushed_to_wechat' && row.wxMediaId) {
          return ok({ media_id: row.wxMediaId, brandKey: row.brandKey, async: false })
        }
        if (result.code && result.code !== 0) {
          return fail(result.code, result.message || '推送失败')
        }
      }
    } catch (e) {
      console.warn('[oaContent] kick push', e.message || e)
    }

    return ok({
      async: true,
      message: '配图已就绪，正在写入微信草稿箱…'
    })
  }

  /** 实际上传封面并写入微信草稿箱（正文图须已 prepare 就绪） */
  async function executePushDraft(id, user) {
    await ensureCols()
    let res = await db.collection(DRAFTS_COL).doc(id).get().catch(() => null)
    if (!res || !res.data) return fail(4040, '草稿不存在')
    let draft = res.data
    // 幂等：已成功写入微信则直接返回，避免双开 draft/add
    if (String(draft.status || '') === 'pushed_to_wechat' && draft.wxMediaId) {
      return ok({
        media_id: draft.wxMediaId,
        brandKey: draft.brandKey,
        credentialSlot: draft.credentialSlot,
        idempotent: true
      })
    }
    const rawPrev =
      draft.pushPrevStatus ||
      (draft.status === 'pushing' ? 'ready' : draft.status) ||
      'ready'
    const prevStatus = ['pushing', 'push_failed'].includes(rawPrev) ? 'ready' : rawPrev
    if (!['ready', 'pushed_to_wechat', 'pushing', 'push_failed'].includes(String(draft.status || ''))) {
      return fail(4000, '草稿状态不可推送')
    }
    if (!draft.html && !draft.markdown) {
      await db
        .collection(DRAFTS_COL)
        .doc(id)
        .update({
          data: { status: 'push_failed', pushLeaseAt: 0, error: '正文为空', updatedAt: now() }
        })
        .catch(() => null)
      return fail(4000, '正文为空')
    }

    try {
      const cfg = await readConfig()
      const brand = resolveBrand(cfg, draft.brandKey || cfg.defaultBrandKey)
      const slot = wechatApi.normalizeSlot(draft.credentialSlot || brand.credentialSlot)
      if (!wechatApi.credentialsReady(slot)) {
        throw new Error(credentialMissingMsg(slot))
      }
      const wxOpts = { credentialSlot: slot }

      // 硬门槛：配图未就绪先转存，绝不带着外链去 draft/add
      if (!draft.imagesReady) {
        const prep = await prepareDraftImages(id, { credentialSlot: slot, fromPush: true })
        if (!(prep && prep.code === 0 && prep.data && prep.data.imagesReady)) {
          const left = prep && prep.data ? prep.data.pending : '?'
          throw new Error(`配图尚未就绪（剩余 ${left} 张），请稍候再推`)
        }
        res = await db.collection(DRAFTS_COL).doc(id).get().catch(() => null)
        draft = (res && res.data) || draft
      }

      let thumbMediaId = draft.wxThumbMediaId || ''
      const cover =
        draft.coverUrl ||
        (draft.imageUrls && draft.imageUrls[0]) ||
        brand.defaultCoverUrl ||
        cfg.defaultCoverUrl
      if (!thumbMediaId && !cover) throw new Error('缺少封面图')
      await db.collection(DRAFTS_COL).doc(id).update({
        data: {
          status: 'pushing',
          pushPrevStatus: prevStatus,
          pushLeaseAt: now(),
          updatedAt: now()
        }
      })
      // 封面：转存表 → 原封面 → 品牌默认封面（防 403）
      if (!thumbMediaId) {
        const imgMap = decodeImageMap(draft)
        const coverCandidates = [
          imgMap[normalizeImgSrc(cover)],
          cover,
          brand.defaultCoverUrl,
          cfg.defaultCoverUrl
        ]
          .map((u) => normalizeImgSrc(u))
          .filter((u) => /^https?:\/\//i.test(u))
        const tried = new Set()
        let lastCoverErr = null
        for (const cand of coverCandidates) {
          if (tried.has(cand)) continue
          tried.add(cand)
          try {
            thumbMediaId = await wechatApi.uploadThumbFromUrl(cand, wxOpts)
            lastCoverErr = null
            break
          } catch (e) {
            lastCoverErr = e
            console.warn('[oaContent] cover upload fail', cand, e.message || e)
          }
        }
        if (!thumbMediaId) {
          throw new Error(
            '封面图无法下载（多为防盗链 HTTP 403）。请在发稿设置配置默认封面，或更换可公开访问的封面 URL。' +
              (lastCoverErr ? ` 详情: ${lastCoverErr.message || lastCoverErr}` : '')
          )
        }
      }

      // 配图未按本槽转存过（含他人 mmbiz 伪就绪）→ 先强制 prepare 再组稿
      // 注意：只用正文配图，不含默认封面（封面走 thumb 上传）
      {
        const imgMapForPush = decodeImageMap(draft)
        const bodySrcs = resolveBodyImageUrls(draft, brand, cfg)
        const needOwnedPrep =
          bodySrcs.length > 0 &&
          bodySrcs.some((u) => !isOwnedWxImage(u, imgMapForPush, draft.wxImageUploadSlot, slot))
        if (needOwnedPrep) {
          const prep = await prepareDraftImages(id, {
            credentialSlot: slot,
            fromPush: true
          })
          if (!(prep && prep.code === 0 && prep.data && prep.data.imagesReady)) {
            const left = prep && prep.data ? prep.data.pending : '?'
            throw new Error(`配图尚未按本公众号转存完成（剩余 ${left} 张），请稍候再推`)
          }
          res = await db.collection(DRAFTS_COL).doc(id).get().catch(() => null)
          draft = (res && res.data) || draft
        } else if (!bodySrcs.length && !draft.imagesReady) {
          // 仅封面稿：补齐就绪标记，避免门控误拦
          await prepareDraftImages(id, { credentialSlot: slot, fromPush: true })
          res = await db.collection(DRAFTS_COL).doc(id).get().catch(() => null)
          draft = (res && res.data) || draft
        }
      }

      const pushImages = resolveBodyImageUrls(draft, brand, cfg)
      let mdForPush = ''
      let html
      if (draft.markdown) {
        const mdHasImages = /!\[[^\]]*\]\(https?:\/\//i.test(draft.markdown)
        if (mdHasImages) {
          // 生成时已按原稿对齐、prepare 已原位换成 mmbiz：直接用，绝不二次重排
          // （二次重排会因 prepare 丢图导致下标移位，配图挤到文末/错位）
          mdForPush = placeImagesInMarkdown(draft.markdown, pushImages, 8, {
            redistribute: false
          })
        } else if (draft.sourceSlottedBody) {
          // markdown 无图（用户删过/旧稿）：按原稿占位重放
          // sourceImageUrls 保留原始下标；已转存的映射为 mmbiz，丢弃的置空跳过不移位
          const imgMap = decodeImageMap(draft)
          const srcList = Array.isArray(draft.sourceImageUrls) ? draft.sourceImageUrls : []
          const indexed = srcList.map((u) => {
            const key = normalizeImgSrc(u)
            const w = imgMap[key]
            if (w && isWechatCdnUrl(w)) return w
            return isOwnedWxImage(key, imgMap, draft.wxImageUploadSlot, slot) ? key : ''
          })
          mdForPush = indexed.some(Boolean)
            ? placeImagesAlignedToSource(draft.markdown, draft.sourceSlottedBody, indexed, 8, {
                preserveIndex: true
              })
            : placeImagesAlignedToSource(draft.markdown, draft.sourceSlottedBody, pushImages, 8)
        } else {
          mdForPush = placeImagesInMarkdown(draft.markdown, pushImages, 8, {
            redistribute: false
          })
        }
        mdForPush = stripPromoBrandFooterMarkdown(mdForPush)
        mdForPush = ensureHeroImagePlacement(mdForPush, {
          coverUrl: draft.coverUrl || brand.defaultCoverUrl || cfg.defaultCoverUrl || ''
        })
        // 头图策略可能改写 markdown：同步回推送稿，避免微信正文与后台不一致
        if (mdForPush && mdForPush !== String(draft.markdown || '').trim()) {
          draft.markdown = mdForPush
        }
        html = markdownToWechatHtml(mdForPush, 'clean')
      } else {
        // 旧 html 里可能已带文首提示语，先剥掉，最终组装时统一加，避免重复
        html = wechatApi.stripLeadDisclaimer(wechatApi.stripMiniprogramCta(draft.html || ''))
      }

      // 头图可能是封面链：并入 fallback，避免 skipCoverFallbacks 把刚置顶的头图剥掉
      const pushImageFallbacks = pickImageUrls(pushImages, collectMarkdownImageUrls(mdForPush || draft.markdown || ''))

      const rewritten = await rewriteHtmlImagesForWechat(html, pushImageFallbacks, wxOpts, {
        draftId: id,
        imageMap: decodeImageMap(draft),
        failMap: decodeFailMap(draft),
        uploadSlot: draft.wxImageUploadSlot || slot,
        priorIncomplete: /配图上传未完成|推送未完成|转存中/i.test(String(draft.error || '')),
        skipCoverFallbacks: true,
        draft,
        brand,
        cfg
      })
      html = rewritten.html || rewritten
      if (rewritten.pending > 0) {
        throw new Error(
          `配图上传未完成（${rewritten.uploaded}/${rewritten.wanted || pushImageFallbacks.length}），请再点推送续传`
        )
      }
      // 双保险：剥残留外链；未本槽转存的 mmbiz 也去掉（避免无点击的假锚点）
      const ownedMap = rewritten.imageMap || decodeImageMap(draft)
      const ownedSlot = draft.wxImageUploadSlot || slot
      html = html.replace(/<img\b[^>]*>/gi, (tag) => {
        const sm = tag.match(/\bsrc=["']([^"']+)["']/i)
        if (!sm) return tag
        const src = normalizeImgSrc(sm[1])
        if (isOwnedWxImage(src, ownedMap, ownedSlot, slot) || isOwnedWxImage(src, ownedMap, slot, slot)) {
          return tag
        }
        if (isWechatCdnUrl(src) && ownedMap[src] && ownedMap[src] !== src) {
          return tag.replace(sm[1], ownedMap[src])
        }
        return ''
      })
      const dropNote =
        rewritten.dropped && rewritten.dropped.length
          ? `（已跳过 ${rewritten.dropped.length} 张无法转存的图）`
          : ''
      html = wechatApi.stripMiniprogramCta(html)
      const mpPath = draft.miniprogramPath || cfg.miniprogramPath || 'pages/index/index'
      // 正文配图必须包小程序锚点（默认开；显式 false 才关）
      if (cfg.linkAllImagesToMiniprogram !== false) {
        html = wechatApi.wrapAllImagesWithMiniprogram(html, { path: mpPath })
      }
      const cardImage =
        (html.match(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/i) || [])[1] ||
        cover ||
        (draft.imageUrls && draft.imageUrls[0]) ||
        ''
      const ctaMode = cfg.miniprogramCtaMode || 'none'
      const ctaOpts = {
        path: mpPath,
        title: String(brand.miniprogramCta || brand.name || draft.title || '火星探索日志').slice(
          0,
          20
        ),
        imageUrl: cardImage,
        credentialSlot: slot,
        // 正文图已经本槽 uploadimg，文末引流可复用，避免重复上传
        trustMmbiz: true
      }
      // 文首提示语置顶；文末引流仅 mode≠none 时附加（默认只靠配图跳转）
      html = buildLeadHtml(cfg, mpPath) + html
      html = await appendMiniprogramCtaHtml(html, cfg, brand, { ...ctaOpts, mode: ctaMode })

      const sourceUrl = String(draft.sourceUrl || '').trim()
      const article = {
        title: sanitizeWxTitle(draft.title),
        author: String(draft.author || brand.author || cfg.author || '火星探索日志').slice(0, 16),
        digest: String(draft.digest || '').slice(0, 120),
        content: html,
        content_source_url: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : '',
        thumb_media_id: thumbMediaId,
        need_open_comment: cfg.openComment === false ? 0 : 1,
        only_fans_can_comment: cfg.onlyFansCanComment ? 1 : 0
      }

      let wx
      let ctaFallback = ''
      try {
        wx = await wechatApi.addDraft(article, wxOpts)
      } catch (e1) {
        if (wechatApi.isInvalidContentError(e1)) {
          console.warn('[oaContent] draft 45166, retry with safer CTA', e1.message || e1)
          // 保留正文配图小程序锚点，只降级文末 CTA
          html = wechatApi.stripMiniprogramCta(html)
          if (cfg.linkAllImagesToMiniprogram !== false) {
            html = wechatApi.wrapAllImagesWithMiniprogram(html, { path: mpPath })
          }
          if (shouldAppendMiniprogramCta(cfg)) {
            html = await appendMiniprogramCtaHtml(html, cfg, brand, {
              ...ctaOpts,
              mode: 'link',
              trustMmbiz: true
            })
            ctaFallback = 'link'
          } else {
            ctaFallback = 'images_only'
          }
          article.content = html
          try {
            wx = await wechatApi.addDraft(article, wxOpts)
          } catch (e2) {
            if (wechatApi.isInvalidContentError(e2)) {
              // 再试：仅配图锚点 + 无文末 CTA（优先保配图可点）
              console.warn('[oaContent] draft 45166, retry images-only MP links', e2.message || e2)
              html = wechatApi.stripMiniprogramCta(html)
              if (cfg.linkAllImagesToMiniprogram !== false) {
                html = wechatApi.wrapAllImagesWithMiniprogram(html, { path: mpPath })
              }
              article.content = html
              ctaFallback = 'images_only'
              try {
                wx = await wechatApi.addDraft(article, wxOpts)
              } catch (e3) {
                if (wechatApi.isInvalidContentError(e3)) {
                  console.warn('[oaContent] draft 45166, last resort unwrap images', e3.message || e3)
                  html = wechatApi.stripMiniprogramCta(html)
                  html = wechatApi.unwrapMiniprogramImageLinks(html)
                  // 最后手段才用文字链；默认 none 策略下尽量不主动插硬广
                  if (shouldAppendMiniprogramCta(cfg)) {
                    html += wechatApi.buildMiniprogramLinkHtml({
                      path: ctaOpts.path,
                      text: brand.miniprogramCta || cfg.miniprogramCta || ctaOpts.title
                    })
                  }
                  article.content = html
                  ctaFallback = 'unwrap'
                  wx = await wechatApi.addDraft(article, wxOpts)
                } else {
                  throw e3
                }
              }
            } else {
              throw e2
            }
          }
        } else {
          throw e1
        }
      }
      const fallbackNote =
        ctaFallback === 'unwrap'
          ? '（微信拒收配图小程序锚点，已降级为文末文字链）'
          : ctaFallback === 'images_only'
            ? '（文末引流已省略，配图仍可点进小程序）'
            : ctaFallback === 'link'
              ? '（文末引流已降级为文字链）'
              : ''
      const pushPatch = {
        status: 'pushed_to_wechat',
        brandKey: brand.key,
        brandName: brand.name,
        credentialSlot: slot,
        wxMediaId: wx.media_id,
        wxThumbMediaId: thumbMediaId,
        html,
        ...(mdForPush ? { markdown: mdForPush } : {}),
        pushLeaseAt: 0,
        pushPrevStatus: '',
        updatedAt: now(),
        error: [dropNote ? `已推送${dropNote}` : '', fallbackNote].filter(Boolean).join('') || '',
        ctaFallback,
        wxImageEntries: encodeImageEntries(rewritten.imageMap || decodeImageMap(draft)),
        wxImageFailEntries: encodeFailEntries(rewritten.failMap || decodeFailMap(draft)),
        wxImageMap: {},
        wxImageFail: {},
        wxImageUploadSlot: slot,
        pushTimeline: appendTimeline(
          draft,
          'push_ok',
          `media_id=${wx.media_id}${ctaFallback ? ` fallback=${ctaFallback}` : ''}`
        )
      }
      if (mdForPush) pushPatch.markdown = mdForPush
      await db.collection(DRAFTS_COL).doc(id).update({ data: pushPatch })
      await writeOpLog({
        user,
        module: 'oa_content',
        action: 'push_wechat_draft',
        targetId: id,
        after: {
          media_id: wx.media_id,
          brandKey: brand.key,
          credentialSlot: slot,
          droppedImages: (rewritten.dropped || []).length
        }
      })
      return ok({
        media_id: wx.media_id,
        brandKey: brand.key,
        async: false,
        droppedImages: rewritten.dropped || []
      })
    } catch (e) {
      const msg = e.message || String(e)
      const notReady = /配图尚未就绪/i.test(msg)
      const resumable = !notReady && /配图上传未完成|请再点推送续传/i.test(msg)
      await db
        .collection(DRAFTS_COL)
        .doc(id)
        .update({
          data: {
            // 配图未就绪回到 ready 等转存；续传保持 pushing；真实失败进 push_failed
            status: notReady
              ? 'ready'
              : resumable
                ? 'pushing'
                : prevStatus === 'pushed_to_wechat'
                  ? 'pushed_to_wechat'
                  : 'push_failed',
            error: msg,
            pushLeaseAt: 0,
            imagesReady: notReady ? false : draft.imagesReady,
            imagePrepStatus: notReady ? 'preparing' : draft.imagePrepStatus,
            pushTimeline:
              notReady || resumable ? draft.pushTimeline || [] : appendTimeline(draft, 'push_fail', msg),
            updatedAt: now()
          }
        })
        .catch(() => null)
      return fail(resumable ? 5030 : notReady ? 5031 : 5000, msg)
    }
  }

  async function publishDraft(id, user) {
    await ensureCols()
    const res = await db.collection(DRAFTS_COL).doc(id).get().catch(() => null)
    if (!res || !res.data) return fail(4040, '草稿不存在')
    const draft = res.data
    const st = String(draft.status || '')
    if (st === 'published') return fail(4000, '已发布')
    if (st !== 'pushed_to_wechat') {
      return fail(4000, '请先推送到微信草稿箱后再发稿')
    }
    if (!draft.wxMediaId) {
      return fail(4000, '缺少微信草稿 media_id，请重新推送')
    }
    const cfg = await readConfig()
    const brand = resolveBrand(cfg, draft.brandKey || cfg.defaultBrandKey)
    const slot = wechatApi.normalizeSlot(draft.credentialSlot || brand.credentialSlot)
    if (!wechatApi.credentialsReady(slot)) {
      return fail(4000, `发稿号凭证槽 ${slot} 未配置`)
    }
    const wxOpts = { credentialSlot: slot }
    const mediaId = draft.wxMediaId
    try {
      const pub = await wechatApi.freepublishSubmit(mediaId, wxOpts)
      await db.collection(DRAFTS_COL).doc(id).update({
        data: {
          status: 'published',
          brandKey: brand.key,
          brandName: brand.name,
          credentialSlot: slot,
          wxPublishId: pub.publish_id || '',
          publishedAt: now(),
          updatedAt: now(),
          error: ''
        }
      })
      await writeOpLog({
        user,
        module: 'oa_content',
        action: 'freepublish',
        targetId: id,
        after: { ...(pub || {}), brandKey: brand.key, credentialSlot: slot }
      })
      return ok({ ...(pub || {}), brandKey: brand.key })
    } catch (e) {
      await db.collection(DRAFTS_COL).doc(id).update({
        data: { error: e.message || String(e), updatedAt: now() }
      })
      return fail(5000, e.message || String(e))
    }
  }

  async function rejectDraft(id, user, body) {
    await ensureCols()
    const res = await db.collection(DRAFTS_COL).doc(id).get().catch(() => null)
    if (!res || !res.data) return fail(4040, '草稿不存在')
    if (String(res.data.status || '') === 'published') {
      return fail(4000, '已发布稿不可拒绝')
    }
    await db.collection(DRAFTS_COL).doc(id).update({
      data: {
        status: 'rejected',
        error: (body && body.reason) || '人工拒绝',
        updatedAt: now()
      }
    })
    await writeOpLog({
      user,
      module: 'oa_content',
      action: 'reject',
      targetId: id,
      after: body || {}
    })
    return ok({ rejected: true })
  }

  async function batchDeleteDrafts(body, user) {
    const ids = Array.isArray(body && body.ids)
      ? [...new Set(body.ids.map((x) => String(x || '').trim()).filter(Boolean))]
      : []
    if (!ids.length) return fail(4000, '请选择要删除的草稿')
    if (ids.length > 100) return fail(4000, '单次最多删除 100 条')
    await ensureCols()
    let deleted = 0
    let failed = 0
    for (const id of ids) {
      try {
        await db.collection(DRAFTS_COL).doc(id).remove()
        deleted += 1
      } catch (e) {
        failed += 1
      }
    }
    await writeOpLog({
      user,
      module: 'oa_content',
      action: 'batch_delete',
      targetId: ids.slice(0, 5).join(','),
      after: { deleted, failed, total: ids.length }
    })
    return ok({ deleted, failed, total: ids.length })
  }

  async function cleanupExpiredOaContent(cfg) {
    const draftDays = Math.max(0, Number(cfg.draftRetainDays || 0))
    const jobDays = Math.max(0, Number(cfg.jobRetainDays || 0))
    const cleaned = { drafts: 0, jobs: 0 }
    const ts = now()

    if (draftDays > 0) {
      const cutoff = ts - draftDays * 24 * 60 * 60 * 1000
      // 只清「已完结」稿，待审核/已推微信草稿保留
      try {
        for (let round = 0; round < 20; round++) {
          const res = await db
            .collection(DRAFTS_COL)
            .where({
              status: _.in(['published', 'rejected', 'generate_failed']),
              createdAt: _.lt(cutoff)
            })
            .limit(50)
            .get()
          const rows = res.data || []
          if (!rows.length) break
          for (const row of rows) {
            await db.collection(DRAFTS_COL).doc(row._id).remove().catch(() => {})
            cleaned.drafts += 1
          }
        }
      } catch (e) {
        console.warn('[oaContent] cleanup drafts', e.message || e)
      }
    }

    if (jobDays > 0) {
      const cutoff = ts - jobDays * 24 * 60 * 60 * 1000
      try {
        for (let round = 0; round < 10; round++) {
          const res = await db
            .collection(JOBS_COL)
            .where({ createdAt: _.lt(cutoff) })
            .limit(50)
            .get()
          const rows = res.data || []
          if (!rows.length) break
          for (const row of rows) {
            await db.collection(JOBS_COL).doc(row._id).remove().catch(() => {})
            cleaned.jobs += 1
          }
        }
      } catch (e) {
        console.warn('[oaContent] cleanup jobs', e.message || e)
      }
    }
    return cleaned
  }

  async function runDailyPipeline(user) {
    await ensureCols()
    const cfg = await readConfig()
    if (!cfg.enabled && !(user && user.username && user.username !== 'cron')) {
      // cron 也尊重开关；手动触发允许强制
    }
    if (!cfg.enabled && (!user || user.username === 'cron')) {
      return ok({ skipped: true, reason: 'disabled' })
    }
    const jobAdd = await db.collection(JOBS_COL).add({
      data: {
        type: 'daily',
        status: 'running',
        createdAt: now(),
        updatedAt: now()
      }
    })
    try {
      const cleaned = await cleanupExpiredOaContent(cfg)
      const max = Math.min(8, Number(cfg.dailyMax) || 3)
      const brand = resolveBrand(cfg, cfg.defaultBrandKey)
      const gathered = await gatherTopics({ limit: max })
      const list = (gathered.data && gathered.data.list) || []
      const results = []
      for (const t of list.slice(0, max)) {
        const r = await runGenerate({
          topic: t,
          strategyKey: 'auto',
          brandKey: brand.key,
          user
        })
        results.push(r.data || r)
        if (cfg.autoPushToWechatDraft && r.code === 0 && r.data && r.data._id && r.data.status === 'ready') {
          await pushDraftToWechat(r.data._id, user)
        }
      }
      const summary = {
        count: results.length,
        draftIds: results.map((x) => x._id).filter(Boolean),
        cleaned
      }
      await db.collection(JOBS_COL).doc(jobAdd._id).update({
        data: { status: 'done', result: summary, updatedAt: now() }
      })
      await writeConfig({
        lastDailyAt: now(),
        lastDailyResult: JSON.stringify(summary)
      })
      return ok(summary)
    } catch (e) {
      await db.collection(JOBS_COL).doc(jobAdd._id).update({
        data: { status: 'failed', error: e.message || String(e), updatedAt: now() }
      })
      return fail(5000, e.message || String(e))
    }
  }

  // ===== Phase 2 assets =====
  async function analyzeTitle(body, user) {
    await ensureCols()
    const title = String((body && body.title) || '').trim()
    if (!title) return fail(4000, '缺少 title')
    const prompt = await findPrompt('title_breakdown')
    const cfg = await readConfig()
    const system = renderTemplate(prompt.system, { persona: cfg.persona })
    const userMsg = renderTemplate(prompt.user, { sourceTitle: title })
    const gen = await generateText({ system, user: userMsg, temperature: 0.4, maxTokens: 800 })
    const raw = (gen && gen.text) || ''
    const parsed = extractJsonBlock(raw) || { raw, error: (gen && gen.error) || '' }
    if (body.save !== false) {
      await db.collection(TITLES_COL).add({
        data: {
          title,
          analysis: parsed,
          source: body.source || 'manual',
          createdAt: now(),
          updatedAt: now(),
          createdBy: (user && user.username) || ''
        }
      })
    }
    return ok(parsed)
  }

  async function generateTitles(body, user) {
    await ensureCols()
    const prompt = await findPrompt('batch_titles')
    const cfg = await readConfig()
    const system = renderTemplate(prompt.system, { persona: cfg.persona })
    const userMsg = renderTemplate(prompt.user, {
      sourceTitle: (body && body.topic) || '航天资讯',
      sourceBody: (body && body.context) || ''
    })
    const gen = await generateText({ system, user: userMsg, temperature: 0.8, maxTokens: 800 })
    const raw = (gen && gen.text) || ''
    let titles = []
    const arrMatch = String(raw).match(/\[[\s\S]*\]/)
    if (arrMatch) {
      try {
        titles = JSON.parse(arrMatch[0])
      } catch (e) {}
    }
    if (!Array.isArray(titles)) titles = []
    titles = titles.map((t) => String(t)).filter(Boolean).slice(0, 12)
    for (const t of titles) {
      await db.collection(TITLES_COL).add({
        data: {
          title: t,
          analysis: null,
          source: 'ai_gen',
          topic: (body && body.topic) || '',
          createdAt: now(),
          updatedAt: now(),
          createdBy: (user && user.username) || ''
        }
      })
    }
    return ok({ titles })
  }

  function markLowFollower(doc, cfg) {
    const fans = Number(doc.fans || doc.accountFans || 0)
    const reads = Number(doc.reads || doc.readCount || 0)
    const maxFans = Number(cfg.lowFollowerMaxFans || 50000)
    const minReads = Number(cfg.lowFollowerMinReads || 10000)
    return fans > 0 && fans <= maxFans && reads >= minReads
  }

  function normalizeWxArticleUrl(raw) {
    const s = String(raw || '').trim()
    if (!s) return ''
    try {
      const u = new URL(s.replace(/^http:\/\//i, 'https://'))
      const biz = u.searchParams.get('__biz') || ''
      const mid = u.searchParams.get('mid') || ''
      const idx = u.searchParams.get('idx') || ''
      const sn = u.searchParams.get('sn') || ''
      if (biz && mid && sn) {
        return `https://mp.weixin.qq.com/s?__biz=${encodeURIComponent(biz)}&mid=${mid}&idx=${idx || '1'}&sn=${sn}`
      }
      u.hash = ''
      return u.toString()
    } catch (e) {
      return s.split('#')[0]
    }
  }

  async function upsertBenchmarkAccount(data) {
    if (!data.accountBiz && !data.accountName) return null
    let row = null
    if (data.accountBiz) {
      const byBiz = await db
        .collection(ACCOUNTS_COL)
        .where({ biz: data.accountBiz })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))
      if (byBiz.data && byBiz.data[0]) row = byBiz.data[0]
    }
    if (!row && data.accountName) {
      const byName = await db
        .collection(ACCOUNTS_COL)
        .where({ name: data.accountName })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))
      if (byName.data && byName.data[0]) row = byName.data[0]
    }
    if (row) {
      const patch = { updatedAt: now() }
      if (data.accountName && data.accountName !== row.name) patch.name = data.accountName
      if (data.accountBiz && data.accountBiz !== row.biz) patch.biz = data.accountBiz
      if (data.fans && Number(data.fans) > Number(row.fans || 0)) patch.fans = Number(data.fans)
      if (Object.keys(patch).length > 1) {
        await db.collection(ACCOUNTS_COL).doc(row._id).update({ data: patch })
      }
      return row._id
    }
    const add = await db.collection(ACCOUNTS_COL).add({
      data: {
        name: data.accountName || data.accountBiz || '未知账号',
        biz: data.accountBiz || '',
        fans: Number(data.fans || 0),
        notes: '采集插件自动入库',
        enabled: true,
        createdAt: now(),
        updatedAt: now()
      }
    })
    return add._id
  }

  async function collectorIngestOne(body) {
    const rawUrl = body.url || body.sourceUrl || ''
    const sourceUrl = /mp\.weixin\.qq\.com/i.test(String(rawUrl))
      ? normalizeWxArticleUrl(rawUrl)
      : oaFetch.normalizeArticleUrl(rawUrl) || normalizeWxArticleUrl(rawUrl)
    const contentRaw = String(body.content || body.html || '')
    let contentStore = contentRaw
    let fromHtml = []
    if (/<img\b/i.test(contentRaw)) {
      const slotted = oaFetch.htmlToTextWithSlots(contentRaw, sourceUrl, 8)
      fromHtml = slotted.imageUrls
      // 入库存带占位的纯文本，洗稿时可按落点插图
      if (slotted.text && slotted.imageUrls.length) contentStore = slotted.text
    }
    const images = pickImageUrls(
      body.images,
      body.imageUrls,
      fromHtml,
      body.coverUrl,
      body.cdn_url_1_1
    )
    if (images.length && !/\[\[IMG:\s*\d+\s*\]\]/i.test(contentStore)) {
      contentStore = ensureImageSlotsInBody(contentStore, images, 8)
    }
    const data = {
      title: String(body.title || '').slice(0, 200),
      content: contentStore.slice(0, 50000),
      sourceUrl,
      accountName: String(body.accountName || ''),
      accountBiz: String(body.accountBiz || body.biz || ''),
      reads: Number(body.reads || body.readNum || 0),
      likes: Number(body.likes || body.oldLikeCount || 0),
      fans: Number(body.fans || 0),
      coverUrl: String(body.coverUrl || body.cdn_url_1_1 || images[0] || ''),
      images,
      sourceSite: String(body.sourceSite || ''),
      authorName: String(body.authorName || body.author || ''),
      publishedAt: String(body.publishedAt || body.datetime || ''),
      rawMeta: body.meta || null,
      updatedAt: now()
    }
    if (!data.title && !data.content) return { ok: false, error: '缺少标题或正文' }

    let existingId = ''
    if (sourceUrl) {
      const found = await db
        .collection(COLLECT_COL)
        .where({ sourceUrl })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }))
      if (found.data && found.data[0]) existingId = found.data[0]._id
    }

    let collectId = existingId
    let action = 'created'
    if (existingId) {
      const prev = (
        await db.collection(COLLECT_COL).doc(existingId).get().catch(() => null)
      )?.data
      const patch = { ...data }
      // 已有更长正文时不覆盖成空/短文
      if (prev && String(prev.content || '').length > String(data.content || '').length) {
        delete patch.content
      }
      await db.collection(COLLECT_COL).doc(existingId).update({ data: patch })
      action = 'updated'
    } else {
      data.createdAt = now()
      const add = await db.collection(COLLECT_COL).add({ data })
      collectId = add._id
    }

    try {
      const cfg = await readConfig()
      const viralPayload = {
        title: data.title,
        url: data.sourceUrl,
        accountName: data.accountName,
        accountBiz: data.accountBiz,
        fans: data.fans,
        reads: data.reads,
        likes: data.likes,
        content: String(data.content || '').slice(0, 20000),
        coverUrl: data.coverUrl,
        images: data.images,
        sourceSite: data.sourceSite,
        authorName: data.authorName,
        isLowFollower: markLowFollower(data, cfg),
        updatedAt: now(),
        source: 'collector'
      }
      const viralFound = data.sourceUrl
        ? await db
            .collection(VIRAL_COL)
            .where({ url: data.sourceUrl })
            .limit(1)
            .get()
            .catch(() => ({ data: [] }))
        : { data: [] }
      if (viralFound.data && viralFound.data[0]) {
        await db.collection(VIRAL_COL).doc(viralFound.data[0]._id).update({ data: viralPayload })
      } else {
        await db.collection(VIRAL_COL).add({
          data: { ...viralPayload, createdAt: now() }
        })
      }
      await upsertBenchmarkAccount(data)
      if (data.title && action === 'created') {
        await db.collection(TITLES_COL).add({
          data: {
            title: data.title,
            analysis: null,
            source: 'collector',
            reads: data.reads,
            createdAt: now(),
            updatedAt: now()
          }
        })
      }
    } catch (e) {
      console.warn('[collectorIngestOne] asset sync', e.message || e)
    }
    return { ok: true, action, _id: collectId, title: data.title, sourceUrl: data.sourceUrl }
  }

  async function collectorIngest(body, headers, user) {
    await ensureCols()
    const tokenOk = verifyCollectorToken(headers)
    if (!tokenOk) {
      if (!user) {
        return fail(4010, '采集插件未授权（需要 OA_COLLECTOR_TOKEN 或 oa_content 权限）')
      }
      if (typeof checkPerm === 'function') {
        const deny = checkPerm(user, 'oa_content')
        if (deny) return deny
      }
    }
    const one = await collectorIngestOne(body || {})
    if (!one.ok) return fail(4000, one.error || '入库失败')
    return ok(one)
  }

  async function collectorIngestBatch(body, headers, user) {
    await ensureCols()
    const tokenOk = verifyCollectorToken(headers)
    if (!tokenOk) {
      if (!user) {
        return fail(4010, '采集插件未授权（需要 OA_COLLECTOR_TOKEN 或 oa_content 权限）')
      }
      if (typeof checkPerm === 'function') {
        const deny = checkPerm(user, 'oa_content')
        if (deny) return deny
      }
    }
    const articles = Array.isArray(body && body.articles) ? body.articles : []
    if (!articles.length) return fail(4000, 'articles 为空')
    const accountName = String(body.accountName || '')
    const accountBiz = String(body.accountBiz || body.biz || '')
    const limit = Math.min(10, Math.max(1, Number(body.limit) || 5))
    const slice = articles.slice(0, limit)
    const results = []
    let created = 0
    let updated = 0
    let failed = 0
    for (const art of slice) {
      const one = await collectorIngestOne({
        ...art,
        accountName: art.accountName || accountName,
        accountBiz: art.accountBiz || accountBiz,
        fans: art.fans || body.fans || 0
      })
      results.push(one)
      if (!one.ok) failed += 1
      else if (one.action === 'created') created += 1
      else updated += 1
    }
    if (accountBiz || accountName) {
      await upsertBenchmarkAccount({
        accountName,
        accountBiz,
        fans: body.fans || 0
      })
    }
    return ok({ created, updated, failed, total: slice.length, results })
  }

  /**
   * RSS 作者追踪：入库采集库；autoWash 时再洗成草稿
   */
  async function trackSourcesRun(body = {}, user) {
    await ensureCols()
    const cfg = await readConfig()
    const sources = normalizeTrackSources(cfg.trackSources)
    const onlyKey = String((body && body.key) || '').trim()
    const list = onlyKey
      ? sources.filter((s) => s.key === onlyKey)
      : sources.filter((s) => s.enabled)
    if (!list.length) {
      return ok({ results: [], message: onlyKey ? '未找到该追踪源' : '无启用的追踪源' })
    }
    // 追踪运行同样落 job，供任务时间线观测
    const jobAdd = await db
      .collection(JOBS_COL)
      .add({ data: { type: 'track', status: 'running', createdAt: now(), updatedAt: now() } })
      .catch(() => null)
    const results = []
    for (const src of list) {
      const row = {
        key: src.key,
        name: src.name,
        fetched: 0,
        created: 0,
        skipped: 0,
        washed: 0,
        error: ''
      }
      try {
        const articles = await oaFetch.fetchRssByAuthor({
          rssUrl: src.rssUrl,
          authorMatch: src.authorMatch,
          limit: Math.max(src.maxPerRun || 3, 8)
        })
        row.fetched = articles.length
        for (const art of articles.slice(0, src.maxPerRun || 3)) {
          if (!art.sourceUrl) {
            row.skipped += 1
            continue
          }
          const found = await db
            .collection(COLLECT_COL)
            .where({ sourceUrl: art.sourceUrl })
            .limit(1)
            .get()
            .catch(() => ({ data: [] }))
          if (found.data && found.data[0]) {
            row.skipped += 1
            continue
          }
          const ing = await collectorIngestOne({
            title: art.title,
            content: art.text,
            sourceUrl: art.sourceUrl,
            url: art.sourceUrl,
            coverUrl: art.coverUrl,
            images: art.imageUrls,
            sourceSite: art.sourceSite || src.site,
            authorName: src.authorMatch,
            accountName: src.name
          })
          if (!ing.ok) {
            row.skipped += 1
            continue
          }
          if (ing.action !== 'created') {
            row.skipped += 1
            continue
          }
          row.created += 1
          if (src.autoWash) {
            try {
              const gen = await runGenerate({
                topic: {
                  sourceType: 'collected',
                  sourceId: ing._id,
                  title: art.title,
                  body: art.text,
                  sourceUrl: art.sourceUrl,
                  coverUrl: art.coverUrl,
                  imageUrls: art.imageUrls
                },
                strategyKey: !src.strategyKey || src.strategyKey === 'auto' ? 'auto' : src.strategyKey,
                brandKey: src.brandKey || cfg.defaultBrandKey,
                user: user || { username: 'track' }
              })
              if (gen && (gen.code === 0 || (gen.data && gen.data._id))) row.washed += 1
            } catch (e) {
              console.warn('[trackSources] autoWash', e.message || e)
            }
          }
        }
      } catch (e) {
        row.error = e.message || String(e)
      }
      results.push(row)
    }
    const summary = results
      .map(
        (r) =>
          `${r.key}: +${r.created}/skip${r.skipped}${r.washed ? `/wash${r.washed}` : ''}${
            r.error ? ` err=${r.error}` : ''
          }`
      )
      .join('; ')
      .slice(0, 1800)
    try {
      await db.collection(GLOBAL_COL).doc(CONFIG_DOC).update({
        data: { lastTrackAt: now(), lastTrackResult: summary, updatedAt: now() }
      })
    } catch (e) {
      try {
        await writeConfig({ lastTrackAt: now(), lastTrackResult: summary })
      } catch (e2) {}
    }
    if (jobAdd && jobAdd._id) {
      const anyErr = results.some((r) => r.error)
      await db
        .collection(JOBS_COL)
        .doc(jobAdd._id)
        .update({
          data: {
            status: anyErr ? 'failed' : 'done',
            result: { summary, results },
            updatedAt: now()
          }
        })
        .catch(() => null)
    }
    return ok({ results, lastTrackAt: now(), lastTrackResult: summary })
  }

  async function listAccountArticles(id, query = {}) {
    await ensureCols()
    const res = await db.collection(ACCOUNTS_COL).doc(id).get().catch(() => null)
    if (!res || !res.data) return fail(4040, '账号不存在')
    const account = { _id: id, ...res.data }
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20))
    let list = []
    try {
      let q = db.collection(COLLECT_COL)
      if (account.biz) q = q.where({ accountBiz: String(account.biz) })
      else if (account.name) q = q.where({ accountName: String(account.name) })
      else return ok({ account, list: [], total: 0, page, pageSize })
      const countRes = await q.count().catch(() => ({ total: 0 }))
      let listRes
      try {
        listRes = await q
          .orderBy('createdAt', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get()
      } catch (e) {
        listRes = await q.limit(100).get()
        listRes.data = (listRes.data || [])
          .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
          .slice((page - 1) * pageSize, page * pageSize)
      }
      list = listRes.data || []
      return ok({
        account,
        list,
        total: countRes.total || list.length,
        page,
        pageSize
      })
    } catch (e) {
      return fail(5000, e.message || String(e))
    }
  }

  async function upsertViral(body, user) {
    await ensureCols()
    const cfg = await readConfig()
    const data = {
      title: body.title || '',
      url: body.url || '',
      accountName: body.accountName || '',
      accountBiz: body.accountBiz || '',
      fans: Number(body.fans || 0),
      reads: Number(body.reads || body.readCount || 0),
      likes: Number(body.likes || 0),
      content: body.content || '',
      coverUrl: body.coverUrl || '',
      tags: Array.isArray(body.tags) ? body.tags : [],
      updatedAt: now()
    }
    data.isLowFollower = markLowFollower(data, cfg)
    if (body._id) {
      await db.collection(VIRAL_COL).doc(body._id).update({ data })
      return getById(VIRAL_COL, body._id)
    }
    data.createdAt = now()
    data.createdBy = (user && user.username) || ''
    const add = await db.collection(VIRAL_COL).add({ data })
    return ok({ _id: add._id, ...data })
  }

  // ===== Phase 3 collector =====
  function safeTokenEqual(a, b) {
    const crypto = require('crypto')
    const ba = Buffer.from(String(a || ''), 'utf8')
    const bb = Buffer.from(String(b || ''), 'utf8')
    if (!ba.length || ba.length !== bb.length) return false
    try {
      return crypto.timingSafeEqual(ba, bb)
    } catch (e) {
      return false
    }
  }

  function verifyCollectorToken(headers = {}) {
    const expected = String(process.env.OA_COLLECTOR_TOKEN || '').trim()
    if (!expected) return false
    const h =
      headers['x-oa-collector-token'] ||
      headers['X-Oa-Collector-Token'] ||
      ''
    const token = String(h)
      .replace(/^Bearer\s+/i, '')
      .trim()
    return safeTokenEqual(token, expected)
  }

  return {
    ensureCols,
    getConfig,
    updateConfig,
    listPrompts: (q) => listCollection(PROMPTS_COL, q),
    createPrompt: (b, u) =>
      createDoc(PROMPTS_COL, b, u, { enabled: true, kind: 'rewrite' }),
    updatePrompt: (id, b, u) =>
      updateDoc(PROMPTS_COL, id, b, u, [
        'key',
        'name',
        'kind',
        'system',
        'user',
        'enabled'
      ]),
    deletePrompt: (id, u) => deleteDoc(PROMPTS_COL, id, u),
    seedPrompts,
    listStrategies: (q) => listCollection(STRATEGIES_COL, q),
    createStrategy: (b, u) =>
      createDoc(STRATEGIES_COL, b, u, { enabled: true, themeId: 'clean', priority: 50 }),
    updateStrategy: (id, b, u) =>
      updateDoc(STRATEGIES_COL, id, b, u, [
        'key',
        'name',
        'promptKey',
        'themeId',
        'structureHint',
        'titleHint',
        'enabled',
        'priority'
      ]),
    deleteStrategy: (id, u) => deleteDoc(STRATEGIES_COL, id, u),
    seedStrategies,
    listDrafts: async (q) => {
      await healStalePushingDrafts()
      return listCollection(DRAFTS_COL, q, 'createdAt')
    },
    getDraft: (id) => getById(DRAFTS_COL, id),
    updateDraft: async (id, b, u) => {
      const curRes = await db.collection(DRAFTS_COL).doc(id).get().catch(() => null)
      if (!curRes || !curRes.data) return fail(4040, '草稿不存在')
      const cur = curRes.data
      const patch = { ...(b || {}) }
      // 客户端不可伪造配图归属 / 槽位（仅服务端 prepare/push/换 brand 写入）
      delete patch.wxImageEntries
      delete patch.wxImageMap
      delete patch.wxImageFailEntries
      delete patch.wxImageFail
      delete patch.wxImageUploadSlot
      delete patch.imagesReady
      delete patch.imagePrepStatus
      delete patch.imagePrepAttempts
      delete patch.imagePrepStats
      delete patch.credentialSlot
      delete patch.ctaFallback
      delete patch.wxMediaId
      delete patch.wxThumbMediaId
      delete patch.wxPublishId
      const from = String(cur.status || '')
      if (from === 'published') return fail(4000, '已发布稿不可编辑')
      if (from === 'generating') return fail(4000, '生成中不可编辑')

      if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
        const next = String(patch.status || '')
        // 客户端只能在 ready / needs_review / rejected 间切换；推送/发布态由服务端写入
        const clientAllowed = ['ready', 'needs_review', 'rejected']
        if (!clientAllowed.includes(next)) {
          return fail(4000, '不可直接设置为该状态，请使用推送/发稿操作')
        }
        const md = String(patch.markdown != null ? patch.markdown : cur.markdown || '')
        if (
          next === 'ready' &&
          (from === 'needs_review' || from === 'generate_failed' || cur.generatedByAi === false)
        ) {
          // 引导语行自动剥离（用户改写后常忘删，不能因此打回）
          const cleaned = stripLlmFallbackNotice(md)
          // 真正的改写判定：与原素材做连续片段比对，照搬才拦
          if (looksLikeUnrewrittenSource(cleaned, cur.sourceSlottedBody || cur.sourceTitle || '')) {
            return fail(4000, '正文仍与原素材基本相同，请实质改写后再标为待审核')
          }
          if (cleaned !== md) patch.markdown = cleaned
        }
      }

      const contentChanged =
        (patch.markdown != null && patch.markdown !== cur.markdown) ||
        (patch.title != null && patch.title !== cur.title) ||
        (patch.coverUrl != null && patch.coverUrl !== cur.coverUrl) ||
        (patch.brandKey != null && patch.brandKey !== cur.brandKey) ||
        (patch.html != null && patch.html !== cur.html) ||
        (patch.miniprogramPath != null && patch.miniprogramPath !== cur.miniprogramPath)

      if (contentChanged) {
        // 内容变更后旧微信草稿失效，必须重新推送
        patch.wxMediaId = ''
        patch.wxThumbMediaId = ''
        patch.wxPublishId = ''
        if (
          ['pushed_to_wechat', 'push_failed'].includes(from) &&
          !Object.prototype.hasOwnProperty.call(patch, 'status')
        ) {
          patch.status = 'ready'
        }
        if (!Object.prototype.hasOwnProperty.call(patch, 'error')) patch.error = ''
      }

      if (patch.markdown && !patch.html) {
        const cfg = await readConfig()
        const brand = resolveBrand(cfg, patch.brandKey || cur.brandKey || cfg.defaultBrandKey)
        patch.markdown = stripPromoBrandFooterMarkdown(patch.markdown)
        patch.markdown = ensureHeroImagePlacement(patch.markdown, {
          coverUrl:
            patch.coverUrl ||
            cur.coverUrl ||
            brand.defaultCoverUrl ||
            cfg.defaultCoverUrl ||
            ''
        })
        let nextHtml =
          buildLeadHtml(cfg, patch.miniprogramPath || cur.miniprogramPath || cfg.miniprogramPath) +
          markdownToWechatHtml(patch.markdown, 'clean')
        nextHtml = await appendMiniprogramCtaHtml(nextHtml, cfg, brand, {
          path: patch.miniprogramPath || cur.miniprogramPath || cfg.miniprogramPath,
          mode: 'link',
          credentialSlot: brand.credentialSlot
        })
        patch.html = nextHtml
      } else if (patch.markdown != null) {
        let cleaned = stripPromoBrandFooterMarkdown(patch.markdown)
        const cfg = await readConfig()
        const brand = resolveBrand(cfg, patch.brandKey || cur.brandKey || cfg.defaultBrandKey)
        cleaned = ensureHeroImagePlacement(cleaned, {
          coverUrl:
            patch.coverUrl ||
            cur.coverUrl ||
            brand.defaultCoverUrl ||
            cfg.defaultCoverUrl ||
            ''
        })
        if (cleaned !== patch.markdown) patch.markdown = cleaned
      }
      if (patch.brandKey) {
        const cfg = await readConfig()
        const brand = resolveBrand(cfg, patch.brandKey)
        patch.brandName = brand.name
        const nextSlot = wechatApi.normalizeSlot(brand.credentialSlot)
        const brandChanged = String(patch.brandKey) !== String(cur.brandKey || '')
        const curSlotRaw = String(cur.credentialSlot == null ? '' : cur.credentialSlot).trim()
        const slotChanged =
          !curSlotRaw || wechatApi.normalizeSlot(curSlotRaw) !== nextSlot
        if (brandChanged || slotChanged) {
          // 换发稿号/槽位（含旧稿 credentialSlot 为空）：旧 mmbiz 归属失效
          patch.wxImageEntries = []
          patch.wxImageMap = {}
          patch.wxImageFailEntries = []
          patch.wxImageUploadSlot = ''
          patch.imagesReady = false
          patch.imagePrepStatus = 'preparing'
        }
        patch.credentialSlot = nextSlot
        if (!patch.author) patch.author = brand.author
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'miniprogramPath')) {
        patch.miniprogramPath = wechatApi.sanitizeMiniprogramPath(patch.miniprogramPath)
      }
      return updateDoc(DRAFTS_COL, id, patch, u, [
        'title',
        'markdown',
        'html',
        'digest',
        'author',
        'coverUrl',
        'imageUrls',
        'miniprogramPath',
        'status',
        'sourceUrl',
        'brandKey',
        'brandName',
        'credentialSlot',
        'error',
        'wxMediaId',
        'wxThumbMediaId',
        'wxPublishId',
        'wxImageEntries',
        'wxImageMap',
        'wxImageUploadSlot',
        'imagesReady',
        'imagePrepStatus'
      ])
    },
    deleteDraft: (id, u) => deleteDoc(DRAFTS_COL, id, u),
    batchDeleteDrafts,
    gatherTopics,
    generateFromBody,
    pushDraftToWechat,
    executePushDraft,
    prepareDraftImages,
    proxyImage,
    publishDraft,
    rejectDraft,
    runDailyPipeline,
    listJobs: (q) => listCollection(JOBS_COL, q, 'createdAt'),
    listAccounts: (q) => listCollection(ACCOUNTS_COL, q),
    createAccount: (b, u) =>
      createDoc(ACCOUNTS_COL, b, u, { enabled: true, fans: 0, notes: '' }),
    updateAccount: (id, b, u) =>
      updateDoc(ACCOUNTS_COL, id, b, u, [
        'name',
        'biz',
        'fans',
        'notes',
        'enabled',
        'tags'
      ]),
    deleteAccount: (id, u) => deleteDoc(ACCOUNTS_COL, id, u),
    listViral: (q) => listCollection(VIRAL_COL, q, 'createdAt'),
    upsertViral,
    deleteViral: (id, u) => deleteDoc(VIRAL_COL, id, u),
    listTitles: (q) => listCollection(TITLES_COL, q, 'createdAt'),
    createTitle: (b, u) => createDoc(TITLES_COL, b, u, { source: 'manual' }),
    deleteTitle: (id, u) => deleteDoc(TITLES_COL, id, u),
    analyzeTitle,
    generateTitles,
    listCollected: (q) => listCollection(COLLECT_COL, q, 'createdAt'),
    deleteCollected: (id, u) => deleteDoc(COLLECT_COL, id, u),
    listAccountArticles,
    collectorIngest,
    collectorIngestBatch,
    trackSourcesRun,
    verifyCollectorToken
  }
}

module.exports = { createOaContentStudioApi }
