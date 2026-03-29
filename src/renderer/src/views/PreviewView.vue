<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NEmpty, NSpace } from 'naive-ui';
import type { PreviewSession } from '@preload/contracts';
import { toImageSrc } from '@/utils/file';

const route = useRoute();
const session = ref<PreviewSession | null>(null);
const activeIndex = ref(0);
const zoom = ref(1);
const rotation = ref(0);
const translate = ref({ x: 0, y: 0 });
const dragging = ref(false);
const dragOrigin = ref({ x: 0, y: 0 });

const activeImage = computed(() => {
  if (!session.value) {
    return null;
  }
  return session.value.images[activeIndex.value] ?? null;
});

onMounted(async () => {
  const token = String(route.params.token ?? '');
  const previewSession = await window.neuromark.app.getPreviewSession(token);
  session.value = previewSession;
  activeIndex.value = previewSession?.initialIndex ?? 0;
});

function resetView() {
  zoom.value = 1;
  rotation.value = 0;
  translate.value = { x: 0, y: 0 };
}

function handleWheel(event: WheelEvent) {
  event.preventDefault();
  zoom.value = Math.min(4, Math.max(0.5, zoom.value + (event.deltaY > 0 ? -0.1 : 0.1)));
}

function startDrag(event: MouseEvent) {
  dragging.value = true;
  dragOrigin.value = { x: event.clientX - translate.value.x, y: event.clientY - translate.value.y };
}

function moveDrag(event: MouseEvent) {
  if (!dragging.value) {
    return;
  }
  translate.value = {
    x: event.clientX - dragOrigin.value.x,
    y: event.clientY - dragOrigin.value.y,
  };
}

function endDrag() {
  dragging.value = false;
}
</script>

<template>
  <div class="preview-page" @mousemove="moveDrag" @mouseup="endDrag" @mouseleave="endDrag">
    <template v-if="session && activeImage">
      <aside class="preview-sidebar">
        <div class="preview-title">{{ session.title }}</div>
        <div class="preview-subtitle">点击缩略图切换页面，滚轮缩放，按住拖动查看局部。</div>
        <div class="preview-thumb-list">
          <button
            v-for="(image, index) in session.images"
            :key="image.title"
            class="preview-thumb"
            :class="{ active: index === activeIndex }"
            @click="activeIndex = index"
          >
            <img :src="toImageSrc(image.src)" :alt="image.title" />
            <span>{{ image.title }}</span>
          </button>
        </div>
      </aside>

      <section class="preview-stage-shell">
        <div class="preview-toolbar">
          <NSpace>
            <NButton size="small" @click="zoom = Math.max(0.5, zoom - 0.1)">缩小</NButton>
            <NButton size="small" @click="zoom = Math.min(4, zoom + 0.1)">放大</NButton>
            <NButton size="small" @click="rotation -= 90">左旋</NButton>
            <NButton size="small" @click="rotation += 90">右旋</NButton>
            <NButton size="small" @click="resetView">重置</NButton>
          </NSpace>
          <div class="preview-toolbar-meta">
            缩放 {{ Math.round(zoom * 100) }}% · 旋转 {{ rotation }}°
          </div>
        </div>

        <div class="preview-stage" @wheel="handleWheel">
          <div
            class="preview-canvas"
            :style="{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${zoom}) rotate(${rotation}deg)`
            }"
            @mousedown="startDrag"
          >
            <img class="preview-image" :src="toImageSrc(activeImage.src)" :alt="activeImage.title" />
            <div
              v-for="region in activeImage.regions"
              :key="`${activeImage.title}-${region.questionId}`"
              class="preview-region"
              :style="{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`
              }"
            >
              <span>{{ region.questionId }}</span>
            </div>
          </div>
        </div>
      </section>
    </template>
    <n-empty v-else description="未找到预览数据，请从主界面重新打开图片预览。" />
  </div>
</template>

