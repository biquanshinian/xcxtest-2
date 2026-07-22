/**
 * 首页「长按保存轮播图到相册」逻辑 — 分包异步加载（attachTo 模式），
 * 纯用户触发路径，不占主包首屏预算。
 */
const { pooledDownloadFile } = require('../../../utils/download-pool.js')
const { toCdnUrl } = require('../../../utils/cos-url.js')

const saveImageMethods = {
  /**
   * 长按保存轮播图
   */
  saveCarouselImage(e) {
    const imageUrl = e.currentTarget.dataset.url

    // 显示保存确认菜单
    wx.showActionSheet({
      itemList: ['保存图片'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.saveImageToAlbum(imageUrl)
        }
      },
      fail: () => {
        // 用户取消操作，不做任何处理
      }
    })
  },

  /**
   * 保存图片到相册
   */
  saveImageToAlbum(imageUrl) {
    wx.showLoading({
      title: '保存中...',
      mask: true
    })

    // 处理本地路径和网络路径
    if (imageUrl.startsWith('/')) {
      // 本地路径：先尝试直接保存，如果失败则转换为临时文件
      wx.saveImageToPhotosAlbum({
        filePath: imageUrl,
        success: () => {
          wx.hideLoading()
          wx.showToast({
            title: '保存成功',
            icon: 'success'
          })
        },
        fail: (err) => {
          if (err.errMsg && err.errMsg.includes('file not exist')) {
            wx.hideLoading()
            wx.showToast({
              title: '图片不存在',
              icon: 'none'
            })
          } else if (err.errMsg && (err.errMsg.includes('auth deny') || err.errMsg.includes('authorize'))) {
            wx.hideLoading()
            this.handleSaveImageError(err, imageUrl)
          } else {
            // 其他错误，提示用户使用预览方式保存
            wx.hideLoading()
            wx.showModal({
              title: '提示',
              content: '本地图片保存需要先预览，请在预览图片时长按保存到相册',
              confirmText: '去预览',
              success: (modalRes) => {
                if (modalRes.confirm) {
                  wx.previewImage({
                    current: imageUrl,
                    urls: this.data.carouselImages,
                    success: () => {
                      wx.showToast({
                        title: '长按图片可保存',
                        icon: 'none',
                        duration: 2000
                      })
                    }
                  })
                }
              }
            })
          }
        }
      })
    } else {
      // 网络路径，需要先下载
      pooledDownloadFile({ url: toCdnUrl(imageUrl) })
        .then((res) => {
          if (res.statusCode === 200) {
            wx.saveImageToPhotosAlbum({
              filePath: res.tempFilePath,
              success: () => {
                wx.hideLoading()
                wx.showToast({
                  title: '保存成功',
                  icon: 'success'
                })
              },
              fail: (err) => {
                wx.hideLoading()
                this.handleSaveImageError(err, imageUrl)
              }
            })
          } else {
            wx.hideLoading()
            wx.showToast({
              title: '下载失败',
              icon: 'none'
            })
          }
        })
        .catch(() => {
          wx.hideLoading()
          wx.showToast({
            title: '下载失败',
            icon: 'none'
          })
        })
    }
  },

  /**
   * 处理保存图片错误
   */
  handleSaveImageError(err, imageUrl) {
    // 处理用户拒绝授权的情况
    if (
      err.errMsg &&
      (err.errMsg.includes('auth deny') || err.errMsg.includes('authorize') || err.errMsg.includes('permission'))
    ) {
      wx.showModal({
        title: '需要授权',
        content: '需要您授权保存图片到相册',
        confirmText: '去设置',
        cancelText: '取消',
        success: (modalRes) => {
          if (modalRes.confirm) {
            wx.openSetting({
              success: (settingRes) => {
                if (settingRes.authSetting['scope.writePhotosAlbum']) {
                  // 用户授权后，重新保存
                  this.saveImageToAlbum(imageUrl)
                } else {
                  wx.showToast({
                    title: '需要授权才能保存',
                    icon: 'none'
                  })
                }
              }
            })
          }
        }
      })
    } else {
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      })
    }
  }
}

function attachTo(page) {
  if (page.__saveImageAttached) return saveImageMethods
  Object.keys(saveImageMethods).forEach((key) => {
    page[key] = saveImageMethods[key]
  })
  page.__saveImageAttached = true
  return saveImageMethods
}

module.exports = { attachTo }
