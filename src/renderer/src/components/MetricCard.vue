<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    value: string | number;
    hint?: string;
    valueMode?: 'number' | 'text';
    cardClass?: string;
  }>(),
  {
    valueMode: 'number',
    cardClass: '',
  },
);
</script>

<template>
  <div class="metric-card" :class="cardClass">
    <div class="metric-label">{{ label }}</div>
    <div
      class="metric-value"
      :class="{ 'metric-value-text': valueMode === 'text' }"
      :title="valueMode === 'text' ? String(value) : undefined"
    >
      {{ value }}
    </div>
    <div v-if="hint" class="metric-hint">{{ hint }}</div>
  </div>
</template>
