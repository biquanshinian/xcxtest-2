/**
 * 航天摄影（影像）API — 仅 news / 上传 / 详情 使用，放分包以削减主包体积
 */
const CF_NAME = 'astroPhotos'

function callAstroPhotos(action, data = {}) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('云能力不可用'))
  }
  return wx.cloud.callFunction({
    name: CF_NAME,
    data: Object.assign({ action }, data || {})
  }).then((res) => {
    const result = (res && res.result) || {}
    if (result.code !== 0 && result.code != null) {
      const err = new Error(result.message || '请求失败')
      err.code = result.code
      err.data = result.data
      throw err
    }
    return result.data != null ? result.data : result
  }).catch((err) => {
    if (err && err.code != null && err.message) throw err
    const msg = (err && (err.errMsg || err.message)) || '请求失败'
    // 云函数未部署时给出可读提示
    if (/FUNCTION_NOT_FOUND|FunctionName/i.test(msg)) {
      throw new Error('云函数未部署，请先上传 astroPhotos')
    }
    throw new Error(msg.replace(/^cloud\.callFunction:fail\s*/i, '').slice(0, 60) || '请求失败')
  })
}

function getPresign(opts) {
  return callAstroPhotos('getPresign', opts || {})
}

function submitPhotoAlbum(payload) {
  return callAstroPhotos('submit', payload || {})
}

function listPublicPhotos(page = 0, pageSize = 10) {
  return callAstroPhotos('listPublic', { page, pageSize })
}

function getPhotoDetail(id) {
  return callAstroPhotos('getDetail', { id })
}

function listMinePhotos(page = 0, pageSize = 20) {
  return callAstroPhotos('listMine', { page, pageSize })
}

function deleteMinePhoto(id) {
  return callAstroPhotos('deleteMine', { id, photoId: id })
}

function editMinePhoto(payload) {
  return callAstroPhotos('editMine', payload || {})
}

module.exports = {
  callAstroPhotos,
  getPresign,
  submitPhotoAlbum,
  listPublicPhotos,
  getPhotoDetail,
  listMinePhotos,
  deleteMinePhoto,
  editMinePhoto
}
