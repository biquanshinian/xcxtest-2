<template>
  <div class="share-wrap">
    <header class="share-header">
      <div class="brand">
        <svg class="brand-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 85 57" width="28" height="20"><path d="M18.215445,2.220227L3.0127578,2.220227C1.695654,2.220227,0.57675987,3.0237782,0.16733406,4.263732C-0.24215524,5.503624,0.18097524,6.8068008,1.2434014,7.5777974L19.784561,21.032907C20.615595,21.635979,21.609751,21.776314,22.57777,21.427326C26.915979,19.863525,29.844072,17.982981,32.047157,15.111856C32.554928,14.450213,32.748951,13.697948,32.624146,12.876106C32.499222,12.054203,32.090172,11.391869,31.408312,10.907513L19.960058,2.7757246C19.429382,2.398773,18.868446,2.2201018,18.215385,2.2201018L18.215445,2.220227ZM53.590393,46.050011L64.861053,54.208569C65.395912,54.595695,65.965034,54.779781,66.627495,54.779781L82.000534,54.779781C83.317139,54.779781,84.435646,53.976864,84.84552,52.737587C85.255447,51.498268,84.833275,50.195461,83.771919,49.423779L65.244278,35.954086C64.412865,35.349693,63.417316,35.208729,62.448338,35.558338C58.111668,37.122643,55.181137,38.997978,52.977551,41.855968C52.470413,42.513714,52.274242,43.26152,52.393955,44.080593C52.513687,44.89967,52.915817,45.561691,53.590454,46.05006L53.590393,46.050011ZM31.407412,46.051582L20.138912,54.208569C19.604046,54.595695,19.034927,54.779781,18.372473,54.779781L2.9994934,54.779781C1.6828973,54.779781,0.5643841,53.976864,0.15445058,52.737587C-0.25541937,51.498268,0.16669591,50.195461,1.2280434,49.423779L19.753914,35.955463C20.585384,35.351013,21.581005,35.210056,22.550098,35.559723C26.884375,37.123653,29.814503,38.998161,32.019745,41.856785C32.527195,42.51453,32.723499,43.262463,32.603966,44.081665C32.484364,44.900925,32.082172,45.563202,31.407412,46.051582L31.407412,46.051582ZM66.784462,2.220227L81.987152,2.220227C83.304184,2.220227,84.423073,3.0237782,84.832565,4.2637339C85.24205,5.503624,84.818855,6.8068023,83.756424,7.5777974L65.214317,21.033596C64.383408,21.636606,63.389324,21.777008,62.421364,21.428146C58.083157,19.864594,55.154041,17.983862,52.951527,15.111417C52.444138,14.44971,52.250313,13.69763,52.375294,12.87598C52.500229,12.054329,52.909275,11.392183,53.591019,10.907953L65.039841,2.7757876C65.57058,2.3988359,66.131447,2.2202277,66.784523,2.2202277L66.784462,2.220227ZM13.7273,28.492243C33.490833,24.037018,37.983288,19.560297,42.507843,0C47.002769,19.563375,51.520348,24.039593,71.272667,28.492243C51.528286,32.971348,47.003792,37.432358,42.507851,56.999996C37.982464,37.436131,33.483662,32.974121,13.7273,28.492243L13.7273,28.492243Z" fill="#FFFFFF"/></svg>
        <div class="brand-text">
          <div class="brand-title">Starship Tracking · Starbase Tx</div>
          <div class="brand-sub">实时追踪 · 未来太空数据舱</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" :disabled="loading" @click="reloadFrame">
          <span class="dot" :class="{ pulse: loading }" />
          {{ loading ? '加载中' : '刷新' }}
        </button>
        <button class="btn btn-ghost" @click="onShare">分享</button>
        <button class="btn btn-primary" @click="openMiniProgram">进入小程序</button>
      </div>
    </header>

    <main class="share-main">
      <div v-if="loading" class="overlay">
        <div class="spinner" />
        <div class="overlay-text">正在加载设计稿…</div>
        <div class="overlay-hint">首次加载约需 3-15 秒，请耐心等待</div>
      </div>

      <div v-if="failed" class="overlay overlay-error">
        <div class="overlay-title">设计稿加载失败</div>
        <div class="overlay-text">
          可能是网络较慢或微信内置浏览器拦截了第三方内嵌内容。
        </div>
        <div class="overlay-hint">请点击微信右上角 ··· 选择「在浏览器打开」</div>
        <div class="overlay-actions">
          <button class="btn btn-primary" @click="reloadFrame">重试</button>
          <button class="btn btn-ghost" @click="openExternal">在浏览器打开</button>
        </div>
      </div>

      <iframe
        v-show="!failed"
        ref="frameRef"
        class="share-frame"
        :src="frameSrc"
        allow="fullscreen; clipboard-read; clipboard-write"
        allowfullscreen
        @load="onLoaded"
        @error="onErrored"
      />
    </main>

    <footer class="share-footer">
      <div class="share-footer__brand">
        <span>Powered by Figma Embed</span>
        <span class="dot-sep">·</span>
        <span>Starship Tracking · Starbase Tx</span>
      </div>
      <button class="share-footer__qr" type="button" @click="openMiniProgram" :title="qrOpen ? '收起二维码' : '进入小程序'">
        <img :src="QR_CODE_URL" alt="小程序二维码" />
        <span class="share-footer__qr-label">进入小程序</span>
      </button>
    </footer>

    <div v-if="qrOpen" class="qr-modal" @click.self="qrOpen = false">
      <div class="qr-modal__card">
        <img :src="QR_CODE_URL" alt="小程序二维码" class="qr-modal__img" />
        <div class="qr-modal__title">「火星探索日志」小程序</div>
        <div class="qr-modal__hint">{{ qrHint }}</div>
        <button class="btn btn-primary" @click="qrOpen = false">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'

