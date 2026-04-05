<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();

const currentTitle = computed(() => {
  const name = String(route.name ?? 'projects');
  if (name.startsWith('answer-generator')) {
    return '参考答案生成';
  }
  if (name.startsWith('projects') || name === 'project-detail') {
    return '项目页面';
  }
  if (name === 'tasks' || name === 'tasks-archived') {
    return '后台任务';
  }
  if (name === 'llm-usage') {
    return '模型计费';
  }
  if (name === 'settings') {
    return '全局设置';
  }
  if (name === 'debug-panel') {
    return '调试面板';
  }
  return 'NeuroMark';
});
</script>

<template>
  <header class="top-bar glass-panel">
    <div>
      <h1 class="top-title">{{ currentTitle }}</h1>
    </div>
  </header>
</template>
