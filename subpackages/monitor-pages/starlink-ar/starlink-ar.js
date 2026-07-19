var satellite = require('../libs/satellite.min.js');
var starlinkPass = require('../../../utils/starlink-pass.js');
var magDeclination = require('./mag-declination.js');

var DEG2RAD = Math.PI / 180;
var RAD2DEG = 180 / Math.PI;
var HFOV = 60; // 水平视场角(度)；垂直视场角按画布宽高比推导
var MAX_SATS = 400;
var TLE_KEY = '_starlink_tle_cache';
// 缓存版本：v2 = NORAD 倒序取最新 400 颗的选择策略；旧版缓存（无 ver）直接作废
var TLE_CACHE_VER = 2;
var TLE_CACHE_TTL = 6 * 60 * 60 * 1000;
var CANVAS_INIT_MAX_RETRY = 25; // Canvas 初始化 200ms 重试上限
var DIAG_THROTTLE_MS = 500;     // 传感器诊断字段 setData 节流
var TRAIL_STEPS = 5;       // 尾迹未来步数
var TRAIL_INTERVAL = 12;   // 每步间隔(秒)
// 轨道推算节流：卫星角位置每 200ms 重算一次即可（视觉上无差异），
// RAF 每帧只做「缓存角位置 → 屏幕投影」，罗盘/俯仰响应仍是满帧率
var PROPAGATE_INTERVAL_MS = 200;
var TRAIN_THRESHOLD = 3;   // 星链列车：角距阈值(度)
var TRAIN_MIN_COUNT = 3;   // 至少几颗才算列车
var TAP_RADIUS = 30;       // 点击卫星的判定半径(px)

function normalizeHeading(heading) {
  while (heading < 0) heading += 360;
  while (heading >= 360) heading -= 360;
  return heading;
}

