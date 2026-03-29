<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { NConfigProvider, NDialogProvider, NMessageProvider, zhCN, dateZhCN } from 'naive-ui';
import { RouterView, useRoute } from 'vue-router';
import AppShell from './layouts/AppShell.vue';
import { useProjectsStore } from './stores/projects';
import { useTasksStore } from './stores/tasks';

const route = useRoute();
const projectsStore = useProjectsStore();
const tasksStore = useTasksStore();

const themeOverrides = {
  common: {
    primaryColor: '#0f8b8d',
    primaryColorHover: '#147f81',
    primaryColorPressed: '#0b6a6b',
    borderRadius: '18px',
    fontFamily:
      '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif',
  },
};

const isPreviewRoute = computed(() => route.name === 'preview');

onMounted(async () => {
  await projectsStore.bootstrap();
  await tasksStore.bootstrap();
});
</script>

<template>
  <n-config-provider
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme-overrides="themeOverrides"
  >
    <n-dialog-provider>
      <n-message-provider>
        <RouterView v-if="isPreviewRoute" />
        <AppShell v-else>
          <RouterView />
        </AppShell>
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

