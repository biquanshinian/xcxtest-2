/**
 * 用户身份展示：自定义昵称 / 头像 / OpenID（本地优先 + 云端同步）
 */
const storageCache = require('./storage-sync-cache.js')

const STORAGE_KEY = '_user_identity'
const DEFAULT_DISPLAY_NAME = '太空探索者'
/** 已废弃默认火星图：无自定义头像时前端显示「+」 */
const DEFAULT_AVATAR = ''
const LEGACY_DEFAULT_AVATAR = '/images/default-mars-avatar.png'
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const MAX_NAME_LEN = 16
const CLOUD_FN = 'userDataGateway'

function _raw() {
  const v = storageCache.readMemOrSync(STORAGE_KEY, null)
  return v && typeof v === 'object' ? v : {}
}

function maskOpenId(openid) {
  const s = String(openid || '').trim()
  if (!s) return ''
  if (s.length <= 8) {
    return s.slice(0, 1) + '·········' + s.slice(-1)
  }
  return s.slice(0, 4) + '·········' + s.slice(-4)
}

/** 仅保留用户上传的头像；旧默认火星图视为未设置 */
function normalizeAvatarUrl(url, fileID) {
  const file = String(fileID || '').trim()
  let u = String(url || file || '').trim()
  if (!u) return ''
  if (u === LEGACY_DEFAULT_AVATAR || u.indexOf('default-mars-avatar') >= 0) return ''
  return u
}

function loadIdentity() {
  const raw = _raw()
  const displayName = String(raw.displayName || '').trim() || DEFAULT_DISPLAY_NAME
  const avatarFileID = String(raw.avatarFileID || '').trim()
  const avatarUrl = normalizeAvatarUrl(raw.avatarUrl, avatarFileID)
  return {
    displayName,
    avatarUrl,
    avatarFileID: avatarUrl ? avatarFileID : '',
    openid: String(raw.openid || '').trim(),
    updatedAt: Number(raw.updatedAt) || 0
  }
}

/** 供页面 setData 的视图字段 */
function getIdentityView() {
  const id = loadIdentity()
  return {
    identityDisplayName: id.displayName,
    identityAvatarUrl: id.avatarUrl,
    identityHasAvatar: !!id.avatarUrl,
    identityOpenId: id.openid,
    identityOpenIdMasked: maskOpenId(id.openid)
  }
}

function _hasCustomIdentity(id) {
  if (!id || typeof id !== 'object') return false
  const avatar = String(id.avatarFileID || id.avatarUrl || '').trim()
  if (avatar && normalizeAvatarUrl(avatar, id.avatarFileID)) return true
  const name = String(id.displayName || '').trim()
  return !!(name && name !== DEFAULT_DISPLAY_NAME)
}

function saveIdentityLocal(patch) {
  const cur = _raw()
  const next = {
    displayName: cur.displayName || '',
    avatarUrl: cur.avatarUrl || '',
    avatarFileID: cur.avatarFileID || '',
    openid: cur.openid || '',
    // 默认保留旧时间戳：仅写 openid 时绝不能把 updatedAt 刷成「现在」，
    // 否则删小程序重装后会判定本地比云端新，导致云端头像/昵称拉不回来。
    updatedAt: Number(cur.updatedAt) || 0
  }
  var contentChanged = false
  if (patch && typeof patch === 'object') {
    if (patch.displayName != null) {
      next.displayName = String(patch.displayName || '').trim().slice(0, MAX_NAME_LEN)
      contentChanged = true
    }
    if (patch.avatarUrl != null) {
      next.avatarUrl = String(patch.avatarUrl || '').trim()
      contentChanged = true
    }
    if (patch.avatarFileID != null) {
      next.avatarFileID = String(patch.avatarFileID || '').trim()
      contentChanged = true
    }
    if (patch.openid != null) next.openid = String(patch.openid || '').trim()
    if (patch.updatedAt != null) {
      next.updatedAt = Number(patch.updatedAt) || 0
    } else if (contentChanged) {
      next.updatedAt = Date.now()
    }
  }
  storageCache.persistAsync(STORAGE_KEY, next)
  return loadIdentity()
}

/** 云端 identity 字段合并到本地（较新者胜；本地无自定义内容时优先恢复云端） */
function mergeIdentityFromCloud(cloudIdentity, openid) {
  if (openid) {
    const cur = _raw()
    if (!cur.openid || cur.openid !== String(openid)) {
      saveIdentityLocal({ openid: String(openid) })
    }
  }
  if (!cloudIdentity || typeof cloudIdentity !== 'object') {
    return loadIdentity()
  }
  const local = loadIdentity()
  const cloudAt = Number(cloudIdentity.updatedAt) || 0
  const localAt = Number(local.updatedAt) || 0
  const cloudHas = _hasCustomIdentity(cloudIdentity) || !!cloudAt
  const localHas = _hasCustomIdentity(local)
  // 重装后本地空：即使云端 updatedAt 不比本地「新」，也要恢复
  const shouldTakeCloud =
    (cloudAt > localAt) ||
    (!localHas && cloudHas)

  if (!shouldTakeCloud) return local

  const fileID = String(cloudIdentity.avatarFileID || '').trim()
  const name = String(cloudIdentity.displayName || '').trim()
  return saveIdentityLocal({
    displayName: name || DEFAULT_DISPLAY_NAME,
    avatarFileID: fileID,
    avatarUrl: fileID || '',
    openid: openid || local.openid,
    updatedAt: cloudAt || Date.now()
  })
}

