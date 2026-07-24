<template>
  <el-container class="layout-root theme-dark" :class="{ 'has-mobile-drawer-open': mobileMenuOpen }">
    <div v-if="mobileMenuOpen" class="mobile-drawer-mask" @click="closeMobileMenu" />
    <el-aside width="240px" class="layout-aside" :class="{ 'is-mobile-open': mobileMenuOpen }">
      <div class="aside-logo" @click="navigate('/dashboard')">
        <svg class="logo-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 85 57" fill="none"><path d="M18.215445,2.220227L3.0127578,2.220227C1.695654,2.220227,0.57675987,3.0237782,0.16733406,4.263732C-0.24215524,5.503624,0.18097524,6.8068008,1.2434014,7.5777974L19.784561,21.032907C20.615595,21.635979,21.609751,21.776314,22.57777,21.427326C26.915979,19.863525,29.844072,17.982981,32.047157,15.111856C32.554928,14.450213,32.748951,13.697948,32.624146,12.876106C32.499222,12.054203,32.090172,11.391869,31.408312,10.907513L19.960058,2.7757246C19.429382,2.398773,18.868446,2.2201018,18.215385,2.2201018L18.215445,2.220227ZM53.590393,46.050011L64.861053,54.208569C65.395912,54.595695,65.965034,54.779781,66.627495,54.779781L82.000534,54.779781C83.317139,54.779781,84.435646,53.976864,84.84552,52.737587C85.255447,51.498268,84.833275,50.195461,83.771919,49.423779L65.244278,35.954086C64.412865,35.349693,63.417316,35.208729,62.448338,35.558338C58.111668,37.122643,55.181137,38.997978,52.977551,41.855968C52.470413,42.513714,52.274242,43.26152,52.393955,44.080593C52.513687,44.89967,52.915817,45.561691,53.590454,46.05006L53.590393,46.050011ZM31.407412,46.051582L20.138912,54.208569C19.604046,54.595695,19.034927,54.779781,18.372473,54.779781L2.9994934,54.779781C1.6828973,54.779781,0.5643841,53.976864,0.15445058,52.737587C-0.25541937,51.498268,0.16669591,50.195461,1.2280434,49.423779L19.753914,35.955463C20.585384,35.351013,21.581005,35.210056,22.550098,35.559723C26.884375,37.123653,29.814503,38.998161,32.019745,41.856785C32.527195,42.51453,32.723499,43.262463,32.603966,44.081665C32.484364,44.900925,32.082172,45.563202,31.407412,46.051582L31.407412,46.051582ZM66.784462,2.220227L81.987152,2.220227C83.304184,2.220227,84.423073,3.0237782,84.832565,4.2637339C85.24205,5.503624,84.818855,6.8068023,83.756424,7.5777974L65.214317,21.033596C64.383408,21.636606,63.389324,21.777008,62.421364,21.428146C58.083157,19.864594,55.154041,17.983862,52.951527,15.111417C52.444138,14.44971,52.250313,13.69763,52.375294,12.87598C52.500229,12.054329,52.909275,11.392183,53.591019,10.907953L65.039841,2.7757876C65.57058,2.3988359,66.131447,2.2202277,66.784523,2.2202277L66.784462,2.220227ZM13.7273,28.492243C33.490833,24.037018,37.983288,19.560297,42.507843,0C47.002769,19.563375,51.520348,24.039593,71.272667,28.492243C51.528286,32.971348,47.003792,37.432358,42.507851,56.999996C37.982464,37.436131,33.483662,32.974121,13.7273,28.492243L13.7273,28.492243Z" fill="#FFFFFF"/></svg>
        <span class="logo-text">火星探索日志</span>
      </div>

      <el-menu
        :default-active="active"
        router
        background-color="transparent"
        text-color="rgba(255,255,255,0.65)"
        active-text-color="#FFFFFF"
        class="aside-menu"
        @select="closeMobileMenu"
      >
        <el-menu-item v-if="hasPerm('dashboard')" index="/dashboard">
          <span>仪表盘</span>
        </el-menu-item>
        <el-menu-item v-if="hasPerm('statistics')" index="/statistics">数据统计</el-menu-item>
        <el-sub-menu v-if="hasPerm('news_events') || hasPerm('news_articles')" index="news">
          <template #title><span>事件管理</span></template>
          <el-menu-item v-if="hasPerm('news_events')" index="/news/events">事件</el-menu-item>
          <el-menu-item v-if="hasPerm('news_articles')" index="/news/articles">文章</el-menu-item>
        </el-sub-menu>
        <el-menu-item v-if="hasPerm('launch_data')" index="/launch-data">发射数据管理</el-menu-item>
        <el-menu-item v-if="hasPerm('starship_status')" index="/starship-status">星舰状态</el-menu-item>
        <el-menu-item v-if="hasPerm('starship_progress')" index="/starship-progress">星舰建设进度</el-menu-item>
        <el-menu-item
          v-if="hasPerm('starship_events')"
          index="/starship-event-updates"
          :class="{ 'has-unread': unreadMap['/starship-event-updates'] > 0 }"
        >
          <MenuBadgeItem
            path="/starship-event-updates"
            label="事件更新追踪"
            :count="unreadMap['/starship-event-updates'] || 0"
            tip="条新事件更新待查看"
          />
        </el-menu-item>
        <el-menu-item
          v-if="hasPerm('tweet_monitor')"
          index="/tweet-monitor"
          :class="{ 'has-unread': unreadMap['/tweet-monitor'] > 0 }"
        >
          <MenuBadgeItem
            path="/tweet-monitor"
            label="推文同步监控"
            :count="unreadMap['/tweet-monitor'] || 0"
            tip="条新推文待审核"
          />
        </el-menu-item>
        <el-menu-item v-if="hasPerm('live_mgmt')" index="/live-management">直播管理</el-menu-item>
        <el-menu-item
          v-if="hasPerm('push_notify')"
          index="/push-notify"
          :class="{ 'has-unread': unreadMap['/push-notify'] > 0 }"
        >
          <MenuBadgeItem
            path="/push-notify"
            label="推送通知管理"
            :count="unreadMap['/push-notify'] || 0"
            tip="条订阅待处理"
          />
        </el-menu-item>
        <el-menu-item
          v-if="hasPerm('launch_votes')"
          index="/launch-votes"
          :class="{ 'has-unread': unreadMap['/launch-votes'] > 0 }"
        >
          <MenuBadgeItem
            path="/launch-votes"
            label="发射竞猜管理"
            :count="unreadMap['/launch-votes'] || 0"
            tip="条新竞猜记录"
          />
        </el-menu-item>
        <el-menu-item
          v-if="hasPerm('lunar_wishes')"
          index="/lunar-wishes"
          :class="{ 'has-unread': unreadMap['/lunar-wishes'] > 0 }"
        >
          <MenuBadgeItem
            path="/lunar-wishes"
            label="月愿计划管理"
            :count="unreadMap['/lunar-wishes'] || 0"
            tip="条月愿待审核"
          />
        </el-menu-item>
        <el-menu-item
          v-if="hasPerm('astro_photos')"
          index="/astro-photos"
          :class="{ 'has-unread': unreadMap['/astro-photos'] > 0 }"
        >
          <MenuBadgeItem
            path="/astro-photos"
            label="航天摄影管理"
            :count="unreadMap['/astro-photos'] || 0"
            tip="条航天摄影待审核"
          />
        </el-menu-item>
        <el-menu-item
          v-if="hasPerm('milestone_rewards')"
          index="/milestone-rewards"
          :class="{ 'has-unread': unreadMap['/milestone-rewards'] > 0 }"
        >
          <MenuBadgeItem
            path="/milestone-rewards"
            label="里程碑彩蛋"
            :count="unreadMap['/milestone-rewards'] || 0"
            tip="条彩蛋更新"
          />
        </el-menu-item>
        <el-menu-item v-if="hasPerm('knowledge_cards')" index="/knowledge-cards">知识卡管理</el-menu-item>
        <el-menu-item v-if="hasPerm('shop_feed')" index="/shop-feed">小店数据</el-menu-item>
        <el-menu-item v-if="hasPerm('shop_feed')" index="/popup-ad">弹窗广告</el-menu-item>
        <el-menu-item v-if="hasPerm('carousel')" index="/carousel">轮播图管理</el-menu-item>
        <el-menu-item v-if="hasPerm('splash_screen')" index="/splash-screen">开屏动画</el-menu-item>
        <el-menu-item
          v-if="hasPerm('road_closure')"
          index="/road-closure"
          :class="{ 'has-unread': unreadMap['/road-closure'] > 0 }"
        >
          <MenuBadgeItem
            path="/road-closure"
            label="封路通知"
            :count="unreadMap['/road-closure'] || 0"
            tip="条封路通知更新"
          />
        </el-menu-item>
        <el-menu-item v-if="hasPerm('spacex_stats')" index="/spacex-stats">SpaceX统计</el-menu-item>
        <el-menu-item
          v-if="hasPerm('announcements')"
          index="/announcements"
          :class="{ 'has-unread': unreadMap['/announcements'] > 0 }"
        >
          <MenuBadgeItem
            path="/announcements"
            label="系统公告"
            :count="unreadMap['/announcements'] || 0"
            tip="条公告更新"
          />
        </el-menu-item>
        <el-menu-item v-if="hasPerm('global_config')" index="/global-config">全局配置</el-menu-item>
        <el-menu-item v-if="hasPerm('global_config')" index="/bilibili-topics">B站话题词库</el-menu-item>
        <el-menu-item v-if="hasPerm('global_config')" index="/year-review-config">年度报告</el-menu-item>
        <el-menu-item v-if="hasPerm('global_config')" index="/membership">会员管理</el-menu-item>
        <el-menu-item v-if="hasPerm('global_config')" index="/invite-stats">邀请统计</el-menu-item>
        <el-menu-item v-if="hasPerm('cloud_functions')" index="/cloud-functions">云函数管理</el-menu-item>
        <el-menu-item v-if="hasPerm('cos_storage')" index="/cos-storage">COS 云存储</el-menu-item>
        <el-menu-item v-if="hasPerm('cos_storage')" index="/rocket-config">火箭配置图</el-menu-item>
        <el-menu-item v-if="hasPerm('data_export')" index="/data-export">数据导出</el-menu-item>
        <el-menu-item v-if="hasPerm('users')" index="/users">用户权限</el-menu-item>
        <el-menu-item v-if="hasPerm('logs')" index="/logs">操作日志</el-menu-item>
        <el-menu-item v-if="hasPerm('dashboard')" index="/figma-design">SpaceX星舰追踪 · 星舰基地</el-menu-item>
        <el-menu-item v-if="hasPerm('global_config')" index="/orbital-config">太空轨道数据中心</el-menu-item>
      </el-menu>

      <div class="aside-footer">
        <div class="aside-user">
          <div class="user-avatar">{{ currentUserName.charAt(0).toUpperCase() }}</div>
          <div class="user-info">
            <div class="user-name">{{ currentUserName }}</div>
            <div class="user-role">{{ roleLabel }}</div>
          </div>
        </div>
      </div>
    </el-aside>

    <el-container class="layout-body">
      <el-header class="layout-header">
        <button class="hamburger-btn" type="button" @click="toggleMobileMenu" :title="mobileMenuOpen ? '关闭菜单' : '打开菜单'">
          <span class="hamburger-line" :class="{ 'is-open': mobileMenuOpen }" />
          <span class="hamburger-line" :class="{ 'is-open': mobileMenuOpen }" />
          <span class="hamburger-line" :class="{ 'is-open': mobileMenuOpen }" />
        </button>
        <div class="header-title cx-gradient-text">{{ pageTitle }}</div>
        <div class="header-actions">
          <el-button class="action-btn action-btn--icon-only" size="small" @click="syncNow" title="同步数据">
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5A5.5 5.5 0 1 1 8 2.5a5.5 5.5 0 0 1 0 11zM8 4a.75.75 0 0 1 .75.75v2.69l1.78 1.03a.75.75 0 1 1-.75 1.3l-2.16-1.25A.75.75 0 0 1 7.25 8V4.75A.75.75 0 0 1 8 4z"/></svg>
            <span class="action-btn__label">同步数据</span>
          </el-button>
          <el-button class="action-btn action-btn--hide-on-mobile" size="small" @click="cleanNow">清理缓存</el-button>
          <el-button class="action-btn logout-btn" size="small" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api, auth } from '../api/client'
