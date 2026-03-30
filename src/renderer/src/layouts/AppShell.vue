<script setup lang="ts">
import NavSidebar from '@/components/NavSidebar.vue';
import TopContextBar from '@/components/TopContextBar.vue';
</script>

<template>
  <div class="app-shell">
    <NavSidebar />
    <div class="shell-main">
      <div class="window-drag-strip" aria-hidden="true" />
      <TopContextBar />
      <main class="shell-content">
        <slot />
      </main>
    </div>
  </div>
</template>
