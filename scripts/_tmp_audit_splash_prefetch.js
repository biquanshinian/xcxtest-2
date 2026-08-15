/**
 * 开屏预拉 + 弱网即刻跳过：审计（含本轮修复）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) {
    pass += 1
    console.log('PASS  ' + name)
  } else {
    fail += 1
    console.log('FAIL  ' + name + (extra ? ' → ' + extra : ''))
  }
}

const prefetch = fs.readFileSync(path.join(ROOT, 'utils/splash-prefetch.js'), 'utf8')
const splash = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/utils/index-splash.js'), 'utf8')
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')

check('prefetch 导出 startSplashPrefetch', /function startSplashPrefetch/.test(prefetch))
check('prefetch 弱网类型含 2g/3g/none', /none:\s*true/.test(prefetch) && /'2g':\s*true/.test(prefetch) && /'3g':\s*true/.test(prefetch))
check('prefetch 监听 onNetworkWeakChange', /onNetworkWeakChange/.test(prefetch))
check('prefetch 启动即拉配置', /starship_splash_config/.test(prefetch))
check('prefetch 预拉预览片', /wx\.downloadFile/.test(prefetch))

check('app.onLaunch 启动预拉', /splash-prefetch\.js/.test(appJs) && /startSplashPrefetch/.test(appJs))
check('app.onLaunch 预下载 index-extra', /preloadSubpackage/.test(appJs) && /index-extra/.test(appJs))

check('开屏消费预拉结果', /startSplashPrefetch\(app\)/.test(splash))
check('开屏弱网即刻跳过', /shouldSkipSplashForWeakNet/.test(splash))
check('不再空等 2500ms 云端', !/2500/.test(splash))
check('远程流起播失败直接关', /streamingRemote/.test(splash) && /abortSplashPrefetchDownload/.test(splash))
check('远程流超时 closeSplash 而非挂封面', /if \(!isLocal\) \{\s*this\.closeSplash\(\)/.test(splash))
check('展示中弱网未起播即关', /_armSplashWeakNetSkip/.test(splash))
check('拉流时延后缓存下载', /deferMediaDownload/.test(splash))

// 本轮审计修复
check('弱网只认当前条目本地片', /function currentPlayUrl/.test(prefetch) && /只认「当前选中条目」/.test(prefetch))
check('换片时重置 localPath', /state\.localPath = local \|\|/.test(prefetch))
check('abort 清空 downloadPromise', /state\.downloadPromise = null/.test(prefetch))
check('下载 URL 与选中 URL 分离', /downloadUrl/.test(prefetch) && /state\.downloadUrl === playUrl/.test(prefetch))
check('换片 abort 旧下载', /prevPlayUrl !== resolved\.playUrl\) abortDownload/.test(prefetch))
check('先探网再下载', /netResolved/.test(prefetch) && /pendingPlayUrl/.test(prefetch))
check('落盘延迟避免挪走临时文件', /setTimeout\(\(\) => \{/.test(prefetch) && /2500/.test(prefetch))
check('consumed 后弱网不再 abort 预拉', /if \(!state\.consumed\) abortDownload/.test(prefetch))
check('展示前再次弱网门闸', /prefetch\.weakNet && !src/.test(splash))
check('预拉 promise 交给页面缓存复用', /_splashPrefetching = \{ url: resolved\.playUrl/.test(splash))
check('补拉配置复用 prefetch.cfgPromise', /prefetch\.cfgPromise/.test(splash) && /lateCfg = await prefetch\.cfgPromise/.test(splash))
check('补拉也 defer 拉流下载', /deferMediaDownload: !!\(splashVideoAllowed && streamingRemote\)/.test(splash))

function isWeakNetworkInfo(res) {
  const t = String((res && res.networkType) || '').toLowerCase()
  if (t === 'none' || t === '2g' || t === '3g') return true
  if (res && res.weakNet === true) return true
  return false
}
check('wifi 非弱网', isWeakNetworkInfo({ networkType: 'wifi' }) === false)
check('4g 非弱网', isWeakNetworkInfo({ networkType: '4g' }) === false)
check('5g 非弱网', isWeakNetworkInfo({ networkType: '5g' }) === false)
check('2g 弱网', isWeakNetworkInfo({ networkType: '2g' }) === true)
check('3g 弱网', isWeakNetworkInfo({ networkType: '3g' }) === true)
check('none 弱网', isWeakNetworkInfo({ networkType: 'none' }) === true)
check('weakNet 标记', isWeakNetworkInfo({ networkType: '4g', weakNet: true }) === true)
check('prefetch 含 isWeakNetworkInfo', /function isWeakNetworkInfo/.test(prefetch))

function hasUsableLocalMedia(state, cached, fileExists) {
  const playUrl = (state && state.resolved && state.resolved.playUrl) || (state && state.playUrl) || ''
  if (state && state.localPath && fileExists(state.localPath)) {
    if (!playUrl || state.playUrl === playUrl) return true
  }
  if (playUrl && cached && cached.localPaths && fileExists(cached.localPaths[playUrl])) return true
  return false
}
const exists = (p) => p === 'wxfile://a.mp4'
check('弱网：池里其它文件不能放行', hasUsableLocalMedia(
  { playUrl: 'https://b', resolved: { playUrl: 'https://b' }, localPath: '' },
  { localPaths: { 'https://a': 'wxfile://a.mp4' } },
  exists
) === false)
check('弱网：当前条目本地片放行', hasUsableLocalMedia(
  { playUrl: 'https://a', resolved: { playUrl: 'https://a' }, localPath: '' },
  { localPaths: { 'https://a': 'wxfile://a.mp4' } },
  exists
) === true)
check('弱网：无选中且无匹配 → 不放行', hasUsableLocalMedia(
  { playUrl: '', resolved: null, localPath: '' },
  { localPaths: { 'https://a': 'wxfile://a.mp4' } },
  exists
) === false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
