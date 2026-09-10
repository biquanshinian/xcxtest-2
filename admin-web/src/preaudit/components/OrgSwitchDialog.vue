<template>
  <Teleport to="body">
    <div v-if="open" class="pa-lightbox pa-lightbox--dialog" @click.self="emit('close')">
      <div class="pa-card pa-org-switch" @click.stop>
        <p class="pa-title">换报账类型</p>
        <button
          v-for="org in orgs"
          :key="org.id"
          type="button"
          class="pa-item"
          :class="{ on: org.id === current }"
          @click="emit('pick', org.id)"
        >
          <div class="pa-tile" :class="org.accent">{{ tileOf(org.id) }}</div>
          <div class="pa-grow">
            <div>{{ org.title }}</div>
            <div class="pa-sub">{{ hintOf(org.id) }}</div>
          </div>
          <span v-if="org.id === current" class="pa-tag" :class="org.accent">当前</span>
        </button>
        <div class="pa-lightbox-bar">
          <el-button @click="emit('close')">取消</el-button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { listOrgs, normalize } from '../lib/org.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  currentOrg: { type: String, default: '' }
})
const emit = defineEmits(['close', 'pick'])
const orgs = listOrgs()
const current = computed(() => normalize(props.currentOrg))

function hintOf(id) {
  if (id === 'small') return '审批、报价、比价、施工照、验收、发票'
  if (id === 'township') return '审批、方案、采购、合同、发票'
  return '开会、公示、招标、合同、发票'
}

function tileOf(id) {
  if (id === 'small') return '小'
  if (id === 'township') return '乡'
  return '村'
}

const onKey = (e) => {
  if (!props.open) return
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>
