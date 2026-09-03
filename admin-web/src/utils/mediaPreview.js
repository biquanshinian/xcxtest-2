import { reactive } from 'vue'

/**
 * 全局媒体预览（灯箱）状态。
 * 任意页面调用 previewMedia(url) / openMediaPreview({...}) 即可弹出大图查看或视频播放，
 * 由 App.vue 中挂载的 <MediaPreview /> 统一渲染。
 */
export const mediaPreviewState = reactive({
  visible: false,
  type: 'image', // 'image' | 'video'
  url: '',
  poster: '',
  title: ''
})

export function openMediaPreview({ type, url, poster = '', title = '' } = {}) {
  if (!url) return
  mediaPreviewState.type = type === 'video' ? 'video' : 'image'
  mediaPreviewState.url = String(url)
  mediaPreviewState.poster = poster ? String(poster) : ''
  mediaPreviewState.title = title ? String(title) : ''
  mediaPreviewState.visible = true
}

export function closeMediaPreview() {
  mediaPreviewState.visible = false
}

const VIDEO_RE = /\.(mp4|mov|webm|m3u8|m4v)(\?.*)?$/i

export function guessMediaType(url) {
  return VIDEO_RE.test(String(url || '')) ? 'video' : 'image'
}

/**
 * 便捷入口：按 URL 后缀自动判断图片/视频。
 * opts: { type?: 'image'|'video', poster?: string, title?: string }
 */
export function previewMedia(url, opts = {}) {
  if (!url) return
  openMediaPreview({
    type: opts.type || guessMediaType(url),
    url,
    poster: opts.poster || '',
    title: opts.title || ''
  })
}
