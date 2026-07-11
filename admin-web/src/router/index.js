import { createRouter, createWebHashHistory } from 'vue-router'
import LoginPage from '../views/LoginPage.vue'
import LayoutPage from '../views/LayoutPage.vue'
import DashboardPage from '../views/DashboardPage.vue'
import NewsEventsPage from '../views/NewsEventsPage.vue'
import NewsArticlesPage from '../views/NewsArticlesPage.vue'
import RoadClosurePage from '../views/RoadClosurePage.vue'
import SpaceXStatsPage from '../views/SpaceXStatsPage.vue'
import StarshipStatusPage from '../views/StarshipStatusPage.vue'
import CarouselPage from '../views/CarouselPage.vue'
import StarshipProgressPage from '../views/StarshipProgressPage.vue'
import StarshipEventUpdatesPage from '../views/StarshipEventUpdatesPage.vue'
import InspirationFeedPage from '../views/InspirationFeedPage.vue'
import ShopFeedPage from '../views/ShopFeedPage.vue'
import PopupAdPage from '../views/PopupAdPage.vue'
import UsersPage from '../views/UsersPage.vue'
import CosStoragePage from '../views/CosStoragePage.vue'
import RocketConfigPage from '../views/RocketConfigPage.vue'
import SplashScreenPage from '../views/SplashScreenPage.vue'
import PushNotifyPage from '../views/PushNotifyPage.vue'
import LaunchDataPage from '../views/LaunchDataPage.vue'
import TweetMonitorPage from '../views/TweetMonitorPage.vue'
import StatisticsPage from '../views/StatisticsPage.vue'
import LiveManagementPage from '../views/LiveManagementPage.vue'
import CloudFunctionsPage from '../views/CloudFunctionsPage.vue'
import GlobalConfigPage from '../views/GlobalConfigPage.vue'
import YearReviewConfigPage from '../views/YearReviewConfigPage.vue'
import AnnouncementsPage from '../views/AnnouncementsPage.vue'
import DataExportPage from '../views/DataExportPage.vue'
import LunarWishesPage from '../views/LunarWishesPage.vue'
import MembershipPage from '../views/MembershipPage.vue'
import LogsPage from '../views/LogsPage.vue'
import { auth } from '../api/client'

const routes = [
  { path: '/login', component: LoginPage },
  { path: '/share/figma', component: () => import('../views/FigmaSharePage.vue'), meta: { public: true } },
  {
    path: '/',
    component: LayoutPage,
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', component: DashboardPage, meta: { perm: 'dashboard' } },
      { path: 'news/events', component: NewsEventsPage, meta: { perm: 'news_events' } },
      { path: 'news/articles', component: NewsArticlesPage, meta: { perm: 'news_articles' } },
      { path: 'road-closure', component: RoadClosurePage, meta: { perm: 'road_closure' } },
      { path: 'spacex-stats', component: SpaceXStatsPage, meta: { perm: 'spacex_stats' } },
      { path: 'starship-status', component: StarshipStatusPage, meta: { perm: 'starship_status' } },
      { path: 'starship-progress', component: StarshipProgressPage, meta: { perm: 'starship_progress' } },
      { path: 'starship-event-updates', component: StarshipEventUpdatesPage, meta: { perm: 'starship_events' } },
      { path: 'inspiration-feed', component: InspirationFeedPage, meta: { perm: 'inspiration_feed' } },
      { path: 'shop-feed', component: ShopFeedPage, meta: { perm: 'shop_feed' } },
      { path: 'popup-ad', component: PopupAdPage, meta: { perm: 'shop_feed' } },
      { path: 'carousel', component: CarouselPage, meta: { perm: 'carousel' } },
      { path: 'splash-screen', component: SplashScreenPage, meta: { perm: 'splash_screen' } },
      { path: 'cos-storage', component: CosStoragePage, meta: { perm: 'cos_storage' } },
      { path: 'rocket-config', component: RocketConfigPage, meta: { perm: 'cos_storage' } },
      { path: 'users', component: UsersPage, meta: { perm: 'users' } },
      { path: 'logs', component: LogsPage, meta: { perm: 'logs' } },
      { path: 'push-notify', component: PushNotifyPage, meta: { perm: 'push_notify' } },
      { path: 'launch-data', component: LaunchDataPage, meta: { perm: 'launch_data' } },
      { path: 'tweet-monitor', component: TweetMonitorPage, meta: { perm: 'tweet_monitor' } },
      { path: 'statistics', component: StatisticsPage, meta: { perm: 'statistics' } },
      { path: 'live-management', component: LiveManagementPage, meta: { perm: 'live_mgmt' } },
      { path: 'cloud-functions', component: CloudFunctionsPage, meta: { perm: 'cloud_functions' } },
      { path: 'global-config', component: GlobalConfigPage, meta: { perm: 'global_config' } },
      { path: 'bilibili-topics', component: () => import('../views/BilibiliTopicsPage.vue'), meta: { perm: 'global_config' } },
      { path: 'year-review-config', component: YearReviewConfigPage, meta: { perm: 'global_config' } },
      { path: 'announcements', component: AnnouncementsPage, meta: { perm: 'announcements' } },
      { path: 'data-export', component: DataExportPage, meta: { perm: 'data_export' } },
      { path: 'lunar-wishes', component: LunarWishesPage, meta: { perm: 'lunar_wishes' } },
      { path: 'launch-votes', component: () => import('../views/LaunchVotesPage.vue'), meta: { perm: 'launch_votes' } },
      { path: 'milestone-rewards', component: () => import('../views/MilestoneRewardsPage.vue'), meta: { perm: 'milestone_rewards' } },
      { path: 'knowledge-cards', component: () => import('../views/KnowledgeCardsPage.vue'), meta: { perm: 'knowledge_cards' } },
      { path: 'membership', component: MembershipPage, meta: { perm: 'global_config' } },
      { path: 'invite-stats', component: () => import('../views/InviteStatsPage.vue'), meta: { perm: 'global_config' } },
      { path: 'figma-design', component: () => import('../views/FigmaDesignPage.vue'), meta: { perm: 'dashboard' } },
      { path: 'orbital-config', component: () => import('../views/OrbitalConfigPage.vue'), meta: { perm: 'global_config' } }
    ]
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach((to) => {
  if (to.path === '/login') return true
  if (to.meta?.public) return true

  const token = localStorage.getItem('admin_token')
  if (!token) return '/login'

  const perm = to.meta?.perm
  if (perm && !auth.hasPermission(perm)) return '/dashboard'

  return true
})

export default router
