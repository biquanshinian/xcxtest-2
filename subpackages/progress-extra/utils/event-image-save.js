/**
 * 事件更新图片：预览用压缩图，下载用原图；多图长按选择保存。
 */
const { stripImageProcess } = require('../../../utils/ll2-image.js')
const { pooledDownloadFile } = require('../../../utils/download-pool.js')

function normalizeOriginalUrl(url) {
  const s = String(url || '').trim()
  if (!s) return ''
  if (/^wxfile:\/\//i.test(s) || /^http:\/\/tmp\//i.test(s)) return s
  return stripImageProcess(s) || s
}

/**
 * 保存图片到相册。返回 Promise（成功 resolve，失败 reject）。
 * @param {string} imageUrl
 * @param {{ silent?: boolean }} [opts] silent 时不弹单张成功 toast（多选批量用）
 */
function saveImageToAlbum(imageUrl, opts) {
  const silent = !!(opts && opts.silent)
  return new Promise(async (resolve, reject) => {
    if (!imageUrl) {
      reject(new Error('empty url'))
      return
    }

    const app = getApp && getApp()
    if (app && typeof app.ensurePrivacyAuthorized === 'function') {
      const privacyRes = await app.ensurePrivacyAuthorized()
      if (privacyRes && privacyRes.ok === false) {
        if (!silent) wx.showToast({ title: '请先同意隐私指引后再保存图片', icon: 'none' })
        reject(new Error('privacy'))
        return
      }
    }

    if (!silent) wx.showLoading({ title: '保存中...', mask: true })

    const onSuccess = () => {
      if (!silent) {
        wx.hideLoading()
        wx.showToast({ title: '保存成功', icon: 'success' })
      }
      resolve()
    }

    const onFail = (err) => {
      if (!silent) wx.hideLoading()
      const msg = (err && err.errMsg) || ''
      if (msg.includes('auth deny') || msg.includes('authorize')) {
        wx.showModal({
          title: '需要授权',
          content: '请在设置中开启"保存到相册"权限',
          showCancel: false
        })
      } else if (!silent) {
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
      reject(err || new Error('save fail'))
    }

    if (/^https?:\/\//.test(imageUrl)) {
      pooledDownloadFile({ url: imageUrl })
        .then((res) => {
          if (res.statusCode === 200 && res.tempFilePath) {
            wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath, success: onSuccess, fail: onFail })
          } else {
            onFail({ errMsg: 'download fail' })
          }
        })
        .catch(onFail)
      return
    }

    wx.saveImageToPhotosAlbum({ filePath: imageUrl, success: onSuccess, fail: onFail })
  })
}

/**
 * @param {object} page 页面实例（可挂 saveImageToAlbum；缺省用本模块实现）
 * @param {{ originals: string[], thumbs?: string[], current?: string }} opts
 */
function handleEventImageLongPress(page, opts) {
  let originals = (opts && Array.isArray(opts.originals) ? opts.originals : [])
    .map(normalizeOriginalUrl)
    .filter(Boolean)
  const thumbs = (opts && Array.isArray(opts.thumbs) ? opts.thumbs : []).slice()
  if (!originals.length && thumbs.length) {
    originals = thumbs.map(normalizeOriginalUrl).filter(Boolean)
  }
  if (!originals.length) {
    wx.showToast({ title: '暂无可保存图片', icon: 'none' })
    return
  }
  const thumbCurrent = String((opts && (opts.thumbCurrent || opts.current)) || '')
  let current = normalizeOriginalUrl(opts && opts.original)
  if (!current || originals.indexOf(current) < 0) {
    const thumbList = thumbs.length === originals.length ? thumbs : []
    const thumbIdx = thumbList.indexOf(thumbCurrent)
    current = thumbIdx >= 0 ? originals[thumbIdx] : originals[0]
  }

  if (originals.length === 1) {
    wx.showActionSheet({
      itemList: ['保存原图'],
      success: (res) => {
        if (res.tapIndex === 0) {
          const fn = (page && page.saveImageToAlbum) || saveImageToAlbum
          Promise.resolve(fn.call(page, originals[0])).catch(() => {})
        }
      }
    })
    return
  }

  wx.showActionSheet({
    itemList: ['保存此图原图', '选择图片保存'],
    success: (res) => {
      if (res.tapIndex === 0) {
        const fn = (page && page.saveImageToAlbum) || saveImageToAlbum
        Promise.resolve(fn.call(page, current)).catch(() => {})
        return
      }
      if (res.tapIndex === 1) {
        openEventImageSavePicker(page, {
          originals,
          thumbs: thumbs.length === originals.length ? thumbs : originals,
          preselectUrl: current
        })
      }
    }
  })
}

