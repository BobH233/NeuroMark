<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    hint?: string;
    valueMode?: 'number' | 'text';
  }>(),
  {
    valueMode: 'number',
  },
);
</script>

<template>
  <div class="metric-card">
    <div class="metric-label">{{ label }}</div>
    <div class="metric-value" :class="{ 'metric-value-text': valueMode === 'text' }">
      {{ value }}
    </div>
    <div v-if="hint" class="metric-hint">{{ hint }}</div>
  </div>
</template>
