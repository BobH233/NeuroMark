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
    return '项目工作台';
  }
  if (name === 'tasks') {
    return '后台任务中心';
  }
  if (name === 'settings') {
    return '全局设置';
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
