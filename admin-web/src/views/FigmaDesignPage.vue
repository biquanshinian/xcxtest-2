<template>
  <div class="figma-page">
    <div class="figma-toolbar">
      <div class="figma-toolbar__left">
        <span class="figma-toolbar__title">Starship Tracking · Starbase Tx</span>
        <span class="figma-toolbar__hint">实时追踪 · 未来太空数据舱</span>
      </div>
      <div class="figma-toolbar__right">
        <el-button size="small" class="action-btn" @click="reloadFrame" :loading="loading">
          刷新
        </el-button>
        <el-button size="small" class="action-btn" @click="openInNewTab">
          在新窗口打开
        </el-button>
      </div>
    </div>

    <div class="figma-frame-wrap">
      <div v-if="loading" class="figma-mask">
        <div class="figma-spinner" />
        <div class="figma-mask__text">正在加载设计稿…</div>
      </div>

      <div v-if="failed" class="figma-mask">
        <div class="figma-mask__title">设计稿加载失败</div>
        <div class="figma-mask__text">
          网络受限或微信内置浏览器拦截了第三方内嵌内容。
        </div>
        <el-button class="action-btn" size="small" @click="reloadFrame">重试</el-button>
        <el-button class="action-btn" size="small" @click="openInNewTab">在外部浏览器打开</el-button>
      </div>

      <iframe
        v-show="!failed"
        ref="frameRef"
        class="figma-frame"
        :src="figmaUrl"
        allow="fullscreen; clipboard-read; clipboard-write"
        allowfullscreen
        @load="onLoaded"
        @error="onErrored"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const FIGMA_URL = 'https://embed.figma.com/design/2AvC161FuB1VFNLUpAVAV2/Starship-Tracking---Starbase-Tx?node-id=0-1&embed-host=share'
const SHARE_PAGE_PATH = '#/share/figma'

const frameRef = ref(null)
const loading = ref(true)
const failed = ref(false)
const figmaUrl = ref(FIGMA_URL)

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
  figmaUrl.value = FIGMA_URL + (FIGMA_URL.includes('?') ? '&' : '?') + '_t=' + Date.now()
  startLoadTimer()
}

const openInNewTab = () => {
  const sharePageUrl = window.location.origin + window.location.pathname + SHARE_PAGE_PATH
  window.open(sharePageUrl, '_blank', 'noopener,noreferrer')
}

onMounted(startLoadTimer)
onBeforeUnmount(() => clearTimeout(loadTimer))
</script>

<style scoped>
.figma-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: calc(100vh - 100px);
  gap: 12px;
}

.figma-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
}

.figma-toolbar__left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.figma-toolbar__title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  letter-spacing: 1px;
}

.figma-toolbar__hint {
  font-size: 12px;
  color: rgba(16, 185, 129, 0.9);
}

.figma-toolbar__right {
  display: flex;
  gap: 8px;
}

.figma-frame-wrap {
  position: relative;
  flex: 1;
  min-height: 600px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: #000;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

.figma-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}

.figma-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.92);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  z-index: 2;
  text-align: center;
  padding: 24px;
}

.figma-mask__title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
}

.figma-mask__text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.6;
}

.figma-spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #10B981;
  animation: figma-spin 0.9s linear infinite;
}

@keyframes figma-spin {
  to { transform: rotate(360deg); }
}
</style>
