<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useTokenVisualizerStore } from '@/stores/token-visualizer';

const route = useRoute();
const visualizerStore = useTokenVisualizerStore();

const currentTitle = computed(() => {
  if (visualizerStore.enabled) {
    return '词流界面';
  }

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

const visualizerButtonLabel = computed(() =>
  visualizerStore.enabled ? '返回普通页面' : '进入词流界面',
);
</script>

<template>
  <header class="top-bar glass-panel">
    <div>
      <h1 class="top-title">{{ currentTitle }}</h1>
    </div>
    <div class="top-bar-actions">
      <button
        type="button"
        class="visualizer-toggle"
        :class="{ 'visualizer-toggle--active': visualizerStore.enabled }"
        :aria-label="visualizerButtonLabel"
        :title="visualizerButtonLabel"
        @click="visualizerStore.toggle()"
      >
        <span
          class="visualizer-eye"
          aria-hidden="true"
        >
          <span class="visualizer-eye-pupil" />
        </span>
        <span class="visualizer-toggle-text">
          {{
            visualizerStore.enabled
              ? '返回工作台'
              : '词流视图'
          }}
        </span>
      </button>
    </div>
  </header>
</template>
