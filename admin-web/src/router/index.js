import { createRouter, createWebHashHistory } from 'vue-router'
import LoginPage from '../views/shell/LoginPage.vue'
import LayoutPage from '../views/shell/LayoutPage.vue'
import { auth } from '../api/client'
import { bindRouter as bindPreauditScroll } from '../preaudit/lib/scroll-memory.js'

const routes = [
  { path: '/login', component: LoginPage },
  { path: '/share/figma', component: () => import('../views/dashboard/FigmaSharePage.vue'), meta: { public: true } },
  {
    path: '/',
    component: LayoutPage,
    children: [
      { path: '', redirect: () => auth.homePath() },
      { path: 'dashboard', component: () => import('../views/dashboard/DashboardPage.vue'), meta: { perm: 'dashboard' } },
      { path: 'statistics', component: () => import('../views/dashboard/StatisticsPage.vue'), meta: { perm: 'statistics' } },
      { path: 'figma-design', component: () => import('../views/dashboard/FigmaDesignPage.vue'), meta: { perm: 'dashboard' } },
      { path: 'oa-content/pipeline', component: () => import('../views/oa/OaPipelinePage.vue'), meta: { perm: 'oa_content' } },
      { path: 'oa-content/drafts', component: () => import('../views/oa/OaDraftsPage.vue'), meta: { perm: 'oa_content' } },
      { path: 'oa-content/prompts', component: () => import('../views/oa/OaPromptsPage.vue'), meta: { perm: 'oa_content' } },
      { path: 'oa-content/strategies', component: () => import('../views/oa/OaStrategiesPage.vue'), meta: { perm: 'oa_content' } },
      { path: 'oa-content/assets', component: () => import('../views/oa/OaAssetsPage.vue'), meta: { perm: 'oa_content' } },
      { path: 'oa-content/config', component: () => import('../views/oa/OaContentConfigPage.vue'), meta: { perm: 'oa_content' } },
      { path: 'news/events', component: () => import('../views/news/NewsEventsPage.vue'), meta: { perm: 'news_events' } },
      { path: 'news/articles', component: () => import('../views/news/NewsArticlesPage.vue'), meta: { perm: 'news_articles' } },
      { path: 'launch-data', component: () => import('../views/launch/LaunchDataPage.vue'), meta: { perm: 'launch_data' } },
      { path: 'starship-status', component: () => import('../views/launch/StarshipStatusPage.vue'), meta: { perm: 'starship_status' } },
      { path: 'starship-progress', component: () => import('../views/launch/StarshipProgressPage.vue'), meta: { perm: 'starship_progress' } },
      { path: 'starship-event-updates', component: () => import('../views/launch/StarshipEventUpdatesPage.vue'), meta: { perm: 'starship_events' } },
      { path: 'tweet-monitor', component: () => import('../views/launch/TweetMonitorPage.vue'), meta: { perm: 'tweet_monitor' } },
      { path: 'road-closure', component: () => import('../views/launch/RoadClosurePage.vue'), meta: { perm: 'road_closure' } },
      { path: 'spacex-stats', component: () => import('../views/launch/SpaceXStatsPage.vue'), meta: { perm: 'spacex_stats' } },
      { path: 'launch-votes', component: () => import('../views/ops/LaunchVotesPage.vue'), meta: { perm: 'launch_votes' } },
      { path: 'push-notify', component: () => import('../views/ops/PushNotifyPage.vue'), meta: { perm: 'push_notify' } },
      { path: 'live-management', component: () => import('../views/ops/LiveManagementPage.vue'), meta: { perm: 'live_mgmt' } },
      { path: 'lunar-wishes', component: () => import('../views/ops/LunarWishesPage.vue'), meta: { perm: 'lunar_wishes' } },
      { path: 'astro-photos', component: () => import('../views/ops/AstroPhotosPage.vue'), meta: { perm: 'astro_photos' } },
      { path: 'milestone-rewards', component: () => import('../views/ops/MilestoneRewardsPage.vue'), meta: { perm: 'milestone_rewards' } },
      { path: 'knowledge-cards', component: () => import('../views/ops/KnowledgeCardsPage.vue'), meta: { perm: 'knowledge_cards' } },
      { path: 'announcements', component: () => import('../views/ops/AnnouncementsPage.vue'), meta: { perm: 'announcements' } },
      { path: 'carousel', component: () => import('../views/media/CarouselPage.vue'), meta: { perm: 'carousel' } },
      { path: 'splash-screen', component: () => import('../views/media/SplashScreenPage.vue'), meta: { perm: 'splash_screen' } },
      { path: 'orbit-pano', component: () => import('../views/media/OrbitPanoPage.vue'), meta: { perm: 'splash_screen' } },
      { path: 'popup-ad', component: () => import('../views/media/PopupAdPage.vue'), meta: { perm: 'shop_feed' } },
      { path: 'shop-feed', component: () => import('../views/media/ShopFeedPage.vue'), meta: { perm: 'shop_feed' } },
      { path: 'cos-storage', component: () => import('../views/media/CosStoragePage.vue'), meta: { perm: 'cos_storage' } },
      { path: 'rocket-config', component: () => import('../views/media/RocketConfigPage.vue'), meta: { perm: 'cos_storage' } },
      { path: 'rocket-3d', component: () => import('../views/media/Rocket3dPage.vue'), meta: { perm: 'cos_storage' } },
      { path: 'orbital-config', component: () => import('../views/media/OrbitalConfigPage.vue'), meta: { perm: 'global_config' } },
      { path: 'watch-party', component: () => import('../views/watch-party/WatchPartyPage.vue'), meta: { perm: 'watch_party' } },
      { path: 'watch-party-merchants', component: () => import('../views/watch-party/WatchPartyMerchantsPage.vue'), meta: { perm: 'watch_party' } },
      { path: 'souvenir-cards', component: () => import('../views/watch-party/SouvenirCardsPage.vue'), meta: { perm: 'watch_party' } },
      { path: 'users', component: () => import('../views/system/UsersPage.vue'), meta: { perm: 'users' } },
      { path: 'logs', component: () => import('../views/system/LogsPage.vue'), meta: { perm: 'logs' } },
      { path: 'cloud-functions', component: () => import('../views/system/CloudFunctionsPage.vue'), meta: { perm: 'cloud_functions' } },
      { path: 'global-config', component: () => import('../views/system/GlobalConfigPage.vue'), meta: { perm: 'global_config' } },
      { path: 'year-review-config', component: () => import('../views/system/YearReviewConfigPage.vue'), meta: { perm: 'global_config' } },
      { path: 'membership', component: () => import('../views/system/MembershipPage.vue'), meta: { perm: 'global_config' } },
      { path: 'invite-stats', component: () => import('../views/system/InviteStatsPage.vue'), meta: { perm: 'global_config' } },
      { path: 'data-export', component: () => import('../views/system/DataExportPage.vue'), meta: { perm: 'data_export' } },
      { path: 'preaudit', component: () => import('../preaudit/views/PreauditHome.vue'), meta: { public: true } },
      { path: 'preaudit/guide', component: () => import('../preaudit/views/PreauditGuide.vue'), meta: { public: true } },
      { path: 'preaudit/new', component: () => import('../preaudit/views/PreauditForm.vue'), meta: { public: true } },
      { path: 'preaudit/pack', component: () => import('../preaudit/views/PreauditPack.vue'), meta: { public: true } },
      { path: 'preaudit/:id/pack', component: () => import('../preaudit/views/PreauditPack.vue'), meta: { public: true } },
      { path: 'preaudit/:id/edit', component: () => import('../preaudit/views/PreauditForm.vue'), meta: { public: true } },
      { path: 'preaudit/:id/item/:key', component: () => import('../preaudit/views/PreauditMaterial.vue'), meta: { public: true } },
      { path: 'preaudit/:id/photos', component: () => import('../preaudit/views/PreauditPhotos.vue'), meta: { public: true } },
      { path: 'preaudit/:id/contract', component: () => import('../preaudit/views/PreauditContract.vue'), meta: { public: true } },
      { path: 'preaudit/:id/audit', component: () => import('../preaudit/views/PreauditAudit.vue'), meta: { public: true } },
      { path: 'preaudit/:id', component: () => import('../preaudit/views/PreauditProject.vue'), meta: { public: true } }
    ]
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

bindPreauditScroll(router)

router.afterEach((to) => {
  const path = String(to.path || '')
  const pre = path.startsWith('/preaudit')
  import('../preaudit/lib/store.js').then((store) => {
    if (pre) store.startLiveSync()
    else store.stopLiveSync()
    const id = to.params && to.params.id
    if (!id || !pre) return
    store.hydrateProject(id).then(() => store.persistPendingPhotos(id))
  })
})

router.beforeEach((to) => {
  if (to.path === '/login') return true
  if (to.meta?.public || String(to.path || '').startsWith('/preaudit')) return true

  const token = localStorage.getItem('admin_token')
  if (!token) return '/login'

  const perm = to.meta?.perm
  if (perm && !auth.hasPermission(perm)) {
    const dest = auth.homePath()
    if (dest === to.path) return true
    return dest
  }

  return true
})

export default router
