<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const navItems = [
  { key: 'projects', label: '项目页面', subtitle: '项目、答卷与结果中心', path: '/projects' },
  { key: 'tasks', label: '后台任务', subtitle: '扫描与批阅进度', path: '/tasks' },
  { key: 'answer-generator', label: '参考答案生成', subtitle: '模板、生成与历史记录', path: '/answer-generator' },
  { key: 'settings', label: '全局设置', subtitle: '模型后端与连接测试', path: '/settings' },
];

const activeKey = computed(() => String(route.name ?? 'projects'));
</script>

<template>
  <aside class="nav-sidebar glass-panel">
    <div class="nav-sidebar-main">
      <div class="brand-block">
        <div class="brand-mark">NM</div>
        <div>
          <div class="brand-title">NeuroMark</div>
          <div class="brand-subtitle">AI 自动阅卷</div>
        </div>
      </div>

      <div class="nav-list">
        <button
          v-for="item in navItems"
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