import { useMenuUnread } from '../utils/menu-unread'
import MenuBadgeItem from '../components/MenuBadgeItem.vue'

const route = useRoute()
const router = useRouter()
const active = computed(() => route.path)

const mobileMenuOpen = ref(false)

const toggleMobileMenu = () => {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

const closeMobileMenu = () => {
  mobileMenuOpen.value = false
}

const navigate = (path) => {
  closeMobileMenu()
  router.push(path)
}

watch(() => route.path, () => {
  closeMobileMenu()
})

document.documentElement.classList.add('dark')

const { unreadMap, refresh: refreshUnread, markRead: markUnreadRead, dispose: disposeUnread } = useMenuUnread()

const removeAfterEach = router.afterEach((to) => {
  markUnreadRead(to.path)
})

onMounted(() => {
  refreshUnread()
  markUnreadRead(route.path)
})
onBeforeUnmount(() => {
  if (typeof disposeUnread === 'function') disposeUnread()
  if (typeof removeAfterEach === 'function') removeAfterEach()
})

const canReviewer = computed(() => auth.hasRole('reviewer'))
const canEditor = computed(() => auth.hasRole('editor'))
const canSuperAdmin = computed(() => auth.hasRole('super_admin'))

const hasPerm = (mod) => auth.hasPermission(mod)

const user = computed(() => auth.getUser() || {})
const currentUserName = computed(() => user.value.username || 'unknown')
const currentUserRole = computed(() => user.value.role || 'viewer')
const roleLabel = computed(() => {
  const map = { super_admin: '超级管理员', editor: '编辑', reviewer: '审核员', viewer: '观察者' }
  return map[currentUserRole.value] || currentUserRole.value
})

const pageTitle = computed(() => {
  const map = {
    '/dashboard': '仪表盘',
    '/news/events': '事件管理',
    '/news/articles': '文章管理',
    '/starship-status': '星舰状态',
    '/starship-progress': '星舰建设进度',
    '/starship-event-updates': '事件更新追踪',
    '/shop-feed': '小店数据',
    '/popup-ad': '弹窗广告',
    '/carousel': '轮播图管理',
    '/splash-screen': '开屏动画',
    '/road-closure': '封路通知',
    '/spacex-stats': 'SpaceX统计',
    '/cos-storage': 'COS 云存储',
    '/rocket-config': '火箭配置图管理',
    '/users': '用户权限',
    '/push-notify': '推送通知管理',
    '/launch-votes': '发射竞猜管理',
    '/launch-data': '发射数据管理',
    '/tweet-monitor': '推文同步监控',
    '/statistics': '数据统计分析',
    '/live-management': '直播管理',
    '/cloud-functions': '云函数管理',
    '/global-config': '全局配置中心',
    '/bilibili-topics': 'B站话题词库',
    '/year-review-config': '年度报告',
    '/membership': '会员管理',
    '/invite-stats': '邀请统计',
    '/announcements': '系统公告',
    '/data-export': '数据导出',
    '/lunar-wishes': '月愿计划管理',
    '/astro-photos': '航天摄影管理',
    '/milestone-rewards': '里程碑彩蛋管理',
    '/knowledge-cards': '知识卡管理',
    '/logs': '操作日志',
    '/figma-design': 'SpaceX星舰追踪 · 星舰基地',
    '/orbital-config': '太空轨道数据中心'
  }
  return map[route.path] || '管理后台'
})

const logout = () => {
  auth.clearAuth()
  router.replace('/login')
}

const syncNow = async () => {
  try {
    await api.triggerSync()
    ElMessage.success('已触发同步')
  } catch (e) {
    ElMessage.error(e.message || '触发同步失败')
  }
}

const cleanNow = async () => {
  try {
    await api.cleanCache()
    ElMessage.success('已触发清缓存')
  } catch (e) {
    ElMessage.error(e.message || '清缓存失败')
  }
}
</script>

<style scoped>
/* ========== Theme Variables ========== */
.layout-root {
  height: 100vh;
  transition: background 0.3s;
}

.theme-dark {
  --t-bg: transparent;
  --t-bg-body: transparent;
  --t-bg-aside: transparent;
  --t-bg-header: transparent;
  --t-bg-card: rgba(0, 0, 0, 0.28);
  --t-bg-input: rgba(255, 255, 255, 0.06);
  --t-bg-btn: rgba(255, 255, 255, 0.08);
  --t-bg-hover: rgba(255, 255, 255, 0.06);
  --t-bg-active: rgba(99, 102, 241, 0.18);
  --t-bg-stripe: rgba(255, 255, 255, 0.02);
  --t-bg-divider-text: rgba(0, 0, 0, 0.4);
  --t-bg-dialog: rgba(15, 17, 28, 0.78);
  --t-bg-table-header: rgba(255,255,255,0.03);
  --t-bg-table-hover: rgba(255,255,255,0.04);
  --t-text-primary: #fff;
  --t-text-regular: rgba(255, 255, 255, 0.85);
  --t-text-secondary: rgba(255, 255, 255, 0.65);
  --t-text-muted: rgba(255, 255, 255, 0.5);
  --t-text-placeholder: rgba(255, 255, 255, 0.35);
  --t-text-aside: rgba(255, 255, 255, 0.4);
  --t-border: rgba(255, 255, 255, 0.06);
  --t-border-input: rgba(255, 255, 255, 0.1);
  --t-border-card: rgba(255, 255, 255, 0.08);
  --t-border-btn: rgba(255, 255, 255, 0.1);
  --t-border-btn-hover: rgba(255, 255, 255, 0.2);
}

.layout-root {
  background: var(--t-bg);
}

/* ========== Aside ========== */
.layout-aside {
  background: var(--t-bg-aside);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border-right: 1px solid var(--t-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background 0.3s, border-color 0.3s;
}

.aside-logo {
  height: 64px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  cursor: pointer;
  border-bottom: 1px solid var(--t-border);
  flex-shrink: 0;
}

.logo-icon {
  width: 28px;
  height: 19px;
  flex-shrink: 0;
}

.logo-text {
  font-size: 16px;
  font-weight: 600;
  color: var(--t-text-primary);
  letter-spacing: 1px;
  transition: color 0.3s;
}

.aside-menu {
  border-right: none !important;
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.aside-menu::-webkit-scrollbar {
  width: 0;
}

.aside-menu :deep(.el-menu-item) {
  height: 42px;
  line-height: 42px;
  margin: 2px 8px;
  border-radius: 8px;
  font-size: 13px;
  padding-left: 20px !important;
  transition: all 0.2s;
}

.aside-menu :deep(.el-menu-item:hover) {
  background: var(--t-bg-hover) !important;
}

.aside-menu :deep(.el-menu-item.is-active) {
  background: var(--t-bg-active) !important;
  color: #007AFF !important;
}

.aside-menu :deep(.el-sub-menu__title) {
  height: 42px;
  line-height: 42px;
  margin: 2px 8px;
  border-radius: 8px;
  font-size: 13px;
  padding-left: 20px !important;
}

.aside-menu :deep(.el-sub-menu__title) {
  color: rgba(255, 255, 255, 0.65) !important;
}

.aside-menu :deep(.el-sub-menu__title:hover) {
  background: var(--t-bg-hover) !important;
}

.aside-menu :deep(.el-sub-menu .el-menu) {
  background: transparent !important;
}

.aside-menu :deep(.el-sub-menu .el-menu .el-menu-item) {
  padding-left: 44px !important;
  font-size: 13px;
}

.aside-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--t-border);
  flex-shrink: 0;
}

.aside-user {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #A855F7 100%);
  box-shadow: 0 6px 16px rgba(139, 92, 246, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.user-info {
  min-width: 0;
}

.user-name {
  font-size: 13px;
  color: var(--t-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.3s;
}

.user-role {
  font-size: 11px;
  color: var(--t-text-aside);
  margin-top: 1px;
  transition: color 0.3s;
}

/* ========== Body / Header ========== */
.layout-body {
  background: var(--t-bg-body);
  display: flex;
  flex-direction: column;
  transition: background 0.3s;
}

.layout-header {
  height: 56px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  background: var(--t-bg-header);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--t-border);
  flex-shrink: 0;
  transition: background 0.3s, border-color 0.3s;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--t-text-primary);
  transition: color 0.3s;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn {
  background: var(--t-bg-btn) !important;
  border: 1px solid var(--t-border-btn) !important;
  color: var(--t-text-secondary) !important;
  border-radius: 8px !important;
  font-size: 12px !important;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.2s;
}

.action-btn:hover {
  background: var(--t-bg-hover) !important;
  color: var(--t-text-primary) !important;
}

.logout-btn {
  color: #FF453A !important;
  border-color: rgba(255, 69, 58, 0.2) !important;
}

.logout-btn:hover {
  background: rgba(255, 69, 58, 0.12) !important;
}

/* ========== Main Content ========== */
.layout-main {
  background: var(--t-bg-body);
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
  transition: background 0.3s;
}

/* -- Card -- */
.layout-main :deep(.el-card) {
  background: var(--t-bg-card);
  border: 1px solid var(--t-border-card);
  border-radius: 12px;
  color: var(--t-text-primary);
  --el-card-bg-color: transparent;
  transition: background 0.3s, border-color 0.3s, color 0.3s;
}

.layout-main :deep(.el-card__header) {
  border-bottom: 1px solid var(--t-border);
  color: var(--t-text-primary);
  padding: 14px 20px;
}

.layout-main :deep(.el-card__body) {
  padding: 16px 20px;
}

/* -- Checklist Card (StarshipStatusPage) -- */
.layout-main :deep(.checklist-card) {
  margin-bottom: 12px;
  background: var(--t-bg-input) !important;
  border: 1px solid var(--t-border-input) !important;
}

/* -- Table -- */
.layout-main :deep(.el-table) {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: var(--t-bg-table-header);
  --el-table-row-hover-bg-color: var(--t-bg-table-hover);
  --el-table-border-color: var(--t-border);
  --el-table-text-color: var(--t-text-regular);
  --el-table-header-text-color: var(--t-text-muted);
  --el-table-current-row-bg-color: rgba(0,122,255,0.08);
  color: var(--t-text-regular);
}

.layout-main :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: var(--t-bg-stripe);
}

/* -- Pagination -- */
.layout-main :deep(.el-pagination) {
  --el-pagination-bg-color: transparent;
  --el-pagination-text-color: var(--t-text-secondary);
  --el-pagination-button-bg-color: var(--t-bg-btn);
  --el-pagination-button-color: var(--t-text-secondary);
  --el-pagination-hover-color: #007AFF;
}

/* -- Input -- */
.layout-main :deep(.el-input__wrapper) {
  background: var(--t-bg-input);
  box-shadow: none;
  border: 1px solid var(--t-border-input);
  border-radius: 8px;
  transition: background 0.3s, border-color 0.3s;
}

.layout-main :deep(.el-input__inner) {
  color: var(--t-text-primary);
}

.layout-main :deep(.el-input__wrapper:hover) {
  border-color: rgba(0, 122, 255, 0.4);
}

.layout-main :deep(.el-input__wrapper.is-focus) {
  border-color: #007AFF;
}

/* -- Textarea -- */
.layout-main :deep(.el-textarea__inner) {
  background: var(--t-bg-input);
  border: 1px solid var(--t-border-input);
  border-radius: 8px;
  color: var(--t-text-primary);
  box-shadow: none;
  transition: background 0.3s, border-color 0.3s, color 0.3s;
}

/* -- Select -- */
.layout-main :deep(.el-select .el-input__wrapper) {
  background: var(--t-bg-input);
}

/* -- Buttons -- */
.layout-main :deep(.el-button--primary) {
  --el-button-bg-color: #007AFF;
  --el-button-border-color: #007AFF;
  --el-button-hover-bg-color: #0A84FF;
  --el-button-hover-border-color: #0A84FF;
  border-radius: 8px;
}

.layout-main :deep(.el-button--danger) {
  --el-button-bg-color: #FF453A;
  --el-button-border-color: #FF453A;
  border-radius: 8px;
}

.layout-main :deep(.el-button--default) {
  background: var(--t-bg-btn);
  border-color: var(--t-border-btn);
  color: var(--t-text-regular);
  border-radius: 8px;
}

.layout-main :deep(.el-button--default:hover) {
  background: var(--t-bg-hover);
  color: var(--t-text-primary);
  border-color: var(--t-border-btn-hover);
}

/* -- Form -- */
.layout-main :deep(.el-form-item__label) {
  color: var(--t-text-secondary);
}

/* -- Divider -- */
.layout-main :deep(.el-divider__text) {
  background-color: var(--t-bg-divider-text);
  color: var(--t-text-muted);
  transition: background-color 0.3s, color 0.3s;
}

.layout-main :deep(.el-divider) {
  border-color: var(--t-border-card);
}

/* -- Tabs -- */
.layout-main :deep(.el-tabs__item) {
  color: var(--t-text-muted);
}

.layout-main :deep(.el-tabs__item.is-active) {
  color: #007AFF;
}

.layout-main :deep(.el-tabs__active-bar) {
  background-color: #007AFF;
}

.layout-main :deep(.el-tabs__nav-wrap::after) {
  background-color: var(--t-border);
}

/* -- Tags -- */
.layout-main :deep(.el-tag) {
  border-radius: 6px;
}

.layout-main :deep(.el-tag--success) {
  --el-tag-bg-color: rgba(52, 199, 89, 0.12);
  --el-tag-border-color: rgba(52, 199, 89, 0.2);
  --el-tag-text-color: #34C759;
}

.layout-main :deep(.el-tag--danger) {
  --el-tag-bg-color: rgba(255, 69, 58, 0.12);
  --el-tag-border-color: rgba(255, 69, 58, 0.2);
  --el-tag-text-color: #FF453A;
}

.layout-main :deep(.el-tag--warning) {
  --el-tag-bg-color: rgba(255, 149, 0, 0.12);
  --el-tag-border-color: rgba(255, 149, 0, 0.2);
  --el-tag-text-color: #FF9500;
}

.layout-main :deep(.el-tag--info) {
  --el-tag-bg-color: rgba(142, 142, 147, 0.12);
  --el-tag-border-color: rgba(142, 142, 147, 0.2);
  --el-tag-text-color: #8E8E93;
}

/* -- Dialog -- */
.layout-main :deep(.el-dialog) {
  --el-dialog-bg-color: var(--t-bg-dialog);
  --el-dialog-title-font-size: 16px;
  border: 1px solid var(--t-border-card);
  border-radius: 16px;
}

.layout-main :deep(.el-dialog__title) {
  color: var(--t-text-primary);
}

.layout-main :deep(.el-dialog__headerbtn .el-dialog__close) {
  color: var(--t-text-muted);
}

/* -- Misc Components -- */
.layout-main :deep(.el-switch__core) {
  border-radius: 16px;
}

.layout-main :deep(.el-input-number) {
  --el-input-number-bg-color: var(--t-bg-input);
}

.layout-main :deep(.el-descriptions__label) {
  color: var(--t-text-muted);
}

.layout-main :deep(.el-descriptions__content) {
  color: var(--t-text-regular);
}

.layout-main :deep(.el-empty__description p) {
  color: var(--t-text-placeholder);
}

.layout-main :deep(.el-progress__text) {
  color: var(--t-text-secondary);
}

.layout-main :deep(.el-text) {
  color: var(--t-text-muted);
}

/* -- Select Dropdown (teleported) -- */
.layout-main :deep(.el-select-dropdown) {
  background: var(--t-bg-card);
  border-color: var(--t-border-card);
}
</style>

<!-- 全局暗色主题覆盖（非 scoped，覆盖 teleported 组件） -->
<style>
html.dark {
  /* Element Plus 核心变量覆盖 */
  --el-bg-color: #1c1c1e;
  --el-bg-color-overlay: #1c1c1e;
  --el-bg-color-page: #0a0a0a;
  --el-fill-color: rgba(255,255,255,0.06);
  --el-fill-color-light: rgba(255,255,255,0.04);
  --el-fill-color-lighter: rgba(255,255,255,0.03);
  --el-fill-color-blank: #1c1c1e;
  --el-text-color-primary: #fff;
  --el-text-color-regular: rgba(255,255,255,0.85);
  --el-text-color-secondary: rgba(255,255,255,0.65);
  --el-text-color-placeholder: rgba(255,255,255,0.35);
  --el-border-color: rgba(255,255,255,0.1);
  --el-border-color-light: rgba(255,255,255,0.08);
  --el-border-color-lighter: rgba(255,255,255,0.06);
  --el-border-color-dark: rgba(255,255,255,0.15);
  --el-color-white: #1c1c1e;
  --el-mask-color: rgba(0,0,0,0.6);
  --el-box-shadow-light: 0 2px 12px rgba(0,0,0,0.4);
  color-scheme: dark;
}

/* Dialog (teleported to body) */
html.dark .el-dialog {
  --el-dialog-bg-color: #1c1c1e;
  background: #1c1c1e;
  border: 1px solid rgba(255,255,255,0.08);
}

html.dark .el-dialog__title {
  color: #fff;
}

html.dark .el-dialog__headerbtn .el-dialog__close {
  color: rgba(255,255,255,0.5);
}

html.dark .el-dialog__header {
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

html.dark .el-dialog__footer {
  border-top: 1px solid rgba(255,255,255,0.06);
}

/* Select Dropdown (teleported) */
html.dark .el-select-dropdown {
  background: #1c1c1e;
  border-color: rgba(255,255,255,0.08);
}

html.dark .el-select-dropdown__item {
  color: rgba(255,255,255,0.85);
}

html.dark .el-select-dropdown__item.hover,
html.dark .el-select-dropdown__item:hover {
  background: rgba(255,255,255,0.06);
}

html.dark .el-select-dropdown__item.selected {
  color: #007AFF;
}

/* Popper / Popover / Tooltip */
html.dark .el-popper {
  --el-bg-color-overlay: #1c1c1e;
  background: #1c1c1e;
  border-color: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.85);
}

html.dark .el-popper.is-dark {
  background: #1c1c1e;
  border-color: rgba(255,255,255,0.08);
  color: #fff;
}

html.dark .el-popper.is-light {
  background: #1c1c1e;
  border-color: rgba(255,255,255,0.08);
}

html.dark .el-popper.is-light .el-popper__arrow::before {
  background: #1c1c1e;
  border-color: rgba(255,255,255,0.08);
}

/* Input Number 增减按钮 */
html.dark .el-input-number__decrease,
html.dark .el-input-number__increase {
  background: rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.65);
  border-color: rgba(255,255,255,0.1);
}

html.dark .el-input-number__decrease:hover,
html.dark .el-input-number__increase:hover {
  color: #007AFF;
}

/* Radio */
html.dark .el-radio__label {
  color: rgba(255,255,255,0.85);
}

html.dark .el-radio__inner {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.2);
}

