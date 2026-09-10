<template>
  <div class="pa-thumb-card" :class="thumbClass">
    <div class="pa-thumb" @click="$emit('preview')">
      <img :src="file.path" alt="" draggable="false" />
      <span
        v-if="label"
        class="pa-thumb-mark"
        :title="file.storeError || ''"
        @click.stop="onMark"
      >{{ label }}</span>
      <span v-if="code" class="pa-thumb-no">{{ code }}</span>
      <button type="button" class="pa-thumb-rotate" @click.stop="$emit('rotate')">旋转</button>
      <button type="button" class="pa-thumb-del" @click.stop="$emit('remove')">删除</button>
    </div>
    <input
      class="pa-thumb-caption"
      type="text"
      maxlength="40"
      v-model="draft"
      :placeholder="placeholder || '备注'"
      enterkeyhint="done"
      @click.stop
      @pointerdown.stop
      @touchstart.stop
      @focus="focused = true"
      @change="commit"
      @blur="commit"
      @keydown.enter.prevent="$event.target.blur()"
    />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  file: { type: Object, required: true },
  label: { type: String, default: '' },
  code: { type: String, default: '' },
  thumbClass: { type: [String, Object, Array], default: '' },
  placeholder: { type: String, default: '' }
})
const emit = defineEmits(['preview', 'remove', 'caption', 'retry', 'rotate'])

const focused = ref(false)
const draft = ref((props.file && props.file.caption) || '')

watch(() => [props.file && props.file.id, props.file && props.file.caption], () => {
  if (focused.value) return
  draft.value = (props.file && props.file.caption) || ''
})

function commit() {
  focused.value = false
  const next = String(draft.value || '').trim()
  draft.value = next
  const prev = String((props.file && props.file.caption) || '')
  if (next !== prev) emit('caption', next)
}

function onMark() {
  if (props.file && props.file.storeError) emit('retry')
}
</script>
