<template>
  <el-tooltip
    :content="tooltipText"
    placement="right"
    effect="dark"
    :disabled="count <= 0"
    :show-after="200"
  >
    <span class="menu-row">
      <span class="menu-text">{{ label }}</span>
      <span
        v-if="count > 0"
        class="menu-count"
        :class="{ 'is-bumping': bumping }"
        :data-count="displayCount"
      >{{ displayCount }}</span>
    </span>
  </el-tooltip>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  path: { type: String, required: true },
  label: { type: String, required: true },
  count: { type: Number, default: 0 },
  tip: { type: String, default: '条新内容' }
})

const displayCount = computed(() => (props.count > 99 ? '99+' : String(props.count)))
const tooltipText = computed(() => `${props.count} ${props.tip}，点击查看`)

const bumping = ref(false)
let bumpTimer = null

function triggerBump() {
  bumping.value = false
  requestAnimationFrame(() => {
    bumping.value = true
    if (bumpTimer) clearTimeout(bumpTimer)
    bumpTimer = setTimeout(() => { bumping.value = false }, 360)
  })
}

watch(() => props.count, (next, prev) => {
  if (next > 0 && next > (prev || 0)) triggerBump()
})

function onBump(e) {
  const targetPath = e && e.detail && e.detail.path
  if (targetPath && targetPath === props.path) triggerBump()
}

onMounted(() => {
  window.addEventListener('menu-unread:bump', onBump)
  if (props.count > 0) triggerBump()
})

onBeforeUnmount(() => {
  window.removeEventListener('menu-unread:bump', onBump)
  if (bumpTimer) clearTimeout(bumpTimer)
})
</script>
