<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AnswerTokenVisualizer from '@/components/AnswerTokenVisualizer.vue';
import NavSidebar from '@/components/NavSidebar.vue';
import TopContextBar from '@/components/TopContextBar.vue';
import { useTokenVisualizerStore } from '@/stores/token-visualizer';

const route = useRoute();
const contentRef = ref<HTMLElement | null>(null);
const visualizerStore = useTokenVisualizerStore();

const isVisualizerMode = computed(() => visualizerStore.enabled);

watch(
  () => route.fullPath,
  async () => {
    await nextTick();
    contentRef.value?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  },
);
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'app-shell--visualizer': isVisualizerMode }"
  >
    <NavSidebar v-show="!isVisualizerMode" />
    <div class="shell-main">
      <div class="window-drag-strip" aria-hidden="true" />
      <TopContextBar />
      <div
        v-show="!isVisualizerMode"
        class="shell-scroll-fade"
        aria-hidden="true"
      />
      <main
        ref="contentRef"
        class="shell-content"
        :class="{ 'shell-content--scroll-locked': isVisualizerMode }"
      >
        <div
          v-show="!isVisualizerMode"
          class="shell-route-stage"
        >
          <slot />
        </div>
      </main>
      <section
        v-if="isVisualizerMode"
        class="shell-visualizer-stage"
      >
        <AnswerTokenVisualizer fullscreen />
      </section>
    </div>
  </div>
</template>
