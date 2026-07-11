<template>
  <div class="app-cosmos-bg" aria-hidden="true">
    <video
      class="app-cosmos-video"
      src="https://mars-1397421562.cos.ap-guangzhou.myqcloud.com/%E8%83%8C%E6%99%AF%E8%A7%86%E9%A2%91/1778841707632_ddgop4.mp4"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
    ></video>
  </div>
  <router-view />
</template>

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
  filter: brightness(0.85) saturate(1.05);
}
@media (prefers-reduced-motion: reduce) {
  .app-cosmos-video { display: none; }
}
</style>