const FIGMA_URL = 'https://embed.figma.com/design/2AvC161FuB1VFNLUpAVAV2/Starship-Tracking---Starbase-Tx?node-id=0-1&embed-host=share'
const QR_CODE_URL = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E4%BA%8C%E7%BB%B4%E7%A0%81/1778753659235_wk29pe.png'

// 微信小程序唤起短链（在「微信公众平台 → 小程序 → 工具 → 生成 URL Link」生成永久 link 后填到这里）
// 留空时全部走「弹二维码」流程，避免黑屏
const MP_URL_LINK = ''

const isInWeChat = () => /MicroMessenger/i.test(navigator.userAgent || '')
const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')

const qrHint = computed(() => {
  if (isInWeChat()) return '长按上方二维码，选择「识别小程序码」即可打开'
  if (isMobile())   return '使用微信扫描上方二维码进入小程序'
  return '使用手机微信扫描上方二维码进入小程序'
})

const openMiniProgram = () => {
  // 1. 微信内：直接弹二维码引导长按识别（微信不允许 H5 用 URL Scheme 跳小程序，跳了反而黑屏）
  if (isInWeChat()) {
    qrOpen.value = true
    return
  }

  // 2. 非微信 + 移动端 + 配置了 URL Link：用 URL Link 拉起微信
  if (isMobile() && MP_URL_LINK) {
    // 用隐藏 iframe 触发拉起，避免当前页跳走变白屏
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = MP_URL_LINK
    document.body.appendChild(iframe)
    // 1.5 秒内若仍可见，说明拉起失败，退回二维码
    setTimeout(() => {
      iframe.parentNode && iframe.parentNode.removeChild(iframe)
      if (!document.hidden) qrOpen.value = true
    }, 1500)
    return
  }

  // 3. 桌面端 / 未配置 URL Link：直接弹二维码
  qrOpen.value = true
}

const frameRef = ref(null)
const loading = ref(true)
const failed = ref(false)
const frameSrc = ref(FIGMA_URL)
const qrOpen = ref(false)

const toggleQr = () => {
  qrOpen.value = !qrOpen.value
}

let loadTimer = null

const startLoadTimer = () => {
  clearTimeout(loadTimer)
  loadTimer = setTimeout(() => {
    if (loading.value) {
      failed.value = true
      loading.value = false
    }
  }, 15000)
}

const onLoaded = () => {
  loading.value = false
  failed.value = false
  clearTimeout(loadTimer)
}

