<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { NEmpty } from 'naive-ui';
import type { ComponentPublicInstance } from 'vue';
import type { PreviewSession } from '@preload/contracts';
import { toImageSrc } from '@/utils/file';

const route = useRoute();
const session = ref<PreviewSession | null>(null);
const loading = ref(true);
const activeIndex = ref(0);
const zoom = ref(1);
const rotations = ref<Record<number, number>>({});
const translate = ref({ x: 0, y: 0 });
const dragging = ref(false);
const dragOrigin = ref({ x: 0, y: 0 });
const suppressTransformTransition = ref(false);
const saving = ref(false);
const thumbnailRefs = ref<HTMLElement[]>([]);

const activeImage = computed(() => {
  if (!session.value) {
    return null;
  }
  return session.value.images[activeIndex.value] ?? null;
});

const zoomPercent = computed(() => Math.round(zoom.value * 100));
const hasMultipleImages = computed(() => (session.value?.images.length ?? 0) > 1);
const activeTitle = computed(() => activeImage.value?.title ?? '图片预览');
const activeCaption = computed(() => activeImage.value?.caption ?? '');
const activeRotation = computed(() => rotations.value[activeIndex.value] ?? 0);

onMounted(async () => {
  const token = String(route.params.token ?? '');
  try {
    const previewSession = await window.neuromark.app.getPreviewSession(token);
    session.value = previewSession;
    activeIndex.value = previewSession?.initialIndex ?? 0;
  } finally {
    loading.value = false;
  }
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
});

watch(
  activeIndex,
  async (index) => {
    await nextTick();
    thumbnailRefs.value[index]?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
  },
  { flush: 'post' },
);

function setThumbnailRef(
  el: Element | ComponentPublicInstance | null,
  index: number,
) {
  if (!el) {
    return;
  }

  thumbnailRefs.value[index] = (
    '$el' in el ? el.$el : el
  ) as HTMLElement;
}

function fitView() {
  zoom.value = 1;
  translate.value = { x: 0, y: 0 };
}

function setZoom(nextZoom: number) {
  zoom.value = Math.min(4, Math.max(0.25, Number(nextZoom.toFixed(2))));
}

function zoomIn() {
  setZoom(zoom.value + 0.1);
}

function zoomOut() {
  setZoom(zoom.value - 0.1);
}

function rotateLeft() {
  rotations.value[activeIndex.value] = activeRotation.value - 90;
}

function rotateRight() {
  rotations.value[activeIndex.value] = activeRotation.value + 90;
}

function selectImage(index: number) {
  suppressTransformTransition.value = true;
  activeIndex.value = index;
  fitView();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      suppressTransformTransition.value = false;
    });
  });
}

function showPrevious() {
  if (!session.value?.images.length) {
    return;
  }
  selectImage((activeIndex.value - 1 + session.value.images.length) % session.value.images.length);
}

function showNext() {
  if (!session.value?.images.length) {
    return;
  }
  selectImage((activeIndex.value + 1) % session.value.images.length);
}

function handleWheel(event: WheelEvent) {
  event.preventDefault();
  setZoom(zoom.value + (event.deltaY > 0 ? -0.08 : 0.08));
}

