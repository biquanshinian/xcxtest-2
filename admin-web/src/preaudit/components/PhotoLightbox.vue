<template>
  <Teleport to="body">
    <div v-if="src" class="pa-lightbox" @click="emit('close')">
      <div class="pa-lightbox-stage" @click.stop>
        <img :src="src" alt="" />
        <div v-if="caption" class="pa-lightbox-caption">{{ caption }}</div>
      </div>
      <div class="pa-lightbox-bar" @click.stop>
        <el-button v-if="list.length > 1" @click="emit('step', -1)">上一张</el-button>
        <el-button @click="emit('rotate')">旋转</el-button>
        <el-button type="primary" @click="emit('close')">关闭</el-button>
        <el-button v-if="list.length > 1" @click="emit('step', 1)">下一张</el-button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'

const props = defineProps({
  src: { type: String, default: '' },
  caption: { type: String, default: '' },
  list: { type: Array, default: () => [] }
})
const emit = defineEmits(['close', 'step', 'rotate'])

const onKey = (e) => {
  if (!props.src) return
  if (e.key === 'Escape') emit('close')
  if (e.key === 'ArrowLeft') emit('step', -1)
  if (e.key === 'ArrowRight') emit('step', 1)
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>