/* Checkbox */
html.dark .el-checkbox__label {
  color: rgba(255,255,255,0.85);
}

html.dark .el-checkbox__inner {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.2);
}

/* Message Box (teleported) */
html.dark .el-message-box {
  background: #1c1c1e;
  border-color: rgba(255,255,255,0.08);
}

html.dark .el-message-box__title {
  color: #fff;
}

html.dark .el-message-box__content {
  color: rgba(255,255,255,0.85);
}

html.dark .el-message-box__headerbtn .el-message-box__close {
  color: rgba(255,255,255,0.5);
}

/* Overlay / Mask */
html.dark .el-overlay {
  background-color: rgba(0,0,0,0.6);
}

/* Switch label */
html.dark .el-switch__label {
  color: rgba(255,255,255,0.65);
}

html.dark .el-switch__label.is-active {
  color: rgba(255,255,255,0.85);
}

/* Breadcrumb */
html.dark .el-breadcrumb__inner {
  color: rgba(255,255,255,0.5);
}

html.dark .el-breadcrumb__separator {
  color: rgba(255,255,255,0.3);
}

/* Form label inside dialog */
html.dark .el-form-item__label {
  color: rgba(255,255,255,0.65);
}

/* Input inside dialog */
html.dark .el-input__wrapper {
  background: rgba(255,255,255,0.06);
  box-shadow: none;
  border: 1px solid rgba(255,255,255,0.1);
}