function startDrag(event: MouseEvent) {
  dragging.value = true;
  dragOrigin.value = {
    x: event.clientX - translate.value.x,
    y: event.clientY - translate.value.y,
  };
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

function handleKeydown(event: KeyboardEvent) {
  if (!session.value) {
    return;
  }

  if (event.key === 'ArrowLeft') {
    showPrevious();
  } else if (event.key === 'ArrowRight') {
    showNext();
  } else if (event.key === '+' || event.key === '=') {
    zoomIn();
  } else if (event.key === '-') {
    zoomOut();
  } else if (event.key === '0') {
    fitView();
  } else if (event.key === '[') {
    rotateLeft();
  } else if (event.key === ']') {
    rotateRight();
  }
}

async function saveCurrentImage() {
  if (!activeImage.value || saving.value) {
    return;
  }

  saving.value = true;
  try {
    await window.neuromark.preview.saveImage(
      activeImage.value.src,
      activeImage.value.caption || activeImage.value.title,
    );
  } catch (error) {
    window.alert(
      `保存图片失败：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="preview-page" @mousemove="moveDrag" @mouseup="endDrag" @mouseleave="endDrag">
    <template v-if="session && activeImage">
      <section class="preview-shell">
        <div class="preview-window-drag-strip" aria-hidden="true" />
        <div class="preview-header">
          <div>
            <div class="preview-title">{{ session.title }}</div>
            <div class="preview-subtitle">
              {{ activeTitle }}
              <span v-if="activeCaption"> · {{ activeCaption }}</span>
            </div>
          </div>

          <div class="preview-counter">{{ activeIndex + 1 }} / {{ session.images.length }}</div>
        </div>

        <main class="preview-stage-shell" :class="{ 'preview-stage-shell--single': !hasMultipleImages }">
          <aside v-if="hasMultipleImages" class="preview-rail">
            <button
              v-for="(image, index) in session.images"
              :key="`${image.title}-${index}`"
              :ref="(el) => setThumbnailRef(el, index)"
              class="preview-thumb"
              :class="{ active: index === activeIndex }"
              @click="selectImage(index)"
            >
              <img :src="toImageSrc(image.src)" :alt="image.title" />
              <span>{{ image.title }}</span>
            </button>
          </aside>

          <div class="preview-stage" @wheel="handleWheel">
            <button v-if="hasMultipleImages" class="preview-nav preview-nav-left" @click="showPrevious" aria-label="上一张">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.5 5.5 8 12l6.5 6.5" />
              </svg>
            </button>

            <div
              class="preview-canvas"
              :class="{ dragging, 'preview-canvas--no-transition': suppressTransformTransition }"
              :style="{
                transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale(${zoom}) rotate(${activeRotation}deg)`
              }"
              @mousedown="startDrag"
            >
              <img
                class="preview-image"
                :src="toImageSrc(activeImage.src)"
                :alt="activeImage.title"
                draggable="false"
              />
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

            <button v-if="hasMultipleImages" class="preview-nav preview-nav-right" @click="showNext" aria-label="下一张">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9.5 5.5 16 12l-6.5 6.5" />
              </svg>
            </button>
          </div>
        </main>

        <footer class="preview-toolbar">
          <button class="toolbar-icon-button" aria-label="缩小" @click="zoomOut">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M16 16 21 21" />
              <path d="M7.5 10.5h6" />
            </svg>
          </button>

          <div class="toolbar-readout">{{ zoomPercent }}%</div>

          <button class="toolbar-icon-button" aria-label="放大" @click="zoomIn">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M16 16 21 21" />
              <path d="M7.5 10.5h6" />
              <path d="M10.5 7.5v6" />
            </svg>
          </button>

          <span class="toolbar-divider" />

          <button class="toolbar-icon-button" aria-label="逆时针旋转" @click="rotateLeft">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path class="rotate-icon-primary" d="M7 17.29A8 8 0 1 0 5.06 11" />
              <polyline class="rotate-icon-accent" points="3 6 5 11 10 9" />
            </svg>
          </button>

          <button class="toolbar-icon-button" aria-label="顺时针旋转" @click="rotateRight">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path class="rotate-icon-primary" d="M17 17.29A8 8 0 1 1 18.94 11" />
              <polyline class="rotate-icon-accent" points="21 6 19 11 14 9" />
            </svg>
          </button>

          <span class="toolbar-divider" />

          <button
            class="toolbar-icon-button"
            :disabled="saving"
            aria-label="保存图片到本地"
            @click="saveCurrentImage"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 7h2" />
              <path d="M8 15h8v6H8z" />
              <path d="M20 7V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11Z" />
            </svg>
          </button>
        </footer>
      </section>
    </template>

    <div v-else-if="loading" class="preview-loading">
      <div class="preview-loading-shell">
        <div class="preview-loading-stage" />
        <div class="preview-loading-copy">正在准备图片预览...</div>
      </div>
    </div>

    <NEmpty v-else description="未找到预览数据，请从主界面重新打开图片预览。" />
  </div>
</template>

<style scoped>
.preview-page {
  min-height: 100vh;
  padding: 0;
  background: #111;
  color: #eef4f8;
  box-sizing: border-box;
}

.preview-shell {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  border-radius: 0;
  overflow: hidden;
  background: #111;
  border: none;
  box-shadow: none;
  backdrop-filter: none;
}

.preview-window-drag-strip {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  z-index: 3;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0));
  -webkit-app-region: drag;
}

.preview-loading {
  width: 100vw;
  height: 100vh;
  display: grid;
  place-items: center;
}

.preview-loading-shell {
  width: min(920px, calc(100vw - 120px));
  display: grid;
  gap: 18px;
}

.preview-loading-stage {
  width: 100%;
  aspect-ratio: 16 / 10;
  border-radius: 28px;
  background:
    linear-gradient(110deg, rgba(255, 255, 255, 0.04) 8%, rgba(255, 255, 255, 0.12) 18%, rgba(255, 255, 255, 0.04) 33%),
    linear-gradient(180deg, rgba(27, 27, 27, 0.96), rgba(19, 19, 19, 0.96));
  background-size: 200% 100%, 100% 100%;
  animation: preview-loading-shimmer 1.1s linear infinite;
}

.preview-loading-copy {
  text-align: center;
  color: rgba(255, 255, 255, 0.62);
  font-size: 14px;
}

@keyframes preview-loading-shimmer {
  from {
    background-position: 200% 0, 0 0;
  }

  to {
    background-position: -200% 0, 0 0;
  }
}

.preview-header {
  position: relative;
  z-index: 4;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 34px 24px 14px;
  -webkit-app-region: drag;
}

.preview-title {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.preview-subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}

.preview-counter {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
  font-weight: 700;
  -webkit-app-region: no-drag;
}

.preview-stage-shell {
  min-height: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 18px;
  padding: 0 22px 16px;
}

.preview-stage-shell--single {
  grid-template-columns: minmax(0, 1fr);
}

.preview-rail {
  width: 144px;
  padding: 16px 12px;
  border-radius: 24px;
  background: linear-gradient(180deg, rgba(13, 13, 13, 0.96), rgba(24, 24, 24, 0.9));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  overflow-y: auto;
}

.preview-thumb {
  width: 100%;
  display: grid;
  gap: 8px;
  margin: 0 0 12px;
  padding: 10px;
  border: none;
  border-radius: 16px;
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, transform 120ms ease;
  -webkit-app-region: no-drag;
}

.preview-thumb:last-child {
  margin-bottom: 0;
}

.preview-thumb.active {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  transform: translateY(-1px);
}

.preview-thumb img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 12px;
}