function toDegreesIfNeeded(value) {
  if (typeof value !== 'number' || isNaN(value)) return null;
  return value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** 两方位角的最小圆周差（0~180） */
function circularDiff(a, b) {
  var d = Math.abs(normalizeHeading(a) - normalizeHeading(b)) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * 由 deviceMotion 三角（度）构建完整旋转矩阵，求「后置摄像头指向」在地理系下的方位/仰角。
 *
 * 背景：wx.onCompassChange 的 direction 在 Android 是"手机平放"参考系的方位，
 * 竖起手机（AR 姿势）会 180° 翻转、接近竖直时数值退化；iOS 底层 CoreLocation
 * 自带姿态补偿无此问题。本函数等价原生 Android AR 的 remapCoordinateSystem 做法，
 * 用完整姿态矩阵直接算摄像头轴的方位角，任何俯仰下都不退化。
 *
 * mirror=true 对应实测的安卓约定（alpha 顺时针增即罗盘向，beta/gamma 与 W3C 相反）；
 * mirror=false 为 W3C DeviceOrientation 标准约定。地理系：X=东 Y=北 Z=天。
 */
function computeMotionOrientation(alphaDeg, betaDeg, gammaDeg, mirror) {
  var a = (mirror ? (360 - alphaDeg) : alphaDeg) * DEG2RAD;
  var b = (mirror ? -betaDeg : betaDeg) * DEG2RAD;
  var g = (mirror ? -gammaDeg : gammaDeg) * DEG2RAD;
  var cA = Math.cos(a), sA = Math.sin(a);
  var cB = Math.cos(b), sB = Math.sin(b);
  var cG = Math.cos(g), sG = Math.sin(g);
  // R = Rz(a)·Rx(b)·Ry(g)；设备 -Z 轴（后置摄像头）在地理系中的向量
  var zx = sG * cA + sB * cG * sA;
  var zy = sG * sA - sB * cG * cA;
  var zz = cB * cG;
  return {
    camAz: normalizeHeading(Math.atan2(-zx, -zy) * RAD2DEG),
    camEl: Math.asin(clamp(-zz, -1, 1)) * RAD2DEG,
    // 设备 +Y 轴（机头）方位：平放时与罗盘 direction 同义，用于约定投票
    topAz: normalizeHeading(Math.atan2(-cB * sA, cB * cA) * RAD2DEG)
  };
}

/**
 * 方位角转方向文字
 */
function azimuthToDir(az) {
  var dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  var idx = Math.round(az / 45) % 8;
  return dirs[idx];
}

Page({
  data: {
    azimuth: 0,
    elevation: 0,
    compassDir: 'N',
    visibleCount: 0,
    showCalibrate: true,
    bestDir: '',
    bestAz: 0,
    // 卫星详情卡片
    showSatCard: false,
    satCardData: null,
    satCardX: 0,
    satCardY: 0,
    // 截图预览
    capturePreview: '',
    // 罗盘不可用降级（隐藏卫星叠点层，显示占位提示）
    compassUnavailable: false,
    // 定位失败（不回退默认坐标，显示重试引导）
    locationFailed: false,
    locationErrMsg: '',
    // 返回按钮 top（px），按胶囊/状态栏适配
    backBtnTop: 44,
    // AR 诊断面板
    arDiagCollapsed: true,
    arDiag: {
      system: '待初始化',
      camera: '待初始化',
      location: '待初始化',
      tle: '待初始化',
      overlay: '待初始化',
      mergeCanvas: '待初始化',
      compass: '待启动',
      motion: '待启动',
      headingSource: '--',
      declination: '--',
      compassRaw: '--',
      compassAccuracy: '--',
      motionHeading: '--',
      motionConv: '--',
      motionAlpha: '--',
      motionBeta: '--',
      motionGamma: '--',
      motionPitch: '--',
      lastCompassAt: '--',
      lastMotionAt: '--',
      lastError: ''
    },
    arDiagLogs: []
  },

  // 内部状态
  _heading: 0,
  _pitch: 0,
  _smoothHeading: 0,
  _smoothPitch: 0,
  _isAndroid: false,
  _pageVisible: false,
  _destroyed: false,
  _bootstrapReady: false,
  _startingAR: false,
  _hasLocation: false,
  _declination: 0,           // 磁偏角修正（度，东偏为正）
  _lat: 0,
  _lng: 0,
  _alt: 0,
  _tleList: [],
  _satRecs: [],
  _canvas: null,
  _ctx: null,
  _rafId: null,
  _canvasW: 0,
  _canvasH: 0,
  _running: false,
  _visibleSatScreenPos: [],  // 当前帧可见卫星的屏幕坐标（用于点击检测）
  _prevVisibleSet: {},        // 上一帧可见卫星集合（用于震动检测）
  _lastVibrateTime: 0,        // 上次震动时间（防抖）
  _cameraCtx: null,            // 相机上下文
  _mergeCanvas: null,          // 合成画布
  _mergeCtx: null,             // 合成画布上下文
  _capturing: false,           // 截图进行中标志
  _calibrateTimer: null,       // 校准提示定时器
  _captureTimer: null,         // 截图超时定时器
  _compassWatchdog: null,      // 罗盘首包看门狗
  // Android 姿态矩阵朝向（iOS 罗盘自带姿态补偿，不需要）
  _motionConvention: 'mirror', // 'mirror'=实测安卓约定 / 'web'=W3C 标准约定
  _convDecided: false,         // 约定是否已判定（投票或读缓存）
  _convVotes: null,            // { mirror, web } 投票计数
  _motionHeadingAt: 0,         // 最近一次矩阵朝向生效时间戳
  _lastCompassRaw: null,       // 最近罗盘原始 direction（磁北），用于约定投票
  _lastCompassRawAt: 0,
  _badAccuracyCount: 0,        // 罗盘精度差的连续包计数
  // 视场投影参数（_initCanvas 后按画布宽高比更新）
  _halfHFov: HFOV / 2,
  _halfVFov: HFOV / 2,
  _tanHalfHFov: Math.tan((HFOV / 2) * Math.PI / 180),
  _tanHalfVFov: Math.tan((HFOV / 2) * Math.PI / 180),
  // 诊断字段节流
  _pendingDiag: null,
  _lastDiagFlushAt: 0,

  /* ========== 生命周期 ========== */

  onLoad: function () {
    var that = this;
    // 记录卫星追踪使用（成就统计）
    try {
      var behaviorStats = require('../../../utils/behavior-stats.js');
      behaviorStats.trackSatelliteAR();
    } catch (ex) {}
    var pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    that.setData({ isDirectEntry: pages.length <= 1 });
    // 返回按钮 top 按胶囊/状态栏高度适配（替代固定 88rpx）
    var backBtnTop = 44;
    try {
      var menuRect = wx.getMenuButtonBoundingClientRect();
      if (menuRect && menuRect.top > 0) {
        backBtnTop = menuRect.top;
      } else {
        var winInfo = wx.getWindowInfo();
        backBtnTop = (winInfo.statusBarHeight || 40) + 4;
      }
    } catch (e) {
      try { backBtnTop = (wx.getWindowInfo().statusBarHeight || 40) + 4; } catch (e2) { }
    }
    that.setData({ backBtnTop: backBtnTop });
    // 平台检测
    var deviceInfo = wx.getDeviceInfo();
    var appBaseInfo = wx.getAppBaseInfo();
    that._isAndroid = (deviceInfo.platform === 'android');
    // Android 姿态约定：优先用本机上次投票结果，本次会话仍继续校验
    that._convVotes = { mirror: 0, web: 0 };
    if (that._isAndroid) {
      try {
        var storedConv = wx.getStorageSync('_ar_motion_conv');
        if (storedConv === 'mirror' || storedConv === 'web') that._motionConvention = storedConv;
      } catch (e) { }
    }
    that._setDiag({
      system: [deviceInfo.brand || '', deviceInfo.model || '', deviceInfo.platform || '', appBaseInfo.SDKVersion || ''].filter(Boolean).join(' / '),
      camera: '相机上下文已创建',
      motionConv: that._isAndroid ? that._motionConvention : '--（iOS 用罗盘）'
    });
    that._pushDiagLog('系统初始化完成');
    // 创建相机上下文
    that._cameraCtx = wx.createCameraContext();
    // 定位成功后的后续初始化链（定位失败重试时复用）
    that._bootstrapAfterLocation = function () {
      that._loadTLE(function () {
        that._initCanvas(function () {
          that._initMergeCanvas(function () {
            if (that._destroyed) return;
            that._bootstrapReady = true;
            that._pushDiagLog('AR 初始化资源已就绪');
            that._maybeStartAR();
          });
        });
      });
    };
    that._getLocation(that._bootstrapAfterLocation);
    // 5秒后隐藏校准提示
    that._calibrateTimer = setTimeout(function () {
      that._calibrateTimer = null;
      that.setData({ showCalibrate: false });
    }, 5000);
  },

  onShow: function () {
    this._pageVisible = true;
    this._maybeStartAR();
  },

  onHide: function () {
    this._pageVisible = false;
    this._stopAR();
  },

  requestCameraPermission: function () {
    wx.openSetting({});
  },

  onUnload: function () {
    this._pageVisible = false;
    this._destroyed = true;
    if (this._calibrateTimer) {
      clearTimeout(this._calibrateTimer);
      this._calibrateTimer = null;
    }
    if (this._captureTimer) {
      clearTimeout(this._captureTimer);
      this._captureTimer = null;
    }
    this._stopAR();
  },

  _setDiag: function (patch) {
    var update = {};
    patch = patch || {};
    Object.keys(patch).forEach(function (key) {
      update['arDiag.' + key] = patch[key];
    });
    if (Object.keys(update).length > 0) {
      this.setData(update);
    }
  },

  /**
   * 传感器回调专用的诊断更新：仅诊断面板展开时 setData，且 500ms 节流。
   * 面板收起时零 setData（这是罗盘/姿态高频回调的最大卡顿源）。
   */
  _setDiagThrottled: function (patch) {
    if (!patch) return;
    var pending = this._pendingDiag || {};
    for (var key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        pending[key] = patch[key];
      }
    }
    this._pendingDiag = pending;
    if (this.data.arDiagCollapsed) return;
    var now = Date.now();
    if (now - this._lastDiagFlushAt < DIAG_THROTTLE_MS) return;
    this._lastDiagFlushAt = now;
    this._pendingDiag = null;
    this._setDiag(pending);
  },

  _pushDiagLog: function (message) {
    var time = new Date();
    var hh = String(time.getHours()).padStart(2, '0');
    var mm = String(time.getMinutes()).padStart(2, '0');
    var ss = String(time.getSeconds()).padStart(2, '0');
    var line = hh + ':' + mm + ':' + ss + ' ' + message;
    var logs = (this.data.arDiagLogs || []).slice(0, 7);
    logs.unshift(line);
    this.setData({ arDiagLogs: logs.slice(0, 8) });
  },

  toggleArDiagPanel: function () {
    var willOpen = this.data.arDiagCollapsed;
    this.setData({ arDiagCollapsed: !willOpen });
    // 展开时把节流期间积累的诊断字段一次性刷出
    if (willOpen && this._pendingDiag) {
      var pending = this._pendingDiag;
      this._pendingDiag = null;
      this._lastDiagFlushAt = Date.now();
      this._setDiag(pending);
    }
  },

  _maybeStartAR: function () {
    var that = this;
    if (!that._pageVisible || !that._bootstrapReady || that._running || that._startingAR) {
      return;
    }

    that._startingAR = true;
    that._setDiag({ compass: '等待隐私授权...', motion: '等待隐私授权...' });

    var app = getApp && getApp();
    var startSensors = function () {
      setTimeout(function () {
        that._startingAR = false;
        if (!that._pageVisible || !that._bootstrapReady || that._running) return;
        that._startAR();
      }, that._isAndroid ? 80 : 260);
    };

    if (!app || typeof app.ensurePrivacyAuthorized !== 'function') {
      startSensors();
      return;
    }

    app.ensurePrivacyAuthorized().then(function (privacyRes) {
      if (privacyRes && privacyRes.ok === false) {
        that._startingAR = false;
        that._setDiag({ compass: '隐私授权未完成', motion: '隐私授权未完成' });
        that._pushDiagLog('隐私授权未完成，未启动传感器');
        return;
      }
      that._pushDiagLog('隐私授权完成，准备启动传感器');
      startSensors();
    }).catch(function () {
      that._startingAR = false;
      that._setDiag({ compass: '隐私授权失败', motion: '隐私授权失败', lastError: '隐私授权校验失败，请稍后重试' });
      that._pushDiagLog('隐私授权校验失败，未启动传感器');
    });
  },

  /* ========== 获取位置 ========== */

  _getLocation: function (cb) {
    var that = this;
    var app = getApp && getApp();
    that._setDiag({ location: '定位中...' });
    that._pushDiagLog('开始获取位置');

    // 定位失败不再回退默认坐标（错误位置会导致卫星方位完全失真），
    // 转为显示提示 + 重试按钮，拿不到位置就不启动推算
    var onLocationFail = function (message) {
      var msg = message || '需要位置权限才能定位卫星';
      that._hasLocation = false;
      that._setDiag({ location: '失败，等待重试', lastError: msg });
      that._pushDiagLog('定位失败：' + msg);
      that.setData({ locationFailed: true, locationErrMsg: msg });
    };

    var loadLocation = function () {
      wx.getFuzzyLocation({
        type: 'wgs84',
        success: function (res) {
          that._lat = res.latitude;
          that._lng = res.longitude;
          that._alt = res.altitude || 0;
          that._hasLocation = true;
          // 磁偏角修正：真北方位 = 罗盘磁方位 + declination（东偏为正）
          that._declination = magDeclination.getDeclination(res.latitude, res.longitude);
          that._setDiag({
            location: '成功 ' + Number(res.latitude || 0).toFixed(2) + ', ' + Number(res.longitude || 0).toFixed(2),
            declination: (that._declination >= 0 ? '+' : '') + that._declination.toFixed(1) + '°'
          });
          that._pushDiagLog('位置获取成功，磁偏角 ' + that._declination.toFixed(1) + '°');
          that.setData({ locationFailed: false, locationErrMsg: '' });
          cb && cb();
        },
        fail: function (err) {
          var msg = (err && (err.errMsg || err.errorMessage)) || '需要位置权限才能定位卫星';
          onLocationFail(msg);
        }
      });
    };

    if (!app || typeof app.ensurePrivacyAuthorized !== 'function') {
      loadLocation();
      return;
    }

    app.ensurePrivacyAuthorized().then(function (privacyRes) {
      if (privacyRes && privacyRes.ok === false) {
        onLocationFail('请先同意隐私指引后再使用AR定位');
        return;
      }
      loadLocation();
    }).catch(function () {
      onLocationFail('隐私授权校验失败，请稍后重试');
    });
  },

  /** 定位失败占位上的重试按钮：权限被拒引导去设置，否则直接重试 */
  retryLocation: function () {
    var that = this;
    var doRetry = function () {
      that._getLocation(that._bootstrapAfterLocation);
    };
    wx.getSetting({
      success: function (res) {
        if (res.authSetting && res.authSetting['scope.userFuzzyLocation'] === false) {
          wx.showModal({
            title: '需要位置权限',
            content: 'AR 观测需要您的位置来计算卫星方位，请在设置中开启位置权限',
            confirmText: '去设置',
            cancelText: '取消',
            success: function (modalRes) {
              if (!modalRes.confirm) return;
              wx.openSetting({
                complete: function () { doRetry(); }
              });
            }
          });
          return;
        }
        doRetry();
      },
      fail: doRetry
    });
  },

  /* ========== 加载 TLE ========== */

  /** 把 TLE 文本或 {name,line1,line2} 数组统一成数组格式 */
  _normalizeTLEList: function (raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string') return [];
    var lines = raw.split('\n').filter(function (l) { return l.trim() !== ''; });
    var list = [];
    for (var i = 0; i + 2 < lines.length; i += 3) {
      list.push({ name: lines[i].trim(), line1: lines[i + 1].trim(), line2: lines[i + 2].trim() });
    }
    return list;
  },

  /** 从全量列表中按 NORAD 倒序选最新 MAX_SATS 颗并解析；返回是否因数据陈旧全部被丢弃 */
  _applyTLEList: function (allList) {
    var selected = starlinkPass.selectNewestTLEs(allList, MAX_SATS);
    var stale = allList.length > 0 && selected.length === 0;
    this._parseTLE(selected);
    return { selected: selected, stale: stale };
  },

  _notifyTLEStale: function () {
    this._satRecs = [];
    this._setDiag({ tle: '数据陈旧（历元超 7 天）', lastError: '星链轨道数据已陈旧，请稍后再试' });
    this._pushDiagLog('TLE 历元超 7 天，已全部丢弃');
    wx.showToast({ title: '星链轨道数据陈旧，暂无法定位卫星', icon: 'none', duration: 2500 });
  },

  _loadTLE: function (cb) {
    var that = this;
    that._setDiag({ tle: '加载中...' });
    that._pushDiagLog('开始加载 TLE');

    // 先检查本地缓存（和过境预报/渲染器共用同一 key，需校验版本号）
    try {
      var cached = wx.getStorageSync(TLE_KEY);
      if (cached && cached.ver === TLE_CACHE_VER && cached.data && Date.now() - cached.ts < TLE_CACHE_TTL) {
        var cachedList = that._normalizeTLEList(cached.data);
        if (cachedList.length > 0) {
          var cachedResult = that._applyTLEList(cachedList);
          // 缓存里全是历元超 7 天的旧星时不提前返回，落到云端重新拉取
          if (!cachedResult.stale && cachedResult.selected.length > 0) {
            that._setDiag({ tle: '缓存命中 ' + cachedResult.selected.length + ' 条' });
            that._pushDiagLog('TLE 使用本地缓存');
            cb && cb();
            return;
          }
        }
      }
    } catch (e) { /* ignore */ }

    // 从云数据库逐个分片读取全部数据（需全量后才能按 NORAD 倒序选最新）
    if (typeof wx.cloud !== 'undefined' && wx.cloud.database) {
      var db = wx.cloud.database();
      var shardIndex = 0;
      var allLines = [];
      var sourceUpdatedAtMs = 0;
      var finish = function (partialErr) {
        if (allLines.length === 0) {
          that._useDemoData();
          cb && cb();
          return;
        }
        var result = that._applyTLEList(allLines);
        var sourceStale = sourceUpdatedAtMs > 0 && (Date.now() - sourceUpdatedAtMs) > starlinkPass.TLE_MAX_AGE_MS;
        if (result.stale || (sourceStale && result.selected.length === 0)) {
          that._notifyTLEStale();
          cb && cb();
          return;
        }
        var diagText = (partialErr ? '部分加载成功 ' : '云端加载成功 ') + result.selected.length + ' 条';
        if (sourceStale) diagText += '（源数据超 7 天未更新）';
        that._setDiag({ tle: diagText, lastError: partialErr || '' });
        that._pushDiagLog(partialErr ? 'TLE 分片加载异常，已使用部分数据' : 'TLE 云端分片加载完成');
        if (sourceStale) {
          wx.showToast({ title: '星链轨道数据较陈旧，预测可能不准', icon: 'none', duration: 2500 });
        }
        try { wx.setStorageSync(TLE_KEY, { data: result.selected, ts: Date.now(), ver: TLE_CACHE_VER }); } catch (e) { }
        cb && cb();
      };
      var loadNext = function () {
        db.collection('starlink_tle').where({ shardIndex: shardIndex }).limit(1).get().then(function (res) {
          if (!res.data || res.data.length === 0) {
            finish(null);
            return;
          }
          var shard = res.data[0];
          if (shardIndex === 0 && shard.updatedAtMs) {
            sourceUpdatedAtMs = shard.updatedAtMs;
          }
          if (shard.data && typeof shard.data === 'string') {
            var lines = shard.data.split('\n').filter(function (l) { return l.trim() !== ''; });
            for (var i = 0; i + 2 < lines.length; i += 3) {
              allLines.push({ name: lines[i].trim(), line1: lines[i + 1].trim(), line2: lines[i + 2].trim() });
            }
          }
          shardIndex++;
          loadNext();
        }).catch(function (err) {
          finish((err && err.errMsg) || 'TLE 分片加载异常');
        });
      };
      loadNext();
    } else {
      that._useDemoData();
      cb && cb();
    }
  },

  _parseTLE: function (list) {
    var recs = [];
    var count = Math.min(list.length, MAX_SATS);
    for (var i = 0; i < count; i++) {
      var item = list[i];
      if (item && item.line1 && item.line2) {
        try {
          var satrec = satellite.twoline2satrec(item.line1, item.line2);
          recs.push({ name: item.name || ('SAT-' + i), satrec: satrec });
        } catch (e) { /* skip bad TLE */ }
      }
    }
    this._satRecs = recs;
  },

  _useDemoData: function () {
    // 空列表 — 无 TLE 时页面仍可运行，只是看不到卫星
    this._satRecs = [];
    this._setDiag({ tle: '无 TLE，已回退空数据', lastError: '未找到 TLE 数据' });
    this._pushDiagLog('未找到 TLE 数据');
    wx.showToast({ title: '未找到 TLE 数据，请先缓存', icon: 'none', duration: 2500 });
  },

  /* ========== 初始化 Canvas ========== */

  _initCanvas: function (cb, attempt) {
    var that = this;
    attempt = attempt || 0;
    if (that._destroyed) return;
    if (attempt >= CANVAS_INIT_MAX_RETRY) {
      that._setDiag({ overlay: '初始化失败', lastError: 'AR 叠加画布初始化超时' });
      that._pushDiagLog('AR 叠加画布初始化超时，已放弃重试');
      cb && cb();
      return;
    }
    var query = wx.createSelectorQuery();
    query.select('#arCanvas')
      .fields({ node: true, size: true })
      .exec(function (res) {
        if (that._destroyed) return;
        if (!res || !res[0]) {
          setTimeout(function () { that._initCanvas(cb, attempt + 1); }, 200);
          return;
        }
        var canvas = res[0].node;
        var ctx = canvas.getContext('2d');
        var dpr = wx.getWindowInfo().pixelRatio || 2;
        var w = res[0].width;
        var h = res[0].height;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        that._canvas = canvas;
        that._ctx = ctx;
        that._canvasW = w;
        that._canvasH = h;
        // 视场：水平取 HFOV，垂直按针孔模型由宽高比推导（竖屏 H>W 时 vFov 更大）
        // vFov = 2 * atan(tan(hFov/2) * H/W)
        var halfHRad = (HFOV / 2) * DEG2RAD;
        var halfVRad = Math.atan(Math.tan(halfHRad) * (h / w));
        that._halfHFov = HFOV / 2;
        that._halfVFov = halfVRad * RAD2DEG;
        that._tanHalfHFov = Math.tan(halfHRad);
        that._tanHalfVFov = Math.tan(halfVRad);
        that._setDiag({ overlay: '已就绪 ' + w + '×' + h + ' FOV ' + Math.round(that._halfHFov * 2) + '×' + Math.round(that._halfVFov * 2) + '°' });
        that._pushDiagLog('AR 叠加画布已就绪');
        cb && cb();
      });
  },

  _initMergeCanvas: function (cb, attempt) {
    var that = this;
    attempt = attempt || 0;
    if (that._destroyed) return;
    if (attempt >= CANVAS_INIT_MAX_RETRY) {
      that._setDiag({ mergeCanvas: '初始化失败', lastError: '合成画布初始化超时' });
      that._pushDiagLog('合成画布初始化超时，已放弃重试');
      cb && cb();
      return;
    }
    var query = wx.createSelectorQuery();
    query.select('#mergeCanvas')
      .fields({ node: true, size: true })
      .exec(function (res) {
        if (that._destroyed) return;
        if (!res || !res[0]) {
          setTimeout(function () { that._initMergeCanvas(cb, attempt + 1); }, 200);
          return;
        }
        var canvas = res[0].node;
        var ctx = canvas.getContext('2d');
        var dpr = wx.getWindowInfo().pixelRatio || 2;
        var w = res[0].width;
        var h = res[0].height;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        that._mergeCanvas = canvas;
        that._mergeCtx = ctx;
        that._setDiag({ mergeCanvas: '已就绪 ' + w + '×' + h });
        that._pushDiagLog('合成画布已就绪');
        cb && cb();
      });
  },

  /* ========== AR 传感器 ========== */

  _startAR: function () {
    var that = this;
    that._startingAR = false;
    that._running = true;

    try {
      wx.offCompassChange();
      wx.offDeviceMotionChange();
      wx.stopCompass();
      wx.stopDeviceMotionListening();
    } catch (e) { }

    that._compassDiagReady = false;
    that._motionDiagReady = false;
    that._motionHeadingAt = 0;
    that._badAccuracyCount = 0;
    that._setDiag({ compass: '启动中...', motion: '启动中...', headingSource: '--', compassRaw: '--', compassAccuracy: '--', motionHeading: '--', motionAlpha: '--', motionBeta: '--', motionGamma: '--', motionPitch: '--', lastCompassAt: '--', lastMotionAt: '--' });
    that._pushDiagLog('开始启动罗盘与姿态传感器');

    wx.startCompass({
      success: function () {
        if (!that._running) return;
        that._setDiag({ compass: '已启动，等待数据' });
        that._pushDiagLog('罗盘启动成功');
        wx.onCompassChange(function (res) {
          that._onCompassChange(res);
        });
        // 看门狗：启动成功但迟迟无回调也视为罗盘不可用
        that._clearCompassWatchdog();
        that._compassWatchdog = setTimeout(function () {
          that._compassWatchdog = null;
          if (!that._running || that._compassDiagReady) return;
          that._markCompassUnavailable('罗盘启动后无数据回调');
        }, 6000);
      },
      fail: function (err) {
        if (!that._running) return;
        var msg = (err && (err.errMsg || err.errorMessage)) || '罗盘不可用';
        var displayMsg = msg.indexOf('privacy agreement') !== -1 ? '隐私声明缺少 startCompass，请同步更新后台隐私指引' : msg;
        that._setDiag({ compass: '启动失败', lastError: displayMsg });
        that._pushDiagLog('罗盘启动失败：' + msg);
        that._markCompassUnavailable(msg.indexOf('privacy agreement') !== -1 ? '缺少罗盘隐私声明' : '罗盘不可用');
      }
    });

    that._startDeviceMotionListening('game', function () {
      if (!that._running) return;
      setTimeout(function () {
        if (!that._running) return;
        that._startDeviceMotionListening('ui', function () {
          if (!that._running) return;
          wx.showToast({ title: '设备姿态传感器不可用', icon: 'none' });
        });
      }, 180);
    });

    that._renderLoop();
  },

  _startDeviceMotionListening: function (interval, onFail) {
    var that = this;
    var intervalLabel = interval || 'default';
    var options = {
      success: function () {
        if (!that._running) return;
        that._setDiag({ motion: '已启动(' + intervalLabel + ')，等待数据' });
        that._pushDiagLog('姿态传感器启动成功：' + intervalLabel);
        wx.onDeviceMotionChange(function (res) {
          that._onDeviceMotionChange(res);
        });
      },
      fail: function (err) {
        if (!that._running) return;
        var msg = (err && (err.errMsg || err.errorMessage)) || ('姿态传感器启动失败(' + intervalLabel + ')');
        var displayMsg = msg.indexOf('privacy agreement') !== -1 ? '隐私声明缺少 startDeviceMotionListening，请同步更新后台隐私指引' : msg;
        that._setDiag({ motion: '启动失败(' + intervalLabel + ')', lastError: displayMsg });
        that._pushDiagLog('姿态传感器启动失败：' + msg);
        onFail && onFail();
      }
    };

    if (interval) {
      options.interval = interval;
    }

    try {
      wx.stopDeviceMotionListening({
        complete: function () {
          wx.startDeviceMotionListening(options);
        }
      });
    } catch (e) {
      try {
        wx.startDeviceMotionListening(options);
      } catch (err) {
        if (!that._running) return;
        onFail && onFail();
      }
    }
  },

  _clearCompassWatchdog: function () {
    if (this._compassWatchdog) {
      clearTimeout(this._compassWatchdog);
      this._compassWatchdog = null;
    }
  },

  /** 罗盘不可用降级：隐藏卫星叠点层，显示占位提示，不再让卫星叠在方位 0° */
  _markCompassUnavailable: function (msg) {
    this._clearCompassWatchdog();
    // Android 姿态矩阵朝向在工作 → 方位不依赖罗盘，无需降级
    if (this._isAndroid && this._motionHeadingAt && Date.now() - this._motionHeadingAt < 3000) {
      this._pushDiagLog('罗盘异常，但姿态矩阵朝向可用，不降级');
      return;
    }
    if (!this.data.compassUnavailable) {
      this.setData({ compassUnavailable: true });
    }
    this._pushDiagLog('罗盘不可用，已隐藏卫星叠点层');
    wx.showToast({ title: msg || '罗盘不可用', icon: 'none' });
  },

  _stopAR: function () {
    this._startingAR = false;
    this._running = false;
    this._clearCompassWatchdog();
    if (this._rafId != null && this._canvas) {
      var cancel = this._canvas.cancelAnimationFrame;
      if (typeof cancel === 'function') {
        try { cancel.call(this._canvas, this._rafId); } catch (e) { /* ignore */ }
      }
      this._rafId = null;
    }
    try {
      wx.stopCompass();
      wx.offCompassChange();
      wx.stopDeviceMotionListening();
      wx.offDeviceMotionChange();
    } catch (e) { /* ignore */ }
  },

  _applyHeading: function (rawHeading, source) {
    if (this._capturing) return;
    if (typeof rawHeading !== 'number' || isNaN(rawHeading)) return;
    // 姿态矩阵朝向可用时，罗盘异常降级不再必要
    if (source === 'motion' && this.data.compassUnavailable) {
      this.setData({ compassUnavailable: false });
    }
    // 磁偏角修正：罗盘/旋转矢量给磁北方位，SGP4 方位是真北。
    // declination 东偏为正（中国大部为西偏/负值），真北方位 = 磁方位 + declination
    var normalized = normalizeHeading(rawHeading + this._declination);
    var prev = this._smoothHeading;
    var diff = normalized - prev;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    var smoothing = this._isAndroid ? 0.1 : 0.2;
    var smoothed = normalizeHeading(prev + diff * smoothing);
    this._smoothHeading = smoothed;
    var heading = Math.round(smoothed);
    this._heading = heading;
    if (heading !== this.data.azimuth) {
      this.setData({
        azimuth: heading,
        compassDir: azimuthToDir(heading),
        'arDiag.headingSource': source === 'compass' ? 'compass(direction)' : 'deviceMotion(matrix)'
      });
    }
  },

  _onCompassChange: function (res) {
    if (this._capturing) return;
    if (!this._compassDiagReady) {
      this._compassDiagReady = true;
      this._clearCompassWatchdog();
      // 罗盘恢复数据后解除降级
      if (this.data.compassUnavailable) {
        this.setData({ compassUnavailable: false });
      }
      var now = new Date();
      this._setDiag({ lastCompassAt: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0'), compass: '数据正常' });
      this._pushDiagLog('收到首个罗盘数据包');
    }
    var raw = typeof res.direction === 'number' ? res.direction : 0;
    this._lastCompassRaw = raw;
    this._lastCompassRawAt = Date.now();

    // 精度：iOS 为数字（磁北偏差度，负数无效），Android 为枚举字符串
    var acc = res.accuracy;
    var accText = '--';
    var accBad = false;
    if (typeof acc === 'string') {
      accText = acc;
      accBad = (acc === 'low' || acc === 'unreliable' || acc === 'no-contact' || acc.indexOf('unknow') === 0);
    } else if (typeof acc === 'number' && !isNaN(acc)) {
      accText = Math.round(acc) + '°';
      accBad = (acc < 0 || acc > 30);
    }
    this._noteCompassAccuracy(accBad);
    this._setDiagThrottled({ compassRaw: Math.round(raw) + '°', compassAccuracy: accText });

    // Android 的 direction 无姿态补偿（竖起手机会 180° 翻转/退化），
    // 姿态矩阵朝向在工作时罗盘只作诊断与约定投票，不参与方位输出
    var motionFresh = this._motionHeadingAt && (Date.now() - this._motionHeadingAt < 2000);
    if (this._isAndroid && motionFresh) return;
    this._applyHeading(raw, 'compass');
  },

  /** 罗盘精度持续偏差时重新弹出"8 字校准"提示 */
  _noteCompassAccuracy: function (accBad) {
    if (!accBad) {
      this._badAccuracyCount = 0;
      return;
    }
    this._badAccuracyCount++;
    // 约 2 秒（5Hz×10 包）持续低精度触发一次提示
    if (this._badAccuracyCount >= 10) {
      this._badAccuracyCount = 0;
      if (this.data.showCalibrate || this._capturing) return;
      var that = this;
      that.setData({ showCalibrate: true });
      that._pushDiagLog('罗盘精度差，提示用户校准');
      if (that._calibrateTimer) clearTimeout(that._calibrateTimer);
      that._calibrateTimer = setTimeout(function () {
        that._calibrateTimer = null;
        that.setData({ showCalibrate: false });
      }, 6000);
    }
  },

  _onDeviceMotionChange: function (res) {
    if (!res || this._capturing) return;
    if (!this._motionDiagReady) {
      this._motionDiagReady = true;
      var now = new Date();
      this._setDiag({ lastMotionAt: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0'), motion: '数据正常' });
      this._pushDiagLog('收到首个姿态数据包');
    }
    var alphaValue = toDegreesIfNeeded(res.alpha);
    var betaValue = toDegreesIfNeeded(res.beta);
    var gammaValue = toDegreesIfNeeded(res.gamma);
    var hasBeta = betaValue !== null;
    var hasGamma = gammaValue !== null;

    this._setDiagThrottled({
      motionAlpha: alphaValue !== null ? (Math.round(alphaValue) + '°') : '--',
      motionBeta: betaValue !== null ? (Math.round(betaValue) + '°') : '--',
      motionGamma: gammaValue !== null ? (Math.round(gammaValue) + '°') : '--'
    });

    if (!hasBeta && !hasGamma) return;

    // ===== Android：完整旋转矩阵推摄像头方位/仰角（姿态补偿，与 iOS 罗盘行为对齐）=====
    if (this._isAndroid && alphaValue !== null && hasBeta && hasGamma) {
      this._voteMotionConvention(alphaValue, betaValue, gammaValue);
      var orient = computeMotionOrientation(alphaValue, betaValue, gammaValue, this._motionConvention === 'mirror');

      this._smoothPitch = this._smoothPitch + (orient.camEl - this._smoothPitch) * 0.1;
      this._pitch = this._smoothPitch;
      var rp = Math.round(this._smoothPitch);
      this._setDiagThrottled({
        motionPitch: Math.round(orient.camEl) + '°',
        motionHeading: Math.round(orient.camAz) + '°'
      });
      if (rp !== this.data.elevation) {
        this.setData({ elevation: rp });
      }
      // 摄像头接近垂直（正上/正下）时水平投影退化，方位保持上次值不更新
      if (Math.abs(orient.camEl) < 78) {
        this._motionHeadingAt = Date.now();
        this._applyHeading(orient.camAz, 'motion');
      }
      return;
    }

    // ===== iOS / 缺 alpha 的安卓降级：beta 推俯仰，方位靠罗盘 =====
    // 统一 beta 符号：Android beta 与 iOS 相反
    var rawBeta = hasBeta ? betaValue : 0;
    if (this._isAndroid) rawBeta = -rawBeta;
    // 后置摄像头修正：beta=0(平放)→看地面=-90°，beta=90(竖直)→看水平线=0°，顶部朝天→90°
    var pitch = rawBeta - 90;
    if (pitch < -90) pitch = -90;
    if (pitch > 90) pitch = 90;

    var smoothing = this._isAndroid ? 0.1 : 0.2;
    this._smoothPitch = this._smoothPitch + (pitch - this._smoothPitch) * smoothing;
    this._pitch = this._smoothPitch;
    var roundedPitch = Math.round(this._smoothPitch);
    this._setDiagThrottled({ motionPitch: Math.round(pitch) + '°' });
    if (roundedPitch !== this.data.elevation) {
      this.setData({ elevation: roundedPitch });
    }
  },

  /**
   * Android alpha 方向约定在不同机型/微信版本上不一致（实测多为顺时针=罗盘向，
   * 与 W3C 相反）。在近平放姿态（罗盘设计姿态、读数可信）下用罗盘 direction
   * 给两种约定投票，判定后本机持久化，跨会话生效。
   */
  _voteMotionConvention: function (alphaDeg, betaDeg, gammaDeg) {
    if (this._convDecided) return;
    var now = Date.now();
    if (!this._lastCompassRawAt || now - this._lastCompassRawAt > 2000) return;
    var oMirror = computeMotionOrientation(alphaDeg, betaDeg, gammaDeg, true);
    // camEl 与约定无关；摄像头非明显朝下 → 非平放姿态，罗盘不可信，不投票
    if (oMirror.camEl > -60) return;
    var oWeb = computeMotionOrientation(alphaDeg, betaDeg, gammaDeg, false);
    var dMirror = circularDiff(oMirror.topAz, this._lastCompassRaw);
    var dWeb = circularDiff(oWeb.topAz, this._lastCompassRaw);
    if (dMirror < 20 && dWeb >= 20) this._convVotes.mirror++;
    else if (dWeb < 20 && dMirror >= 20) this._convVotes.web++;
    else return;

    var total = this._convVotes.mirror + this._convVotes.web;
    if (total < 8) return;
    var winner = null;
    if (this._convVotes.mirror >= this._convVotes.web * 2) winner = 'mirror';
    else if (this._convVotes.web >= this._convVotes.mirror * 2) winner = 'web';
    if (winner) {
      this._convDecided = true;
      if (winner !== this._motionConvention) {
        this._motionConvention = winner;
        this._pushDiagLog('姿态约定切换为 ' + winner);
      }
      this._setDiag({ motionConv: winner + '（已校验）' });
      try { wx.setStorageSync('_ar_motion_conv', winner) } catch (e) { }
    } else if (total > 40) {
      // 票数胶着（罗盘本身可能未校准）：放弃本次会话投票，保持当前约定
      this._convDecided = true;
      this._pushDiagLog('姿态约定投票无共识，保持 ' + this._motionConvention);
    }
  },

  /* ========== 渲染循环 ========== */

  _renderLoop: function () {
    var that = this;
    if (!that._running || !that._canvas) return;
    var canvas = that._canvas;
    var raf = canvas && canvas.requestAnimationFrame;
    if (typeof raf !== 'function') return;
    var cb = function () {
      if (!that._running || !that._canvas) return;
      that._renderFrame();
      that._renderLoop();
    };
    if (typeof cb !== 'function') return;
    try {
      that._rafId = raf.call(canvas, cb);
    } catch (e) {
      that._rafId = null;
    }
  },

  /**
   * 每 PROPAGATE_INTERVAL_MS 重算一次全量卫星角位置快照（satellite.propagate 是 CPU 大头）；
   * RAF 帧内只做屏幕投影，避免中低端机 60fps × 200 颗推算导致掉帧发热
   */
  _computeSatSnapshot: function (now) {
    // 没有真实定位时不推算（避免用错误坐标产生完全失真的方位）
    if (!this._hasLocation) {
      this._satSnapshot = [];
      return;
    }
    var gmst = satellite.gstime(now);
    var observerGd = {
      longitude: this._lng * DEG2RAD,
      latitude: this._lat * DEG2RAD,
      height: this._alt / 1000 // km
    };
    var recs = this._satRecs;
    var snapshot = [];
    for (var i = 0; i < recs.length; i++) {
      var rec = recs[i];
      try {
        var posVel = satellite.propagate(rec.satrec, now);
        if (!posVel.position) continue;

        var posEci = posVel.position;
        var posEcf = satellite.eciToEcf(posEci, gmst);
        var lookAngles = satellite.ecfToLookAngles(observerGd, posEcf);

        var satAz = lookAngles.azimuth * RAD2DEG;  // 0-360
        var satEl = lookAngles.elevation * RAD2DEG; // 负=地平线下

        // 过滤地平线以下
        if (satEl < 0) continue;

        // 计算卫星高度和速度
        var posR = Math.sqrt(posEci.x * posEci.x + posEci.y * posEci.y + posEci.z * posEci.z);
        var altKm = Math.round(posR - 6371);
        var speedKms = 0;
        if (posVel.velocity) {
          var v = posVel.velocity;
          speedKms = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        }

        // 真实日照判断（圆柱阴影模型），只在 200ms 快照节奏里算，不在每帧调用
        var sunlit = false;
        try {
          var satGeo = satellite.eciToGeodetic(posEci, gmst);
          sunlit = starlinkPass.isSatelliteSunlit(now, satGeo, satGeo.height);
        } catch (e2) { /* 保守视为阴影中 */ }

        snapshot.push({ az: satAz, el: satEl, name: rec.name, sunlit: sunlit, altKm: altKm, speedKms: speedKms, recIdx: i });
      } catch (e) { /* skip */ }
    }
    this._satSnapshot = snapshot;
    this._satSnapshotGmst = gmst;
    this._satSnapshotObserver = observerGd;
    this._satSnapshotNow = now;
    // 位置更新后尾迹缓存失效（尾迹按需重算）
    this._trailCache = {};
  },

  /**
   * 针孔模型投影：dAz/dEl 为与设备朝向的角度差（度）。
   * 超出视场（水平 halfHFov / 垂直 halfVFov 分别判断）返回 null。
   */
  _projectToScreen: function (dAz, dEl, W, H) {
    if (Math.abs(dAz) > this._halfHFov || Math.abs(dEl) > this._halfVFov) return null;
    return {
      sx: W / 2 + (Math.tan(dAz * DEG2RAD) / this._tanHalfHFov) * (W / 2),
      sy: H / 2 - (Math.tan(dEl * DEG2RAD) / this._tanHalfVFov) * (H / 2)
    };
  },

  _renderFrame: function () {
    var ctx = this._ctx;
    if (!ctx) return;
    var W = this._canvasW;
    var H = this._canvasH;

    // 清空画布
    ctx.clearRect(0, 0, W, H);

    // 罗盘不可用时方位不可信：不绘制卫星叠点层（wxml 另有占位提示）
    if (this.data.compassUnavailable) {
      this._visibleSatScreenPos = [];
      if (this.data.visibleCount !== 0) this.setData({ visibleCount: 0 });
      return;
    }

    var nowMs = Date.now();
    if (!this._satSnapshot || !this._satSnapshotTs || (nowMs - this._satSnapshotTs) >= PROPAGATE_INTERVAL_MS) {
      this._computeSatSnapshot(new Date(nowMs));
      this._satSnapshotTs = nowMs;
    }

    var heading = this._heading;
    var pitch = this._pitch;
    var visCount = 0;

    // 收集所有地平线以上卫星
    var allAbove = [];
    // 收集视场内卫星的屏幕坐标（用于点击检测）
    var screenPos = [];
    // 当前帧可见卫星名称集合
    var currentVisibleSet = {};

    var snap = this._satSnapshot;
    for (var i = 0; i < snap.length; i++) {
      var entry = snap[i];
      {
        var satAz = entry.az;
        var satEl = entry.el;

        // 计算与设备朝向的角度差
        var dAz = satAz - heading;
        // 归一化到 -180 ~ 180
        while (dAz > 180) dAz -= 360;
        while (dAz < -180) dAz += 360;

        var dEl = satEl - pitch;
        var sunlit = entry.sunlit;
        var altKm = entry.altKm;
        var speedKms = entry.speedKms;

        allAbove.push({ az: satAz, el: satEl, name: entry.name, dAz: dAz, dEl: dEl, sunlit: sunlit, altKm: altKm, speedKms: speedKms, recIdx: entry.recIdx });

        // 针孔模型投影，超出视场（水平/垂直分别判断）跳过
        var proj = this._projectToScreen(dAz, dEl, W, H);
        if (!proj) continue;
        var sx = proj.sx;
        var sy = proj.sy;

        currentVisibleSet[entry.name] = true;

        // ── 绘制轨迹尾迹 ──
        this._drawTrail(ctx, entry, heading, pitch, W, H, sunlit);

        // ── 发光光晕 ──
        var baseR = sunlit ? 7 : 4;
        var glowR = baseR * 3;
        var gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
        if (sunlit) {
          gradient.addColorStop(0, 'rgba(0, 255, 136, 0.6)');
          gradient.addColorStop(0.3, 'rgba(0, 255, 136, 0.2)');
          gradient.addColorStop(1, 'rgba(0, 255, 136, 0)');
        } else {
          gradient.addColorStop(0, 'rgba(180, 180, 180, 0.35)');
          gradient.addColorStop(0.3, 'rgba(180, 180, 180, 0.1)');
          gradient.addColorStop(1, 'rgba(180, 180, 180, 0)');
        }
        ctx.beginPath();
        ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // ── 核心亮点 ──
        ctx.beginPath();
        ctx.arc(sx, sy, baseR, 0, Math.PI * 2);
        ctx.fillStyle = sunlit ? '#00ff88' : 'rgba(200,200,200,0.6)';
        ctx.fill();

        // ── 内核白点 ──
        ctx.beginPath();
        ctx.arc(sx, sy, baseR * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = sunlit ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)';
        ctx.fill();

        // ── 十字瞄准线（高仰角卫星） ──
        if (satEl > 30) {
          var crossLen = baseR + 8;
          ctx.strokeStyle = sunlit ? 'rgba(0, 255, 136, 0.3)' : 'rgba(180,180,180,0.2)';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(sx - crossLen, sy); ctx.lineTo(sx - baseR - 2, sy);
          ctx.moveTo(sx + baseR + 2, sy); ctx.lineTo(sx + crossLen, sy);
          ctx.moveTo(sx, sy - crossLen); ctx.lineTo(sx, sy - baseR - 2);
          ctx.moveTo(sx, sy + baseR + 2); ctx.lineTo(sx, sy + crossLen);
          ctx.stroke();
        }

        // ── 卫星名称 + 高度标签 ──
        var labelX = sx + baseR + 6;
        var labelY = sy - baseR - 2;
        ctx.font = '11px monospace';
        ctx.fillStyle = sunlit ? 'rgba(0, 255, 136, 0.85)' : 'rgba(255,255,255,0.5)';
        ctx.fillText(entry.name, labelX, labelY);
        ctx.font = '9px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText(altKm + ' km · ' + Math.round(satEl) + '°', labelX, labelY + 13);

        // 记录屏幕坐标（用于点击检测）
        screenPos.push({ sx: sx, sy: sy, name: entry.name, altKm: altKm, el: satEl, az: satAz, sunlit: sunlit, speedKms: speedKms });

        visCount++;
      }
    }

    // 保存当前帧可见卫星屏幕坐标
    this._visibleSatScreenPos = screenPos;

    // ── 星链列车检测与绘制 ──
    this._drawTrains(ctx, allAbove, W, H);

    // 绘制迷你雷达罗盘
    this._drawRadar(ctx, W, H, heading, allAbove);

    // 绘制边缘引导箭头
    this._drawEdgeArrows(ctx, W, H, allAbove);

    // 更新最佳观测方位
    this._updateBestDirection(allAbove);

    // ── 震动反馈：新卫星进入视场 ──
    this._checkVibrate(currentVisibleSet);

    if (visCount !== this.data.visibleCount) {
      this.setData({ visibleCount: visCount });
    }
  },

  /* ========== 卫星轨迹尾迹 ========== */

  /** 尾迹角位置（az/el）按快照周期缓存；每帧仅按当前朝向做屏幕投影 */
  _getTrailAngles: function (entry) {
    if (!this._trailCache) this._trailCache = {};
    var cached = this._trailCache[entry.name];
    if (cached) return cached;

    var angles = [];
    var rec = this._satRecs[entry.recIdx];
    var now = this._satSnapshotNow || new Date();
    var observerGd = this._satSnapshotObserver;
    if (rec && rec.satrec && observerGd) {
      for (var s = 1; s <= TRAIL_STEPS; s++) {
        try {
          var futureTime = new Date(now.getTime() + s * TRAIL_INTERVAL * 1000);
          var futureGmst = satellite.gstime(futureTime);
          var fPosVel = satellite.propagate(rec.satrec, futureTime);
          if (!fPosVel.position) continue;
          var fEcf = satellite.eciToEcf(fPosVel.position, futureGmst);
          var fLook = satellite.ecfToLookAngles(observerGd, fEcf);
          var fEl = fLook.elevation * RAD2DEG;
          if (fEl < 0) continue;
          angles.push({ az: fLook.azimuth * RAD2DEG, el: fEl });
        } catch (e) { /* skip */ }
      }
    }
    this._trailCache[entry.name] = angles;
    return angles;
  },

  _drawTrail: function (ctx, entry, heading, pitch, W, H, sunlit) {
    var angles = this._getTrailAngles(entry);
    var points = [];
    for (var s = 0; s < angles.length; s++) {
      var fdAz = angles[s].az - heading;
      while (fdAz > 180) fdAz -= 360;
      while (fdAz < -180) fdAz += 360;
      var fdEl = angles[s].el - pitch;
      var proj = this._projectToScreen(fdAz, fdEl, W, H);
      if (!proj) continue;
      points.push({ x: proj.sx, y: proj.sy });
    }
    if (points.length < 1) return;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    for (var j = 0; j < points.length - 1; j++) {
      var alpha = 0.4 - (j / points.length) * 0.35;
      ctx.strokeStyle = sunlit
        ? 'rgba(0, 255, 136, ' + alpha + ')'
        : 'rgba(180, 180, 180, ' + alpha + ')';
      ctx.beginPath();
      ctx.moveTo(points[j].x, points[j].y);
      ctx.lineTo(points[j + 1].x, points[j + 1].y);
      ctx.stroke();
    }
    ctx.restore();
  },

  /* ========== 星链列车检测 ========== */

  _drawTrains: function (ctx, allAbove, W, H) {
    if (allAbove.length < TRAIN_MIN_COUNT) return;
    // 按方位角排序
    var sorted = allAbove.slice().sort(function (a, b) { return a.az - b.az; });
    var chains = [];
    var chain = [sorted[0]];
    for (var i = 1; i < sorted.length; i++) {
      var prev = chain[chain.length - 1];
      var cur = sorted[i];
      var angDist = Math.sqrt(Math.pow(cur.az - prev.az, 2) + Math.pow(cur.el - prev.el, 2));
      if (angDist < TRAIN_THRESHOLD) {
        chain.push(cur);
      } else {
        if (chain.length >= TRAIN_MIN_COUNT) chains.push(chain);
        chain = [cur];
      }
    }
    if (chain.length >= TRAIN_MIN_COUNT) chains.push(chain);

    // 绘制列车连线
    for (var c = 0; c < chains.length; c++) {
      var tr = chains[c];
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      var started = false;
      var midX = 0, midY = 0, count = 0;
      for (var j = 0; j < tr.length; j++) {
        var s = tr[j];
        var proj = this._projectToScreen(s.dAz, s.dEl, W, H);
        if (!proj) continue;
        if (!started) { ctx.moveTo(proj.sx, proj.sy); started = true; }
        else { ctx.lineTo(proj.sx, proj.sy); }
        midX += proj.sx; midY += proj.sy; count++;
      }
      if (started) ctx.stroke();
      ctx.setLineDash([]);
      // 列车标签
      if (count >= TRAIN_MIN_COUNT) {
        midX /= count; midY /= count;
        ctx.font = '10px sans-serif';
        ctx.fillStyle = 'rgba(255, 200, 0, 0.85)';
        ctx.textAlign = 'center';
        ctx.fillText('TRAIN ×' + tr.length, midX, midY - 14);
      }
      ctx.restore();
    }
  },

  /* ========== 震动反馈 ========== */

  _checkVibrate: function (currentSet) {
    var prevSet = this._prevVisibleSet || {};
    var nowMs = Date.now();
    // 防抖：至少间隔 2 秒
    if (nowMs - this._lastVibrateTime < 2000) {
      this._prevVisibleSet = currentSet;
      return;
    }
    var hasNew = false;
    for (var name in currentSet) {
      if (!prevSet[name]) { hasNew = true; break; }
    }
    if (hasNew) {
      try { wx.vibrateShort({ type: 'light' }); } catch (e) {}
      this._lastVibrateTime = nowMs;
    }
    this._prevVisibleSet = currentSet;
  },

  /* ========== 点击卫星检测 ========== */

  onCanvasTap: function (e) {
    var touch = e.touches && e.touches[0] || e.detail;
    if (!touch) return;
    var tx = touch.x || touch.clientX || 0;
    var ty = touch.y || touch.clientY || 0;
    var list = this._visibleSatScreenPos || [];
    var closest = null;
    var minDist = TAP_RADIUS;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var d = Math.sqrt(Math.pow(s.sx - tx, 2) + Math.pow(s.sy - ty, 2));
      if (d < minDist) { minDist = d; closest = s; }
    }
    if (closest) {
      wx.vibrateShort({ type: 'medium' });
      this.setData({
        showSatCard: true,
        satCardData: {
          name: closest.name,
          altKm: closest.altKm,
          el: Math.round(closest.el),
          az: Math.round(closest.az),
          azDir: azimuthToDir(closest.az),
          sunlit: closest.sunlit,
          speedKmh: Math.round(closest.speedKms * 3600)
        }
      });
    } else {
      if (this.data.showSatCard) {
        this.setData({ showSatCard: false, satCardData: null });
      }
    }
  },

  closeSatCard: function () {
    this.setData({ showSatCard: false, satCardData: null });
  },

  closeCapturePreview: function () {
    this.setData({ capturePreview: '' });
  },

  saveCaptureToAlbum: function () {
    var that = this;
    var filePath = this.data.capturePreview;
    if (!filePath) return;
    wx.saveImageToPhotosAlbum({
      filePath: filePath,
      success: function () {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
        that.setData({ capturePreview: '' });
      },
      fail: function () {
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    });
  },

  shareCaptureImage: function () {
    var filePath = this.data.capturePreview;
    if (!filePath) return;
    wx.shareFileMessage({
      filePath: filePath,
      success: function () {},
      fail: function () {
        wx.showToast({ title: '分享失败', icon: 'none' });
      }
    });
  },

  /* ========== 截图分享 ========== */

  onCapture: function () {
    var that = this;
    if (!that._cameraCtx || !that._mergeCanvas) {
      wx.showToast({ title: '初始化中，请稍后', icon: 'none' });
      return;
    }

    var app = getApp && getApp();
    var startCapture = function () {
      that._capturing = true;
      wx.showLoading({ title: '生成中...', mask: true });

      // 1. 拍照
      that._cameraCtx.takePhoto({
        quality: 'high',
        success: function (photoRes) {
          var photoPath = photoRes.tempImagePath;

          // 2. 导出 AR 画布为临时文件
          wx.canvasToTempFilePath({
            canvas: that._canvas,
            success: function (arTmpRes) {
              var arPath = arTmpRes.tempFilePath;

              // 3. 在合成画布上绘制：先画相机照片，再叠加 AR
              var mCanvas = that._mergeCanvas;
              var mCtx = that._mergeCtx;
              var w = that._canvasW;
              var h = that._canvasH;

              // 用 canvas 自身的 createImage 加载两张图
              var bgImg = mCanvas.createImage();
              var arImg = mCanvas.createImage();
              var bgLoaded = false;
              var arLoaded = false;
              var hasError = false;

              var tryCompose = function () {
                if (hasError || !bgLoaded || !arLoaded) return;
                if (that._captureTimer) {
                  clearTimeout(that._captureTimer);
                  that._captureTimer = null;
                }

                try {
                  mCtx.clearRect(0, 0, w, h);
                  mCtx.drawImage(bgImg, 0, 0, w, h);
                  mCtx.drawImage(arImg, 0, 0, w, h);

                  // 水印
                  mCtx.save();
                  mCtx.font = '11px sans-serif';
                  mCtx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                  mCtx.textAlign = 'left';
                  var timeStr = new Date().toLocaleString();
                  mCtx.fillText('Starlink AR · ' + that.data.visibleCount + ' sats · ' + timeStr, 12, h - 12);
                  mCtx.restore();
                } catch (e) {
                  wx.hideLoading();
                  that._capturing = false;
                  wx.showToast({ title: '合成绘制失败', icon: 'none' });
                  return;
                }

                // 4. 导出合成图片
                wx.canvasToTempFilePath({
                  canvas: mCanvas,
                  success: function (tmpRes) {
                    wx.hideLoading();
                    that._capturing = false;
                    that.setData({ capturePreview: tmpRes.tempFilePath });
                  },
                  fail: function () {
                    wx.hideLoading();
                    that._capturing = false;
                    wx.showToast({ title: '导出失败', icon: 'none' });
                  }
                });
              };

              var onError = function (msg) {
                if (hasError) return;
                hasError = true;
                wx.hideLoading();
                that._capturing = false;
                wx.showToast({ title: msg || '图片加载失败', icon: 'none' });
              };

              bgImg.onload = function () { bgLoaded = true; tryCompose(); };
              bgImg.onerror = function () { onError('照片加载失败'); };
              arImg.onload = function () { arLoaded = true; tryCompose(); };
              arImg.onerror = function () { onError('AR叠加失败'); };

              // 设置超时保护：3秒内图片没加载完就报错（onUnload 时清理）
              that._captureTimer = setTimeout(function () {
                that._captureTimer = null;
                if (!bgLoaded || !arLoaded) {
                  onError('图片加载超时');
                }
              }, 3000);

              bgImg.src = photoPath;
              arImg.src = arPath;
            },
            fail: function () {
              wx.hideLoading();
              that._capturing = false;
              wx.showToast({ title: 'AR画布导出失败', icon: 'none' });
            }
          });
        },
        fail: function (err) {
          wx.hideLoading();
          that._capturing = false;
          console.error('拍照失败:', err);
          wx.showToast({ title: '拍照失败', icon: 'none' });
        }
      });
    };

    if (!app || typeof app.ensurePrivacyAuthorized !== 'function') {
      startCapture();
      return;
    }

    app.ensurePrivacyAuthorized().then(function (privacyRes) {
      if (privacyRes && privacyRes.ok === false) {
        wx.showToast({ title: '请先同意隐私指引后再保存截图', icon: 'none' });
        return;
      }
      startCapture();
    }).catch(function () {
      wx.showToast({ title: '隐私授权校验失败，请稍后重试', icon: 'none' });
    });
  },

  /* ========== 迷你雷达罗盘 ========== */

  _drawRadar: function (ctx, W, H, heading, sats) {
    var cx = W / 2;
    var cy = H - 140;
    var r = 40;

    ctx.save();

    // 背景圆
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 同心圆（30°/60° 仰角参考线）
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2 / 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r / 3, 0, Math.PI * 2);
    ctx.stroke();

    // 十字线
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();

    // 视场扇形（当前相机朝向，取水平视场角）
    var fovHalfRad = this._halfHFov * DEG2RAD;
    var startAngle = -Math.PI / 2 - fovHalfRad;
    var endAngle = -Math.PI / 2 + fovHalfRad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 255, 136, 0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.3)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // 绘制卫星点
    for (var i = 0; i < sats.length; i++) {
      var s = sats[i];
      var relAzRad = (s.az - heading) * DEG2RAD;
      // 仰角映射：90°=中心，0°=边缘
      var dist = (1 - s.el / 90) * r;
      var px = cx + Math.sin(relAzRad) * dist;
      var py = cy - Math.cos(relAzRad) * dist;

      ctx.beginPath();
      ctx.arc(px, py, s.sunlit ? 2.5 : 1.5, 0, Math.PI * 2);
      ctx.fillStyle = s.sunlit ? '#00ff88' : 'rgba(180,180,180,0.5)';
      ctx.fill();
    }

    // 中心点
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // N 标记
    ctx.font = '9px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.textAlign = 'center';
    // N 的位置：相对于 heading 旋转
    var nRad = -heading * DEG2RAD;
    var nx = cx + Math.sin(nRad) * (r + 9);
    var ny = cy - Math.cos(nRad) * (r + 9);
    ctx.fillText('N', nx, ny + 3);

    ctx.restore();
  },

  /* ========== 边缘引导箭头 ========== */

  _drawEdgeArrows: function (ctx, W, H, sats) {
    var outside = [];
    for (var i = 0; i < sats.length; i++) {
      var s = sats[i];
      if (Math.abs(s.dAz) > this._halfHFov || Math.abs(s.dEl) > this._halfVFov) {
        if (s.el > 10) outside.push(s);
      }
    }
    if (outside.length === 0) return;

    // 按仰角排序，取前5颗最高的
    outside.sort(function (a, b) { return b.el - a.el; });
    outside = outside.slice(0, 5);

    var margin = 35;
    ctx.save();

    for (var j = 0; j < outside.length; j++) {
      var o = outside[j];
      var angle = Math.atan2(o.dAz, -o.dEl);

      // 沿角度方向投射到屏幕边缘
      var ex = W / 2 + Math.sin(angle) * (W / 2 - margin);
      var ey = H / 2 + Math.cos(angle) * (H / 2 - margin);
      ex = Math.max(margin, Math.min(W - margin, ex));
      ey = Math.max(margin + 50, Math.min(H - margin - 80, ey));

      // 箭头透明度随仰角变化
      var alpha = 0.4 + (o.el / 90) * 0.5;

      // 画三角箭头
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(-6, 5);
      ctx.lineTo(6, 5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 255, 136, ' + alpha + ')';
      ctx.fill();

      // 仰角标注
      ctx.rotate(-angle); // 恢复水平方向写字
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, ' + (alpha * 0.8) + ')';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(o.el) + '°', 0, 18);
      ctx.restore();
    }

    ctx.restore();
  },

  /* ========== 最佳观测方位 ========== */

  _updateBestDirection: function (sats) {
    if (sats.length === 0) {
      if (this.data.bestDir) {
        this.setData({ bestDir: '', bestAz: 0 });
      }
      return;
    }
    // 向量平均法计算卫星密集方向，高仰角卫星权重更大
    var sumX = 0, sumY = 0;
    for (var i = 0; i < sats.length; i++) {
      var weight = 0.5 + (sats[i].el / 90) * 0.5;
      var rad = sats[i].az * DEG2RAD;
      sumX += Math.cos(rad) * weight;
      sumY += Math.sin(rad) * weight;
    }
    var bestAz = Math.atan2(sumY, sumX) * RAD2DEG;
    if (bestAz < 0) bestAz += 360;
    bestAz = Math.round(bestAz);
    var bestDir = azimuthToDir(bestAz);

    if (bestAz !== this.data.bestAz || bestDir !== this.data.bestDir) {
      this.setData({ bestDir: bestDir, bestAz: bestAz });
    }
  },

  /* ========== 事件 ========== */

  goBack: function () {
    // 分享/直达场景页面栈深为 1，navigateBack 会失败 → 兜底 switchTab 回监控中心
    wx.navigateBack({
      delta: 1,
      fail: function () {
        wx.switchTab({ url: '/pages/monitor/monitor' });
      }
    });
  },

  onCameraError: function (e) {
    console.error('Camera error:', e.detail);
    var msg = (e && e.detail && (e.detail.errMsg || e.detail.message)) || '相机初始化失败';
    this._setDiag({ camera: '异常', lastError: msg });
    this._pushDiagLog('相机异常：' + msg);
    wx.showModal({
      title: '相机权限',
      content: '需要相机权限才能使用 AR 观测功能，请在设置中开启后重试',
      confirmText: '去设置',
      cancelText: '返回',
      success: function (res) {
        if (res.confirm) {
          wx.openSetting({});
        } else {
          wx.navigateBack({
            delta: 1,
            fail: function () {
              wx.switchTab({ url: '/pages/monitor/monitor' });
            }
          });
        }
      }
    });
  }
});