function openEventImageSavePicker(page, opts) {
  const originals = (opts && opts.originals) || []
  const thumbs = (opts && opts.thumbs) || originals
  const pre = normalizeOriginalUrl(opts && opts.preselectUrl)
  const selected = originals.map((url) => url === pre)
  if (!selected.some(Boolean) && selected.length) selected[0] = true
  page.setData({
    showEventImageSavePicker: true,
    eventImageSaveThumbs: thumbs,
    eventImageSaveOriginals: originals,
    eventImageSaveSelected: selected
  })
}

function closeEventImageSavePicker(page) {
  page.setData({
    showEventImageSavePicker: false,
    eventImageSaveThumbs: [],
    eventImageSaveOriginals: [],
    eventImageSaveSelected: []
  })
}

function toggleEventImageSaveSelect(page, index) {
  const idx = Number(index)
  const selected = (page.data.eventImageSaveSelected || []).slice()
  if (idx < 0 || idx >= selected.length) return
  selected[idx] = !selected[idx]
  page.setData({ eventImageSaveSelected: selected })
}

function selectAllEventImageSave(page) {
  const originals = page.data.eventImageSaveOriginals || []
  const selected = page.data.eventImageSaveSelected || []
  const allOn = selected.length === originals.length && selected.every(Boolean)
  page.setData({
    eventImageSaveSelected: originals.map(() => !allOn)
  })
}

async function confirmEventImageSavePicker(page) {
  const originals = page.data.eventImageSaveOriginals || []
  const selected = page.data.eventImageSaveSelected || []
  const urls = originals.filter((_, i) => selected[i])
  if (!urls.length) {
    wx.showToast({ title: '请先选择图片', icon: 'none' })
    return
  }
  closeEventImageSavePicker(page)
  wx.showLoading({ title: '保存中...', mask: true })
  let ok = 0
  let fail = 0
  const fn = (page && page.saveImageToAlbum) || saveImageToAlbum
  for (let i = 0; i < urls.length; i++) {
    try {
      await Promise.resolve(fn.call(page, urls[i], { silent: true }))
      ok++
    } catch (e) {
      fail++
      // 权限拒绝后不再继续
      const msg = (e && e.errMsg) || ''
      if (msg.includes('auth deny') || msg.includes('authorize')) break
    }
  }
  wx.hideLoading()
  if (ok > 0 && fail === 0) {
    wx.showToast({ title: ok > 1 ? `已保存 ${ok} 张` : '保存成功', icon: 'success' })
  } else if (ok > 0) {
    wx.showToast({ title: `已保存 ${ok} 张，失败 ${fail} 张`, icon: 'none' })
  } else {
    wx.showToast({ title: '保存失败', icon: 'none' })
  }
}

/** 从长按事件 dataset 解析（兼容 originals 数组 / JSON 字符串） */
function parseLongPressDataset(dataset) {
  const ds = dataset || {}
  let originals = ds.originals
  let thumbs = ds.thumbs
  if (typeof originals === 'string') {
    try { originals = JSON.parse(originals) } catch (e) { originals = [] }
  }
  if (typeof thumbs === 'string') {
    try { thumbs = JSON.parse(thumbs) } catch (e) { thumbs = [] }
  }
  if (!Array.isArray(originals)) originals = []
  if (!Array.isArray(thumbs)) thumbs = []
  return {
    originals,
    thumbs,
    current: ds.current || '',
    thumbCurrent: ds.current || '',
    original: ds.original || ''
  }
}

module.exports = {
  normalizeOriginalUrl,
  saveImageToAlbum,
  handleEventImageLongPress,
  openEventImageSavePicker,
  closeEventImageSavePicker,
  toggleEventImageSaveSelect,
  selectAllEventImageSave,
  confirmEventImageSavePicker,
  parseLongPressDataset
}
