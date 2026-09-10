Component({
  properties: {
    visible: { type: Boolean, value: false },
    milestone: { type: Object, value: {} }
  },

  data: {
    stage: 'egg',
    animState: '',
    formName: '',
    formPhone: '',
    formAddress: '',
    formSelections: {},
    submitting: false
  },

  observers: {
    visible: function (val) {
      if (val) {
        this.setData({ stage: 'egg', animState: '', formName: '', formPhone: '', formAddress: '', formSelections: {}, submitting: false })
      }
    }
  },

  methods: {
    noop: function () {},

    onTapEgg: function () {
      wx.vibrateShort({ type: 'heavy' })
      this.setData({ stage: 'crack' })
      var self = this
      setTimeout(function () {
        self.setData({ stage: 'prize' })
      }, 800)
    },

    onShowForm: function () {
      this.setData({ stage: 'form' })
    },

    onClaimOrForm: function () {
      var milestone = this.data.milestone || {}
      if (milestone.prizeType === 'pro_1month') {
        this.submitClaim(true)
        return
      }
      this.setData({ stage: 'form' })
    },

    onInputName: function (e) {
      this.setData({ formName: e.detail.value })
    },
    onInputPhone: function (e) {
      this.setData({ formPhone: e.detail.value })
    },
    onInputAddress: function (e) {
      this.setData({ formAddress: e.detail.value })
    },
    onPickOption: function (e) {
      var label = e.currentTarget.dataset.label
      var value = e.currentTarget.dataset.value
      var key = 'formSelections.' + label
      this.setData({ [key]: value })
    },

    onSubmit: function () {
      this.submitClaim(false)
    },

    submitClaim: function (isPro) {
      var milestone = this.data.milestone
      if (!milestone || !milestone.milestoneId) {
        return wx.showToast({ title: '奖品信息异常', icon: 'none' })
      }

      var body = { milestoneId: milestone.milestoneId }
      if (!isPro) {
        var name = (this.data.formName || '').trim()
        var phone = (this.data.formPhone || '').trim()
        var address = (this.data.formAddress || '').trim()
        var selections = this.data.formSelections || {}

        if (!name) return wx.showToast({ title: '请输入姓名', icon: 'none' })
        if (!phone || phone.length < 11) return wx.showToast({ title: '请输入正确手机号', icon: 'none' })
        if (!address) return wx.showToast({ title: '请输入收货地址', icon: 'none' })

        var customOptions = milestone.customOptions || []
        for (var i = 0; i < customOptions.length; i++) {
          var opt = customOptions[i]
          if (opt.required && !selections[opt.label]) {
            return wx.showToast({ title: '请选择' + opt.label, icon: 'none' })
          }
        }
        body.name = name
        body.phone = phone
        body.address = address
        body.selections = selections
      }

      this.setData({ submitting: true })
      var self = this

      wx.cloud.callFunction({
        name: 'adminGateway',
        data: {
          path: '/milestone-claim',
          method: 'POST',
          body: body
        }
      }).then(function (res) {
        var result = res.result || {}
        if (result.code === 0) {
          wx.vibrateShort({ type: 'medium' })
          self.setData({ stage: 'done', submitting: false })
          self.triggerEvent('claimed', { milestoneId: milestone.milestoneId, prizeType: milestone.prizeType || '' })
        } else {
          wx.showToast({ title: result.message || '提交失败', icon: 'none' })
          self.setData({ submitting: false })
        }
      }).catch(function (err) {
        console.error('[MilestoneEgg] submit error:', err)
        wx.showToast({ title: '网络错误，请重试', icon: 'none' })
        self.setData({ submitting: false })
      })
    },

    onClose: function () {
      this.triggerEvent('close')
    }
  }
})