function pushIdentityToCloud() {
  if (!wx.cloud || !wx.cloud.callFunction) return
  const id = loadIdentity()
  wx.cloud.callFunction({
    name: CLOUD_FN,
    data: {
      action: 'saveIdentity',
      identity: {
        displayName: id.displayName === DEFAULT_DISPLAY_NAME ? id.displayName : id.displayName,
        avatarFileID: id.avatarFileID || '',
        updatedAt: id.updatedAt || Date.now()
      }
    }
  }).catch(function () {})
}

/** 确保本地有 openid（必要时打一次 getProfile） */
function ensureOpenId() {
  const cur = loadIdentity()
  if (cur.openid) return Promise.resolve(cur.openid)
  if (!wx.cloud || !wx.cloud.callFunction) return Promise.resolve('')
  return wx.cloud
    .callFunction({ name: CLOUD_FN, data: { action: 'getProfile' } })
    .then(function (res) {
      const r = (res && res.result) || {}
      const openid = String(r.openid || (r.profile && r.profile.openid) || '').trim()
      if (openid) {
        mergeIdentityFromCloud(r.profile && r.profile.identity, openid)
      }
      return openid
    })
    .catch(function () {
      return ''
    })
}

function getFileSize(filePath) {
  return new Promise(function (resolve) {
    try {
      wx.getFileSystemManager().getFileInfo({
        filePath: filePath,
        success: function (r) {
          resolve(Number(r && r.size) || 0)
        },
        fail: function () {
          resolve(0)
        }
      })
    } catch (e) {
      resolve(0)
    }
  })
}

/**
 * 选图并上传头像（≤2MB）
 * @returns {Promise<{avatarUrl:string, avatarFileID:string}>}
 */
function chooseAndUploadAvatar() {
  return new Promise(function (resolve, reject) {
    if (typeof wx.chooseMedia !== 'function') {
      wx.showToast({ title: '当前基础库不支持选图', icon: 'none' })
      reject(new Error('no chooseMedia'))
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: function (res) {
        const f = ((res && res.tempFiles) || [])[0]
        if (!f || !f.tempFilePath) {
          reject(new Error('empty'))
          return
        }
        const path = f.tempFilePath
        Promise.resolve(Number(f.size) || 0)
          .then(function (size) {
            if (size > 0) return size
            return getFileSize(path)
          })
          .then(function (size) {
            if (size > MAX_AVATAR_BYTES) {
              wx.showToast({ title: '图片不能超过 2MB', icon: 'none' })
              reject(new Error('too large'))
              return null
            }
            if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
              wx.showToast({ title: '云能力不可用', icon: 'none' })
              reject(new Error('no cloud'))
              return null
            }
            wx.showLoading({ title: '上传中', mask: true })
            return ensureOpenId().then(function (openid) {
              const uid = openid || 'anon'
              const ext = /\.png$/i.test(path) ? 'png' : 'jpg'
              const cloudPath = 'user_avatars/' + uid + '_' + Date.now() + '.' + ext
              return new Promise(function (resUp, rejUp) {
                wx.cloud.uploadFile({
                  cloudPath: cloudPath,
                  filePath: path,
                  success: function (up) {
                    resUp(up && up.fileID)
                  },
                  fail: rejUp
                })
              })
            }).then(function (fileID) {
              try { wx.hideLoading() } catch (e) {}
              return fileID
            }, function (err) {
              try { wx.hideLoading() } catch (e) {}
              throw err
            })
          })
          .then(function (fileID) {
            if (!fileID) return
            saveIdentityLocal({
              avatarFileID: fileID,
              avatarUrl: fileID
            })
            pushIdentityToCloud()
            resolve({ avatarUrl: fileID, avatarFileID: fileID })
          })
          .catch(function (err) {
            try { wx.hideLoading() } catch (e) {}
            if (err && (err.message === 'too large' || err.message === 'no cloud')) {
              reject(err)
              return
            }
            wx.showToast({ title: '上传失败，请重试', icon: 'none' })
            reject(err)
          })
      },
      fail: function (err) {
        const msg = String((err && err.errMsg) || '')
        if (msg.indexOf('cancel') >= 0 || msg.indexOf('取消') >= 0) {
          reject(new Error('cancel'))
          return
        }
        if (msg.indexOf('privacy') >= 0 || msg.indexOf('authorize') >= 0) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在微信公众平台用户隐私保护指引中声明「选中的照片」，并通过后再试。',
            showCancel: false
          })
        }
        reject(err || new Error('choose fail'))
      }
    })
  })
}

function setDisplayName(name) {
  const trimmed = String(name || '').trim().slice(0, MAX_NAME_LEN)
  const next = trimmed || DEFAULT_DISPLAY_NAME
  saveIdentityLocal({ displayName: next })
  pushIdentityToCloud()
  return next
}

module.exports = {
  DEFAULT_DISPLAY_NAME,
  DEFAULT_AVATAR,
  MAX_AVATAR_BYTES,
  MAX_NAME_LEN,
  maskOpenId,
  loadIdentity,
  getIdentityView,
  saveIdentityLocal,
  mergeIdentityFromCloud,
  pushIdentityToCloud,
  ensureOpenId,
  chooseAndUploadAvatar,
  setDisplayName
}
