<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { NConfigProvider, NDialogProvider, NMessageProvider, zhCN, dateZhCN } from 'naive-ui';
import { RouterView, useRoute } from 'vue-router';
import AppShell from './layouts/AppShell.vue';
import { useAnswerGeneratorStore } from './stores/answer-generator';
import { useProjectsStore } from './stores/projects';
import { useTasksStore } from './stores/tasks';
import { useTokenVisualizerStore } from './stores/token-visualizer';

const route = useRoute();
const answerGeneratorStore = useAnswerGeneratorStore();
const projectsStore = useProjectsStore();
const tasksStore = useTasksStore();
const visualizerStore = useTokenVisualizerStore();

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

const isStandaloneRoute = computed(() =>
  ['preview', 'result-pdf-print'].includes(String(route.name ?? '')),
);

onMounted(async () => {
  await projectsStore.bootstrap();
  await tasksStore.bootstrap();
  await answerGeneratorStore.bootstrap();
});

watch(
  () => answerGeneratorStore.drafts,
  (drafts) => {
    for (const draft of drafts) {
      const channelKey = `answer-draft:${draft.id}`;
      visualizerStore.syncText(channelKey, 'reasoning', draft.generationReasoningText);
      visualizerStore.syncText(channelKey, 'preview', draft.generationPreviewText);
    }
  },
  { immediate: true },
);

watch(
  () => tasksStore.tasks,
  (tasks) => {
    for (const task of tasks) {
      if (task.kind !== 'grading') {
        continue;
      }
      const channelKey = `grading-task:${task.id}`;
      visualizerStore.syncText(channelKey, 'reasoning', task.streamReasoningText);
      visualizerStore.syncText(channelKey, 'preview', task.streamPreviewText);
    }
  },
  { immediate: true },
);

watch(
  () => visualizerStore.enabled,
  (enabled) => {
    if (!enabled) {
      visualizerStore.resetScene();
    }
  },
);
</script>

<template>
  <n-config-provider
    :locale="zhCN"
    :date-locale="dateZhCN"
    :theme-overrides="themeOverrides"
  >
    <n-dialog-provider>
      <n-message-provider>
        <RouterView v-if="isStandaloneRoute" />
        <AppShell v-else>
          <RouterView />
        </AppShell>
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>
