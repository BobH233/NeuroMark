<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  value: string;
}>();

const theme = computed(() => {
  if (['completed'].includes(props.value)) {
    return 'success';
  }
  if (['running', 'processing'].includes(props.value)) {
    return 'active';
  }
  if (['failed', 'cancelled'].includes(props.value)) {
    return 'danger';
  }
  return 'muted';
});

const labelMap: Record<string, string> = {
  pending: '待开始',
  ready: '已就绪',
  processing: '处理中',
  running: '进行中',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
  skipped: '已跳过',
};
</script>

<template>
  <span class="status-pill" :data-theme="theme">{{ labelMap[value] ?? value }}</span>
</template>

