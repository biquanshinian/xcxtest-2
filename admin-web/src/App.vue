<template>
  <div class="app-cosmos-bg" aria-hidden="true">
    <video
      v-if="showCosmosVideo"
      class="app-cosmos-video"
      :class="{ on: videoReady }"
      :src="COSMOS_SRC"
      autoplay
      muted
      loop
      playsinline
      webkit-playsinline
      preload="metadata"
      disablepictureinpicture
      controlslist="nodownload nofullscreen noremoteplayback"
      @playing="videoReady = true"
    ></video>
  </div>
  <router-view />
  <MediaPreview />
</template>

<script setup>
import { onMounted, ref } from 'vue'
import MediaPreview from './components/media/MediaPreview.vue'

const COSMOS_SRC = 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E8%83%8C%E6%99%AF%E8%A7%86%E9%A2%91/1778841707632_ddgop4.mp4'
const showCosmosVideo = ref(false)
const videoReady = ref(false)

function canUseBgVideo() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (window.matchMedia('(hover: none)').matches) return false
  if (window.matchMedia('(max-width: 900px)').matches) return false
  return true
}

onMounted(() => {
  showCosmosVideo.value = canUseBgVideo()
})
</script>

<style>
.app-cosmos-bg {
  position: fixed;
  inset: 0;
  z-index: -2;
  overflow: hidden;
  background: #000;
  pointer-events: none;
}
.app-cosmos-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  filter: brightness(0.85) saturate(1.05);
  pointer-events: none;
}
.app-cosmos-video.on {
  opacity: 1;
  transition: opacity 0.45s ease;
}
.app-cosmos-video::-webkit-media-controls,
.app-cosmos-video::-webkit-media-controls-enclosure,
.app-cosmos-video::-webkit-media-controls-start-playback-button,
.app-cosmos-video::-webkit-media-controls-overlay-play-button {
  display: none !important;
  opacity: 0 !important;
  -webkit-appearance: none;
  appearance: none;
  width: 0 !important;
  height: 0 !important;
}
@media (max-width: 900px), (hover: none), (prefers-reduced-motion: reduce) {
  .app-cosmos-video { display: none !important; }
}
</style>
