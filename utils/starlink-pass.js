/**
 * Starlink 卫星过境预测工具
 * 基于 satellite.js 进行 TLE 轨道传播，计算给定观测点的可见过境
 */

var satellite = require('./libs/satellite.min.js')

// ============================================================
// 辅助函数
// ============================================================

/**
 * 方位角转罗盘方向
 * @param {number} az - 方位角（度）
 * @returns {string} 罗盘方向 N/NE/E/SE/S/SW/W/NW
 */
function azToDirection(az) {
  az = ((az % 360) + 360) % 360;
  if (az >= 337.5 || az < 22.5) return 'N';
  if (az < 67.5) return 'NE';
  if (az < 112.5) return 'E';
  if (az < 157.5) return 'SE';
  if (az < 202.5) return 'S';
  if (az < 247.5) return 'SW';
  if (az < 292.5) return 'W';
  return 'NW';
}

/**
 * 简化太阳位置计算
 * 返回太阳的赤纬和时角，用于判断天空是否足够暗
 * @param {Date} date
 * @param {number} lat - 纬度（度）
 * @param {number} lng - 经度（度）
 * @returns {{altitude: number}} altitude 为太阳高度角（度）
 */
function getSunPosition(date, lat, lng) {
  var rad = Math.PI / 180;

  // 儒略日
  var JD = date.getTime() / 86400000 + 2440587.5;
  var n = JD - 2451545.0; // J2000 起算天数

  // 太阳平黄经和平近点角
  var L = (280.460 + 0.9856474 * n) % 360;
  var g = ((357.528 + 0.9856003 * n) % 360) * rad;

  // 黄道经度
  var lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;

  // 黄赤交角
  var epsilon = 23.439 * rad;

  // 太阳赤纬
  var sinDec = Math.sin(epsilon) * Math.sin(lambda);
  var dec = Math.asin(sinDec);

  // 太阳赤经
  var ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));

  // 格林尼治恒星时（简化）
  var GMST = (280.46061837 + 360.98564736629 * n) % 360;
  var LST = (GMST + lng) * rad;

  // 时角
  var ha = LST - ra;

  // 太阳高度角
  var latRad = lat * rad;
  var sinAlt = Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(ha);
  var altitude = Math.asin(sinAlt) / rad;

  return { altitude: altitude };
}

/**
 * 判断天空是否足够暗（民用暮光：太阳低于 -6°）
 * @param {Date} date
 * @param {{lat: number, lng: number}} observer
 * @returns {boolean}
 */
function isSkyDark(date, observer) {
  var sunPos = getSunPosition(date, observer.lat, observer.lng);
  return sunPos.altitude < -6;
}

/**
 * 判断卫星是否被太阳照射（未进入地球阴影）
 * 使用简化的圆柱阴影模型
 * @param {Date} date
 * @param {{longitude: number, latitude: number, height: number}} satGeo - 卫星地理坐标（弧度/千米）
 * @param {number} satAltKm - 卫星高度（千米）
 * @returns {boolean}
 */
function isSatelliteSunlit(date, satGeo, satAltKm) {
  if (!satGeo || typeof satGeo.latitude !== 'number' || typeof satGeo.longitude !== 'number') {
    return false
  }
  var sunPos = getSunPosition(date, 0, 0);
  // 地球半径约 6371 km
  var earthRadius = 6371;
  var satDistance = earthRadius + satAltKm;

  // 地球阴影的半角（简化）
  var shadowAngle = Math.asin(earthRadius / satDistance) * (180 / Math.PI);

  // 卫星相对于地心的太阳高度角
  // 简化：使用卫星正下方点的太阳高度角，加上卫星因高度产生的视角偏移
  var satLatDeg = satGeo.latitude * (180 / Math.PI);
  var satLngDeg = satGeo.longitude * (180 / Math.PI);
  var sunAtSat = getSunPosition(date, satLatDeg, satLngDeg);

  // 卫星在高空，能"看到"地平线以下更远的太阳
  var horizonDip = Math.acos(earthRadius / satDistance) * (180 / Math.PI);

  return (sunAtSat.altitude + horizonDip) > 0;
}

/**
 * 合并时间相近的过境为"星链列车"
 * 5 分钟内的过境归为同一组
 * @param {Array} passes - 过境数组
 * @returns {Array} 合并后的过境数组，带 trainCount 字段
 */
function mergeStarlinkTrains(passes) {
  if (!passes || passes.length === 0) return [];

  // 按开始时间排序
  var sorted = passes.slice().sort(function (a, b) {
    return a.startTime - b.startTime;
  });

  var merged = [];
  var currentGroup = [sorted[0]];

  for (var i = 1; i < sorted.length; i++) {
    var prev = currentGroup[currentGroup.length - 1];
    var curr = sorted[i];
    var gap = (curr.startTime - prev.startTime) / 60000; // 分钟

    if (gap <= 5) {
      currentGroup.push(curr);
    } else {
      // 输出当前组
      _flushGroup(currentGroup, merged);
      currentGroup = [curr];
    }
  }
  // 最后一组
  _flushGroup(currentGroup, merged);

  return merged;
}