html.dark .el-input__inner {
  color: #fff;
}

html.dark .el-input__inner::placeholder {
  color: rgba(255,255,255,0.35);
}

html.dark .el-textarea__inner {
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.1);
  color: #fff;
}

/* Table inside dialog */
html.dark .el-table {
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(255,255,255,0.03);
  --el-table-row-hover-bg-color: rgba(255,255,255,0.04);
  --el-table-border-color: rgba(255,255,255,0.06);
  --el-table-text-color: rgba(255,255,255,0.85);
  --el-table-header-text-color: rgba(255,255,255,0.5);
  --el-table-current-row-bg-color: rgba(0,122,255,0.08);
  color: rgba(255,255,255,0.85);
}

html.dark .el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell {
  background: rgba(255,255,255,0.02);
}

/* Action Sheet / Dropdown Menu */
html.dark .el-dropdown-menu {
  background: #1c1c1e;
  border-color: rgba(255,255,255,0.08);
}

html.dark .el-dropdown-menu__item {
  color: rgba(255,255,255,0.85);
}

html.dark .el-dropdown-menu__item:hover {
  background: rgba(255,255,255,0.06);
  color: #007AFF;
}

/* ============== 汉堡菜单按钮（移动端） ============== */
.hamburger-btn {
  display: none;
  width: 36px;
  height: 36px;
  margin-right: 8px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex-shrink: 0;
  transition: background 0.2s, border-color 0.2s;
}

