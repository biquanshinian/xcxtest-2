/**
 * 同行商家入驻申请页（商家「推荐给同行」分享落地页）
 * - 链接携带 ref=推荐商家id（服务端反查归属，防伪造）与 refName（仅展示用）
 * - 提交即自动入驻（与观礼页合作申请同一云端链路 applyMerchantLead）
 * - 当前微信已绑定商家时不展示表单，直接引导进商家中心
 */
const pageBase = require('../../utils/page-base.js')
const composerInput = require('./utils/composer-input-behavior.js')
const watchParty = require('./utils/api.js')
const { guardWatchPartyPage } = require('../../utils/watch-party-feature.js')

Page({
  behaviors: [pageBase, composerInput],
  _fallbackTab: '/pages/index/index',

  data: {
    loading: true,
    /** 当前微信已是入驻商家：展示直达商家中心，不再收申请 */
    alreadyMerchant: false,
    alreadyMerchantName: '',
    /** 推荐商家（展示用；归属以服务端反查为准） */
    refName: '',
    form: { name: '', contactName: '', phone: '', location: '', note: '' },
    submitting: false,
    done: false,
    doneMerchantCode: ''
  },

  onLoad(options) {
    this.initUiShell()
    this._options = options || {}
    this._refMerchantId = String((options && options.ref) || '').trim()
    this._channel = String((options && options.channel) || '').trim() || 'peer_share'
    let refName = ''
    try { refName = decodeURIComponent(String((options && options.refName) || '')) } catch (e) {}
    this.setData({ refName: refName.trim().slice(0, 40) })
    guardWatchPartyPage(this).then((ok) => {
      if (!ok || this._unloaded) return
      this.detectBound()
    })
  },

  onUnload() {
    this._unloaded = true
  },

  onShow() {
    if (typeof this.syncTheme === 'function') this.syncTheme()
  },

  _safeSetData(patch) {
    if (this._unloaded) return
    this.setData(patch)
  },

  /** 已绑定商家的微信不用再申请：4011 = 未绑定（预期路径，展示表单） */
  detectBound() {
    watchParty.fetchMerchantMe().then((res) => {
      this._safeSetData({
        loading: false,
        alreadyMerchant: true,
        alreadyMerchantName: (res && res.merchant && res.merchant.name) || ''
      })
    }).catch(() => {
      this._safeSetData({ loading: false, alreadyMerchant: false })
    })
  },

  onGoMerchant() {
    wx.navigateTo({ url: '/subpackages/watch-party/merchant' })
  },

  onSubmit() {
    const { form, submitting } = this.data
    if (submitting) return
    const name = String(form.name || '').trim()
    const contactName = String(form.contactName || '').trim()
    const phone = String(form.phone || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写商家/观礼点名称', icon: 'none' })
      return
    }
    if (!contactName) {
      wx.showToast({ title: '请填写联系人姓名', icon: 'none' })
      return
    }
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请填写正确的手机号', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    watchParty.applyMerchantCooperation({
      name,
      contactName,
      phone,
      location: String(form.location || '').trim(),
      note: String(form.note || '').trim(),
      refMerchantId: this._refMerchantId
    }).then((res) => {
      try { wx.vibrateShort({ type: 'light', fail: () => {} }) } catch (e) {}
      this._safeSetData({
        submitting: false,
        done: true,
        doneMerchantCode: (res && res.merchantCode) || ''
      })
      if (res && res.autoApproved) {
        wx.showModal({
          title: '入驻成功',
          content: `您已成为观礼合作商家（编号 ${res.merchantCode || '见商家中心'}），当前微信已自动绑定。现在就去商家中心创建观礼场次吧！`,
          confirmText: '进商家中心',
          cancelText: '稍后再去',
          success: (r) => {
            if (!r.confirm || this._unloaded) return
            wx.navigateTo({ url: '/subpackages/watch-party/merchant' })
          }
        })
      }
    }).catch((err) => {
      this._safeSetData({ submitting: false })
      const msg = (err && err.message) || '提交失败，请重试'
      // 已绑定商家 / 手机号重复等业务拦截：弹窗展示完整原因
      if (err && err.code === 4002) {
        wx.showModal({
          title: '无法提交',
          content: msg,
          showCancel: false,
          confirmText: '知道了'
        })
        return
      }
      wx.showToast({ title: msg, icon: 'none' })
    })
  },

  /** 同行还可以继续转出去：保持原推荐商家归属 */
  onShareAppMessage() {
    const ref = this._refMerchantId
    const refName = String(this.data.refName || '').trim()
    let path = '/subpackages/watch-party/merchant-apply?channel=peer_share'
    if (ref) {
      path += '&ref=' + encodeURIComponent(ref)
      if (refName) path += '&refName=' + encodeURIComponent(refName)
    }
    return {
      title: '火箭观礼商家入驻邀请｜自助建场次，免费接入发射观礼客流',
      path
    }
  }
})
