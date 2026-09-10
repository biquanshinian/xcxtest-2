/**
 * 节日帽 UI：按宿主圆直径缩放贴合（基准设计稿 112rpx）
 * properties.hat = spring|duanwu|zhongqiu|guoqing|laodong
 * properties.size = 圆直径 rpx（星问头像 112，倒计时配置图 132）
 */
const BASE_SIZE = 112

Component({
  options: {
    virtualHost: true
  },

  properties: {
    hat: { type: String, value: '' },
    size: { type: Number, value: BASE_SIZE }
  },

  data: {
    wrapStyle: '',
    scaleStyle: ''
  },

  observers: {
    size(n) {
      this._layout(n)
    }
  },

  lifetimes: {
    attached() {
      this._layout(this.properties.size)
    }
  },

  methods: {
    _layout(size) {
      const s = Math.max(48, Number(size) || BASE_SIZE)
      const scale = s / BASE_SIZE
      const h = Math.round(56 * scale)
      const half = Math.round(s / 2)
      const lift = Math.round(-18 * scale)
      this.setData({
        wrapStyle: `width:${s}rpx;height:${h}rpx;margin-left:-${half}rpx;transform:translate3d(0,${lift}rpx,0);`,
        scaleStyle: `transform:scale(${scale.toFixed(4)});`
      })
    }
  }
})
