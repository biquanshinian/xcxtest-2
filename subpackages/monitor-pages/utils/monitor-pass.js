/**
 * subpackages/monitor-pages/utils/monitor-pass.js
 * 监控页「星链过境预报」整块逻辑（从 pages/monitor/monitor.js 拆出）
 *
 * 全部方法都是用户点击才触发（加载按钮 / 刷新 / 详情 / 地图），
 * 主包 monitor.js 通过 require.async + attachTo 委托加载，
 * 与 index 页的 index-vote / index-save-image 模式一致。
 *
 * 依赖说明：
 * - starlink-pass.js（轨道计算，含 satellite.js）已随本次拆分移入本分包，
 *   同分包同步 require，不存在历史上"跨分包 require.async 失败"的故障点。
 * - starlink-renderer.js 与主包 monitor.js 里 require.async 拿到的是同一模块实例
 *   （小程序模块缓存），共享已解析的 satrec 列表。
 */
const starlinkPass = require('./starlink-pass.js')
const starlinkRenderer = require('./starlink-renderer.js')
const storageCache = require('../../../utils/storage-sync-cache.js')
const { ROUTES, navigateTo } = require('../../../utils/routes.js')
const { gateCheck } = require('../../../utils/membership.js')

const STARLINK_TLE_CACHE_KEY = '_starlink_tle_cache'
// 缓存版本：v2 = NORAD 倒序取最新 400 颗；与 starlink-renderer / starlink-ar 三方共用同一 key，需同步
const STARLINK_TLE_CACHE_VER = 2
const STARLINK_TLE_CACHE_TTL = 6 * 60 * 60 * 1000
// 过境预报参与计算的卫星上限（NORAD 倒序取最新，低轨新批次是肉眼"星链列车"主体）
const STARLINK_PASS_MAX_SATS = 400
const PASS_DETAIL_STORAGE_KEY = '_starlink_pass_detail_payload'