const onErrored = () => {
  loading.value = false
  failed.value = true
  clearTimeout(loadTimer)
}

const reloadFrame = () => {
  loading.value = true
  failed.value = false
  frameSrc.value = FIGMA_URL + (FIGMA_URL.includes('?') ? '&' : '?') + '_t=' + Date.now()
  startLoadTimer()
}

const openExternal = () => {
  window.open(FIGMA_URL, '_blank', 'noopener,noreferrer')
}

const onShare = async () => {
  const shareUrl = window.location.href
  const shareData = {
    title: 'Starship Tracking 设计稿',
    text: 'SpaceX 星舰追踪项目（实时追踪）',
    url: shareUrl
  }
  try {
    if (navigator.share) {
      await navigator.share(shareData)
      return
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareUrl)
      window.alert('链接已复制，可粘贴分享给好友')
      return
    }
  } catch (e) {}
  window.prompt('复制下方链接分享给好友：', shareUrl)
}

onMounted(() => {
  document.title = 'Starship Tracking · 火星探索日志'
  startLoadTimer()
})

onBeforeUnmount(() => clearTimeout(loadTimer))
</script>

<style scoped>
.share-wrap {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #000;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif;
}

.share-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  background: rgba(0, 0, 0, 0.72);
  z-index: 3;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.brand-logo {
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.brand-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.brand-sub {
  font-size: 11px;
  color: rgba(16, 185, 129, 0.95);
  letter-spacing: 0.4px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s, transform 0.1s;
}

.btn:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.55);
}

.btn:active:not(:disabled) {
  transform: translateY(1px);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-primary {
  background: linear-gradient(135deg, #10B981 0%, #34D399 100%);
  border-color: transparent;
  color: #06171a;
  font-weight: 600;
}

.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669 0%, #10B981 100%);
  filter: brightness(1.05);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10B981;
  display: inline-block;
}

.dot.pulse {
  animation: share-pulse 1.4s ease-in-out infinite;
}

@keyframes share-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
  50%      { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
}

.share-main {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #000;
}

.share-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: #000;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 28px;
  text-align: center;
  background: rgba(0, 0, 0, 0.92);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  z-index: 2;
}

.overlay-error { gap: 14px; }

.overlay-title {
  font-size: 16px;
  font-weight: 600;
}

.overlay-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.6;
  max-width: 420px;
}

.overlay-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0.4px;
}

.overlay-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

.spinner {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #10B981;
  animation: share-spin 0.9s linear infinite;
}

@keyframes share-spin {
  to { transform: rotate(360deg); }
}

.share-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  letter-spacing: 0.5px;
}

.share-footer__brand {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.share-footer__qr {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 4px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.2s, border-color 0.2s, transform 0.1s;
}

.share-footer__qr:hover {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.5);
}

.share-footer__qr:active {
  transform: translateY(1px);
}

.share-footer__qr img {
  width: 26px;
  height: 26px;
  display: block;
  border-radius: 4px;
  background: #fff;
}

.share-footer__qr-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 0.5px;
}

.qr-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  padding: 24px;
}

.qr-modal__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px;
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.1);
  max-width: 320px;
  width: 100%;
}

.qr-modal__img {
  width: 240px;
  height: 240px;
  background: #fff;
  border-radius: 8px;
  padding: 12px;
  box-sizing: border-box;
}

.qr-modal__title {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  text-align: center;
  letter-spacing: 0.4px;
}

.qr-modal__hint {
  font-size: 11px;
  color: rgba(16, 185, 129, 0.85);
  text-align: center;
  letter-spacing: 0.4px;
}

.dot-sep {
  opacity: 0.5;
}

@media (max-width: 640px) {
  .share-header {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 12px 14px;
  }

  .actions {
    justify-content: flex-end;
  }

  .brand-title {
    font-size: 14px;
  }

  .share-footer {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 10px 12px;
  }

  .share-footer__brand {
    justify-content: center;
    text-align: center;
  }

  .share-footer__qr {
    align-self: center;
  }

  .qr-modal__img {
    width: 200px;
    height: 200px;
  }
}
</style>
