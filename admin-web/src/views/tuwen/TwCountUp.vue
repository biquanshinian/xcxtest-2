<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  value: { type: [Number, String], default: 0 },
  duration: { type: Number, default: 760 },
  money: { type: Boolean, default: false },
  decimals: { type: Number, default: 2 }
})

const shown = ref(0)
let raf = 0
let started = 0
let from = 0
let to = 0

function reduced() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function ease(t) {
  return 1 - (1 - t) ** 3
}

function stop() {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

function tick(ts) {
  if (!started) started = ts
  const p = Math.min(1, (ts - started) / Math.max(160, props.duration))
  shown.value = from + (to - from) * ease(p)
  if (p < 1) raf = requestAnimationFrame(tick)
  else shown.value = to
}

function play(next) {
  stop()
  const n = Number(next)
  const target = Number.isFinite(n) ? n : 0
  if (reduced()) {
    shown.value = target
    return
  }
  from = shown.value
  to = target
  if (from === to) return
  started = 0
  raf = requestAnimationFrame(tick)
}

watch(() => props.value, (v) => play(v), { immediate: true })
onBeforeUnmount(stop)

const text = computed(() => {
  const n = Number(shown.value) || 0
  if (props.money) return `¥${n.toFixed(props.decimals)}`
  return String(Math.round(n))
})
</script>

<template>
  <span class="tw-count">{{ text }}</span>
</template>
