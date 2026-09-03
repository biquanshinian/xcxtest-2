// 把抽出的 progress 折叠区方法并入 progress-lazy.js
const fs = require('fs')
const extracted = fs.readFileSync('scripts/_tmp_extracted_progress.txt', 'utf8')
const lazyFile = 'subpackages/progress-extra/utils/progress-lazy.js'
let lazy = fs.readFileSync(lazyFile, 'utf8')

const sections = {}
extracted.split(/\/\/ ===== (\w+) =====\n/).forEach((part, i, arr) => {
  if (i % 2 === 1) sections[part] = arr[i + 1] || ''
})

const methodSections = ['ll2Cluster', 'eventCluster1', 'openEventDetail', 'eventCluster2']
let methodsText = methodSections.map((k) => sections[k].replace(/\s+$/, '')).join('\n\n')
// 分包内相对路径修正（progress-lazy 位于 subpackages/progress-extra/utils/）
methodsText = methodsText.replace(/require\('\.\.\/\.\.\/utils\//g, "require('../../../utils/")
// 结尾成员需要逗号收尾（最后一个成员允许省略，这里统一保留原样：块末是 `},`）

const prelude = `
// ══ 事件动态 / LL2 折叠区依赖（原 progress.js 首屏后延迟加载逻辑） ══
const { fetchLl2LaunchUpdates, fetchLl2LaunchTimeline } = require('../../../utils/api-app-services.js')
const { normalizeLl2TimelineList } = require('../../../utils/ll2-launch-timeline.js')
const { formatCloudError } = require('../../../utils/launch-stats-cloud.js')
const { getCachedMediaImage } = require('../../../utils/icon-cache.js')
const { enrichVideoMediaItem, eventVideoAdUnlockId, playEventVideo, saveEventOriginalVideo } = require('../../../utils/event-video.js')
const { resolveTweetAccountAvatarUrl } = require('../../../utils/event-share-image.js')
const { fetchLiveStatusBatch, parseLiveStatus } = require('../../../utils/live-status.js')
const { isLiveEntryAllowed } = require('../../../utils/feature-flags.js')
const { isPermissionDenied, getPermissionDeniedMessage } = require('../../../utils/single-page.js')
const { gateCheck, isProSync, isMembershipEnabled, canUsePaidCloudSync, canPrefetchVideoSync, canSaveOriginalVideoSync } = require('../../../utils/membership.js')
const { getMemberPolicy } = require('../../../utils/member-policy.js')
const { isVideoUrl } = require('../../../utils/cos-url.js')
const { runPullRefresh } = require('../../../utils/pull-refresh.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const storageCache = require('../../../utils/storage-sync-cache.js')

/** 事件列表直播状态批量查询延后，避免与首屏 DB 查询抢带宽 */
const PROGRESS_LIVE_STATUS_DEFER_MS = 600

/** LL2 自动解析星舰发射失败时的可读文案 */
function formatLl2AutoError(message) {
  const m = String(message || '')
  if (m === 'no_starship_launch') {
    return 'LL2 上暂未找到火箭配置为「Starship」的发射（已查 upcoming / previous）。可稍后下拉刷新，或在后台手动填写发射 UUID。'
  }
  return formatCloudError(new Error(m))
}
`

// 1) 插入 prelude：紧跟现有 import 之后
const importAnchor = "} = require('../../../utils/progress-road-closure.js')\n"
if (!lazy.includes(importAnchor)) { console.error('import 锚点未找到'); process.exit(1) }
lazy = lazy.replace(importAnchor, importAnchor + prelude)

// 2) 插入方法：methods 对象收尾 `  }\n}` 前
const tailAnchor = '\n}\n\n/** 把低频方法挂到页面实例上（覆盖主包里的委托占位方法） */'
if (!lazy.includes(tailAnchor)) { console.error('methods 收尾锚点未找到'); process.exit(1) }
lazy = lazy.replace(tailAnchor, ',\n\n' + methodsText + '\n}\n\n/** 把低频方法挂到页面实例上（覆盖主包里的委托占位方法） */')

fs.writeFileSync(lazyFile, lazy)
console.log('progress-lazy.js:', (lazy.length / 1024).toFixed(1) + 'KB')
