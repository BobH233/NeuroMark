<script setup lang="ts">
import type { PreviewImageItem } from '@preload/contracts';
import { toImageSrc } from '@/utils/file';

const props = defineProps<{
  image: PreviewImageItem;
}>();

async function openPreview() {
  await window.neuromark.preview.open([props.image], 0, props.image.title);
}
</script>

<template>
  <button class="image-tile" @click="openPreview">
    <img class="image-tile-media" :src="toImageSrc(image.src)" :alt="image.title" />
    <div class="image-tile-footer">
      <div class="image-tile-title">{{ image.title }}</div>
      <div v-if="image.caption" class="image-tile-caption">{{ image.caption }}</div>
    </div>
  </button>
</template>

