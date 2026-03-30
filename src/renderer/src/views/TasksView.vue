<script setup lang="ts">
import type { BackgroundJob } from '@preload/contracts';
import { computed, ref } from 'vue';
import { NButton, NCard, NEmpty, NProgress } from 'naive-ui';
import StatusPill from '@/components/StatusPill.vue';
import { useTasksStore } from '@/stores/tasks';

const tasksStore = useTasksStore();
const tasks = computed(() => tasksStore.tasks);
const expandedTaskIds = ref<Set<string>>(new Set());

async function cancelTask(jobId: string) {
  await window.neuromark.grading.cancel(jobId).catch(async () => {
    await window.neuromark.scan.cancel(jobId);
  });
}

function formatTaskTime(value: string | null, fallback: string) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('zh-CN', {
    hour12: false,
  });
}

function getTaskStartedAtLabel(task: BackgroundJob) {
  return formatTaskTime(task.startedAt, '未开始');
}

function getTaskFinishedAtLabel(task: BackgroundJob) {
  if (task.finishedAt) {
    return formatTaskTime(task.finishedAt, '未结束');
  }

  if (task.status === 'queued') {
    return '等待开始';
  }

  if (task.status === 'running' || task.status === 'paused') {
    return '进行中';
  }

  return '未结束';
}

function getTaskDisplayProgress(task: BackgroundJob) {
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    return 100;
  }

  return Math.round(task.progress * 100);
}

function getTaskProgressColor(task: BackgroundJob) {
  if (task.status === 'failed' || task.status === 'cancelled') {
    return '#d14343';
  }

  return '#3f7ae0';
}

function isTaskExpanded(taskId: string) {
  return expandedTaskIds.value.has(taskId);
}

function toggleTaskExpanded(taskId: string) {
  const next = new Set(expandedTaskIds.value);
  if (next.has(taskId)) {
    next.delete(taskId);
  } else {
    next.add(taskId);
  }
  expandedTaskIds.value = next;
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">
          后台任务可持续运行
        </div>
        <h2 class="section-title">
          后台任务页面
        </h2>
        <p class="section-copy">
          扫描与批阅任务会常驻主进程运行，你可以随时切换页面查看结果，而不会中断后台进度。
        </p>
      </div>
    </section>

    <section
      v-if="tasks.length"
      class="task-list-layout"
    >
      <n-card
        v-for="task in tasks"
        :key="task.id"
        class="surface-card task-list-card"
      >
        <template #header>
          <div class="task-list-card-title">
            {{ task.kind === 'scan' ? '批量扫描任务' : task.kind === 'grading' ? '批量批阅任务' : '参考答案生成任务' }}
          </div>
        </template>
        <template #header-extra>
          <StatusPill :value="task.status" />
        </template>
        <div class="task-list-card-body">
          <div class="task-list-card-main">
            <div
              v-if="isTaskExpanded(task.id)"
              class="task-list-meta-grid"
            >
              <div class="task-list-meta-item">
                <div class="task-list-meta-label">
                  任务分组
                </div>
                <div class="task-list-meta-value">
                  {{ task.projectName }}
                </div>
              </div>
              <div class="task-list-meta-item task-list-meta-item--wide">
                <div class="task-list-meta-label">
                  当前对象
                </div>
                <div class="task-list-meta-value">
                  {{ task.currentPaperLabel || '准备中' }}
                </div>
              </div>
              <div class="task-list-meta-item">
                <div class="task-list-meta-label">
                  处理速度
                </div>
                <div class="task-list-meta-value">
                  {{ task.kind === 'answer-generation' ? '按需请求' : `${task.speed.toFixed(2)} 套/分钟` }}
                </div>
              </div>
              <div class="task-list-meta-item">
                <div class="task-list-meta-label">
                  预计完成
                </div>
                <div class="task-list-meta-value">
                  {{ task.kind === 'answer-generation' ? (task.eta || '等待模型返回') : (task.eta || '计算中') }}
                </div>
              </div>
              <div class="task-list-meta-item">
                <div class="task-list-meta-label">
                  开始时间
                </div>
                <div class="task-list-meta-value">
                  {{ getTaskStartedAtLabel(task) }}
                </div>
              </div>
              <div class="task-list-meta-item">
                <div class="task-list-meta-label">
                  结束时间
                </div>
                <div class="task-list-meta-value">
                  {{ getTaskFinishedAtLabel(task) }}
                </div>
              </div>
            </div>

            <div class="task-list-progress">
              <div class="task-list-progress-head">
                <span>当前进度</span>
                <strong>{{ getTaskDisplayProgress(task) }}%</strong>
              </div>
              <n-progress
                type="line"
                :percentage="getTaskDisplayProgress(task)"
                :show-indicator="false"
                :color="getTaskProgressColor(task)"
              />
            </div>

            <div class="task-summary-panel">
              <div class="task-list-meta-label">
                任务摘要
              </div>
              <p class="task-summary">
                {{ task.summary }}
              </p>
            </div>
          </div>

          <div class="task-list-card-actions">
            <n-button
              tertiary
              @click="toggleTaskExpanded(task.id)"
            >
              {{ isTaskExpanded(task.id) ? '收起详情' : '展开详情' }}
            </n-button>
            <n-button
              v-if="task.abortable && task.status === 'running'"
              tertiary
              type="error"
              @click="cancelTask(task.id)"
            >
              终止任务
            </n-button>
          </div>
        </div>
      </n-card>
    </section>
    <n-empty
      v-else
      description="当前没有正在跟踪的后台任务"
    />
  </div>
</template>
