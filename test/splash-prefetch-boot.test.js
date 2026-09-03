/**
 * node --test test/splash-prefetch-boot.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const PREFETCH_PATH = path.resolve(__dirname, '../subpackages/index-extra/utils/splash-prefetch.js')
const LOCALE_PATH = path.resolve(__dirname, '../utils/locale.js')
const STORAGE_PATH = path.resolve(__dirname, '../utils/storage-sync-cache.js')

function installWx(opts) {
  const cloudDoc = (opts && opts.cloudDoc) || { enabled: true, mediaItems: [] }
  const cacheDoc =
    opts && Object.prototype.hasOwnProperty.call(opts, 'cacheDoc')
      ? opts.cacheDoc
      : {
          enabled: true,
          mediaItems: [{ id: 'a', mediaUrl: 'https://cdn.example/splash.jpg', mediaType: 'image' }]
        }
  const calls = {
    getStorageSync: 0,
    getStorage: 0,
    downloadFile: 0,
    setStorageSync: 0,
    getImageInfo: 0,
    accessSync: 0,
    callFunction: 0
  }
  global.wx = {
    getStorageSync() {
      calls.getStorageSync += 1
      return null
    },
    getStorage({ success }) {
      calls.getStorage += 1
      success &&
        success({
          data: cacheDoc
        })
    },
    setStorage() {},
    setStorageSync() {
      calls.setStorageSync += 1
    },
    downloadFile() {
      calls.downloadFile += 1
    },
    getImageInfo() {
      calls.getImageInfo += 1
    },
    getNetworkType({ success }) {
      success && success({ networkType: 'wifi' })
    },
    getFileSystemManager() {
      return {
        accessSync() {
          calls.accessSync += 1
          throw new Error('missing')
        },
        saveFile() {},
        removeSavedFile() {}
      }
    },
    cloud: {
      database() {
        return {
          collection() {
            return {
              doc() {
                return {
                  get() {
                    return Promise.resolve({ data: cloudDoc })
                  }
                }
              }
            }
          }
        }
      },
      callFunction() {
        calls.callFunction += 1
        return Promise.resolve({ result: {} })
      }
    }
  }
  return calls
}

function loadPrefetch() {
  delete require.cache[PREFETCH_PATH]
  return require(PREFETCH_PATH)
}

test('startSplashPrefetch 不在 onLaunch 路径打同步 storage / 下载 / accessSync / 云函数', async () => {
  const calls = installWx()
  const { startSplashPrefetch } = loadPrefetch()
  const app = {}
  const state = startSplashPrefetch(app)
  assert.equal(calls.getStorageSync, 0)
  assert.equal(calls.downloadFile, 0)
  assert.equal(calls.accessSync, 0)
  assert.equal(calls.getImageInfo, 0)
  assert.equal(calls.callFunction, 0)
  assert.ok(state.cachePromise)
  await state.cachePromise
  assert.ok(calls.getStorage >= 1)
  assert.equal(calls.downloadFile, 0)
  assert.equal(calls.accessSync, 0)
  assert.equal(calls.getImageInfo, 0)
  assert.equal(calls.callFunction, 0)
  assert.ok(state.picked)
  assert.match(String(state.playUrl || ''), /cdn\.example\/splash\.jpg/)
})

test('getContentLang 在偏好未预热时不 getStorageSync，默认中文', () => {
  const calls = installWx()
  delete require.cache[STORAGE_PATH]
  delete require.cache[LOCALE_PATH]
  const locale = require(LOCALE_PATH)
  locale.invalidateContentLangCache()
  assert.equal(locale.getContentLang(), 'zh')
  assert.equal(calls.getStorageSync, 0)
})

test('normalizeItems：显式空 mediaItems 不回落顶层 mediaUrl', () => {
  installWx()
  const { normalizeItems } = loadPrefetch()
  assert.deepEqual(
    normalizeItems({
      enabled: true,
      mediaItems: [],
      mediaUrl: 'https://cdn.example/old.jpg'
    }),
    []
  )
  const legacy = normalizeItems({
    mediaUrl: 'https://cdn.example/old.jpg',
    mediaType: 'image'
  })
  assert.equal(legacy.length, 1)
  assert.match(String(legacy[0].mediaUrl), /cdn\.example\/old\.jpg/)
})

test('云端空媒体池覆盖本地缓存且取消预选片', async () => {
  installWx()
  const stored = []
  global.wx.setStorage = ({ key, data }) => {
    stored.push({ key, data })
  }
  const { startSplashPrefetch } = loadPrefetch()
  const state = startSplashPrefetch({})
  await state.cachePromise
  assert.ok(state.picked)
  await state.cfgPromise
  assert.equal(state.picked, null)
  assert.equal(state.playUrl, '')
  const last = stored.filter((s) => s.key === '_splash_screen_cache').pop()
  assert.ok(last)
  assert.deepEqual(last.data.mediaItems, [])
  assert.equal(last.data.mediaUrl || '', '')
})

test('云端条目无 mediaUrl 视为空池，覆盖本地旧片', async () => {
  installWx({
    cloudDoc: { enabled: true, mediaItems: [{ id: 'broken' }], mediaUrl: 'https://cdn.example/stale.jpg' }
  })
  const stored = []
  global.wx.setStorage = ({ key, data }) => {
    stored.push({ key, data })
  }
  const { startSplashPrefetch } = loadPrefetch()
  const state = startSplashPrefetch({})
  await state.cfgPromise
  assert.equal(state.picked, null)
  const last = stored.filter((s) => s.key === '_splash_screen_cache').pop()
  assert.ok(last)
  assert.deepEqual(last.data.mediaItems, [])
  assert.equal(last.data.mediaUrl || '', '')
})

test('关闭开屏时缓存不含旧 mediaItems', async () => {
  installWx({
    cloudDoc: {
      enabled: false,
      mediaItems: [{ id: 'a', mediaUrl: 'https://cdn.example/splash.jpg' }]
    }
  })
  const stored = []
  global.wx.setStorage = ({ key, data }) => {
    stored.push({ key, data })
  }
  const { startSplashPrefetch } = loadPrefetch()
  const state = startSplashPrefetch({})
  await state.cfgPromise
  assert.equal(state.picked, null)
  const last = stored.filter((s) => s.key === '_splash_screen_cache').pop()
  assert.ok(last)
  assert.equal(last.data.enabled, false)
  assert.ok(!last.data.mediaItems || !last.data.mediaItems.length)
})
