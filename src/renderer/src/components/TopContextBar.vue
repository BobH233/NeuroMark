<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { NButton } from 'naive-ui';
import { useProjectsStore } from '@/stores/projects';

const route = useRoute();
const projectsStore = useProjectsStore();

const currentTitle = computed(() => {
  const name = String(route.name ?? 'projects');
  if (name.startsWith('answer-generator')) {
    return '参考答案生成';
  }
  if (name === 'projects') {
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

const showRefreshButton = computed(() => {
  const name = String(route.name ?? 'projects');
  return !name.startsWith('answer-generator');
});

const selectedProject = computed(() => projectsStore.selectedProject);
</script>

<template>
  <header class="top-bar glass-panel">
    <div>
      <h1 class="top-title">{{ currentTitle }}</h1>
    </div>
    <div class="top-actions">
      <div v-if="selectedProject" class="project-brief">
        <span class="project-brief-name">{{ selectedProject.name }}</span>
        <span class="project-brief-meta">
          {{ selectedProject.stats.importedPaperCount }} 套答卷 /
          {{ selectedProject.stats.gradedPaperCount }} 已批改
        </span>
      </div>
      <n-button
        v-if="showRefreshButton"
        tertiary
        type="primary"
        @click="projectsStore.loadProjects()"
      >
        刷新数据
      </n-button>
    </div>
  </header>
</template>
