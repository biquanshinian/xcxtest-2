/**
 * One-shot: extract index splash wxml/wxss into index-extra component.
 */
const fs = require('fs')
const path = require('path')

const root = 'subpackages/index-extra/components/index-splash'
fs.mkdirSync(root, { recursive: true })

const wxml = fs.readFileSync('pages/index/index.wxml', 'utf8')
const wxss = fs.readFileSync('pages/index/index.wxss', 'utf8')

const startMark = '  <!-- 开屏动画 -->'
const endMark = '  <!-- 任务卡片长按 → 分享面板'
const i0 = wxml.indexOf(startMark)
const i1 = wxml.indexOf(endMark)
if (i0 < 0 || i1 < 0) throw new Error('wxml marks not found: ' + i0 + ' ' + i1)

let splashWxml = wxml.slice(i0, i1).replace(startMark, '').trim()

const compWxml = splashWxml
  .replace(/splashVisible/g, 'visible')
  .replace(/splashFading/g, 'fading')
  .replace(/splashConfig/g, 'config')
  .replace(/splashVideoReady/g, 'videoReady')
  .replace(/splashCountdown/g, 'countdown')
  .replace(/splashNotice/g, 'notice')
  .replace(/splashMissionCd/g, 'missionCd')
  .replace(/splashMission/g, 'mission')

fs.writeFileSync(path.join(root, 'index.wxml'), compWxml + '\n')

const lines = wxss.split(/\n/)
const css = lines.slice(2287, 2728).join('\n') + '\n'
fs.writeFileSync(path.join(root, 'index.wxss'), css)

fs.writeFileSync(
  path.join(root, 'index.json'),
  JSON.stringify({ component: true, styleIsolation: 'apply-shared' }, null, 2) + '\n'
)

const js = `/**
 * 首页开屏动画展示组件（index-extra）
 * 状态由页面持有，交互 triggerEvent 回页面（逻辑在 utils/index-splash.js）。
 */
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    visible: { type: Boolean, value: false },
    fading: { type: Boolean, value: false },
    config: { type: Object, value: {} },
    videoReady: { type: Boolean, value: false },
    countdown: { type: Number, value: 0 },
    notice: { type: Object, value: null },
    mission: { type: Object, value: null },
    missionCd: { type: Object, value: null },
    compactCdTop: { type: Number, value: 0 },
    compactCdHeight: { type: Number, value: 0 }
  },
  methods: {
    preventMove() {},
    onSplashVideoPlay(e) { this.triggerEvent('videoplay', e.detail) },
    onSplashVideoTimeUpdate(e) { this.triggerEvent('videotimeupdate', e.detail) },
    onSplashVideoLoadedMeta(e) { this.triggerEvent('videoloadedmeta', e.detail) },
    onSplashVideoEnded(e) { this.triggerEvent('videoended', e.detail) },
    onSplashVideoError(e) { this.triggerEvent('videoerror', e.detail) },
    onSplashSkipTap() { this.triggerEvent('skip') },
    onSplashMissionTap() { this.triggerEvent('missiontap') },
    onSplashAgencyLogoLoad(e) {
      const ds = (e && e.currentTarget && e.currentTarget.dataset) || {}
      this.triggerEvent('agencylogoload', { ...ds, detail: e && e.detail })
    }
  }
})
`
fs.writeFileSync(path.join(root, 'index.js'), js)

const newPageSplash = `  <!-- 开屏动画：index-extra 组件（wxml/wxss 不占主包） -->
  <index-splash
    id="indexSplash"
    visible="{{splashVisible}}"
    fading="{{splashFading}}"
    config="{{splashConfig}}"
    video-ready="{{splashVideoReady}}"
    countdown="{{splashCountdown}}"
    notice="{{splashNotice}}"
    mission="{{splashMission}}"
    mission-cd="{{splashMissionCd}}"
    compact-cd-top="{{compactCdTop}}"
    compact-cd-height="{{compactCdHeight}}"
    bind:videoplay="onSplashVideoPlay"
    bind:videotimeupdate="onSplashVideoTimeUpdate"
    bind:videoloadedmeta="onSplashVideoLoadedMeta"
    bind:videoended="onSplashVideoEnded"
    bind:videoerror="onSplashVideoError"
    bind:skip="onSplashSkipTap"
    bind:missiontap="onSplashMissionTap"
    bind:agencylogoload="onSplashAgencyLogoLoad"
  />

`
const newWxml = wxml.slice(0, i0) + newPageSplash + wxml.slice(i1)
fs.writeFileSync('pages/index/index.wxml', newWxml)

const newWxss = lines.slice(0, 2287).concat(lines.slice(2728)).join('\n')
fs.writeFileSync('pages/index/index.wxss', newWxss)

console.log('ok wxml', (compWxml.length / 1024).toFixed(1), 'wxss', (css.length / 1024).toFixed(1))
console.log('page wxml', (newWxml.length / 1024).toFixed(1), 'wxss', (newWxss.length / 1024).toFixed(1))
