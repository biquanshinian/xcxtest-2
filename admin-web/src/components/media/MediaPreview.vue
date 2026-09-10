<template>
  <Teleport to="body">
    <Transition name="mp-fade">
      <div
        v-if="mediaPreviewState.visible"
        class="mp-overlay"
        @click.self="onClose"
        @keydown.esc="onClose"
      >
        <div class="mp-frame" :class="{ 'mp-frame--video': mediaPreviewState.type === 'video' }">
          <div class="mp-corner mp-corner--tl" />
          <div class="mp-corner mp-corner--tr" />
          <div class="mp-corner mp-corner--bl" />
          <div class="mp-corner mp-corner--br" />

          <div class="mp-header">
            <span class="mp-title">{{ mediaPreviewState.title || defaultTitle }}</span>
            <div class="mp-header-right">
              <a
                v-if="mediaPreviewState.url"
                class="mp-open"
                :href="mediaPreviewState.url"
                target="_blank"
                rel="noopener"
              >原文件</a>
              <button class="mp-close" type="button" aria-label="关闭" @click="onClose">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
              </button>
            </div>
          </div>

          <div class="mp-body" @click.self="onClose">
            <video
              v-if="mediaPreviewState.type === 'video'"
              :key="mediaPreviewState.url"
              :src="mediaPreviewState.url"
              :poster="mediaPreviewState.poster || undefined"
              class="mp-media mp-media--video"
              controls
              autoplay
              playsinline
            />
            <img
              v-else
              :src="mediaPreviewState.url"
              class="mp-media mp-media--image"
              referrerpolicy="no-referrer"
              alt=""
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, watch, onBeforeUnmount } from 'vue'
import { mediaPreviewState, closeMediaPreview } from '../../utils/mediaPreview'

const defaultTitle = computed(() => (mediaPreviewState.type === 'video' ? '视频播放' : '图片预览'))

function onClose() {
  closeMediaPreview()
}

function onKeydown(e) {
  if (e.key === 'Escape' && mediaPreviewState.visible) onClose()
}

watch(
  () => mediaPreviewState.visible,
  (v) => {
    if (v) {
      document.addEventListener('keydown', onKeydown)
      document.body.style.overflow = 'hidden'
    } else {
      document.removeEventListener('keydown', onKeydown)
      document.body.style.overflow = ''
    }
  }
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<style>
.mp-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(4, 6, 14, 0.82);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.mp-frame {
  position: relative;
  display: flex;
  flex-direction: column;
  max-width: min(1080px, 94vw);
  max-height: 92vh;
  background: rgba(10, 14, 26, 0.9);
  border: 1px solid rgba(139, 92, 246, 0.35);
  border-radius: 14px;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.04) inset,
    0 24px 80px rgba(0, 0, 0, 0.6),
    0 0 60px rgba(139, 92, 246, 0.15);
  overflow: hidden;
}

/* HUD 四角 */
.mp-corner {
  position: absolute;
  width: 18px;
  height: 18px;
  z-index: 2;
  pointer-events: none;
  opacity: 0.9;
}
.mp-corner--tl { top: 6px; left: 6px; border-top: 2px solid #8B5CF6; border-left: 2px solid #8B5CF6; border-top-left-radius: 6px; }
.mp-corner--tr { top: 6px; right: 6px; border-top: 2px solid #8B5CF6; border-right: 2px solid #8B5CF6; border-top-right-radius: 6px; }
.mp-corner--bl { bottom: 6px; left: 6px; border-bottom: 2px solid #8B5CF6; border-left: 2px solid #8B5CF6; border-bottom-left-radius: 6px; }
.mp-corner--br { bottom: 6px; right: 6px; border-bottom: 2px solid #8B5CF6; border-right: 2px solid #8B5CF6; border-bottom-right-radius: 6px; }

.mp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  background: linear-gradient(90deg, rgba(99, 102, 241, 0.12), rgba(168, 85, 247, 0.06), transparent);
}

.mp-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: rgba(255, 255, 255, 0.65);
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mp-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.mp-open {
  font-size: 12px;
  color: #A78BFA;
  text-decoration: none;
}
.mp-open:hover { color: #C4B5FD; text-decoration: underline; }

.mp-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.75);
  cursor: pointer;
  transition: all 0.2s;
}
.mp-close:hover {
  background: rgba(255, 69, 58, 0.2);
  border-color: rgba(255, 69, 58, 0.5);
  color: #fff;
}

.mp-body {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  overflow: hidden;
}

.mp-media {
  max-width: 100%;
  max-height: calc(92vh - 96px);
  border-radius: 8px;
  background: #000;
}
.mp-media--image { object-fit: contain; }
.mp-media--video { width: 100%; }

/* 过渡 */
.mp-fade-enter-active,
.mp-fade-leave-active {
  transition: opacity 0.22s ease;
}
.mp-fade-enter-active .mp-frame,
.mp-fade-leave-active .mp-frame {
  transition: transform 0.22s ease, opacity 0.22s ease;
}
.mp-fade-enter-from,
.mp-fade-leave-to {
  opacity: 0;
}
.mp-fade-enter-from .mp-frame,
.mp-fade-leave-to .mp-frame {
  transform: scale(0.96) translateY(8px);
}

@media (max-width: 768px) {
  .mp-overlay { padding: 10px; }
  .mp-frame { max-width: 96vw; max-height: 88vh; }
  .mp-media { max-height: calc(88vh - 90px); }
}

@media (prefers-reduced-motion: reduce) {
  .mp-fade-enter-active,
  .mp-fade-leave-active,
  .mp-fade-enter-active .mp-frame,
  .mp-fade-leave-active .mp-frame {
    transition: none;
  }
}
</style>
