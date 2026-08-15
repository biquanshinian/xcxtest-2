/**
 * 开屏倒计时卡 + 发射商 logo：禁止再等 400 家目录
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

const splash = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/utils/index-splash.js'), 'utf8')
const enrich = fs.readFileSync(path.join(ROOT, 'utils/upcoming-agency-logo-enrich.js'), 'utf8')
const listApi = fs.readFileSync(path.join(ROOT, 'utils/api-launch-list.js'), 'utf8')
const prefetch = fs.readFileSync(path.join(ROOT, 'utils/splash-prefetch.js'), 'utf8')
const wxml = fs.readFileSync(path.join(ROOT, 'subpackages/index-extra/components/index-splash/index.wxml'), 'utf8')

check('开屏不再等 400 家目录', !/enrichMissionsLaunchAgencyImages/.test(splash))
check('开屏单条 logo 补齐', /enrichOneMissionAgencyLogo/.test(splash))
check('开屏复用 upcoming 快照/在飞请求', /getUpcomingMissionsAny/.test(splash) && /findMissionInListSnapshots/.test(splash))
check('开屏本地列表秒出卡', /_collectSplashUpcomingLocals/.test(splash) && /showFromHit/.test(splash))
check('开屏 logo 用原链+本地缓存', /function splashLogoForDisplay/.test(splash) && /不强制 thumb/.test(splash))
check('空 logo 不覆盖已有图', /_mergeSplashMissionLogo/.test(splash))
check('单条 enrich 导入 override', /applyLaunchAgencyLogoOverridesToMission/.test(enrich))
check('logo 加载失败回退原链', /onSplashAgencyLogoError/.test(splash))
check('启动预热任务列表和 logo', /warmSplashMissionSideData/.test(prefetch) && /_splash_mission_hit/.test(prefetch))
check('启动预拉即将发射发射商 logo', /prefetchUpcomingAgencyLogos/.test(prefetch))
check('启动预热不拉 400 家目录', !/getBulkAgencyLogoMap/.test(prefetch))
check('按权重排序发射商 logo', /scoreAgencyLogoPriority/.test(enrich) && /splitLogoFetchWaves/.test(enrich))
check('按 id 缓存发射商 logo', /_agency_logo_by_id/.test(enrich) && /peekAgencyLogoById/.test(enrich))
check('胶囊 hydrate 用按 id 缓存', /hydrateMissionAgencyLogo/.test(fs.readFileSync(path.join(ROOT, 'utils/upcoming-agency-filter.js'), 'utf8')))
check('单条 enrich 有超时', /timeoutMs/.test(enrich) && /800/.test(enrich))
const oneFn = enrich.slice(
  enrich.indexOf('async function enrichOneMissionAgencyLogo'),
  enrich.indexOf('module.exports')
)
check('单条 enrich 不拉 getAgencies', /getAgencyDetail/.test(oneFn) && !/getBulkAgencyLogoMap/.test(oneFn) && !/getAgencies/.test(oneFn))
const listFn = enrich.slice(
  enrich.indexOf('async function enrichMissionsLaunchAgencyImages'),
  enrich.indexOf('async function enrichOneMissionAgencyLogo')
)
check('列表 enrich 不拉 400 家', /splitLogoFetchWaves/.test(listFn) && !/getBulkAgencyLogoMap/.test(listFn) && !/getAgencies/.test(listFn))
check('list API 导出 getUpcomingMissionsAny', /function getUpcomingMissionsAny/.test(listApi) && /peekUpcomingMissionsList/.test(listApi))
check('wxml logo 用 remote 落盘', /agencyLogoRemote/.test(wxml))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
