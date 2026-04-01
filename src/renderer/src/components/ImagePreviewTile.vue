<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { PreviewImageItem } from '@preload/contracts';
import { toImageSrc } from '@/utils/file';

const props = defineProps<{
  image: PreviewImageItem;
  previewImages?: PreviewImageItem[];
  initialIndex?: number;
  previewTitle?: string;
}>();

const tileRef = ref<HTMLElement | null>(null);
const hasEnteredViewport = ref(false);
const imageSrc = computed(() =>
  hasEnteredViewport.value ? toImageSrc(props.image.src, props.image.cacheKey) : undefined,
);

let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (hasEnteredViewport.value) {
    return;
  }

  if (!('IntersectionObserver' in window)) {
    hasEnteredViewport.value = true;
    return;
  }

  observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return;
      }

      hasEnteredViewport.value = true;
      observer?.disconnect();
      observer = null;
    },
    {
      rootMargin: '480px 0px',
    },
  );

  if (tileRef.value) {
    observer.observe(tileRef.value);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

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
    ref="tileRef"
    class="image-tile"
    @click="openPreview"
  >
    <div
      class="image-tile-media-shell"
      :class="{ 'image-tile-media-shell--loaded': hasEnteredViewport }"
    >
      <img
        v-if="imageSrc"
        class="image-tile-media"
        :src="imageSrc"
        :alt="image.title"
        loading="lazy"
        decoding="async"
      >
      <div
        v-else
        class="image-tile-media image-tile-media-placeholder"
        aria-hidden="true"
      />
    </div>
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
