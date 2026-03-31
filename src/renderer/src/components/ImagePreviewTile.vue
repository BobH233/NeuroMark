<script setup lang="ts">
import type { PreviewImageItem } from '@preload/contracts';
import { toImageSrc } from '@/utils/file';

const props = defineProps<{
  image: PreviewImageItem;
  previewImages?: PreviewImageItem[];
  initialIndex?: number;
  previewTitle?: string;
}>();

async function openPreview() {
  const previewImages = props.previewImages?.length ? props.previewImages : [props.image];
  const currentIndex =
    props.previewImages?.length
      ? Math.min(Math.max(props.initialIndex ?? 0, 0), previewImages.length - 1)
      : 0;

  await window.neuromark.preview.open(
    previewImages,
    currentIndex,
    props.previewTitle ?? props.image.title,
  );
}
</script>

<template>
  <button
    class="image-tile"
    @click="openPreview"
  >
    <img
      class="image-tile-media"
      :src="toImageSrc(image.src, image.cacheKey)"
      :alt="image.title"
    >
    <div class="image-tile-footer">
      <div class="image-tile-title">
        {{ image.title }}
      </div>
      <div
        v-if="image.caption"
        class="image-tile-caption"
      >
        {{ image.caption }}
      </div>
    </div>
  </button>
</template>
