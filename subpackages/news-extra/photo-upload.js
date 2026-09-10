const pageBase = require('../../utils/page-base.js')
const { isFeatureEnabled } = require('../../utils/feature-flags.js')
const {
  submitPhotoAlbum,
  editMinePhoto,
  getPhotoDetail
} = require('./utils/api-astro-photos.js')
const { displayImageUrl } = require('../../utils/cos-url.js')
const storageCache = require('../../utils/storage-sync-cache.js')

const MAX_PHOTOS = 8
const MAX_BYTES = 30 * 1024 * 1024
const MAX_EDGE = 3840
const UPLOAD_PASSWORD = 'zghtzp'
const PHOTOS_CACHE_KEY = 'news_cache_photos_v2'
const PHOTOS_CACHE_KEYS_LEGACY = ['news_cache_photos_v1']

function extFromPath(path, mime) {
  const m = String(mime || '').toLowerCase()
  if (m.indexOf('png') >= 0) return 'png'
  if (m.indexOf('webp') >= 0) return 'webp'
  if (m.indexOf('heic') >= 0) return 'heic'
  const p = String(path || '').toLowerCase()
  const i = p.lastIndexOf('.')
  if (i >= 0) {
    const e = p.slice(i + 1)
    if (e === 'png' || e === 'webp' || e === 'heic' || e === 'jpg' || e === 'jpeg') {
      return e === 'jpeg' ? 'jpg' : e
    }
  }
  return 'jpg'
}

function getImageInfo(path) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: path,
      success: resolve,
      fail: reject
    })
  })
}

/** 先上传到微信云存储，再由云函数转存 COS（绕过直传签名/域名问题） */
function uploadToCloudTemp(filePath, ext) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      reject(new Error('云能力不可用'))
      return
    }
    const cloudPath = `astro_photo_tmp/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext || 'jpg'}`
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => {
        if (res && res.fileID) resolve(res.fileID)
        else reject(new Error('云存储上传失败'))
      },
      fail: (err) => reject(new Error((err && (err.errMsg || err.message)) || '云存储上传失败'))
    })
  })
}

