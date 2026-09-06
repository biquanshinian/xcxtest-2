<template>
  <div class="tw-shell">
    <nav class="tw-tabs" aria-label="智能业务模块">
      <router-link
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="tw-tab"
        :class="{ 'is-active': isActive(tab) }"
      >{{ tab.label }}</router-link>
    </nav>
    <router-view v-slot="{ Component, route: r }">
      <transition name="tw-fade">
        <component :is="Component" :key="viewKey(r)" />
      </transition>
    </router-view>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router'
import './tuwen.css'

const route = useRoute()
const tabs = [
  { to: '/tuwen/dashboard', label: '仪表盘' },
  { to: '/tuwen/orders', label: '订单' },
  { to: '/tuwen/customers', label: '客户' },
  { to: '/tuwen/suppliers', label: '供应商' },
  { to: '/tuwen/statements', label: '对账单' },
  { to: '/tuwen/expenses', label: '支出' },
  { to: '/tuwen/after-sales', label: '售后' },
  { to: '/tuwen/reports', label: '报表' },
  { to: '/tuwen/audit', label: '记录' },
  { to: '/tuwen/settings', label: '设置' }
]

function isActive(tab) {
  const path = String(route.path || '')
  if (tab.to === '/tuwen/orders') return path.startsWith('/tuwen/orders')
  return path === tab.to || path.startsWith(`${tab.to}/`)
}

function viewKey(r) {
  const path = String((r && r.path) || '')
  if (/^\/tuwen\/orders\/(new|[^/]+)$/.test(path)) return 'tuwen-order-edit'
  return path || 'tuwen'
}
</script>
