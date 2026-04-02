<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import brandLogo from '../../../../build/icons/128x128.png';
import { useDebugPanelStore } from '@/stores/debug-panel';

const route = useRoute();
const router = useRouter();
const debugPanelStore = useDebugPanelStore();

const navItems = [
  { key: 'projects', label: '项目页面', subtitle: '项目、答卷与结果中心', path: '/projects' },
  { key: 'tasks', label: '后台任务', subtitle: '扫描与批阅进度', path: '/tasks' },
  { key: 'answer-generator', label: '参考答案生成', subtitle: '模板、生成与历史记录', path: '/answer-generator' },
  { key: 'settings', label: '全局设置', subtitle: '模型后端与连接测试', path: '/settings' },
];

const visibleNavItems = computed(() => {
  const items = [...navItems];

  if (debugPanelStore.enabled) {
    items.push({
      key: 'debug-panel',
      label: '调试面板',
      subtitle: '终端输出与运行日志',
      path: '/debug',
    });
  }

  return items;
});

const activeKey = computed(() => {
  const routeNames = route.matched
    .map((item) => item.name)
    .filter((name): name is string => typeof name === 'string');

  if (routeNames.some((name) => name.startsWith('answer-generator'))) {
    return 'answer-generator';
  }

  if (routeNames.some((name) => name.startsWith('tasks'))) {
    return 'tasks';
  }

  if (routeNames.some((name) => name.startsWith('projects') || name === 'project-detail')) {
    return 'projects';
  }

  if (routeNames.includes('debug-panel')) {
    return 'debug-panel';
  }

  return String(route.name ?? 'projects');
});

onMounted(async () => {
  await debugPanelStore.initialize();
});

function handleLogoClick() {
  if (debugPanelStore.registerLogoClick()) {
    void router.push('/debug');
  }
}
</script>

<template>
  <aside class="nav-sidebar glass-panel">
    <div class="nav-sidebar-main">
      <button class="brand-block brand-trigger" type="button" @click="handleLogoClick">
        <div class="brand-mark">
          <img class="brand-logo" :src="brandLogo" alt="NeuroMark logo" />
        </div>
        <div>
          <div class="brand-title">NeuroMark</div>
          <div class="brand-subtitle">AI 自动阅卷</div>
        </div>
      </button>

      <div class="nav-list">
        <button
          v-for="item in visibleNavItems"
          :key="item.key"
          class="nav-card"
          :class="{ active: activeKey === item.key }"
          @click="router.push(item.path)"
        >
          <div class="nav-card-title">{{ item.label }}</div>
          <div class="nav-card-subtitle">{{ item.subtitle }}</div>
        </button>
      </div>
    </div>
  </aside>
</template>
