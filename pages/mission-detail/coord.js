/**
 * 坐标系转换工具（分包内私有版本，避免主包出现"未使用"提示）
 *
 * 微信小程序的 <map> 组件在中国大陆默认使用 GCJ-02（火星坐标系），
 * 而绝大多数 API（包括 Launch Library 2 / SpaceX API / NASA 等）以及
 * GPS 设备返回的都是 WGS-84（GPS 原始坐标系）。
 *
 * 在中国大陆，两者会有数百米的偏移（WGS-84 相对 GCJ-02 偏向西南方向），
 * 直接把 WGS-84 坐标喂给 <map> 会出现"标点跑到海里 / 路边"的现象。
 *
 * 国外区域不需要转换（GCJ-02 仅在中国大陆境内有偏移）。
 */

const PI = Math.PI
const A = 6378245.0
const EE = 0.00669342162296594323

function outOfChina(lng, lat) {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55)
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320.0 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0
  return ret
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0
  return ret
}

function wgs84ToGcj02(lng, lat) {
  const numLng = Number(lng)
  const numLat = Number(lat)
  if (!isFinite(numLng) || !isFinite(numLat)) return { lng: numLng, lat: numLat }
  if (outOfChina(numLng, numLat)) return { lng: numLng, lat: numLat }

  let dlat = transformLat(numLng - 105.0, numLat - 35.0)
  let dlng = transformLng(numLng - 105.0, numLat - 35.0)
  const radlat = (numLat / 180.0) * PI
  let magic = Math.sin(radlat)
  magic = 1 - EE * magic * magic
  const sqrtmagic = Math.sqrt(magic)
  dlat = (dlat * 180.0) / (((A * (1 - EE)) / (magic * sqrtmagic)) * PI)
  dlng = (dlng * 180.0) / ((A / sqrtmagic) * Math.cos(radlat) * PI)
  return { lng: numLng + dlng, lat: numLat + dlat }
}

module.exports = {
  wgs84ToGcj02,
  outOfChina
}
