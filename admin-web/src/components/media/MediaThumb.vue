<template>
  <div
    class="mt-thumb"
    :class="{ 'mt-thumb--video': mediaType === 'video' }"
    :style="{ width: widthCss, height: heightCss, borderRadius: radiusCss }"
    :title="title || (mediaType === 'video' ? '点击播放' : '点击查看')"
    @click.stop="onPreview"
  >
    <img
      v-if="mediaType === 'image'"
      :src="src"
      :style="{ objectFit: fit }"
      class="mt-media"
      referrerpolicy="no-referrer"
      loading="lazy"
      alt=""
      @error="broken = true"
    />
    <template v-else>
      <img
        v-if="poster"
        :src="poster"
        :style="{ objectFit: fit }"
        class="mt-media"
        referrerpolicy="no-referrer"
        loading="lazy"
        alt=""
        @error="broken = true"
      />
      <video
        v-else
        :src="src"
        class="mt-media"
        :style="{ objectFit: fit }"
        muted
        preload="metadata"
        playsinline
      />
      <span class="mt-play">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M5.5 3.5v9a.5.5 0 0 0 .77.42l7-4.5a.5.5 0 0 0 0-.84l-7-4.5a.5.5 0 0 0-.77.42z"/></svg>
      </span>
    </template>
    <span v-if="broken" class="mt-broken">加载失败</span>
    <span class="mt-zoom">
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3 3"/></svg>
    </span>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { previewMedia, guessMediaType } from '../../utils/mediaPreview'

const props = defineProps({
  src: { type: String, required: true },
  type: { type: String, default: '' }, // 'image' | 'video'，留空自动按后缀判断
  poster: { type: String, default: '' },
  title: { type: String, default: '' },
  width: { type: [Number, String], default: 56 },
  height: { type: [Number, String], default: 56 },
  fit: { type: String, default: 'cover' },
  radius: { type: [Number, String], default: 6 }
})

const broken = ref(false)

const mediaType = computed(() => props.type || guessMediaType(props.src))

const toCss = (v) => (typeof v === 'number' ? `${v}px` : v)
const widthCss = computed(() => toCss(props.width))
const heightCss = computed(() => toCss(props.height))
const radiusCss = computed(() => toCss(props.radius))

function onPreview() {
  if (broken.value) return
  previewMedia(props.src, { type: mediaType.value, poster: props.poster, title: props.title })
}
</script>

<style scoped>
.mt-thumb {
  position: relative;
  display: inline-block;
  overflow: hidden;
  cursor: zoom-in;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  vertical-align: middle;
  flex-shrink: 0;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.mt-thumb:hover {
  border-color: rgba(139, 92, 246, 0.55);
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.25);
}

.mt-media {
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}

.mt-thumb--video { cursor: pointer; }

.mt-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.35);
  pointer-events: none;
}

.mt-zoom {
  position: absolute;
  right: 3px;
  bottom: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.5);
  color: rgba(255, 255, 255, 0.85);
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}

.mt-thumb:hover .mt-zoom { opacity: 1; }
.mt-thumb--video:hover .mt-zoom { opacity: 0; }

.mt-broken {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.04);
  pointer-events: none;
}
</style>