/**
 * 将一组过境写入结果数组，附加 trainCount
 */
function _flushGroup(group, output) {
  for (var j = 0; j < group.length; j++) {
    group[j].trainCount = group.length;
    output.push(group[j]);
  }
}

// ============================================================
// 亮度估算
// ============================================================

/**
 * 根据最大仰角估算亮度
 * @param {number} maxElev - 最大仰角（度）
 * @returns {{brightnessText: string, brightness: number}}
 */
function estimateBrightness(maxElev) {
  if (maxElev > 60) {
    return { brightnessText: 'bright', brightness: 1 };
  } else if (maxElev > 30) {
    return { brightnessText: 'medium', brightness: 2 };
  }
  return { brightnessText: 'dim', brightness: 3 };
}

// ============================================================
// 核心预测函数
// ============================================================

/**
 * 预测 Starlink 卫星可见过境
 *
 * @param {Array<{name: string, line1: string, line2: string}>} tleData - TLE 数据数组
 * @param {{lat: number, lng: number, alt: number}} observer - 观测者位置（度/米）
 * @param {number} [hours=24] - 预测时间窗口（小时）
 * @returns {Array} 过境数组，按 startTime 排序
 */
/** 单颗卫星的过境扫描（predictPasses / predictPassesAsync 共用） */
function _scanSatellitePasses(tle, observerGd, observer, startMs, endMs) {
  var rad2deg = 180 / Math.PI;
  var SCAN_STEP = 30 * 1000;   // 粗扫描步长：30 秒
  var REFINE_STEP = 10 * 1000; // 精细步长：10 秒
  var MIN_ELEV = 10;           // 最低仰角：10°

  var satrec;
  try {
    // 支持已解析的 satrec 对象（从渲染器复用，避免重复解析）
    satrec = tle._satrec || satellite.twoline2satrec(tle.line1, tle.line2);
  } catch (e) {
    return [];
  }

  var passes = [];
  var passStart = null;
  var maxElev = 0;
  var startAz = 0;
  var lastAz = 0;
  var lastTime = null;

  var scanTime = startMs;

  while (scanTime <= endMs) {
    try {
    var date = new Date(scanTime);
    var lookAngles = _getLookAngles(satrec, date, observerGd);

    if (!lookAngles) {
      scanTime += SCAN_STEP;
      continue;
    }

    var elevDeg = lookAngles.elevation * rad2deg;
    var azDeg = lookAngles.azimuth * rad2deg;

    // 获取卫星地理坐标用于日照判断
    var satGeo = _getSatGeo(satrec, date);
    var satAltKm = satGeo ? satGeo.height : 550;

    var isVisible = elevDeg >= MIN_ELEV &&
                    isSatelliteSunlit(date, satGeo, satAltKm) &&
                    isSkyDark(date, observer);

    if (isVisible) {
      if (!passStart) {
        // 过境开始 — 向前精细搜索确定精确起始
        passStart = date;
        startAz = azDeg;
        maxElev = elevDeg;
      }
      if (elevDeg > maxElev) {
        maxElev = elevDeg;
      }
      lastAz = azDeg;
      lastTime = date;
    } else {
      if (passStart && lastTime) {
        // 过境结束 — 向前精细搜索确定精确结束
        var refined = _refinePassEnd(
          satrec, observerGd, observer,
          lastTime.getTime(), scanTime,
          REFINE_STEP, MIN_ELEV, rad2deg
        );

        if (refined.maxElev > maxElev) maxElev = refined.maxElev;
        var actualEnd = refined.endTime || date;
        var actualEndAz = refined.endAz || lastAz;

        var duration = (actualEnd.getTime() - passStart.getTime()) / 1000; // 秒
        var bright = estimateBrightness(maxElev);

        passes.push({
          satName: tle.name || 'UNKNOWN',
          startTime: passStart,
          endTime: actualEnd,
          maxElev: Math.round(maxElev * 10) / 10,
          startAz: Math.round(startAz * 10) / 10,
          endAz: Math.round(actualEndAz * 10) / 10,
          duration: Math.round(duration),
          startDirection: azToDirection(startAz),
          endDirection: azToDirection(actualEndAz),
          brightnessText: bright.brightnessText,
          brightness: bright.brightness
        });

        // 重置
        passStart = null;
        maxElev = 0;
        startAz = 0;
        lastAz = 0;
        lastTime = null;
      }
    }
    } catch (e) { /* 单步轨道异常（如 RangeError）跳过 */ }

    scanTime += SCAN_STEP;
  }

  // 如果扫描结束时仍在过境中，也记录下来
  if (passStart && lastTime) {
    var duration2 = (lastTime.getTime() - passStart.getTime()) / 1000;
    var bright2 = estimateBrightness(maxElev);

    passes.push({
      satName: tle.name || 'UNKNOWN',
      startTime: passStart,
      endTime: lastTime,
      maxElev: Math.round(maxElev * 10) / 10,
      startAz: Math.round(startAz * 10) / 10,
      endAz: Math.round(lastAz * 10) / 10,
      duration: Math.round(duration2),
      startDirection: azToDirection(startAz),
      endDirection: azToDirection(lastAz),
      brightnessText: bright2.brightnessText,
      brightness: bright2.brightness
    });
  }

  return passes;
}