.hamburger-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.hamburger-line {
  display: block;
  width: 16px;
  height: 1.5px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 2px;
  transition: transform 0.25s, opacity 0.2s;
  transform-origin: center;
}

.hamburger-line.is-open:nth-child(1) {
  transform: translateY(5.5px) rotate(45deg);
}

.hamburger-line.is-open:nth-child(2) {
  opacity: 0;
}

.hamburger-line.is-open:nth-child(3) {
  transform: translateY(-5.5px) rotate(-45deg);
}

.mobile-drawer-mask {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 998;
  animation: cx-fade-in 0.2s ease;
}

@keyframes cx-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.action-btn--icon-only .action-btn__label {
  display: inline;
  margin-left: 4px;
}

/* ============== 移动端断点（≤768px） ============== */
@media (max-width: 768px) {
  .hamburger-btn {
    display: inline-flex;
  }

  .mobile-drawer-mask {
    display: block;
  }

  .layout-aside {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    width: 80vw;
    max-width: 280px;
    z-index: 999;
    transform: translateX(-100%);
    transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1);
    box-shadow: 8px 0 32px rgba(0, 0, 0, 0.4);
  }

  .layout-aside.is-mobile-open {
    transform: translateX(0);
  }

  .layout-body {
    margin-left: 0 !important;
    width: 100%;
  }

  .layout-header {
    padding: 0 12px;
    height: 52px;
  }

  .header-title {
    font-size: 14px;
    flex: 1;
    min-width: 0;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0 8px;
  }

  .header-actions {
    gap: 6px;
    flex-shrink: 0;
  }

  .action-btn {
    padding: 6px 10px !important;
    font-size: 12px !important;
  }

  .action-btn--hide-on-mobile {
    display: none !important;
  }

  .action-btn--icon-only .action-btn__label {
    display: none;
  }

  .action-btn--icon-only {
    padding: 6px 8px !important;
  }

  .layout-main {
    padding: 12px !important;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* 表格在窄屏强制可横滚 */
  .layout-main :deep(.el-table) {
    min-width: 100%;
  }

  .layout-main :deep(.el-table__inner-wrapper) {
    overflow-x: auto;
  }

  /* 卡片间距压缩 */
  .layout-main :deep(.el-card) {
    border-radius: 12px;
  }

  .layout-main :deep(.el-card__body) {
    padding: 12px !important;
  }

  /* 对话框窄屏全宽 */
  :deep(.el-dialog) {
    width: 92vw !important;
    max-width: 92vw !important;
    margin: 5vh auto !important;
  }

  :deep(.el-dialog__body) {
    padding: 16px !important;
  }

  /* 表单 label 在窄屏改为顶部 */
  :deep(.el-form--label-right .el-form-item__label),
  :deep(.el-form--label-left .el-form-item__label) {
    text-align: left !important;
    width: auto !important;
    padding-right: 0 !important;
  }

  :deep(.el-form-item) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    margin-bottom: 16px;
  }

  :deep(.el-form-item__content) {
    margin-left: 0 !important;
  }

  /* 分页条紧凑 */
  .layout-main :deep(.el-pagination) {
    flex-wrap: wrap;
    gap: 4px;
    justify-content: center;
  }
}

/* 极窄屏（≤375px）进一步压缩 */
@media (max-width: 375px) {
  .layout-aside {
    width: 88vw;
  }

  .header-title {
    font-size: 13px;
  }

  .action-btn {
    padding: 5px 8px !important;
  }
}
</style>
