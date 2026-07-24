/**
 * 侧栏菜单"未读红点"工具
 *
 * 设计：
 *   - 用 localStorage 存"上次进入该路由"的时间戳：_menu_lastRead_<path>
 *   - 后端按 module 维度聚合，counts[mod] = createdAt > lastRead 的 op_log 条数
 *   - 路由切换时调用 markRead(path)，本地立即清零并写回 storage
 *   - 通过 useMenuUnread() 暴露 ref<unreadMap> 给 LayoutPage 渲染
 *   - 节能：可见时 60s 轮询；隐藏时清掉定时器；可见/聚焦时立即刷新
 *   - 新到提示：path 上的数字从 0→正数 或 增长时，派发 menu-unread:bump 事件
 */
import { ref } from 'vue'
import { api } from '../api/client'

const STORAGE_PREFIX = '_menu_lastRead_'
const POLL_INTERVAL = 60_000

/** 路由 path -> op_log module 字段名 */
export const PATH_MODULE_MAP = {
  '/starship-event-updates': 'starship_event_updates',
  '/tweet-monitor':          'tweet_sync',
  '/push-notify':            'launch_subscriptions',
  '/launch-votes':           'launch_votes',
  '/lunar-wishes':           'lunar_wishes',
  '/astro-photos':           'astro_photos',
  '/road-closure':           'road_closure_notice',
  '/milestone-rewards':      'milestone_rewards',
  '/announcements':          'announcements'
}

const ALL_MODULES = Object.values(PATH_MODULE_MAP)

function readLastReadMap() {
  const out = {}
  for (const path in PATH_MODULE_MAP) {
    const mod = PATH_MODULE_MAP[path]
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + path)
      out[mod] = raw ? Number(raw) : 0
    } catch (e) {
      out[mod] = 0
    }
  }
  return out
}

export function markRead(path) {
  if (!PATH_MODULE_MAP[path]) return
  try {
    localStorage.setItem(STORAGE_PREFIX + path, String(Date.now()))
  } catch (e) {}
}

function emitBump(path) {
  try {
    window.dispatchEvent(new CustomEvent('menu-unread:bump', { detail: { path } }))
  } catch (e) {}
}

/**
 * 组合式 hook：返回一个 reactive map { [path]: count }
 * 用法：
 *   const { unreadMap, refresh, markRead, dispose } = useMenuUnread()
 *   onMounted(refresh)
 *   onBeforeUnmount(dispose)
 */
export function useMenuUnread() {
  const unreadMap = ref({})
  let pollTimer = null
  let disposed = false

  function startTimer() {
    if (pollTimer || disposed) return
    pollTimer = setInterval(refresh, POLL_INTERVAL)
  }

  function stopTimer() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  async function refresh() {
    if (disposed) return
    try {
      const lastReadMap = readLastReadMap()
      const data = await api.getMenuUnread(lastReadMap, ALL_MODULES)
      const counts = (data && data.counts) || {}

      const next = {}
      const prev = unreadMap.value || {}
      for (const path in PATH_MODULE_MAP) {
        const mod = PATH_MODULE_MAP[path]
        next[path] = Number(counts[mod] || 0)
      }
      unreadMap.value = next

      for (const path in next) {
        const a = Number(prev[path] || 0)
        const b = next[path]
        if (b > 0 && b > a) emitBump(path)
      }
    } catch (e) {
      // 静默：网络抖动不影响菜单展示
    }
  }

  function clearLocally(path) {
    if (!unreadMap.value[path]) return
    unreadMap.value = { ...unreadMap.value, [path]: 0 }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      refresh()
      startTimer()
    } else {
      stopTimer()
    }
  }

  function onWindowFocus() {
    refresh()
    startTimer()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', onWindowFocus)
  }
  startTimer()

  function dispose() {
    disposed = true
    stopTimer()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', onWindowFocus)
    }
  }

  return {
    unreadMap,
    refresh,
    markRead: (path) => {
      markRead(path)
      clearLocally(path)
    },
    dispose
  }
}
