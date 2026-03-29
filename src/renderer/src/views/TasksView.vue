<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NCard, NEmpty, NProgress } from 'naive-ui';
import StatusPill from '@/components/StatusPill.vue';
import { useTasksStore } from '@/stores/tasks';

const tasksStore = useTasksStore();
const tasks = computed(() => tasksStore.tasks);

async function cancelTask(jobId: string) {
  await window.neuromark.grading.cancel(jobId).catch(async () => {
    await window.neuromark.scan.cancel(jobId);
  });
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">后台任务可持续运行</div>
        <h2 class="section-title">后台任务页面</h2>
        <p class="section-copy">
          扫描与批阅任务会常驻主进程运行，你可以随时切换页面查看结果，而不会中断后台进度。
        </p>
      </div>
    </section>

    <section v-if="tasks.length" class="task-card-grid">
      <n-card v-for="task in tasks" :key="task.id" class="surface-card">
        <template #header>
          <div class="task-card-title">
            {{ task.kind === 'scan' ? '批量扫描任务' : task.kind === 'grading' ? '批量批阅任务' : '参考答案生成任务' }}
          </div>
        </template>
        <template #header-extra>
          <StatusPill :value="task.status" />
        </template>
        <div class="task-card-body">
          <div class="task-meta-line"><span>所属项目</span><strong>{{ task.projectName }}</strong></div>
          <div class="task-meta-line"><span>当前对象</span><strong>{{ task.currentPaperLabel || '准备中' }}</strong></div>
          <div class="task-meta-line"><span>处理速度</span><strong>{{ task.speed.toFixed(2) }} 套/分钟</strong></div>
          <div class="task-meta-line"><span>预计完成</span><strong>{{ task.eta || '计算中' }}</strong></div>
          <n-progress type="line" :percentage="Math.round(task.progress * 100)" :show-indicator="false" />
          <p class="task-summary">{{ task.summary }}</p>
          <n-button v-if="task.abortable && task.status === 'running'" tertiary type="error" @click="cancelTask(task.id)">
            终止任务
          </n-button>
        </div>
      </n-card>
    </section>
    <n-empty v-else description="当前没有正在跟踪的后台任务" />
  </div>
</template>

