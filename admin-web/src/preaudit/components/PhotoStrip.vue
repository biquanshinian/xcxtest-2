<template>
  <div
    class="pa-thumbs"
    :class="{ on }"
    @pointerenter="$emit('mark')"
    @dragenter="forwardDrag($event, 'dragenter')"
    @dragover="forwardDrag($event, 'dragover')"
    @dragleave="forwardDrag($event, 'dragleave')"
    @drop="forwardDrop"
  >
    <draggable
      class="pa-thumbs-list"
      :model-value="files"
      item-key="id"
      handle=".pa-thumb"
      :animation="180"
      :delay="180"
      :delay-on-touch-only="true"
      :touch-start-threshold="8"
      ghost-class="pa-thumb-ghost"
      :filter="'.pa-thumb-caption, .pa-thumb-del, .pa-thumb-rotate, input, textarea'"
      :prevent-on-filter="true"
      @update:model-value="$emit('reorder', $event)"
    >
      <template #item="{ element, index }">
        <PhotoThumb
          :file="element"
          :label="labelOf(element)"
          :code="indexCode(index)"
          :thumb-class="classOf(element)"
          :placeholder="captionPlaceholder"
          @preview="$emit('preview', element)"
          @remove="$emit('remove', element)"
          @caption="$emit('caption', element, $event)"
          @retry="$emit('retry', element)"
          @rotate="$emit('rotate', element)"
        />
      </template>
    </draggable>
    <label class="pa-add">
      {{ addText }}
      <input type="file" :accept="accept" multiple hidden @change="$emit('pick', $event)" />
    </label>
  </div>
</template>

<script setup>
import draggable from 'vuedraggable'
import { isFileDrag } from '../lib/upload.js'
import PhotoThumb from './PhotoThumb.vue'

const props = defineProps({
  files: { type: Array, default: () => [] },
  on: { type: Boolean, default: false },
  addText: { type: String, default: '拍照或上传' },
  accept: { type: String, default: 'image/*,application/pdf,.pdf' },
  labelOf: { type: Function, default: () => '' },
  classOf: { type: Function, default: () => '' },
  captionPlaceholder: { type: String, default: '' },
  indexPrefix: { type: String, default: '' }
})
const emit = defineEmits(['mark', 'dragenter', 'dragover', 'dragleave', 'drop', 'reorder', 'preview', 'remove', 'caption', 'pick', 'retry', 'rotate'])

function indexCode(index) {
  if (!props.indexPrefix) return ''
  return props.indexPrefix + '-' + (index + 1)
}

function forwardDrag(e, name) {
  if (isFileDrag(e.dataTransfer)) e.preventDefault()
  emit(name, e)
}

function forwardDrop(e) {
  if (isFileDrag(e.dataTransfer)) e.preventDefault()
  emit('drop', e)
}
</script>
