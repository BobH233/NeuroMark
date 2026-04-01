<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  value: unknown;
  label?: string;
  depth?: number;
  initiallyExpanded?: boolean;
}>();

const isExpanded = ref(props.initiallyExpanded ?? true);
const nodeDepth = computed(() => props.depth ?? 0);
const isArray = computed(() => Array.isArray(props.value));
const isObject = computed(
  () => props.value !== null && typeof props.value === 'object' && !Array.isArray(props.value),
);
const entries = computed(() => {
  if (isArray.value) {
    return (props.value as unknown[]).map((item, index) => ({
      key: String(index),
      value: item,
    }));
  }

  if (isObject.value) {
    return Object.entries(props.value as Record<string, unknown>).map(([key, value]) => ({
      key,
      value,
    }));
  }

  return [];
});

const previewText = computed(() => {
  if (isArray.value) {
    return `Array(${entries.value.length})`;
  }
  if (isObject.value) {
    return `Object(${entries.value.length})`;
  }
  if (typeof props.value === 'string') {
    return `"${props.value}"`;
  }
  if (props.value === null) {
    return 'null';
  }
  return String(props.value);
});

function toggleExpanded() {
  if (!isArray.value && !isObject.value) {
    return;
  }
  isExpanded.value = !isExpanded.value;
}
</script>

<template>
  <div class="json-tree-node" :style="{ '--json-depth': String(nodeDepth) }">
    <div class="json-tree-row">
      <button
        v-if="isArray || isObject"
        class="json-tree-toggle"
        type="button"
        @click="toggleExpanded"
      >
        {{ isExpanded ? '▾' : '▸' }}
      </button>
      <span v-else class="json-tree-toggle json-tree-toggle--placeholder"></span>

      <span v-if="label" class="json-tree-key">{{ label }}</span>
      <span v-if="label" class="json-tree-colon">:</span>

      <template v-if="isArray || isObject">
        <span class="json-tree-value json-tree-type">{{ previewText }}</span>
      </template>
      <template v-else-if="typeof value === 'string'">
        <span class="json-tree-value json-tree-string">{{ previewText }}</span>
      </template>
      <template v-else-if="typeof value === 'number'">
        <span class="json-tree-value json-tree-number">{{ value }}</span>
      </template>
      <template v-else-if="typeof value === 'boolean'">
        <span class="json-tree-value json-tree-boolean">{{ String(value) }}</span>
      </template>
      <template v-else>
        <span class="json-tree-value json-tree-null">null</span>
      </template>
    </div>

    <div v-if="(isArray || isObject) && isExpanded" class="json-tree-children">
      <JsonTreeView
        v-for="entry in entries"
        :key="entry.key"
        :value="entry.value"
        :label="entry.key"
        :depth="nodeDepth + 1"
        :initially-expanded="nodeDepth < 1"
      />
    </div>
  </div>
</template>