.preview-thumb span {
  font-size: 12px;
  line-height: 1.35;
  word-break: break-word;
}

.preview-stage {
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(27, 27, 27, 0.96), rgba(19, 19, 19, 0.96));
}

.preview-canvas {
  position: relative;
  width: fit-content;
  max-width: none;
  margin: 0;
  display: inline-block;
  transform-origin: center center;
  cursor: grab;
  user-select: none;
  will-change: transform;
  backface-visibility: hidden;
  transition: transform 120ms ease-out;
}

.preview-canvas.dragging {
  cursor: grabbing;
  transition: none;
}

.preview-canvas--no-transition {
  transition: none;
}

.preview-image {
  display: block;
  max-width: min(78vw, 1180px);
  max-height: calc(100vh - 240px);
  width: auto;
  height: auto;
  object-fit: contain;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.26);
}

.preview-nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 999px;
  background: rgba(13, 13, 13, 0.72);
  color: #fff;
  transform: translateY(-50%);
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.preview-nav svg {
  width: 22px;
  height: 22px;
  stroke: currentColor;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.preview-nav-left {
  left: 18px;
}

.preview-nav-right {
  right: 18px;
}

.preview-toolbar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  padding: 14px 24px 18px;
}

.toolbar-icon-button {
  height: 42px;
  min-width: 42px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 12px;
  background: rgba(10, 10, 10, 0.84);
  color: #fff;
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
  -webkit-app-region: no-drag;
}

.toolbar-icon-button:hover,
.toolbar-icon-button:hover {
  background: rgba(255, 255, 255, 0.12);
  transform: translateY(-1px);
}

.toolbar-icon-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.toolbar-icon-button svg {
  width: 22px;
  height: 22px;
  stroke: currentColor;
  stroke-width: 1.9;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.toolbar-icon-button .rotate-icon-primary,
.toolbar-icon-button .rotate-icon-accent {
  stroke: rgba(255, 255, 255, 0.92);
}

.toolbar-readout {
  min-width: 72px;
  height: 42px;
  display: grid;
  place-items: center;
  padding: 0 12px;
  border-radius: 12px;
  background: rgba(10, 10, 10, 0.84);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
}

.toolbar-divider {
  width: 1px;
  height: 28px;
  margin: 0 4px;
  background: rgba(255, 255, 255, 0.12);
}

html.platform-macos .preview-header {
  padding-left: 92px;
}

@media (max-width: 980px) {
  .preview-page {
    padding: 0;
  }

  .preview-shell {
    height: 100vh;
  }

  .preview-stage-shell {
    grid-template-columns: 1fr;
  }

  .preview-rail {
    width: auto;
    display: flex;
    gap: 10px;
    padding: 10px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .preview-thumb {
    width: 110px;
    min-width: 110px;
    margin: 0;
  }

  .preview-image {
    max-width: calc(100vw - 60px);
    max-height: calc(100vh - 300px);
  }

  .preview-toolbar {
    flex-wrap: wrap;
  }
}
</style>
