/**
 * node --test test/index-card-rocket-image.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')

global.wx = global.wx || {
  env: { USER_DATA_PATH: '/tmp' },
  getStorageSync() { return '' },
  setStorageSync() {},
  getFileSystemManager() {
    return {
      accessSync() { throw new Error('no file') },
      mkdirSync() {},
      writeFileSync() {},
      readFileSync() { throw new Error('no file') }
    }
  }
}

const { isDefaultRocketSrc } = require('../utils/util.js')
const {
  resolveIndexCardRocketImage,
  hydrateNetChangePayloadFromCard,
  findHomepageCardForNetChange
} = require('../subpackages/shared/utils/index-card-rocket-image.js')

test('hydrateNetChangePayloadFromCard：用首页任务卡字段覆盖 default 盖章', () => {
  const out = hydrateNetChangePayloadFromCard(
    { missionId: 'cz5', rocketImage: '火箭配置图/default.jpg', rocketName: '长征五号' },
    {
      rocketImage: 'https://cdn.example/cz5.jpg',
      rocketConfiguration: { name: 'Long March 5', full_name: 'Long March 5' },
      rocketName: 'Long March 5',
      _langPack: { rocketNameEn: 'Long March 5' }
    }
  )
  assert.equal(out.rocketImage, 'https://cdn.example/cz5.jpg')
  assert.equal(out.rocketConfiguration.name, 'Long March 5')
  assert.equal(out.rocketNameEn, 'Long March 5')
})

test('hydrateNetChangePayloadFromCard：无任务卡时保持原 payload', () => {
  const src = { missionId: 'x', rocketImage: '火箭配置图/default.jpg' }
  const out = hydrateNetChangePayloadFromCard(src, null)
  assert.equal(out.rocketImage, src.rocketImage)
  assert.equal(out.missionId, 'x')
})

test('resolveIndexCardRocketImage：已有非 default 配置图时不降级成占位图', () => {
  const src = resolveIndexCardRocketImage({
    rocketImage: 'https://cdn.example/long-march-5.jpg',
    rocketName: 'Long March 5',
    rocketNameEn: 'Long March 5',
    _langPack: { rocketNameEn: 'Long March 5' },
    rocketConfiguration: { name: 'Long March 5', full_name: 'Long March 5' }
  })
  assert.ok(src)
  assert.equal(isDefaultRocketSrc(src), false)
})

test('改期弹窗走首页任务卡解析，不再把 stamped default 直接当最终图', () => {
  const fs = require('fs')
  const path = require('path')
  const js = fs.readFileSync(
    path.join(__dirname, '../subpackages/shared/components/net-change-modal/index.js'),
    'utf8'
  )
  assert.match(js, /resolveIndexCardRocketImage/)
  assert.match(js, /hydrateNetChangePayloadFromCard/)
  assert.match(js, /findHomepageCardForNetChange/)
  assert.doesNotMatch(js, /if \(stamped && String\(stamped\)\.trim\(\)\) return/)
})

test('改期弹窗：点击我知道了必须同步关闭，不允许回到 setTimeout 延迟关', () => {
  const fs = require('fs')
  const path = require('path')
  const js = fs.readFileSync(
    path.join(__dirname, '../subpackages/shared/components/net-change-modal/index.js'),
    'utf8'
  )
  // onConfirm 方法体内：同步 _dismiss，无任何 timer
  const start = js.indexOf('onConfirm()')
  const end = js.indexOf('onClose()')
  assert.ok(start > 0 && end > start)
  const body = js.slice(start, end)
  assert.match(body, /this\._dismiss\(\)/)
  assert.doesNotMatch(body, /setTimeout/)
  assert.doesNotMatch(js, /_confirmTimer/)
  // show() 异常时必须解锁遮罩，防轮播永久锁死
  const showStart = js.indexOf('show(payload)')
  const showEnd = js.indexOf('resyncRocketImagesFromHomepage')
  const showBody = js.slice(showStart, showEnd)
  assert.match(showBody, /catch \(e\) \{\s*this\._setOverlayBlocking\(false\)/)
  // 按钮层级保险：wxss 中 .ncm-btn 提到 stack 顶层
  const wxss = fs.readFileSync(
    path.join(__dirname, '../subpackages/shared/components/net-change-modal/index.wxss'),
    'utf8'
  )
  const btnStart = wxss.indexOf('.ncm-btn {')
  assert.ok(btnStart > 0)
  const btnBody = wxss.slice(btnStart, wxss.indexOf('}', btnStart))
  assert.match(btnBody, /z-index:\s*2/)
})

test('改期弹窗 wxml：事件结构对齐 briefing，单卡不挂 swiper', () => {
  const fs = require('fs')
  const path = require('path')
  const wxml = fs.readFileSync(
    path.join(__dirname, '../subpackages/shared/components/net-change-modal/index.wxml'),
    'utf8'
  )
  // mask 只允许 catchtouchmove；catchtouchstart 属性会干扰 root-portal 内 tap 手势合成
  assert.doesNotMatch(wxml, /catchtouchstart="/)
  const maskLine = wxml.split('\n').find((l) => l.includes('ncm-mask'))
  assert.ok(maskLine && maskLine.includes('catchtouchmove'))
  // 单卡直渲分支存在（root-portal 内 swiper 手势层会吃掉相邻按钮 tap）
  assert.match(wxml, /wx:if="\{\{cardCount <= 1\}\}"/)
  assert.match(wxml, /ncm-single/)
  // 确认按钮绑定仍在
  assert.match(wxml, /catchtap="onConfirm"/)
  assert.match(wxml, /item.newTimeLabel/)
  assert.match(wxml, /newTimeUntrusted/)
})

test('findHomepageCardForNetChange：按任务名模糊对齐首页卡', () => {
  const card = {
    id: 'll2-cz5',
    missionName: '嫦娥七号',
    rocketName: '长征五号',
    rocketImage: 'https://cdn.example/cz5.jpg',
    rocketConfiguration: { name: 'Long March 5' },
    _langPack: { rocketNameEn: 'Long March 5', missionNameZh: '嫦娥七号' }
  }
  const pageData = { upcomingMissions: [card] }
  assert.equal(findHomepageCardForNetChange({ missionId: 'll2-cz5' }, pageData), card)
  assert.equal(
    findHomepageCardForNetChange({ missionName: '嫦娥七号探测器', rocketName: '长征五号' }, pageData),
    card
  )
  assert.equal(findHomepageCardForNetChange({ missionId: 'nope' }, pageData), null)
})