Page({
  behaviors: [pageBase],
  _fallbackTab: '/pages/news/news',

  data: {
    isEdit: false,
    editId: '',
    navTitle: '航天摄影投稿',
    photos: [],
    uploadPassword: '',
    authorName: '',
    location: '',
    deviceModel: '',
    shotAt: '',
    intro: '',
    submitting: false,
    draggingUid: '',
    scrollEnabled: true
  },

  async onLoad(options) {
    this.initUiShell()
    this._uidSeq = 0
    const on = await isFeatureEnabled('enableAstroPhotos', { defaultOff: true, failClosed: true })
    if (!on) {
      wx.showToast({ title: '航天摄影投稿暂未开放', icon: 'none' })
      setTimeout(() => this.goBack(), 1200)
      return
    }

    let gatePwd = ''
    let editId = ''
    let editSnapshot = null
    try {
      const app = getApp()
      const gate = app && app._astroPhotoUploadGate
      if (gate && gate.password && Date.now() - (gate.at || 0) < 5 * 60 * 1000) {
        gatePwd = String(gate.password)
        if (gate.editId) {
          editId = String(gate.editId)
          editSnapshot = gate.item || null
        }
      }
      if (app) app._astroPhotoUploadGate = null
    } catch (e) {}

    const queryId = String((options && options.id) || '').trim()
    if (!editId && queryId) editId = queryId

    if (!gatePwd || gatePwd !== UPLOAD_PASSWORD) {
      wx.showToast({ title: '请先验证投稿密码', icon: 'none' })
      setTimeout(() => this.goBack(), 1000)
      return
    }

    if (editId) {
      this.setData({
        uploadPassword: gatePwd,
        isEdit: true,
        editId,
        navTitle: '重新编辑投稿'
      })
      await this._loadEditDraft(editId, editSnapshot)
      return
    }

    this.setData({ uploadPassword: gatePwd, isEdit: false, editId: '' })
  },

  async _loadEditDraft(editId, snapshot) {
    wx.showLoading({ title: '加载中…', mask: true })
    try {
      let doc = snapshot
      if (!doc || !doc.canEdit) {
        doc = await getPhotoDetail(editId)
      }
      if (!doc || !doc.isOwner) {
        throw new Error('只能编辑自己的投稿')
      }
      if (!doc.canEdit) {
        throw new Error('每条投稿仅可重新编辑一次')
      }
      const photos = (Array.isArray(doc.photos) ? doc.photos : []).map((p) => {
        const url = (p && p.url) || ''
        return {
          uid: this._nextUid(),
          isRemote: true,
          path: '',
          url: url ? displayImageUrl(url, 'thumb') : url,
          rawUrl: url,
          cosKey: (p && p.cosKey) || '',
          width: Number(p && p.width) || 1,
          height: Number(p && p.height) || 1,
          aspectRatio: Number(p && p.aspectRatio) || 1,
          size: 0,
          ext: 'jpg'
        }
      }).filter((p) => p.rawUrl || p.cosKey)

      this.setData({
        photos,
        authorName: doc.authorName || '',
        location: doc.location || '',
        deviceModel: doc.deviceModel || '',
        shotAt: doc.shotAt || '',
        intro: doc.intro || ''
      })
    } catch (e) {
      wx.showToast({
        title: String((e && (e.message || e.errMsg)) || '加载失败').slice(0, 40),
        icon: 'none'
      })
      setTimeout(() => this.goBack(), 1200)
    } finally {
      wx.hideLoading()
    }
  },

  onShow() {
    if (typeof this.syncTheme === 'function') this.syncTheme()
  },

  _nextUid() {
    this._uidSeq = (this._uidSeq || 0) + 1
    return `p_${Date.now()}_${this._uidSeq}`
  },

  onAuthorInput(e) {
    this.setData({ authorName: (e.detail && e.detail.value) || '' })
  },
  onLocationInput(e) {
    this.setData({ location: (e.detail && e.detail.value) || '' })
  },
  onDeviceInput(e) {
    this.setData({ deviceModel: (e.detail && e.detail.value) || '' })
  },
  onIntroInput(e) {
    this.setData({ intro: (e.detail && e.detail.value) || '' })
  },
  onShotAtChange(e) {
    this.setData({ shotAt: (e.detail && e.detail.value) || '' })
  },

  removePhoto(e) {
    if (this._dragging) return
    const index = Number(e.currentTarget.dataset.index)
    if (isNaN(index)) return
    const photos = (this.data.photos || []).slice()
    photos.splice(index, 1)
    this.setData({ photos })
  },

  _cacheItemRects() {
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .in(this)
        .selectAll('.photo-grid-item')
        .boundingClientRect((rects) => {
          this._itemRects = Array.isArray(rects) ? rects : []
          resolve(this._itemRects)
        })
        .exec()
    })
  },

  async onPhotoLongPress(e) {
    if (this.data.submitting) return
    const index = Number(e.currentTarget.dataset.index)
    const photos = this.data.photos || []
    if (isNaN(index) || !photos[index]) return
    this._dragging = true
    this._dragFromIndex = index
    this._lastSwapAt = 0
    await this._cacheItemRects()
    this.setData({
      draggingUid: photos[index].uid,
      scrollEnabled: false
    })
    try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
  },

  onGridTouchMove(e) {
    if (!this._dragging) return
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
    if (!touch) return
    const rects = this._itemRects || []
    let over = -1
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      if (!r) continue
      if (
        touch.clientX >= r.left &&
        touch.clientX <= r.right &&
        touch.clientY >= r.top &&
        touch.clientY <= r.bottom
      ) {
        over = i
        break
      }
    }
    if (over < 0 || over === this._dragFromIndex) return
    const now = Date.now()
    if (now - (this._lastSwapAt || 0) < 80) return
    this._lastSwapAt = now

    const photos = (this.data.photos || []).slice()
    const [item] = photos.splice(this._dragFromIndex, 1)
    photos.splice(over, 0, item)
    this._dragFromIndex = over
    this.setData({ photos, draggingUid: item.uid })
    this._cacheItemRects()
  },

  onGridTouchEnd() {
    if (!this._dragging) return
    this._dragging = false
    this._dragFromIndex = -1
    this.setData({ draggingUid: '', scrollEnabled: true })
  },

  choosePhotos() {
    if (this._dragging) return
    const remain = MAX_PHOTOS - (this.data.photos || []).length
    if (remain <= 0) {
      wx.showToast({ title: '最多 8 张', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'],
      success: async (res) => {
        const files = (res && res.tempFiles) || []
        const accepted = (this.data.photos || []).slice()
        for (const f of files) {
          if (accepted.length >= MAX_PHOTOS) break
          const path = f.tempFilePath || f.path
          const size = Number(f.size) || 0
          if (!path) continue
          if (size > MAX_BYTES) {
            wx.showToast({ title: '有照片超过 30MB', icon: 'none' })
            continue
          }
          try {
            const info = await getImageInfo(path)
            const w = Number(info.width) || 0
            const h = Number(info.height) || 0
            if (Math.max(w, h) > MAX_EDGE) {
              wx.showToast({ title: '有照片超过 4K', icon: 'none' })
              continue
            }
            accepted.push({
              uid: this._nextUid(),
              isRemote: false,
              path,
              url: '',
              rawUrl: '',
              cosKey: '',
              size,
              width: w,
              height: h,
              aspectRatio: w > 0 && h > 0 ? w / h : 1,
              ext: extFromPath(path, f.fileType || f.type)
            })
          } catch (e) {
            wx.showToast({ title: '读取图片信息失败', icon: 'none' })
          }
        }
        this.setData({ photos: accepted })
      }
    })
  },

  async onSubmit() {
    if (this.data.submitting) return
    this.onGridTouchEnd()
    const photos = this.data.photos || []
    const authorName = String(this.data.authorName || '').trim()
    const uploadPassword = String(this.data.uploadPassword || '').trim()
    if (!uploadPassword || uploadPassword !== UPLOAD_PASSWORD) {
      wx.showToast({ title: '投稿密码已失效，请返回重试', icon: 'none' })
      return
    }
    if (!photos.length) {
      wx.showToast({ title: '请先选择照片', icon: 'none' })
      return
    }
    if (!authorName) {
      wx.showToast({ title: '请填写作者名字', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '处理中…', mask: true })
    try {
      const payloadPhotos = []
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i]
        if (p.isRemote && (p.rawUrl || p.cosKey)) {
          payloadPhotos.push({
            url: p.rawUrl,
            cosKey: p.cosKey,
            width: p.width,
            height: p.height,
            aspectRatio: p.aspectRatio
          })
          continue
        }
        wx.showLoading({ title: `上传 ${i + 1}/${photos.length}`, mask: true })
        const fileID = await uploadToCloudTemp(p.path, p.ext || 'jpg')
        payloadPhotos.push({
          fileID,
          width: p.width,
          height: p.height,
          size: p.size,
          aspectRatio: p.aspectRatio,
          ext: p.ext || 'jpg'
        })
      }

      const body = {
        password: uploadPassword,
        authorName,
        location: String(this.data.location || '').trim(),
        deviceModel: String(this.data.deviceModel || '').trim(),
        shotAt: String(this.data.shotAt || '').trim(),
        intro: String(this.data.intro || '').trim(),
        photos: payloadPhotos
      }

      wx.showLoading({ title: this.data.isEdit ? '保存中…' : '发布中…', mask: true })
      let submitRes
      if (this.data.isEdit) {
        submitRes = await editMinePhoto(Object.assign({ id: this.data.editId, photoId: this.data.editId }, body))
      } else {
        submitRes = await submitPhotoAlbum(body)
      }

      try {
        ;[PHOTOS_CACHE_KEY].concat(PHOTOS_CACHE_KEYS_LEGACY).forEach((key) => {
          storageCache.invalidate(key)
          wx.removeStorage({ key, fail() {} })
        })
        const app = getApp()
        if (app) app._astroPhotosNeedRefresh = Date.now()
      } catch (e) {}

      wx.hideLoading()
      const status = submitRes && submitRes.status
      wx.showToast({
        title: status === 'pending'
          ? '已提交审核'
          : (this.data.isEdit ? '编辑成功' : '发布成功'),
        icon: 'success'
      })
      setTimeout(() => this.goBack(), 800)
    } catch (e) {
      wx.hideLoading()
      const msg = (e && (e.message || e.errMsg)) || '提交失败'
      wx.showToast({
        title: String(msg).slice(0, 40),
        icon: 'none',
        duration: 2800
      })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
