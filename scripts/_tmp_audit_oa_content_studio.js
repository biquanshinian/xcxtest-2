/**
 * 公众号内容中台冒烟审计 — 目标全绿灯
 * node scripts/_tmp_audit_oa_content_studio.js
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
let failed = 0
let passed = 0

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function check(name, ok, detail) {
  if (ok) {
    passed += 1
    console.log('  OK ', name)
  } else {
    failed += 1
    console.log('  FAIL', name, detail ? `— ${detail}` : '')
  }
}

async function main() {
  console.log('=== OA Content Studio smoke audit ===\n')

  // ── 1) 文件存在 ──
  console.log('[1] files')
  ;[
    'cloudfunctions/adminGateway/oaContentStudio.js',
    'cloudfunctions/adminGateway/oaFetchArticle.js',
    'cloudfunctions/adminGateway/oaWechatApi.js',
    'cloudfunctions/adminGateway/oaContentLlm.js',
    'cloudfunctions/adminGateway/oaContentFormat.js',
    'cloudfunctions/oaContentDaily/index.js',
    'cloudfunctions/oaContentDaily/package.json',
    'cloudfunctions/oaContentDaily/config.json',
    'cloudfunctions/oaAuthorTrack/index.js',
    'cloudfunctions/oaAuthorTrack/package.json',
    'cloudfunctions/oaAuthorTrack/config.json',
    'cloudfunctions/oaPushDraft/index.js',
    'cloudfunctions/oaPushDraft/package.json',
    'cloudfunctions/oaPushDraft/config.json',
    'admin-web/src/views/OaPipelinePage.vue',
    'admin-web/src/views/OaDraftsPage.vue',
    'admin-web/src/views/OaPromptsPage.vue',
    'admin-web/src/views/OaStrategiesPage.vue',
    'admin-web/src/views/OaContentConfigPage.vue',
    'admin-web/src/views/OaAssetsPage.vue',
    'tools/oa-collector-extension/manifest.json',
    'tools/oa-collector-extension/popup.html',
    'tools/oa-collector-extension/popup.js',
    'tools/oa-collector-extension/content.js',
    'tools/oa-collector-extension/README.md'
  ].forEach((f) => check(f, exists(f)))

  // ── 2) 语法 ──
  console.log('\n[2] syntax')
  ;[
    'cloudfunctions/adminGateway/oaContentStudio.js',
    'cloudfunctions/adminGateway/oaFetchArticle.js',
    'cloudfunctions/adminGateway/oaWechatApi.js',
    'cloudfunctions/adminGateway/oaContentLlm.js',
    'cloudfunctions/adminGateway/oaContentFormat.js',
    'cloudfunctions/oaContentDaily/index.js',
    'cloudfunctions/oaAuthorTrack/index.js',
    'cloudfunctions/oaPushDraft/index.js',
    'cloudfunctions/adminGateway/index.js',
    'tools/oa-collector-extension/popup.js'
  ].forEach((f) => {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' })
    check(`syntax ${f}`, r.status === 0, (r.stderr || r.stdout || '').trim().slice(0, 160))
  })

  // ── 3) 权限 / 挂载 / 集合 ──
  console.log('\n[3] adminGateway wiring')
  const gw = read('cloudfunctions/adminGateway/index.js')
  check('PERMISSION oa_content', /oa_content:\s*'公众号内容中台'/.test(gw))
  check('require oaContentStudio', /require\('\.\/oaContentStudio'\)/.test(gw))
  check('oaContentApi()', /function oaContentApi\(/.test(gw) && /createOaContentStudioApi/.test(gw))
  check('EXTRA cols oa_drafts', /'oa_drafts'/.test(gw))
  check('EXTRA cols oa_prompts', /'oa_prompts'/.test(gw))
  check('EXTRA cols oa_strategies', /'oa_strategies'/.test(gw))
  check('EXTRA cols oa_viral_articles', /'oa_viral_articles'/.test(gw))
  check('EXTRA cols oa_collected_articles', /'oa_collected_articles'/.test(gw))
  check('EXTRA cols oa_benchmark_accounts', /'oa_benchmark_accounts'/.test(gw) || /oa_benchmark_accounts/.test(read('cloudfunctions/adminGateway/oaContentStudio.js')))
  check('collector before !user', (() => {
    const iCollector = gw.indexOf('/oa-content/collector/ingest')
    const iAuth = gw.indexOf("if (!user) return fail(4010, '未授权或登录已过期')")
    return iCollector > 0 && iAuth > 0 && iCollector < iAuth
  })())
  check('ingest-batch before !user', (() => {
    const i = gw.indexOf('/oa-content/collector/ingest-batch')
    const iAuth = gw.indexOf("if (!user) return fail(4010, '未授权或登录已过期')")
    return i > 0 && iAuth > 0 && i < iAuth
  })())
  check('internal run-daily before !user', (() => {
    const i = gw.indexOf('/oa-content/internal/run-daily')
    const iAuth = gw.indexOf("if (!user) return fail(4010, '未授权或登录已过期')")
    return i > 0 && iAuth > 0 && i < iAuth
  })())
  check('internal track-sources before !user', (() => {
    const i = gw.indexOf('/oa-content/internal/track-sources')
    const iAuth = gw.indexOf("if (!user) return fail(4010, '未授权或登录已过期')")
    return i > 0 && iAuth > 0 && i < iAuth
  })())

  const routesNeeded = [
    '/oa-content/config',
    '/oa-content/topics',
    '/oa-content/generate',
    '/oa-content/run-daily',
    '/oa-content/track-sources',
    '/oa-content/prompts',
    '/oa-content/strategies',
    '/oa-content/drafts',
    '/oa-content/drafts/batch-delete',
    '/oa-content/accounts',
    '/oa-content/viral',
    '/oa-content/titles',
    '/oa-content/titles/analyze',
    '/oa-content/titles/generate',
    '/oa-content/collected',
    '/oa-content/collector/ingest',
    '/oa-content/collector/ingest-batch'
  ]
  routesNeeded.forEach((p) => check(`route ${p}`, gw.includes(`'${p}'`) || gw.includes(`"${p}"`)))
  check('draft push route', /drafts\/.*push|path\.endsWith\('\/push'\)/.test(gw))
  check('draft publish route', /path\.endsWith\('\/publish'\)/.test(gw))
  check('draft reject route', /path\.endsWith\('\/reject'\)/.test(gw))
  check('account articles route',
    /\/oa-content\/account-articles/.test(gw) ||
      /path\.endsWith\('\/articles'\)/.test(gw) ||
      /accounts\/[^/]+\/articles/.test(gw)
  )
  check('listAccountArticles wired', /listAccountArticles/.test(gw))
  check('checkPerm oa_content', /checkPerm\(user,\s*'oa_content'\)/.test(gw) || /denyOa\(\)/.test(gw))

  // ── 4) Studio 契约 ──
  console.log('\n[4] oaContentStudio contracts')
  // 拆分后：studio = 主模块 + 种子数据 + 纯函数（regex 契约检查合并扫描）
  const studioMain = read('cloudfunctions/adminGateway/oaContentStudio.js')
  const studioSeeds = read('cloudfunctions/adminGateway/oaContentSeeds.js')
  const studioHelpers = read('cloudfunctions/adminGateway/oaStudioHelpers.js')
  const studio = studioMain + '\n' + studioSeeds + '\n' + studioHelpers
  ;[
    'createOaContentStudioApi',
    'gatherTopics',
    'runGenerate',
    'pushDraftToWechat',
    'publishDraft',
    'runDailyPipeline',
    'analyzeTitle',
    'generateTitles',
    'collectorIngest',
    'collectorIngestBatch',
    'collectorIngestOne',
    'listAccountArticles',
    'batchDeleteDrafts',
    'normalizeWxArticleUrl',
    'upsertBenchmarkAccount',
    'seedPrompts',
    'seedStrategies',
    'markLowFollower',
    'SEED_PROMPTS',
    'SEED_STRATEGIES',
    'rewriteHtmlImagesForWechat',
    'enrichTopicFromUrl',
    'trackSourcesRun',
    'normalizeTrackSources',
    'oaFetch'
  ].forEach((k) => check(`studio.${k}`, studio.includes(k)))
  check('trackSources default proxima_jack', /proxima_jack/.test(studio) && /authorMatch:\s*'Jack C\.'/.test(studio))
  check('require oaFetchArticle', /require\('\.\/oaFetchArticle'\)/.test(studio))
  check('ingest persists images', /images,\s*\n\s*sourceSite:/.test(studio) || /images:\s*data\.images/.test(studio))
  check('placeImagesAligned on generate', /placeImagesAlignedToSource\(/.test(studio))
  check('strategy auto on empty key', /strategyAuto|matchStrategyFromContent/.test(studio))
  check('wash uses matchStrategyFromContent', /matchStrategyFromContent\(/.test(studio))
  check('daily uses strategy auto', /strategyKey:\s*'auto'/.test(studio))
  check('ensureImageSlots before LLM', /ensureImageSlotsInBody\(/.test(studio))
  check('mmbiz reuse skip upload', /isWechatCdnUrl/.test(studio))
  check(
    'prepare after generate',
    /prepareDraftImages\(draftId/.test(studio) || /kickPrepareOrPush\(draftId,\s*'prepare'/.test(studio)
  )
  check('no cover forced as body IMG1', !/封面不在正文图里时置顶占位/.test(read('cloudfunctions/adminGateway/oaFetchArticle.js')))
  check('enrich refill images when few', /existingImgs\.length < 3/.test(studio))
  check('ingest htmlToTextWithSlots', /htmlToTextWithSlots\(contentRaw/.test(studio))
  check('prompt keeps IMG slots', /\[\[IMG:/.test(studio))
  check('status ready', /status:\s*'ready'/.test(studio) || /'ready'/.test(studio))
  check('status pushed_to_wechat', /pushed_to_wechat/.test(studio))
  check('status published', /'published'/.test(studio))
  check('miniprogram CTA via wechatApi', /buildMiniprogramCtaHtml/.test(studio))
  check('45166 retry fallback', /isInvalidContentError/.test(studio) && /45166/.test(studio))
  check('title slice 32 for wechat', /\.slice\(0,\s*32\)/.test(studio))
  check('default CTA mode none', /miniprogramCtaMode:\s*'none'/.test(studio))
  check('linkAllImagesToMiniprogram default', /linkAllImagesToMiniprogram:\s*true/.test(studio))
  check('wrapAllImages on push', /wrapAllImagesWithMiniprogram/.test(studio))
  check('owned wx image helper', /function isOwnedWxImage/.test(studio))
  check('wxImageUploadSlot tracked', /wxImageUploadSlot/.test(studio))
  check('no allMmbiz ready shortcut', !/imagesReadyOut = !imageUrls\.length \|\| allMmbiz/.test(studio))
  check('45166 keep image wraps first', /retry images-only MP links/.test(studio))
  check('brands DEFAULT mars_log+mars_space', /mars_log/.test(studio) && /mars_space/.test(studio) && /DEFAULT_BRANDS/.test(studio))
  check('resolveBrand + credentialSlot', /function resolveBrand/.test(studio) && /credentialSlot/.test(studio))
  check('seed strategy space_story', /key:\s*'space_story'/.test(studio))
  check('anti AI voice rules', /ANTI_AI_VOICE/.test(studio) && /严禁套话/.test(studio))
  check('seed upsert updates existing', /updated \+= 1/.test(studio) && /structureHint:\s*s\.structureHint/.test(studio))
  check('gen temperature 0.55 anti-hallucination', /temperature:\s*0\.55/.test(studio))
  check('grounding rules present', /GROUNDING_RULES/.test(studio) && /唯一事实来源/.test(studio))
  check('grounding wired into prompts', /GROUNDING_RULES \+/.test(studio) || /GROUNDING_RULES\s*\+/.test(studio))
  check('strategy hints grounded', /必须是素材写到的/.test(studio) && /素材没写就别造/.test(studio))
  check('draft saves sourceImageUrls', /sourceImageUrls:\s*imageUrls\.slice\(0,\s*8\)/.test(studio))
  check('push no re-place when md has images', /mdHasImages/.test(studio) && /绝不二次重排/.test(studio))
  check('push aligned preserveIndex fallback', /preserveIndex:\s*true/.test(studio))
  check('sources launch+event+article+collected',
    /starship_event_updates/.test(studio) &&
      /news_articles/.test(studio) &&
      /pickLaunchTopics/.test(studio) &&
      /COLLECT_COL/.test(studio)
  )
  check('autoFreepublish default off in DEFAULT_CONFIG', /autoFreepublish:\s*false/.test(studio))
  check('cron respects enabled', /skipped:\s*true,\s*reason:\s*'disabled'/.test(studio))
  check('openComment default on', /openComment:\s*true/.test(studio))
  check('draftRetainDays default', /draftRetainDays:\s*14/.test(studio))

  // ── 5) WeChat API ──
  console.log('\n[5] wechat draft API')
  const wx = read('cloudfunctions/adminGateway/oaWechatApi.js')
  check('draft/add', /cgi-bin\/draft\/add/.test(wx))
  check('freepublish/submit', /cgi-bin\/freepublish\/submit/.test(wx))
  check('material thumb', /add_material.*type=thumb|type=thumb/.test(wx))
  check('uploadimg', /media\/uploadimg/.test(wx))
  check('WECHAT_OA_APPID', /WECHAT_OA_APPID/.test(wx))
  check('WECHAT_OA_SECRET', /WECHAT_OA_SECRET/.test(wx))
  check('credential slot 2 env', /WECHAT_OA_APPID_2/.test(wx) && /WECHAT_OA_SECRET_2/.test(wx))
  check('credentialsStatus', /function credentialsStatus/.test(wx) || /credentialsStatus/.test(wx))
  check('normalizeSlot', /function normalizeSlot/.test(wx))
  check('miniprogram data attrs', /data-miniprogram-appid/.test(wx) && /data-miniprogram-path/.test(wx))
  check('default mini appid fallback', /wxf98b58309019771b/.test(wx))
  check('CTA modes image/link/card', /m === 'card'/.test(wx) && /buildMiniprogramLinkHtml/.test(wx) && /mode = 'image'/.test(wx))
  check('isInvalidContentError 45166', /45166\|invalid content/.test(wx))
  check('stripMiniprogramCta', /function stripMiniprogramCta/.test(wx))

  // ── 6) LLM / Format ──
  console.log('\n[6] llm + format')
  const llm = read('cloudfunctions/adminGateway/oaContentLlm.js')
  const fmt = read('cloudfunctions/adminGateway/oaContentFormat.js')
  check('hunyuan providers', /hunyuan-v3/.test(llm) && /hunyuan-lite/.test(llm) && /cloudbase/.test(llm))
  check('llm dual call shapes', /function buildCallShapes/.test(llm) && /isMissingModelParamError/.test(llm))
  check('llm tries flat then data', /shapes\[i\]/.test(llm) && /\{ data: flat \}/.test(llm))
  check('llm hy3 alias', /model:\s*'hy3'/.test(llm))
  check('external OA_CONTENT_AI_KEY', /OA_CONTENT_AI_KEY/.test(llm))
  check('renderTemplate', /function renderTemplate/.test(llm) || /renderTemplate/.test(llm))
  check('markdownToWechatHtml', /function markdownToWechatHtml/.test(fmt))
  check('themes clean/diary/brief', /clean:/.test(fmt) && /diary:/.test(fmt) && /brief:/.test(fmt))
  check('extractJsonBlock', /extractJsonBlock/.test(fmt))
  check('buildImageMarkdown', /buildImageMarkdown/.test(fmt) || /function buildImageMarkdown/.test(fmt))
  check('placeImagesInMarkdown fn', /function placeImagesInMarkdown/.test(fmt))
  check('ensureImageSlotsInBody fn', /function ensureImageSlotsInBody/.test(fmt))

  try {
    const mod = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaContentFormat.js'))
    const html = mod.markdownToWechatHtml(
      '# 标题\n\n## 小节\n\n一段**加粗**文字\n\n- a\n- b\n\n> 引用\n\n![图](https://example.com/a.jpg)',
      'clean'
    )
    check('format runtime html has h2', /<h2/.test(html))
    check('format runtime html has strong', /<strong>/.test(html))
    check('format runtime html has li', /<li/.test(html))
    check('format runtime html has blockquote', /<blockquote/.test(html))
    check('format runtime md image', /<img[\s\S]*example\.com\/a\.jpg/.test(html))
    const parsed = mod.stripTitleFromMarkdown('# Hello\n\nbody text')
    check('stripTitleFromMarkdown', parsed.title === 'Hello' && /body text/.test(parsed.body))
    const j = mod.extractJsonBlock('x ```json\n{"a":1}\n``` y')
    check('extractJsonBlock runtime', j && j.a === 1)
    const slotted = mod.ensureImageSlotsInBody('第一段\n\n第二段\n\n第三段', [
      'https://a.com/1.jpg',
      'https://a.com/2.jpg'
    ])
    check(
      'slots distributed in body',
      /\[\[IMG:1\]\]/.test(slotted) &&
        /\[\[IMG:2\]\]/.test(slotted) &&
        slotted.indexOf('[[IMG:1]]') > 0
    )
    const singleSlot = mod.ensureImageSlotsInBody('第一段\n\n第二段', ['https://a.com/1.jpg'])
    check('single image slot at top', singleSlot.startsWith('[[IMG:1]]'))
    const heroMoved = mod.ensureHeroImagePlacement(
      '正文\n\n![配图1](https://a.com/1.jpg)',
      { coverUrl: 'https://cover.com/c.jpg' }
    )
    check('hero moves single img to top', /^!\[头图\]\(https:\/\/a\.com\/1\.jpg\)/.test(heroMoved))
    const heroCover = mod.ensureHeroImagePlacement('只有文字', { coverUrl: 'https://cover.com/c.jpg' })
    check('hero uses cover when no body img', /^!\[头图\]\(https:\/\/cover\.com\/c\.jpg\)/.test(heroCover))
    // 段落数 < 图数：图应穿插，不允许全部堆在文末
    const manyImgs = mod.ensureImageSlotsInBody('甲段落\n\n乙段落', [
      'https://a.com/1.jpg',
      'https://a.com/2.jpg',
      'https://a.com/3.jpg',
      'https://a.com/4.jpg'
    ])
    check(
      'slots interleave when imgs > paras',
      manyImgs.indexOf('[[IMG:1]]') < manyImgs.indexOf('乙段落') &&
        manyImgs.indexOf('[[IMG:2]]') < manyImgs.indexOf('乙段落') &&
        manyImgs.indexOf('[[IMG:3]]') > manyImgs.indexOf('乙段落')
    )
    // preserveIndex：空串占位的图直接跳过，不移位
    const pi = mod.placeImagesAlignedToSource(
      '成稿甲\n\n成稿乙',
      '原甲\n\n[[IMG:1]]\n\n原乙\n\n[[IMG:2]]',
      ['', 'https://a.com/2.jpg'],
      8,
      { preserveIndex: true }
    )
    check(
      'aligned preserveIndex skips dropped',
      !/配图1/.test(pi) && /配图2.*a\.com\/2\.jpg/.test(pi)
    )
    // 文本段按字数占比分桶（长段占大头时图不整体漂移到前面）
    check('aligned weighted buckets', /cumRatio/.test(read('cloudfunctions/adminGateway/oaContentFormat.js')))
    check(
      'ensure slots multi-insert per para',
      /while \(imgIdx < list\.length && progress >=/.test(read('cloudfunctions/adminGateway/oaContentFormat.js'))
    )
    const placed = mod.placeImagesInMarkdown(
      '开场\n\n[[IMG:1]]\n\n中间叙述\n\n结尾',
      ['https://a.com/1.jpg', 'https://a.com/2.jpg'],
      8,
      { redistribute: false }
    )
    check('place resolves slot', /!\[配图1\]\(https:\/\/a\.com\/1\.jpg\)/.test(placed))
    check('place strict no redistribute', !/!\[配图2\]\(https:\/\/a\.com\/2\.jpg\)/.test(placed))
    const aligned = mod.placeImagesAlignedToSource(
      '改写开场\n\n改写中间\n\n改写结尾',
      '原文开场\n\n[[IMG:1]]\n\n原文中间\n\n[[IMG:2]]\n\n原文结尾',
      ['https://a.com/1.jpg', 'https://a.com/2.jpg']
    )
    check(
      'aligned keeps source order',
      aligned.indexOf('https://a.com/1.jpg') < aligned.indexOf('https://a.com/2.jpg') &&
        aligned.indexOf('改写开场') < aligned.indexOf('https://a.com/1.jpg') &&
        aligned.indexOf('https://a.com/1.jpg') < aligned.indexOf('改写中间')
    )
  } catch (e) {
    check('format runtime load', false, e.message)
  }

  try {
    const wapi = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaWechatApi.js'))
    const link = wapi.buildMiniprogramLinkHtml({ path: 'pages/index/index', text: '打开' })
    check('CTA link html runtime', /data-miniprogram-appid=/.test(link) && /pages\/index\/index/.test(link))
    check('CTA href empty not qq.com', /href=""/.test(link) && !/www\.qq\.com/.test(link))
    check('CTA marked oa-mp-cta', /class="oa-mp-cta"/.test(link))
    const cta = await wapi.buildMiniprogramCtaHtml({
      path: 'pages/index/index',
      text: '打开',
      mode: 'link'
    })
    check('CTA html runtime async', /data-miniprogram-appid=/.test(cta) && /pages\/index\/index/.test(cta))
    check('CTA async href empty', /href=""/.test(cta) && !/www\.qq\.com/.test(cta))
    const wrapped = wapi.wrapAllImagesWithMiniprogram(
      '<p><img src="https://mmbiz.qpic.cn/a.jpg" /></p><p>文字</p>',
      { path: 'pages/index/index' }
    )
    check(
      'wrapAllImages runtime',
      /data-miniprogram-appid=/.test(wrapped) &&
        /<a[^>]*href=""[^>]*>\s*<img/.test(wrapped) &&
        /文字/.test(wrapped)
    )
    const kept = wapi.stripMiniprogramCta(
      '<p><a data-miniprogram-appid="wx" data-miniprogram-path="pages/index/index" href=""><img src="https://mmbiz.qpic.cn/a.jpg" /></a></p>' +
        '<p class="oa-mp-cta" data-oa-cta="1"><a data-miniprogram-appid="wx" href="">CTA</a></p>'
    )
    check('strip CTA keeps body img wrap', /mmbiz\.qpic\.cn\/a\.jpg/.test(kept) && !/CTA/.test(kept))
    check('credentialsReady fn', typeof wapi.credentialsReady === 'function')
    check('isInvalidContentError runtime', wapi.isInvalidContentError({ message: 'errcode:45166 invalid content' }))
    check('stripMiniprogramCta runtime', !/<mp-common-miniprogram/.test(
      wapi.stripMiniprogramCta('<p>x</p><mp-common-miniprogram data-x="1"></mp-common-miniprogram>')
    ))
    check('sanitize path blocks injection', wapi.sanitizeMiniprogramPath('pages/x" onclick=') === 'pages/index/index')
    check('sanitize path ok', wapi.sanitizeMiniprogramPath('pages/mission-detail/mission-detail') === 'pages/mission-detail/mission-detail')
    check('escapeAttr quotes', wapi.escapeAttr('a"b') === 'a&quot;b')
    check('blocked private ip 127', wapi.isBlockedIp('127.0.0.1'))
    check('blocked metadata ip', wapi.isBlockedIp('169.254.169.254'))
    check('blocked 10.x', wapi.isBlockedIp('10.0.0.1'))
    check('public ip ok', !wapi.isBlockedIp('1.1.1.1'))
    let ssrfOk = false
    try {
      await wapi.assertSafeFetchUrl('http://127.0.0.1/x')
    } catch (e) {
      ssrfOk = /禁止|内网|主机/.test(String(e.message || e))
    }
    check('SSRF block localhost url', ssrfOk)
    let ssrfMeta = false
    try {
      await wapi.assertSafeFetchUrl('http://169.254.169.254/latest/meta-data/')
    } catch (e) {
      ssrfMeta = true
    }
    check('SSRF block metadata url', ssrfMeta)
    const inj = wapi.buildMiniprogramLinkHtml({
      path: 'pages/index/index" data-miniprogram-appid="evil',
      text: '</a><script>x</script>'
    })
    check('path injection neutralized', !/data-miniprogram-appid="evil"/.test(inj) && /pages\/index\/index/.test(inj))
    check('cta text escaped', /&lt;\/a&gt;/.test(inj) || /&lt;script&gt;/.test(inj))
    const unwrapped = wapi.unwrapMiniprogramImageLinks(
      '<a data-miniprogram-appid="wx" data-miniprogram-path="pages/index/index" href=""><img src="https://mmbiz.qpic.cn/a.jpg" /></a>'
    )
    check('unwrap image links', /^<img\b/.test(unwrapped.trim()) && !/data-miniprogram-appid/.test(unwrapped))
    const dirty = wapi.wrapAllImagesWithMiniprogram(
      '<a href="http://x.com"><img src="https://mmbiz.qpic.cn/a.jpg" /><br></a>',
      { path: 'pages/index/index' }
    )
    check(
      'wrap dirty a+br cleaned',
      /data-miniprogram-appid=/.test(dirty) &&
        !/href="http:\/\/x\.com"/.test(dirty) &&
        (dirty.match(/<a\b/gi) || []).length === 1
    )
    const twice = wapi.wrapAllImagesWithMiniprogram(dirty, { path: 'pages/index/index' })
    check(
      'wrap idempotent no nest',
      (twice.match(/<a\b/gi) || []).length === 1 &&
        (twice.match(/<\/a>/gi) || []).length === 1
    )
    // trustMmbiz：已是 mmbiz 时不应再走 upload（通过不抛错 + 原 URL 复用验证）
    const trusted = await wapi.buildMiniprogramCtaHtml({
      path: 'pages/index/index',
      text: '打开',
      mode: 'image',
      imageUrl: 'https://mmbiz.qpic.cn/owned.jpg',
      trustMmbiz: true
    })
    check(
      'CTA trustMmbiz reuses url',
      /mmbiz\.qpic\.cn\/owned\.jpg/.test(trusted) && /data-miniprogram-appid=/.test(trusted)
    )
  } catch (e) {
    check('wechatApi runtime load', false, e.message)
  }

  // owned 判定（与 studio 内 isOwnedWxImage 同语义，供审计独立验证）
  {
    const normalizeSlot = (s) => (String(s == null || s === '' ? '1' : s).trim() === '2' ? '2' : '1')
    const isWx = (u) => /qpic\.cn|qlogo\.cn/i.test(String(u || ''))
    const owned = (src, imageMap, uploadSlot, currentSlot) => {
      const s = String(src || '').trim()
      if (!s) return false
      const us = String(uploadSlot == null ? '' : uploadSlot).trim()
      if (!us) return false
      if (normalizeSlot(us) !== normalizeSlot(currentSlot)) return false
      const map = imageMap || {}
      if (map[s] && map[s] !== s && isWx(map[s])) return true
      if (isWx(s)) {
        for (const [u, w] of Object.entries(map)) {
          if (w === s && u !== w) return true
        }
      }
      return false
    }
    const foreign = 'https://mmbiz.qpic.cn/foreign.jpg'
    const w = 'https://mmbiz.qpic.cn/owned-by-us.jpg'
    check('owned: foreign bare false', owned(foreign, {}, '1', '1') === false)
    check('owned: identity map false', owned(foreign, { [foreign]: foreign }, '1', '1') === false)
    check('owned: empty slot false', owned(w, { a: w }, '', '1') === false)
    check('owned: cross slot false', owned(w, { a: w }, '2', '1') === false)
    check('owned: mapped true', owned(w, { a: w }, '1', '1') === true)
    check('owned: key remap true', owned('https://cdn.ex/a.jpg', { 'https://cdn.ex/a.jpg': w }, '2', '2') === true)
  }

  // ── 7) Daily cron + author track ──
  console.log('\n[7] oaContentDaily + oaAuthorTrack')
  const daily = read('cloudfunctions/oaContentDaily/index.js')
  const dailyCfg = JSON.parse(read('cloudfunctions/oaContentDaily/config.json'))
  check('calls adminGateway', /name:\s*'adminGateway'/.test(daily))
  check('internal path', /\/oa-content\/internal\/run-daily/.test(daily))
  check('internal token header', /x-oa-internal-token/.test(daily))
  check('daily only OA_CONTENT_INTERNAL_TOKEN', /OA_CONTENT_INTERNAL_TOKEN/.test(daily) && !/TOKEN_SECRET/.test(daily))
  check('callFunction timeout 90s', /timeout:\s*90000/.test(daily))
  check('timer trigger present', Array.isArray(dailyCfg.triggers) && dailyCfg.triggers.length > 0)
  check('timer cron string', /config/.test(JSON.stringify(dailyCfg.triggers[0])))

  const trackFn = read('cloudfunctions/oaAuthorTrack/index.js')
  const trackCfg = JSON.parse(read('cloudfunctions/oaAuthorTrack/config.json'))
  check('track calls adminGateway', /name:\s*'adminGateway'/.test(trackFn))
  check('track internal path', /\/oa-content\/internal\/track-sources/.test(trackFn))
  check('track token header', /x-oa-internal-token/.test(trackFn))
  check('track only OA_CONTENT_INTERNAL_TOKEN', /OA_CONTENT_INTERNAL_TOKEN/.test(trackFn) && !/TOKEN_SECRET/.test(trackFn))
  check('track timer every 6h', Array.isArray(trackCfg.triggers) && /\*\/6/.test(String(trackCfg.triggers[0]?.config || '')))

  console.log('\n[7b] oaFetchArticle')
  const fetchArt = read('cloudfunctions/adminGateway/oaFetchArticle.js')
  check('fetch assertSafeFetchUrl', /assertSafeFetchUrl/.test(fetchArt))
  check('fetch browser UA not bot', /Chrome\/\d+/.test(fetchArt) && !/MarsOABot/.test(fetchArt))
  check('fetch gzip support', /Accept-Encoding/.test(fetchArt) && /zlib/.test(fetchArt))
  check('fetch truncate not fail', /truncated/.test(fetchArt) && !/reject\(new Error\('页面过大'\)\)/.test(fetchArt))
  check('fetch redirect depth cap', /MAX_REDIRECTS/.test(fetchArt) && /redirectDepth > MAX_REDIRECTS/.test(fetchArt))
  check('fetch 403 header retry', /buildPageHeaderProfiles/.test(fetchArt) && /403/.test(fetchArt))
  check('fetch looksLikeLoneUrl', /function looksLikeLoneUrl/.test(fetchArt))
  check('fetch proxima rss', /proximareport\.com\/rss/.test(fetchArt))
  check('fetchRssByAuthor', /function fetchRssByAuthor/.test(fetchArt) || /fetchRssByAuthor/.test(fetchArt))
  check('fetch MAX_IMAGES 8', /MAX_IMAGES\s*=\s*8/.test(fetchArt))
  check('htmlToTextWithSlots', /function htmlToTextWithSlots/.test(fetchArt))
  try {
    const fam = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaFetchArticle.js'))
    check('looksLikeLoneUrl runtime yes', fam.looksLikeLoneUrl('https://proximareport.com/articles/x/') === true)
    check('looksLikeLoneUrl runtime no', fam.looksLikeLoneUrl('hello https://x.com') === false)
    check('normalizeArticleUrl strips utm', !/utm_/.test(fam.normalizeArticleUrl('https://a.com/x?utm_source=1')))
    const slotted = fam.htmlToTextWithSlots(
      '<p>发射前</p><img src="https://cdn.example.com/a.jpg" /><p>入轨后</p><img data-src="https://cdn.example.com/b.jpg" />',
      'https://example.com/'
    )
    check(
      'html slots keep order',
      slotted.imageUrls.length === 2 &&
        /发射前[\s\S]*\[\[IMG:1\]\][\s\S]*入轨后[\s\S]*\[\[IMG:2\]\]/.test(slotted.text)
    )
  } catch (e) {
    check('oaFetchArticle runtime', false, e.message)
  }

  // ── 8) admin-web ──
  console.log('\n[8] admin-web')
  const router = read('admin-web/src/router/index.js')
  const layout = read('admin-web/src/views/LayoutPage.vue')
  const client = read('admin-web/src/api/client.js')
  ;[
    'oa-content/pipeline',
    'oa-content/drafts',
    'oa-content/prompts',
    'oa-content/strategies',
    'oa-content/assets',
    'oa-content/config'
  ].forEach((p) => {
    check(`router ${p}`, router.includes(p) && /perm:\s*'oa_content'/.test(router))
    check(`menu ${p}`, layout.includes(`/${p}`) || layout.includes(p))
  })
  check('submenu 公众号内容', /公众号内容/.test(layout))
  check('menu title icon svg', /menu-title-icon/.test(layout) && /1784339901998_3dsgrb\.svg/.test(layout))
  check('menu oa-content after statistics', (() => {
    const iStats = layout.indexOf('index="/statistics"')
    const iOa = layout.indexOf('index="oa-content"')
    const iNews = layout.indexOf('index="news"')
    return iStats > 0 && iOa > iStats && (iNews < 0 || iOa < iNews)
  })())
  ;[
    'getOaContentConfig',
    'generateOaContent',
    'listOaDrafts',
    'pushOaDraft',
    'publishOaDraft',
    'batchDeleteOaDrafts',
    'seedOaPrompts',
    'seedOaStrategies',
    'analyzeOaTitle',
    'generateOaTitles',
    'listOaViral',
    'listOaCollected',
    'listOaAccountArticles',
    'runOaDaily',
    'runOaTrackSources'
  ].forEach((fn) => check(`api.${fn}`, client.includes(fn)))

  const draftsPage = read('admin-web/src/views/OaDraftsPage.vue')
  check('drafts push+publish UI', /pushOaDraft/.test(draftsPage) && /publishOaDraft/.test(draftsPage))
  check('drafts reject UI', /rejectOaDraft/.test(draftsPage))
  check('drafts batch delete UI', /batchDeleteOaDrafts/.test(draftsPage) && /批量删除/.test(draftsPage))
  check('drafts selection column', /type="selection"/.test(draftsPage))
  check('drafts ops contrast classes', /ops-btn--primary/.test(draftsPage) && /ops-btn--danger/.test(draftsPage))
  const pipeline = read('admin-web/src/views/OaPipelinePage.vue')
  check('pipeline batch+manual', /generateOaContent/.test(pipeline) && /runOaDaily/.test(pipeline))
  check('pipeline URL wash', /sourceUrl/.test(pipeline) && /粘贴文章 URL/.test(pipeline) && /looksLikeUrl/.test(pipeline))
  const assets = read('admin-web/src/views/OaAssetsPage.vue')
  check('assets low follower tab', /lowFollower|低粉/.test(assets))
  check('assets title analyze', /analyzeOaTitle/.test(assets))
  check('assets rewrite from viral', /rewriteFromViral|deep_recap/.test(assets))
  check('assets account articles drawer', /listOaAccountArticles/.test(assets) && /openAccountArticles/.test(assets))
  check('assets wash from collected', /rewriteFromCollected/.test(assets))
  check('assets wash passes images', /imageUrls:\s*safeImgs/.test(assets) && /hotlinkSafeImageUrl/.test(assets))
  const cfgPage = read('admin-web/src/views/OaContentConfigPage.vue')
  check('config wechatReady warn', /wechatReady|凭证槽/.test(cfgPage))
  check('config brands UI', /brands/.test(cfgPage) && /credentialSlot/.test(cfgPage) && /发稿号/.test(cfgPage))
  check('config autoFreepublish disabled UI', /autoFreepublish/.test(cfgPage) && /disabled/.test(cfgPage))
  check('config CTA mode none default', /miniprogramCtaMode:\s*'none'/.test(cfgPage) || /value="none"/.test(cfgPage))
  check('config linkAllImages switch', /linkAllImagesToMiniprogram/.test(cfgPage))
  check('config trackSources UI', /trackSources/.test(cfgPage) && /外链追踪/.test(cfgPage) && /runOaTrackSources/.test(cfgPage))
  check('config autoWash switch', /autoWash/.test(cfgPage))
  check('pipeline brand select', /brandKey/.test(pipeline) && /发稿号/.test(pipeline))
  check('drafts brand filter', /brandKey/.test(draftsPage) && /发稿号/.test(draftsPage))

  // ── 9) collector extension ──
  console.log('\n[9] collector extension')
  const manifest = JSON.parse(read('tools/oa-collector-extension/manifest.json'))
  const popupJs = read('tools/oa-collector-extension/popup.js')
  const popupHtml = read('tools/oa-collector-extension/popup.html')
  check('MV3', manifest.manifest_version === 3)
  check('ext version >= 1.1', String(manifest.version || '').startsWith('1.1') || Number(String(manifest.version).split('.')[1] || 0) >= 1)
  check('host mp.weixin', JSON.stringify(manifest.host_permissions || []).includes('mp.weixin.qq.com'))
  check('popup posts collector ingest', /\/oa-content\/collector\/ingest/.test(popupJs))
  check('popup posts ingest-batch', /\/oa-content\/collector\/ingest-batch/.test(popupJs))
  check('popup sends x-oa-collector-token', /x-oa-collector-token/.test(popupJs))
  check('popup scrapes #js_content', /js_content|activity-name/.test(popupJs))
  check('popup collect latest 5', /scrapeLatestFiveFn|采集最新 5 篇/.test(popupJs) && /collect5/.test(popupHtml))
  check('popup history page hint', /历史消息/.test(popupHtml))
  check('studio verifyCollectorToken', /verifyCollectorToken|OA_COLLECTOR_TOKEN/.test(studio))

  // ── 10) 合规默认 ──
  console.log('\n[10] safety defaults')
  check('no auto freepublish in daily path', !/autoFreepublish[\s\S]{0,80}publishDraft/.test(studio))
  check('push only ready/pushed', /ready.*pushed_to_wechat|pushed_to_wechat/.test(studio))
  check('cover required for push', /缺少封面图/.test(studio))
  check('batch delete cap 100', /单次最多删除 100/.test(studio))
  check('ingest batch cap', /Math\.min\(10/.test(studio) || /limit:\s*5/.test(studio))

  // ── 11) 安全 / 逻辑深审 ──
  console.log('\n[11] security + logic')
  check('SSRF assertSafeFetchUrl present', /function assertSafeFetchUrl/.test(wx))
  check('SSRF MAX_FETCH_BYTES', /MAX_FETCH_BYTES/.test(wx))
  check('SSRF MAX_REDIRECTS', /MAX_REDIRECTS/.test(wx))
  check('stable_token preferred', /cgi-bin\/stable_token/.test(wx))
  check('withTokenRetry 40001', /function withTokenRetry/.test(wx) && /40001/.test(wx))
  check('token singleflight', /_tokenInflightBySlot/.test(wx))
  check('IPv4-mapped blocked', /::ffff:/.test(wx))
  check('LLM extract nested content', /normalizeContent|Array\.isArray\(content\)/.test(llm))
  check('LLM userOnly fallback', /【系统要求】/.test(llm) || /userOnly/.test(llm))
  check('LLM returns {text,error}', /return \{\s*text,\s*error:\s*''\s*\}/.test(llm) || /text:\s*''/.test(llm))
  check('no generateText.lastError', !/generateText\.lastError/.test(studio) && !/generateText\.lastError/.test(llm))
  check('publish requires pushed_to_wechat', /请先推送到微信草稿箱后再发稿/.test(studio))
  check('publish requires wxMediaId', /缺少微信草稿 media_id/.test(studio))
  check('push lease lock', /pushLeaseAt/.test(studio) && /正在推送中/.test(studio))
  check('push force retry', /opts\.force|force === true/.test(studio))
  check('push image upload up to 8', /MAX_BODY_IMAGES\s*=\s*8/.test(studio))
  check('push placeImages before html', /placeImagesInMarkdown\(draft\.markdown/.test(studio))
  check('push aligned images', /placeImagesAlignedToSource\(draft\.markdown/.test(studio))
  check('push async kick oaPushDraft', /name:\s*['"]oaPushDraft['"]/.test(studio))
  check('push wxImageMap resume', /wxImageMap/.test(studio))
  check('prepareDraftImages fn', /async function prepareDraftImages/.test(studio))
  check('imagesReady gate on push', /imagesReady/.test(studio) && /配图尚未就绪/.test(studio))
  check('resolveBodyImageUrls helper', /function resolveBodyImageUrls/.test(studioHelpers))
  check('push uses body images not cover', /resolveBodyImageUrls\(draft, brand, cfg\)/.test(studio))
  check('prepare cover-only ready', /coverOnly:\s*true/.test(studio))
  check('rewrite skipCoverFallbacks', /skipCoverFallbacks/.test(studio))
  check('UI prep only-cover label', /仅封面/.test(draftsPage))
  try {
    const hp2 = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaStudioHelpers.js'))
    const def = 'https://example.com/cover.jpg'
    check(
      'runtime cover-only empty body',
      hp2.resolveBodyImageUrls(
        { coverUrl: def, imageUrls: [def], markdown: '无图', sourceSlottedBody: '无图' },
        { defaultCoverUrl: def },
        { defaultCoverUrl: def }
      ).length === 0
    )
  } catch (e) {
    check('runtime cover-only empty body', false, e.message)
  }
  check('push sync execute fallback', /return executePushDraft\(id,\s*user/.test(studio))
  check('oaPushDraft timer 30s', /0,30 \* \* \* \* \* \*/.test(read('cloudfunctions/oaPushDraft/config.json')))
  check('oaPushDraft prepare action', /action === 'prepare'/.test(read('cloudfunctions/oaPushDraft/index.js')))
  check('prepare-images route', /prepare-images/.test(gw))
  check('UI prepare button', /转存配图/.test(draftsPage) && /prepareOaDraftImages/.test(read('admin-web/src/api/client.js')))
  check('heal stale pushing', /healStalePushingDrafts/.test(studio))
  check('heal stale window 5min', /5 \* 60 \* 1000/.test(studio))
  check('heal queued uses updatedAt', /lease=0|pushLeaseAt|\.updatedAt/.test(studio) && /8 \* 60 \* 1000/.test(studio))
  check('enqueue sets pushLeaseAt now', /status:\s*'pushing'[\s\S]{0,120}pushLeaseAt:\s*now\(\)/.test(studio))
  check('execute idempotent if pushed', /idempotent:\s*true/.test(studio))
  check('client cannot forge image ownership', /delete patch\.wxImageEntries/.test(studio) && /delete patch\.wxImageUploadSlot/.test(studio) && /delete patch\.imagesReady/.test(studio))
  check('execute requires _internal', /opts\._internal/.test(studio))
  check('owned rejects empty uploadSlot', /空 uploadSlot 不可信|if\s*\(\s*!us\s*\)\s*return false/.test(studio))
  check('rewrite no bare mmbiz uploaded', !/if \(isWechatCdnUrl\(src\)\) \{\s*uploaded \+= 1/.test(studio))
  check('prepare no-op when already owned', /alreadyOwned|skipped:\s*true/.test(studio))
  check('prepare blocked during pushing', /reason:\s*'pushing'/.test(studio))
  check('CTA trustMmbiz skip reupload', /trustMmbiz/.test(wx) && /trustMmbiz:\s*true/.test(studio))
  check('FAIL_DROP_AFTER non-force 2', /FAIL_DROP_AFTER = forceSkip \? 1 : 2/.test(studio))
  check('brand change clears ownership', /brandChanged \|\| slotChanged/.test(studio))
  check('ctaFallback recorded', /ctaFallback/.test(studio))
  check('UI partial prep label', /配图部分就绪（/.test(draftsPage))
  check('internal push-draft route', /\/oa-content\/internal\/push-draft/.test(gw))
  const pushWorker = read('cloudfunctions/oaPushDraft/index.js')
  check('oaPushDraft calls internal push', /\/oa-content\/internal\/push-draft/.test(pushWorker))
  check('oaPushDraft timer config', /0,30 \* \* \* \* \* \*/.test(read('cloudfunctions/oaPushDraft/config.json')))
  check('assets wash brand picker', /选择发稿号/.test(assets) && /confirmWash/.test(assets))
  check('pipeline require brand', /requireBrand/.test(pipeline))
  check('drafts pushing status UI', /pushing:\s*'推送中'/.test(draftsPage) && /ensurePushPoll/.test(draftsPage))
  check('push credentialsReady gate', /credentialsReady\(slot\)/.test(studio))
  check('push blocks LLM fallback md', /素材整理稿尚未实质改写/.test(studio))
  check('updateDraft clears wxMediaId', /patch\.wxMediaId\s*=\s*''/.test(studio))
  check('updateDraft status client whitelist', /不可直接设置为该状态/.test(studio))
  check('updateDraft blocks fallback→ready', /正文仍与原素材基本相同，请实质改写后再标为待审核/.test(studio))
  check('updateDraft strips fallback notice', /stripLlmFallbackNotice\(md\)/.test(studio))
  check('updateDraft rewrite check by source similarity', /looksLikeUnrewrittenSource\(cleaned/.test(studio))
  check('CTA uses unified slot', /credentialSlot:\s*slot/.test(studio))
  check(
    'push rebuilds from markdown',
    /始终以 markdown 重建|mdForPush\s*=\s*placeImagesInMarkdown|markdownToWechatHtml\(mdForPush/.test(studio)
  )
  check('UI canPublish needs media', /status === 'pushed_to_wechat' && !!row\.wxMediaId/.test(draftsPage))
  check('UI save strips fallback notice', /stripFallbackNotice/.test(draftsPage))
  check('UI save unrewritten toast', /仍与原素材基本相同/.test(draftsPage))
  check('runGenerate returns llmError', /llmError:\s*usedFallback/.test(studio))
  check('assets wash shows llmError', /AI 生成失败，已写入素材整理稿/.test(assets) && /first\.llmError/.test(assets))
  check('pipeline notify shows llmError', /res\.llmError/.test(pipeline))
  try {
    const hp = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaStudioHelpers.js'))
    const srcTxt =
      'SpaceX is targeting Friday for the launch of 28 Starlink satellites from SLC-40. ' +
      'The booster previously launched 12 times and recovery is planned on the droneship in the Atlantic. ' +
      'Weather officials forecast 80 percent favorable conditions for the launch window on Friday night.'
    const noticeLn = '> 自动生成暂不可用（超时）。以下为素材整理稿，请人工改写后保存再推送。'
    const rawMd = `# t\n\n${noticeLn}\n\n${srcTxt}`
    check('strip notice runtime', !/自动生成暂不可用/.test(hp.stripLlmFallbackNotice(rawMd)))
    check('unrewritten copy detected', hp.looksLikeUnrewrittenSource(rawMd, srcTxt) === true)
    check(
      'rewritten passes gate',
      hp.looksLikeUnrewrittenSource(`${noticeLn}\n\n本周五猎鹰九号再送28颗星链上天，这枚火箭已经飞过12次，回收船在大西洋待命，气象预报八成放行。`, srcTxt) === false
    )
    check('short source not blocked', hp.looksLikeUnrewrittenSource('随便', '短') === false)
  } catch (e) {
    check('rewrite gate runtime', false, e.message)
  }
  try {
    const wapi2 = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaWechatApi.js'))
    check('blocked mapped ipv4 runtime', wapi2.isBlockedIp('::ffff:127.0.0.1') === true)
  } catch (e) {
    check('blocked mapped ipv4 runtime', false, e.message)
  }
  check('no export getOaSecret', !/^\s*getOaSecret,/m.test(wx) && !/module\.exports[\s\S]*getOaSecret/.test(wx))
  check('path sanitize present', /function sanitizeMiniprogramPath/.test(wx))
  check('attr escape present', /function escapeAttr/.test(wx))
  check('CTA data-oa-cta marker', /data-oa-cta="1"/.test(wx))
  check('unwrapMiniprogramImageLinks', /function unwrapMiniprogramImageLinks/.test(wx))
  check('45166 unwrap fallback', /unwrapMiniprogramImageLinks/.test(studio))
  check('push uses draft.credentialSlot', /draft\.credentialSlot\s*\|\|\s*brand\.credentialSlot/.test(studio))
  check('publish status gate not ready-only', /请先推送到微信草稿箱后再发稿/.test(studio))
  check('reject blocks published', /已发布稿不可拒绝/.test(studio))
  check('LLM fallback needs_review', /usedFallback\s*\?\s*'needs_review'/.test(studio))
  check('autoPush only ready', /autoPushToWechatDraft[\s\S]{0,120}status === 'ready'/.test(studio))
  check('autoFreepublish hard false', /cfg\.autoFreepublish\s*=\s*false/.test(studio))
  check('coerceBool for linkAllImages', /coerceBool\(cfg\.linkAllImagesToMiniprogram/.test(studio))
  check('collector requires oa_content or token', /checkPerm\(user,\s*'oa_content'\)/.test(studio))
  check('collector token header only', /verifyCollectorToken\(headers\)/.test(studio) && !/body\.collectorToken/.test(studio))
  check('collector timingSafeEqual', /timingSafeEqual/.test(studio))
  check('createApi gets checkPerm', /createOaContentStudioApi\(\{[\s\S]*checkPerm/.test(gw))
  check('internal token no TOKEN_SECRET fallback', (() => {
    const block = gw.slice(
      gw.indexOf('/oa-content/internal/run-daily'),
      gw.indexOf('/oa-content/internal/run-daily') + 900
    )
    return /OA_CONTENT_INTERNAL_TOKEN/.test(block) && !/TOKEN_SECRET/.test(block) && !/body\.internalToken/.test(block)
  })())
  check('internal token timingSafeEqual', (() => {
    const block = gw.slice(
      gw.indexOf('/oa-content/internal/run-daily'),
      gw.indexOf('/oa-content/internal/run-daily') + 900
    )
    return /timingSafeEqual/.test(block)
  })())
  check('format escapes img src', /escapeHtml\(\s*mdImg\[2\]/.test(fmt) || /src="\$\{escapeHtml/.test(fmt))
  check('format link href escaped', /escapeHtml\(href\)/.test(fmt))
  check('rewrite img scoped to tag', /out\.replace\(\/<img\\b/.test(studio) || /tag\.replace\(src/.test(studio))

  // ── 12) 本轮设计优化：拆分 / 状态机 / 槽位化 / 种子补缺 / 熔断 / 观测 ──
  console.log('\n[12] design refactor round')
  const promptsPage = read('admin-web/src/views/OaPromptsPage.vue')
  const strategiesPage = read('admin-web/src/views/OaStrategiesPage.vue')
  const configPage2 = read('admin-web/src/views/OaContentConfigPage.vue')
  const clientJs = read('admin-web/src/api/client.js')

  // 12.1 模块拆分
  check('seeds module exists', exists('cloudfunctions/adminGateway/oaContentSeeds.js'))
  check('helpers module exists', exists('cloudfunctions/adminGateway/oaStudioHelpers.js'))
  ;['cloudfunctions/adminGateway/oaContentSeeds.js', 'cloudfunctions/adminGateway/oaStudioHelpers.js'].forEach((f) => {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' })
    check(`syntax ${f}`, r.status === 0, (r.stderr || r.stdout || '').trim().slice(0, 160))
  })
  check('studio requires seeds', /require\('\.\/oaContentSeeds'\)/.test(studioMain))
  check('studio requires helpers', /require\('\.\/oaStudioHelpers'\)/.test(studioMain))
  check('main no inline SEED_PROMPTS', !/const SEED_PROMPTS = \[/.test(studioMain))
  check('main no inline isOwnedWxImage def', !/function isOwnedWxImage/.test(studioMain))
  check('main no inline decodeImageMap def', !/function decodeImageMap/.test(studioMain))
  check('seeds pure (no db/cloud)', !/require\('wx-server-sdk'\)|\bdb\./.test(studioSeeds))
  check('helpers pure (no db/cloud)', !/require\('wx-server-sdk'\)|\bdb\./.test(studioHelpers))
  try {
    const seedsMod = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaContentSeeds.js'))
    check('seeds exports complete', !!(seedsMod.COLS && seedsMod.DEFAULT_CONFIG && seedsMod.SEED_PROMPTS.length && seedsMod.SEED_STRATEGIES.length && seedsMod.GROUNDING_RULES && seedsMod.matchStrategyFromContent))
    check(
      'match starship diary',
      seedsMod.matchStrategyFromContent({ title: 'Ship 36 静火', body: 'Starbase 星舰完成静火' }) === 'starship_diary'
    )
    check(
      'match launch brief',
      seedsMod.matchStrategyFromContent({ title: 'Falcon 9 即将发射', body: '发射窗口 NET 明天，LC-39A 倒计时' }) ===
        'launch_brief'
    )
    check(
      'match space story',
      seedsMod.matchStrategyFromContent({
        title: 'NASA和俄罗斯还要接着换宇航员座位？',
        body: '宇航员座位互换协议，空间站 ISS 载人飞行'
      }) === 'space_story'
    )
    check(
      'match news digest short',
      seedsMod.matchStrategyFromContent({ title: '航天要闻速览', body: '一句话快讯。' }) === 'news_digest'
    )
  } catch (e) {
    check('seeds exports complete', false, e.message)
  }

  // 12.2 状态机
  check('generate fail → generate_failed', /status:\s*'generate_failed'/.test(studioMain))
  check('generate fail not rejected', !/catch \(e\) \{[\s\S]{0,200}status:\s*'rejected'[\s\S]{0,80}生成失败/.test(studioMain))
  check('push fail → push_failed', /status.*push_failed|'push_failed'/.test(studioMain))
  check('heal → push_failed', /pushed_to_wechat'\s*\?\s*'pushed_to_wechat'\s*:\s*'push_failed'/.test(studioMain))
  check('worker markFailed → push_failed', /'push_failed'/.test(pushWorker))
  check('push gate allows push_failed', /'ready',\s*'pushed_to_wechat',\s*'pushing',\s*'push_failed'/.test(studioMain))
  check('cleanup includes generate_failed', /'published',\s*'rejected',\s*'generate_failed'/.test(studioMain))
  check('worker prep skips generate_failed', /generate_failed/.test(pushWorker))
  check('UI status push_failed', /push_failed:\s*'推送失败'/.test(draftsPage))
  check('UI status generate_failed', /generate_failed:\s*'生成失败'/.test(draftsPage))
  check('UI filter push_failed', /value="push_failed"/.test(draftsPage))
  check('UI canPush push_failed', /'push_failed'\]\.includes\(row\.status\)/.test(draftsPage))
  check('edit from push_failed resets ready', /\['pushed_to_wechat',\s*'push_failed'\]\.includes\(from\)/.test(studioMain))

  // 12.3 凭证槽配置化
  check('normalizeSlot 1-9', /\^\[1-9\]\$/.test(wx))
  check('resolveCredentials dynamic env', /WECHAT_OA_APPID_\$\{s\}/.test(wx))
  check('credentialsStatus loops slots', /for \(let i = 1; i <= 9; i\+\+\)/.test(wx))
  check('credentialMissingMsg helper', /function credentialMissingMsg/.test(studioHelpers) && /credentialMissingMsg\(slot\)/.test(studioMain))
  check('UI slotOptions dynamic', /slotOptions/.test(configPage2) && /WECHAT_OA_APPID_\$\{s\}/.test(configPage2))
  try {
    const wapi3 = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaWechatApi.js'))
    check('runtime normalizeSlot(3)=3', wapi3.normalizeSlot('3') === '3')
    check('runtime normalizeSlot(x)=1', wapi3.normalizeSlot('x') === '1' && wapi3.normalizeSlot('') === '1')
    process.env.WECHAT_OA_APPID_7 = 'wx_test_7'
    process.env.WECHAT_OA_SECRET_7 = 'sec_test_7'
    const c7 = wapi3.resolveCredentials('7')
    check('runtime slot7 env resolved', c7.appid === 'wx_test_7' && c7.secret === 'sec_test_7')
    const st7 = wapi3.credentialsStatus()
    check('runtime status lists slot7', !!(st7['7'] && st7['7'].ready))
    delete process.env.WECHAT_OA_APPID_7
    delete process.env.WECHAT_OA_SECRET_7
    check('runtime status hides unset slot', !wapi3.credentialsStatus()['7'])
  } catch (e) {
    check('runtime slot config', false, e.message)
  }

  // 12.4 种子导入只补缺失
  check('seed overwrite param', /coerceBool\(opts && opts\.overwrite, false\)/.test(studioMain))
  check('seed skips existing by default', /skipped \+= 1/.test(studioMain))
  check('seed route passes body', /seedPrompts\(user, body \|\| \{\}\)/.test(gw) && /seedStrategies\(user, body \|\| \{\}\)/.test(gw))
  check('UI seed confirm prompts', /仅补缺失/.test(promptsPage) && /覆盖重置/.test(promptsPage))
  check('UI seed confirm strategies', /仅补缺失/.test(strategiesPage) && /覆盖重置/.test(strategiesPage))
  check('client seed body', /seedOaPrompts\(body\)/.test(clientJs) && /seedOaStrategies\(body\)/.test(clientJs))

  // 12.5 LLM 熔断
  check('isFatalLlmError present', /function isFatalLlmError/.test(llm))
  check('fatal skips provider variants', /genFatal/.test(llm) && /isFatalLlmError\(msg\)/.test(llm))
  try {
    const llmMod = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaContentLlm.js'))
    const shapes = llmMod.buildCallShapes('hy3-preview', [{ role: 'user', content: 'x' }], {
      temperature: 0.5,
      maxTokens: 100
    })
    check('runtime shapes flat first', shapes[0] && shapes[0].model === 'hy3-preview' && !shapes[0].data)
    check('runtime shapes data second', shapes[1] && shapes[1].data && shapes[1].data.model === 'hy3-preview')
    check(
      'runtime missing-model not fatal',
      llmMod.isMissingModelParamError('Request body missing required parameter: model') === true &&
        llmMod.isFatalLlmError('Request body missing required parameter: model') === false
    )
  } catch (e) {
    check('runtime llm shapes', false, e.message)
  }
  check('round deadline budget', /roundDeadline/.test(llm) && /100000/.test(llm))
  try {
    delete require.cache[require.resolve(path.join(ROOT, 'cloudfunctions/adminGateway/oaContentLlm.js'))]
  } catch (e) {}

  // 12.6 观测性：时间线 + jobs
  check('appendTimeline helper', /function appendTimeline/.test(studioHelpers))
  check('timeline on push ok', /appendTimeline\([\s\S]{0,40}'push_ok'/.test(studioMain))
  check('timeline on push fail', /'push_fail'/.test(studioMain))
  check('timeline on generate', /'generated'/.test(studioMain) && /'generate_failed'/.test(studioMain))
  check('timeline on prep done', /'prep_ready'|'prep_partial'/.test(studioMain))
  check('timeline capped 20', /slice\(-20\)/.test(studioHelpers))
  check('track run writes job', /type:\s*'track',\s*status:\s*'running'/.test(studioMain))
  check('listCollection type filter', /if \(query\.type\) where\.type/.test(studioMain))
  check('UI jobs drawer', /任务记录/.test(pipeline) && /listOaJobs/.test(pipeline))
  check('UI job draft deeplink', /gotoDraft/.test(pipeline))
  check('UI generate notify deeplink', /notifyGenerated/.test(pipeline) && /ElNotification/.test(pipeline))
  check('UI drafts deeplink query id', /route\.query\.id/.test(draftsPage))
  check('UI drafts timeline render', /el-timeline/.test(draftsPage) && /timelineLabel/.test(draftsPage))

  // ── 13) 反爬站点 RSS 兜底 + NSF 栏目追踪 ──
  console.log('\n[13] anti-bot RSS fallback + NSF tracking')
  const fetchSrc = read('cloudfunctions/adminGateway/oaFetchArticle.js')
  check('SITE_FEEDS registry', /const SITE_FEEDS = \{/.test(fetchSrc) && /nasaspaceflight\.com/.test(fetchSrc))
  check('NSF category feeds listed', /news\/spacex\/feed\//.test(fetchSrc) && /news\/international\/chinese\/feed\//.test(fetchSrc))
  check('fetchFromSiteFeeds fn', /async function fetchFromSiteFeeds/.test(fetchSrc))
  check('known host pre-try RSS', /knownFeedHost/.test(fetchSrc))
  check('403/429 falls back to feeds', /sc === 403 \|\| sc === 429/.test(fetchSrc) && /fetchFromSiteFeeds\(u\)/.test(fetchSrc))
  check('fallback miss error actionable', /追踪源/.test(fetchSrc) && /反爬拦截/.test(fetchSrc))
  check('generic wp/ghost feed guess', /\$\{url\.origin\}\/feed\//.test(fetchSrc) && /\$\{url\.origin\}\/rss\//.test(fetchSrc))
  check('rss empty author = all items', /needle\s*\?\s*items\.filter/.test(fetchSrc))
  check('seeds preset nsf_spacex', /nsf_spacex/.test(studioSeeds) && /news\/spacex\/feed\//.test(studioSeeds))
  check('seeds preset nsf_chinese', /nsf_chinese/.test(studioSeeds) && /news\/international\/chinese\/feed\//.test(studioSeeds))
  check('UI track presets', /trackPresets/.test(configPage2) && /nsf_spacex/.test(configPage2) && /nsf_chinese/.test(configPage2))
  check('UI preset add dedup', /hasTrackSource/.test(configPage2))
  check('UI track source remove', /removeTrackSource/.test(configPage2))
  check('rss reader UA fallback profiles', /Feedly\/1\.0/.test(fetchSrc) && /rss\|xml/.test(fetchSrc))
  check('loadRssItems fn', /async function loadRssItems/.test(fetchSrc))
  check('rss2json proxy fallback', /api\.rss2json\.com/.test(fetchSrc) && /loadRssItemsViaRss2Json/.test(fetchSrc))
  check('403/429 feed → rss2json', /feed blocked HTTP/.test(fetchSrc) && /rss2json/.test(fetchSrc))
  check('fetchRssByAuthor uses loadRssItems', /fetchRssByAuthor[\s\S]{0,200}loadRssItems\(rssUrl\)/.test(fetchSrc))
  check('fetchFromSiteFeeds uses loadRssItems', /fetchFromSiteFeeds[\s\S]{0,200}loadRssItems\(feedUrl\)/.test(fetchSrc))
  check('UI tip mentions rss2json', /rss2json/.test(configPage2))
  check('UI track toast shows fetched', /拉到\$\{r\.fetched/.test(configPage2))
  check('UI track toast shows error', /r\.error \? `\$\{base\} ❌/.test(configPage2))
  try {
    const of2 = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaFetchArticle.js'))
    const feeds = of2.candidateFeedsFor('https://www.nasaspaceflight.com/2026/08/launch-preview-080326/#more-114437')
    check('runtime candidate feeds nsf', feeds.length >= 3 && feeds.some((f) => /news\/spacex\/feed/.test(f)))
    check('runtime candidate feeds generic', of2.candidateFeedsFor('https://example.com/2026/08/post/').some((f) => f === 'https://example.com/feed/'))
    // 运行时：rss2json 中转能拿到 NSF 条目（云函数 403 时的兜底路径）
    const proxied = await of2.loadRssItemsViaRss2Json(
      'https://www.nasaspaceflight.com/news/spacex/feed/'
    )
    check('runtime rss2json nsf items', Array.isArray(proxied) && proxied.length >= 3)
    check(
      'runtime rss2json has content',
      proxied[0] && String(proxied[0].contentHtml || '').length > 200
    )
    // NSF 配图 Cloudflare 403 → Photon / wsrv 镜像
    const wapiImg = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaWechatApi.js'))
    const nsfImg =
      'https://www.nasaspaceflight.com/wp-content/uploads/2026/08/jsc2026e404725large.jpg'
    check(
      'runtime NSF hotlink → photon',
      /i0\.wp\.com/.test(wapiImg.hotlinkSafeImageUrl(nsfImg))
    )
    check(
      'runtime NSF candidates prefer mirror',
      wapiImg.imageUrlCandidates(nsfImg)[0].includes('i0.wp.com')
    )
  } catch (e) {
    check('runtime candidate feeds', false, e.message)
  }

  check('cfBypassImageMirrors fn', /function cfBypassImageMirrors/.test(wx))
  check('hotlinkSafeImageUrl fn', /function hotlinkSafeImageUrl/.test(wx))
  check('fetchArticle rewrites NSF imgs', /hotlinkSafeImageUrl/.test(fetchSrc))
  check('UI hotlinkSafe for NSF thumbs', /hotlinkSafeImageUrl/.test(read('admin-web/src/utils/oaImageProxy.js')))
  check('assets wash remaps NSF imgs', /hotlinkSafeImageUrl\(row\.coverUrl\)/.test(assets))

  // ── 14) 文首提示语（信息向免责，不挂文字小程序链） ──
  console.log('\n[14] lead disclaimer')
  check('buildLeadDisclaimerHtml fn', /function buildLeadDisclaimerHtml/.test(wx))
  check('stripLeadDisclaimer fn', /function stripLeadDisclaimer/.test(wx))
  check('lead marker data-oa-lead', /data-oa-lead="1"/.test(wx))
  check('lead plain text policy', /不挂小程序文字链|纯文展示/.test(wx) || /void path/.test(wx))
  check('lead no bracket auto-link', !/raw\.match\(\/【/.test(wx))
  check(
    'seeds leadDisclaimer defaults',
    /leadDisclaimerEnabled:\s*true/.test(studioSeeds) && /本文详情信息仅供参考/.test(studioSeeds)
  )
  check('config normalize lead fields', /coerceBool\(cfg\.leadDisclaimerEnabled, true\)/.test(studioMain) && /leadDisclaimerText/.test(studioMain))
  check('studio buildLeadHtml helper', /function buildLeadHtml/.test(studioMain))
  const leadInjections = (studioMain.match(/buildLeadHtml\(cfg/g) || []).length
  check('lead injected at 4 assembly points', leadInjections >= 4, `found ${leadInjections}`)
  check('push strips old lead before rebuild', /stripLeadDisclaimer\(wechatApi\.stripMiniprogramCta/.test(studioMain))
  check('UI lead switch + textarea', /leadDisclaimerEnabled/.test(configPage2) && /leadDisclaimerText/.test(configPage2))
  try {
    const wapi4 = require(path.join(ROOT, 'cloudfunctions/adminGateway/oaWechatApi.js'))
    const lh = wapi4.buildLeadDisclaimerHtml({
      text: '本文详情信息仅供参考，有关火箭发射预报小程序【火星探索日志】可以查看火箭发射信息及相关资讯，感谢阅读，记得点赞支持',
      path: 'pages/index/index'
    })
    check('runtime lead plain (no text mp link)', /【火星探索日志】/.test(lh) && !/<a\b/i.test(lh))
    check('runtime lead strip idempotent', wapi4.stripLeadDisclaimer(lh + '<p>x</p>') === '<p>x</p>')
    check('runtime lead escape', !/<b>/.test(wapi4.buildLeadDisclaimerHtml({ text: '<b>x</b>【名】', path: 'p' })))
  } catch (e) {
    check('runtime lead disclaimer', false, e.message)
  }

  console.log('\n=== summary ===')
  console.log(`passed=${passed} failed=${failed}`)
  if (failed) {
    console.log('RESULT: RED')
    process.exit(1)
  }
  console.log('RESULT: GREEN')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
