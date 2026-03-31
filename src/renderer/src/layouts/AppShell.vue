<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import NavSidebar from '@/components/NavSidebar.vue';
import TopContextBar from '@/components/TopContextBar.vue';

const route = useRoute();
const contentRef = ref<HTMLElement | null>(null);

watch(
  () => route.fullPath,
  async () => {
    await nextTick();
    contentRef.value?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  },
);
</script>

<template>
  <div class="app-shell">
    <NavSidebar />
    <div class="shell-main">
      <div class="window-drag-strip" aria-hidden="true" />
      <TopContextBar />
      <div class="shell-scroll-fade" aria-hidden="true" />
      <main ref="contentRef" class="shell-content">
        <slot />
      </main>
    </div>
  </div>
</template>
