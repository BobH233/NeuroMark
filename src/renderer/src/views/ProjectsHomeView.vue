<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NCard, NEmpty } from 'naive-ui';
import CreateProjectModal from '@/components/CreateProjectModal.vue';
import StatusPill from '@/components/StatusPill.vue';
import { useProjectsStore } from '@/stores/projects';

const router = useRouter();
const projectsStore = useProjectsStore();

const showCreateModal = ref(false);

onMounted(() => {
  projectsStore.clearSelection();
});

async function handleCreateProject(payload: any) {
  const project = await projectsStore.createProject(payload);
  showCreateModal.value = false;
  router.push(`/projects/${project.id}`);
}

function openProject(projectId: string) {
  router.push(`/projects/${projectId}`);
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">项目管理与批阅中心</div>
        <h2 class="section-title">项目页面</h2>
        <p class="section-copy">
          先选择一个项目进入详情，再查看答卷库、批阅结果和项目设置。
        </p>
      </div>
      <n-button type="primary" size="large" @click="showCreateModal = true">新建项目</n-button>
    </section>

    <section v-if="projectsStore.projects.length" class="project-grid">
      <article
        v-for="project in projectsStore.projects"
        :key="project.id"
        class="project-card"
        tabindex="0"
        @click="openProject(project.id)"
        @keydown.enter.prevent="openProject(project.id)"
        @keydown.space.prevent="openProject(project.id)"
      >
        <div class="project-card-head">
          <h3>{{ project.name }}</h3>
          <StatusPill value="completed" />
        </div>
        <div class="project-card-metrics">
          <span>{{ project.stats.importedPaperCount }} 套导入</span>
          <span>{{ project.stats.scannedPaperCount }} 套已扫描</span>
          <span>{{ project.stats.gradedPaperCount }} 套已批改</span>
        </div>
        <div class="project-card-footer">
          <span>平均分 {{ project.stats.averageScore }}</span>
          <span>{{ project.stats.lastTaskSummary }}</span>
        </div>
      </article>
    </section>

    <n-card v-else class="surface-card projects-empty-state">
      <n-empty description="还没有项目，先创建一个阅卷项目。" />
    </n-card>

    <CreateProjectModal
      :show="showCreateModal"
      @close="showCreateModal = false"
      @submit="handleCreateProject"
    />
  </div>
</template>