const methods = {
  async _getPassLocation() {
    var app = getApp && getApp()
    if (app && typeof app.ensurePrivacyAuthorized === 'function') {
      var privacyRes = await app.ensurePrivacyAuthorized()
      if (privacyRes && privacyRes.ok === false) {
        return { ok: false, needsSetting: false, message: '请先同意隐私指引后再获取位置' }
      }
    }

    var settingRes = await new Promise(function (resolve) {
      wx.getSetting({ success: resolve, fail: function () { resolve(null) } })
    })
    if (!settingRes) {
      return { ok: false, needsSetting: false, message: '无法获取权限状态，请稍后重试' }
    }

    var authStatus = settingRes.authSetting['scope.userFuzzyLocation']
    if (authStatus === false) {
      return { ok: false, needsSetting: true, message: '请在设置中开启位置权限后重试' }
    }

    var locRes = await new Promise(function (resolve) {
      wx.getFuzzyLocation({
        type: 'wgs84',
        success: function (res) { resolve({ ok: true, data: res }) },
        fail: function (err) { resolve({ ok: false, err: err }) }
      })
    })

    if (!locRes || !locRes.ok || !locRes.data) {
      var errMsg = locRes && locRes.err && (locRes.err.errMsg || locRes.err.message) ? (locRes.err.errMsg || locRes.err.message) : ''
      var isPermDenied = errMsg.indexOf('auth deny') !== -1 || errMsg.indexOf('auth denied') !== -1 || errMsg.indexOf('permission denied') !== -1 || errMsg.indexOf('system permission') !== -1
      return {
        ok: false,
        needsSetting: authStatus === false || isPermDenied,
        message: isPermDenied ? '系统定位权限未开启，请在设置中允许' : (errMsg || '定位获取失败，请稍后重试')
      }
    }

    return { ok: true, data: locRes.data }
  },

  /** 用户点击「加载」按钮触发过境预报 */
  onLoadStarlinkPasses() {
    this.setData({ passReady: true })
    this.loadStarlinkPasses()
  },

  async loadStarlinkPasses() {
    var that = this
    // in-flight 去重：刷新按钮 / 权限回调可能并行触发，避免重复的 CPU 密集计算与云读
    if (this._passLoadInFlight) return
    this._passLoadInFlight = true
    this.setData({ passLoading: true, passNoLocation: false, passError: '', passList: [], passReady: true })

    try {
      var locState = await this._getPassLocation()
      if (!locState.ok) {
        that.setData({
          passLoading: false,
          passNoLocation: true,
          passLocation: '',
          passError: locState.message || '需要位置权限'
        })
        return
      }

      var observer = { lat: locState.data.latitude, lng: locState.data.longitude, alt: locState.data.altitude || 0 }
      that.data._passObserver = observer
      that.setData({
        passLocation: observer.lat.toFixed(2) + '°N, ' + observer.lng.toFixed(2) + '°E',
        passError: ''
      })

      // 3. 获取 TLE 数据（优先复用 Starlink 渲染器已加载的数据）
      //    统一选星策略：历元 7 天内、按 NORAD ID 倒序取最新 400 颗
      var tleData = []
      var tleStale = false // 有原始数据但历元全部超 7 天 / 源数据超 7 天未更新

      // 尝试从渲染器获取已解析的 satrec 列表（避免重复读取云数据库）
      var sharedSatrecs = starlinkRenderer.getSharedSatrecList()
      if (sharedSatrecs && sharedSatrecs.length > 0) {
        var sampled = starlinkPass.selectNewestSatrecs(sharedSatrecs, STARLINK_PASS_MAX_SATS)
        tleData = sampled.map(function (s) { return { _satrec: s.satrec, name: s.name } })
        if (tleData.length === 0) {
          tleStale = true
          // 内存/本地缓存里的星历元全部超龄：清掉共享数据与缓存，
          // 让下面的 loadData 绕过 6h 缓存直接回源云端（云端可能已有新数据）
          if (typeof starlinkRenderer.resetSharedData === 'function') {
            starlinkRenderer.resetSharedData()
          }
        }
      }

      // 如果渲染器没有数据，通过渲染器的 loadData 再尝试一次
      if (tleData.length === 0 && typeof starlinkRenderer.loadData === 'function') {
        try {
          await starlinkRenderer.loadData()
          var retryList = starlinkRenderer.getSharedSatrecList()
          if (retryList && retryList.length > 0) {
            var retrySampled = starlinkPass.selectNewestSatrecs(retryList, STARLINK_PASS_MAX_SATS)
            tleData = retrySampled.map(function (s) { return { _satrec: s.satrec, name: s.name } })
            tleStale = tleData.length === 0
          }
        } catch (e) {
          console.warn('[Pass] starlinkRenderer.loadData retry failed:', e)
        }
      }

      // 最后回退：从本地缓存或云数据库直接读 TLE 文本
      if (tleData.length === 0) {
        try {
          // 该 key 由 starlink-renderer / starlink-ar 用 wx.setStorageSync 直写，
          // 不能走 storage-sync-cache 内存层（首读后驻留，会读到会话内的旧值）
          var cached = wx.getStorageSync(STARLINK_TLE_CACHE_KEY)
          if (cached && cached.ver === STARLINK_TLE_CACHE_VER && cached.data && Date.now() - cached.ts < STARLINK_TLE_CACHE_TTL) {
            var rawList = []
            var rawData = cached.data
            if (typeof rawData === 'string') {
              var lines = rawData.split('\n').filter(function (l) { return l.trim() !== '' })
              for (var i = 0; i + 2 < lines.length; i += 3) {
                rawList.push({ name: lines[i].trim(), line1: lines[i + 1].trim(), line2: lines[i + 2].trim() })
              }
            } else if (Array.isArray(rawData)) {
              rawList = rawData
            }
            if (rawList.length > 0) {
              tleData = starlinkPass.selectNewestTLEs(rawList, STARLINK_PASS_MAX_SATS)
              tleStale = tleData.length === 0
            }
          }
        } catch (e) {}
      }

      if (tleData.length === 0) {
        try {
          var db = wx.cloud.database()
          var shardIndex = 0
          var allLines = []
          // 先读 shard0 判断格式
          var shard0Res = await db.collection('starlink_tle').where({ shardIndex: 0 }).limit(1).get()
          if (shard0Res.data && shard0Res.data.length > 0) {
            var shard0 = shard0Res.data[0]
            if (shard0.updatedAtMs && Date.now() - shard0.updatedAtMs > starlinkPass.TLE_MAX_AGE_MS) {
              tleStale = true
            }
            if (shard0.shardCount) {
              // 新分片格式：并行读取所有分片
              var shardPromises = [Promise.resolve(shard0.data || '')]
              for (var si = 1; si < shard0.shardCount; si++) {
                shardPromises.push(
                  db.collection('starlink_tle').where({ shardIndex: si }).limit(1).get()
                    .then(function (res) { return res.data.length > 0 ? res.data[0].data : '' })
                    .catch(function () { return '' })
                )
              }
              var shardArr = await Promise.all(shardPromises)
              var mergedTle = shardArr.filter(Boolean).join('\n')
              var mLines = mergedTle.split('\n').filter(function (l) { return l.trim() !== '' })
              for (var mi = 0; mi + 2 < mLines.length; mi += 3) {
                allLines.push({ name: mLines[mi].trim(), line1: mLines[mi + 1].trim(), line2: mLines[mi + 2].trim() })
              }
            } else if (shard0.data && typeof shard0.data === 'string') {
              // 旧格式循环读取
              var oldLines = shard0.data.split('\n').filter(function (l) { return l.trim() !== '' })
              for (var oi = 0; oi + 2 < oldLines.length; oi += 3) {
                allLines.push({ name: oldLines[oi].trim(), line1: oldLines[oi + 1].trim(), line2: oldLines[oi + 2].trim() })
              }
              shardIndex = 1
              while (shardIndex < 10) {
                var nextRes = await db.collection('starlink_tle').where({ shardIndex: shardIndex }).limit(1).get()
                if (!nextRes.data || nextRes.data.length === 0) break
                var nextShard = nextRes.data[0]
                if (nextShard.data && typeof nextShard.data === 'string') {
                  var nLines = nextShard.data.split('\n').filter(function (l) { return l.trim() !== '' })
                  for (var ni = 0; ni + 2 < nLines.length; ni += 3) {
                    allLines.push({ name: nLines[ni].trim(), line1: nLines[ni + 1].trim(), line2: nLines[ni + 2].trim() })
                  }
                }
                shardIndex++
              }
            }
          }
          tleData = starlinkPass.selectNewestTLEs(allLines, STARLINK_PASS_MAX_SATS)
          if (allLines.length > 0 && tleData.length === 0) tleStale = true
          if (tleData.length > 0) {
            storageCache.persistAsync(STARLINK_TLE_CACHE_KEY, { data: tleData, ts: Date.now(), ver: STARLINK_TLE_CACHE_VER })
          }
        } catch (e) {
          console.error('[Pass] TLE cloud load error:', e)
        }
      }

      if (tleData.length === 0) {
        that.setData({
          passLoading: false,
          passList: [],
          passError: tleStale
            ? '星链轨道数据已陈旧（超 7 天未更新），暂无法计算过境，请稍后再试'
            : '星链轨道数据暂时无法获取，请检查网络后重试'
        })
        return
      }

      if (!starlinkPass || typeof starlinkPass.predictPasses !== 'function') {
        that.setData({ passLoading: false, passError: '过境计算模块异常，请重启小程序' })
        return
      }
      // 优先分片异步版：每 20 颗卫星让出一次主线程，避免长时间阻塞 UI
      var passes = typeof starlinkPass.predictPassesAsync === 'function'
        ? await starlinkPass.predictPassesAsync(tleData, observer, 24)
        : starlinkPass.predictPasses(tleData, observer, 24)

      var formatted = passes.slice(0, 10).map(function (p, idx) {
        var d = new Date(p.startTime)
        var h = d.getHours()
        var m = d.getMinutes()
        return {
          idx: idx,
          startTimeStr: (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m,
          maxElev: Math.round(p.maxElev),
          startDirection: p.startDirection,
          endDirection: p.endDirection,
          durationMin: Math.round(p.duration / 60),
          brightness: p.brightness,
          brightnessText: p.brightnessText,
          trainCount: p.trainCount || 1
        }
      })
      that.setData({ passList: formatted, passLoading: false, passNoLocation: false })
    } catch (err) {
      console.error('[Pass] error:', err)
      var errMsg = (err && (err.message || err.errMsg)) || ''
      var hasLocation = !!(that.data._passObserver || that.data.passLocation)
      var displayError = '过境预报加载失败，请稍后重试'
      if (errMsg.indexOf('No TLE') !== -1 || errMsg.indexOf('satellite') !== -1) {
        displayError = '星链轨道数据异常，请稍后重试'
      } else if (errMsg.indexOf('require') !== -1 || errMsg.indexOf('module') !== -1) {
        displayError = '过境计算模块加载失败，请退出重进'
      }
      that.setData({
        passLoading: false,
        passNoLocation: !hasLocation,
        passError: displayError
      })
    } finally {
      this._passLoadInFlight = false
    }
  },

  requestPassLocation() {
    var that = this
    wx.getSetting({
      success: function (res) {
        var authStatus = res.authSetting['scope.userFuzzyLocation']
        if (authStatus === false) {
          wx.showModal({
            title: '需要位置权限',
            content: '过境预报需要您的位置来计算可见卫星，请在设置中开启位置权限',
            confirmText: '去设置',
            cancelText: '取消',
            success: function (modalRes) {
              if (!modalRes.confirm) return
              wx.openSetting({
                success: function (settingRes) {
                  if (settingRes.authSetting['scope.userFuzzyLocation']) {
                    that.loadStarlinkPasses()
                  } else {
                    that.setData({
                      passNoLocation: true,
                      passLocation: '',
                      passError: '未开启位置权限，暂时无法计算过境预报'
                    })
                  }
                },
                fail: function () {
                  that.setData({
                    passNoLocation: true,
                    passLocation: '',
                    passError: '打开设置失败，请稍后重试'
                  })
                }
              })
            }
          })
          return
        }

        // authStatus 为 undefined 或 true，直接调用 loadStarlinkPasses（其内部会 getFuzzyLocation）
        that.loadStarlinkPasses()
      },
      fail: function () {
        that.setData({
          passNoLocation: true,
          passLocation: '',
          passError: '无法获取权限状态，请稍后重试'
        })
      }
    })
  },

  refreshPasses() {
    this.loadStarlinkPasses()
  },

  openPassDetail() {
    if (!this.data.passReady) {
      this.onLoadStarlinkPasses()
      return
    }
    if (this.data.passLoading) return
    if (this.data.passNoLocation || this.data.passError) {
      if (this.data.passNoLocation) this.requestPassLocation()
      else this.refreshPasses()
      return
    }

    try {
      wx.setStorageSync(PASS_DETAIL_STORAGE_KEY, {
        passList: this.data.passList || [],
        passLocation: this.data.passLocation || '',
        observer: this.data._passObserver || null,
        updatedAt: Date.now()
      })
    } catch (e) {}

    navigateTo(ROUTES.STARLINK_PASS_DETAIL)
  },

  async openPassMap() {
    if (this._gateChecking) return
    this._gateChecking = true
    let allowed = false
    try {
      allowed = await gateCheck('starlink_pro', '24小时过境预报')
    } finally {
      this._gateChecking = false
    }
    if (!allowed) return

    const passList = this.data.passList || []
    const firstPass = passList[0]
    if (!firstPass) {
      wx.showToast({ title: '暂无可用过境数据', icon: 'none' })
      return
    }
    const observer = this.data._passObserver || {}
    const encodedPassList = encodeURIComponent(JSON.stringify(passList.slice(0, 10)))
    const query = [
      'startTimeStr=' + encodeURIComponent(firstPass.startTimeStr || ''),
      'maxElev=' + encodeURIComponent(firstPass.maxElev || 0),
      'startDirection=' + encodeURIComponent(firstPass.startDirection || ''),
      'endDirection=' + encodeURIComponent(firstPass.endDirection || ''),
      'durationMin=' + encodeURIComponent(firstPass.durationMin || 0),
      'brightnessText=' + encodeURIComponent(firstPass.brightnessText || ''),
      'trainCount=' + encodeURIComponent(firstPass.trainCount || 1),
      'lat=' + encodeURIComponent(observer.lat || ''),
      'lng=' + encodeURIComponent(observer.lng || ''),
      'locationText=' + encodeURIComponent(this.data.passLocation || ''),
      'passList=' + encodedPassList
    ].join('&')
    wx.navigateTo({ url: ROUTES.PASS_MAP + '?' + query })
  }
}

/** 把过境预报方法挂到页面实例上（覆盖主包里的委托占位方法） */
function attachTo(page) {
  Object.keys(methods).forEach((name) => {
    page[name] = methods[name]
  })
  page.__passAttached = true
}

module.exports = { attachTo, methods }
