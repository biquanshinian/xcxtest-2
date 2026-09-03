/**
 * node --test test/profile-shop-flag.test.js
 *
 * 我的页微信小店首页 store-home：后台开关即可，不必选商品
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function loadProfileShopMod() {
  const flagsPath = require.resolve('../utils/feature-flags.js')
  const shopPath = require.resolve('../utils/profile-shop.js')
  delete require.cache[flagsPath]
  delete require.cache[shopPath]
  return require('../utils/profile-shop.js')
}

function installWx({ main }) {
  global.wx = {
    cloud: {
      database() {
        return {
          collection(name) {
            return {
              doc(id) {
                return {
                  get() {
                    if (name === 'global_config' && id === 'main') {
                      if (!main) return Promise.reject(new Error('not found'))
                      return Promise.resolve({ data: main })
                    }
                    return Promise.reject(new Error('not found'))
                  }
                }
              },
              where() {
                return this
              },
              limit() {
                return this
              },
              get() {
                if (name === 'global_config') {
                  return Promise.resolve({ data: main ? [main] : [] })
                }
                return Promise.resolve({ data: [] })
              }
            }
          }
        }
      }
    }
  }
}

test('后台开关与一键过审，不必选商品', () => {
  const vue = read('admin-web/src/views/system/GlobalConfigPage.vue')
  assert.match(vue, /field: 'enableProfileShop'/)
  assert.match(vue, /AUDIT_FIELDS\s*=\s*\[[\s\S]*?'enableProfileShop'/)
  assert.match(vue, /enableProfileShop: data.enableProfileShop === true/)
  assert.match(vue, /store-home/)
  assert.doesNotMatch(vue, /form.enableProfileShop = true/)
  assert.doesNotMatch(vue, /profileShopItemId/)
})

test('我的页插入 store-home 在星际通行证下方', () => {
  const wxml = read('pages/profile/profile.wxml')
  const passIdx = wxml.indexOf('星际通行证')
  const titleIdx = wxml.indexOf('微信小店')
  const shopIdx = wxml.indexOf('<store-home')
  const dataIdx = wxml.indexOf('我的数据')
  assert.ok(passIdx >= 0 && titleIdx > passIdx && shopIdx > titleIdx && dataIdx > shopIdx)
  assert.match(wxml, /wx:if="\{\{showProfileShop\}\}"/)
  assert.match(wxml, /section-title-text">微信小店/)
  assert.match(wxml, /<wechat-shop-icon[\s>]/)
  const shopIcon = read('subpackages/profile-extra/components/wechat-shop-icon/index.wxml')
  assert.match(shopIcon, /src="\/subpackages\/profile-extra\/images\/ic-wechat-shop\.svg"/)
  const profileJson = read('pages/profile/profile.json')
  assert.match(profileJson, /wechat-shop-icon/)
  assert.match(wxml, /appid="\{\{profileShopAppid\}\}"/)
  assert.doesNotMatch(wxml, /<store-product[\s>]/)
  assert.doesNotMatch(wxml, /<store-coupon[\s>]/)
  assert.doesNotMatch(wxml, /<store-gift[\s>]/)
  const js = read('pages/profile/profile.js')
  assert.match(js, /showProfileShop: false/)
  assert.match(js, /loadProfileShopHome\(true\)/)
  const wxss = read('pages/profile/profile.wxss')
  assert.match(wxss, /justify-content:\s*center/)
  assert.match(wxml, /pf-shop-blend/)
  assert.doesNotMatch(wxss, /\.pf-shop-more/)
  assert.doesNotMatch(wxss, /\.pf-shop-label/)
})

test('云函数写入 enableProfileShop', () => {
  const src = read('cloudfunctions/adminGateway/index.js')
  assert.match(src, /patch.enableProfileShop = body.enableProfileShop === true/)
})

test('loadProfileShopHome：未开启 / 无 main 不展示', async () => {
  installWx({ main: { _id: 'main' } })
  const { loadProfileShopHome } = loadProfileShopMod()
  assert.equal(await loadProfileShopHome(true), null)

  installWx({ main: null })
  const mod2 = loadProfileShopMod()
  assert.equal(await mod2.loadProfileShopHome(true), null)
})

test('loadProfileShopHome：开启后用内置小店 AppID，不必选商品', async () => {
  installWx({
    main: {
      _id: 'main',
      enableProfileShop: true
    }
  })
  const { loadProfileShopHome, resolveStoreAppid } = loadProfileShopMod()
  const home = await loadProfileShopHome(true)
  assert.ok(home)
  assert.equal(home.appid, resolveStoreAppid({}))
  assert.ok(home.appid)
})

test('loadProfileShopHome：可被 main.profileShopAppid 覆盖', async () => {
  installWx({
    main: {
      _id: 'main',
      enableProfileShop: true,
      profileShopAppid: 'wxcustomshop'
    }
  })
  const { loadProfileShopHome } = loadProfileShopMod()
  const home = await loadProfileShopHome(true)
  assert.ok(home)
  assert.equal(home.appid, 'wxcustomshop')
})

test('buildProfileShopView', () => {
  const { buildProfileShopView } = loadProfileShopMod()
  assert.deepEqual(buildProfileShopView(''), { showProfileShop: false, profileShopAppid: '' })
  assert.deepEqual(buildProfileShopView('wxabc'), { showProfileShop: true, profileShopAppid: 'wxabc' })
})