function _buildObserverGd(observer) {
  var deg2rad = Math.PI / 180;
  return {
    longitude: observer.lng * deg2rad,
    latitude: observer.lat * deg2rad,
    height: (observer.alt || 0) / 1000 // 米转千米
  };
}

function _finalizePasses(allPasses) {
  // 合并星链列车
  allPasses = mergeStarlinkTrains(allPasses);

  // 按开始时间排序
  allPasses.sort(function (a, b) {
    return a.startTime - b.startTime;
  });

  return allPasses;
}

function predictPasses(tleData, observer, hours) {
  hours = hours || 24;
  var observerGd = _buildObserverGd(observer);
  var startMs = Date.now();
  var endMs = startMs + hours * 3600000;

  var allPasses = [];
  for (var t = 0; t < tleData.length; t++) {
    var passes = _scanSatellitePasses(tleData[t], observerGd, observer, startMs, endMs);
    for (var p = 0; p < passes.length; p++) allPasses.push(passes[p]);
  }

  return _finalizePasses(allPasses);
}

/**
 * 分片异步版：每算完 chunkSize 颗卫星让出主线程一次，
 * 避免 200 颗 × 24h 的同步扫描长时间阻塞 UI（点击无响应/掉帧）
 */
function predictPassesAsync(tleData, observer, hours, chunkSize) {
  hours = hours || 24;
  chunkSize = chunkSize || 20;
  var observerGd = _buildObserverGd(observer);
  var startMs = Date.now();
  var endMs = startMs + hours * 3600000;

  return new Promise(function (resolve) {
    var allPasses = [];
    var index = 0;

    function runChunk() {
      var chunkEnd = Math.min(index + chunkSize, tleData.length);
      for (; index < chunkEnd; index++) {
        var passes = _scanSatellitePasses(tleData[index], observerGd, observer, startMs, endMs);
        for (var p = 0; p < passes.length; p++) allPasses.push(passes[p]);
      }
      if (index >= tleData.length) {
        resolve(_finalizePasses(allPasses));
        return;
      }
      setTimeout(runChunk, 0);
    }

    runChunk();
  });
}

// ============================================================
// 内部工具函数
// ============================================================

/**
 * 计算卫星在指定时刻的观测角度
 * @returns {{elevation: number, azimuth: number}|null} 弧度
 */
function _getLookAngles(satrec, date, observerGd) {
  try {
    var posVel = satellite.propagate(satrec, date);
    if (!posVel.position) return null;

    var gmst = satellite.gstime(date);
    var ecf = satellite.eciToEcf(posVel.position, gmst);
    var lookAngles = satellite.ecfToLookAngles(observerGd, ecf);

    return lookAngles;
  } catch (e) {
    return null;
  }
}

/**
 * 获取卫星地理坐标
 * @returns {{longitude: number, latitude: number, height: number}|null} 弧度/千米
 */
function _getSatGeo(satrec, date) {
  try {
    var posVel = satellite.propagate(satrec, date);
    if (!posVel.position) return null;

    var gmst = satellite.gstime(date);
    var geo = satellite.eciToGeodetic(posVel.position, gmst);

    return geo;
  } catch (e) {
    return null;
  }
}

/**
 * 精细搜索过境结束时刻
 * 在 [startMs, endMs] 区间内以 step 步长搜索
 */
function _refinePassEnd(satrec, observerGd, observer, startMs, endMs, step, minElev, rad2deg) {
  var result = { endTime: null, endAz: 0, maxElev: 0 };

  for (var ms = startMs; ms <= endMs; ms += step) {
    var date = new Date(ms);
    var lookAngles = _getLookAngles(satrec, date, observerGd);
    if (!lookAngles) continue;

    var elevDeg = lookAngles.elevation * rad2deg;
    var azDeg = lookAngles.azimuth * rad2deg;

    var satGeo = _getSatGeo(satrec, date);
    var satAltKm = satGeo ? satGeo.height : 550;

    var isVisible = elevDeg >= minElev &&
                    isSatelliteSunlit(date, satGeo, satAltKm) &&
                    isSkyDark(date, observer);

    if (isVisible) {
      result.endTime = date;
      result.endAz = azDeg;
      if (elevDeg > result.maxElev) {
        result.maxElev = elevDeg;
      }
    } else {
      break;
    }
  }

  return result;
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  predictPasses: predictPasses,
  predictPassesAsync: predictPassesAsync
};
