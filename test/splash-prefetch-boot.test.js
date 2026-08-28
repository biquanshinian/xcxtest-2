/**
 * node --test test/splash-prefetch-boot.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const PREFETCH_PATH = path.resolve(__dirname, '../utils/splash-prefetch.js')
const LOCALE_PATH = path.resolve(__dirname, '../utils/locale.js')
const STORAGE_PATH = path.resolve(__dirname, '../utils/storage-sync-cache.js')

function installWx() {
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
          data: {
            enabled: true,
            mediaItems: [{ id: 'a', mediaUrl: 'https://cdn.example/splash.jpg', mediaType: 'image' }]
          }
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
        saveFile() {}
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
                    return Promise.resolve({ data: { enabled: true, mediaItems: [] } })
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
