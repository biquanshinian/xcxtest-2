/**
 * 中国区磁偏角简化模型
 *
 * 基于 WMM2025 在若干中国城市的磁偏角锚点，用反距离加权（IDW）插值，
 * 中国区内精度约 1° 以内，避免引入完整 WMM 系数表。
 *
 * 符号约定：磁偏角 declination 以「东偏为正、西偏为负」（中国大部为西偏，即负值）。
 * 真北方位 = 罗盘磁方位 + declination
 * 例：北京 declination ≈ -7°，罗盘读数 100° 对应真北方位 93°。
 */

// [纬度, 经度, 磁偏角(度, 东偏为正)] — WMM2025 近似锚点
var ANCHORS = [
  [53.5, 122.3, -11],   // 漠河
  [45.8, 126.6, -9.5],  // 哈尔滨
  [39.9, 116.4, -7],    // 北京
  [31.2, 121.5, -6],    // 上海
  [34.3, 108.9, -4],    // 西安
  [23.1, 113.3, -3],    // 广州
  [30.6, 104.1, -2.5],  // 成都
  [25.0, 102.7, -1.8],  // 昆明
  [29.7, 91.1, 0],      // 拉萨
  [43.8, 87.6, 3]       // 乌鲁木齐
];

// 中国区大致经纬度范围，超出范围 clamp 到边界再插值
var LAT_MIN = 18, LAT_MAX = 54;
var LNG_MIN = 73, LNG_MAX = 135;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * 获取指定位置的磁偏角（度，东偏为正）
 * @param {number} lat 纬度（度）
 * @param {number} lng 经度（度）
 * @returns {number} 磁偏角，无效输入返回 0（即不修正）
 */
function getDeclination(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return 0;
  }
  lat = clamp(lat, LAT_MIN, LAT_MAX);
  lng = clamp(lng, LNG_MIN, LNG_MAX);

  // 反距离加权插值（p=2）；命中锚点 0.1° 内直接取锚点值
  var sumW = 0;
  var sumWD = 0;
  for (var i = 0; i < ANCHORS.length; i++) {
    var dLat = lat - ANCHORS[i][0];
    // 经度距离按纬度余弦缩放，近似等距
    var dLng = (lng - ANCHORS[i][1]) * Math.cos(lat * Math.PI / 180);
    var d2 = dLat * dLat + dLng * dLng;
    if (d2 < 0.01) {
      return ANCHORS[i][2];
    }
    var w = 1 / d2;
    sumW += w;
    sumWD += w * ANCHORS[i][2];
  }
  return sumW > 0 ? (sumWD / sumW) : 0;
}

module.exports = {
  getDeclination: getDeclination
};
