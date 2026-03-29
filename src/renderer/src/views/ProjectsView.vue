<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  NButton,
  NCard,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NSwitch,
  NTabPane,
  NTabs,
} from 'naive-ui';
import type { FinalResult, PreviewImageItem, ResultRecord } from '@preload/contracts';
import CreateProjectModal from '@/components/CreateProjectModal.vue';
import ImagePreviewTile from '@/components/ImagePreviewTile.vue';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import MetricCard from '@/components/MetricCard.vue';
import StatusPill from '@/components/StatusPill.vue';
import { useProjectsStore } from '@/stores/projects';
import { toImageSrc } from '@/utils/file';
import { cloneFinalResult, computeDisplayedTotal } from '@/utils/result';

const projectsStore = useProjectsStore();

const showCreateModal = ref(false);
const activeTab = ref('overview');
const selectedResultId = ref('');
const previewMode = ref<'original' | 'scanned'>('scanned');
const editableResult = ref<FinalResult | null>(null);

const detail = computed(() => projectsStore.detail);
const selectedProject = computed(() => detail.value?.project ?? null);
const results = computed(() => detail.value?.results ?? []);
const papers = computed(() => detail.value?.originals ?? []);

const selectedResult = computed<ResultRecord | null>(() => {
  return results.value.find((item) => item.id === selectedResultId.value) ?? results.value[0] ?? null;
});

const selectedPaper = computed(() => {
  const current = selectedResult.value;
  if (!current) {
    return null;
  }
  return papers.value.find((item) => item.id === current.paperId) ?? null;
});

const resultPreviewImages = computed<PreviewImageItem[]>(() => {
  const paper = selectedPaper.value;
  const currentResult = selectedResult.value;
  if (!paper || !currentResult) {
    return [];
  }

  return paper.originalPages.map((page, index) => ({
    src:
      previewMode.value === 'scanned'
        ? page.scannedPath || page.originalPath
        : page.originalPath,
    title: `${paper.paperCode} · 第 ${index + 1} 页`,
    caption: previewMode.value === 'scanned' ? '扫描答卷视图' : '原始答卷视图',
    regions:
      previewMode.value === 'original'
        ? currentResult.modelResult.questionRegions?.filter(
            (region) => region.pageIndex === index,
          ) ?? []
        : currentResult.modelResult.questionRegions?.filter(
            (region) => region.pageIndex === index,
          ) ?? [],
  }));
});

watch(
  () => results.value,
  (value) => {
    if (!selectedResultId.value && value.length > 0) {
      selectedResultId.value = value[0].id;
    }
  },
  { immediate: true },
);

watch(
  () => selectedResult.value,
  (value) => {
    editableResult.value = value ? cloneFinalResult(value.finalResult) : null;
  },
  { immediate: true },
);

async function handleCreateProject(payload: any) {
  await projectsStore.createProject(payload);
  showCreateModal.value = false;
}

async function importImages() {
  if (!selectedProject.value) {
    return;
  }
  const files = await window.neuromark.app.selectImages();
  if (files.length === 0) {
    return;
  }
  await projectsStore.importOriginalImages(selectedProject.value.id, files);
}

async function startScan() {
  if (!selectedProject.value) {
    return;
  }
  await window.neuromark.scan.start(selectedProject.value.id, { skipCompleted: true });
}

async function startGrading() {
  if (!selectedProject.value) {
    return;
  }
  await window.neuromark.grading.start(selectedProject.value.id, { skipCompleted: true });
}

async function resumeGrading() {
  if (!selectedProject.value) {
    return;
  }
  await window.neuromark.grading.resume(selectedProject.value.id);
}

async function exportResults() {
  if (!selectedProject.value) {
    return;
  }
  await projectsStore.exportResults(selectedProject.value.id);
}

async function saveResult() {
  if (!selectedProject.value || !selectedResult.value || !editableResult.value) {
    return;
  }
  await projectsStore.saveFinalResult(
    selectedProject.value.id,
    selectedResult.value.paperId,
    editableResult.value,
  );
}

async function saveProjectSettings() {
  if (!selectedProject.value) {
    return;
  }
  await projectsStore.updateProjectSettings(selectedProject.value.id, selectedProject.value.settings);
}

async function openStagePreview() {
  if (resultPreviewImages.value.length === 0) {
    return;
  }
  await window.neuromark.preview.open(resultPreviewImages.value, 0, '答卷图片预览');
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">项目管理与批阅中心</div>
        <h2 class="section-title">项目页面</h2>
        <p class="section-copy">
          从新建项目、导入原始答卷，到扫描、批阅、复核和导出，所有关键状态都围绕项目进行组织。
        </p>
      </div>
      <n-button type="primary" size="large" @click="showCreateModal = true">新建项目</n-button>
    </section>

    <section class="project-grid">
      <button
        v-for="project in projectsStore.projects"
        :key="project.id"
        class="project-card"
        :class="{ active: project.id === projectsStore.selectedProjectId }"
        @click="projectsStore.selectProject(project.id)"
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
      </button>
    </section>

    <section v-if="selectedProject && detail" class="detail-panel">
      <div class="detail-panel-head">
        <div>
          <div class="eyebrow">当前项目</div>
          <h3 class="detail-title">{{ selectedProject.name }}</h3>
          <div class="detail-subtitle">{{ selectedProject.rootPath }}</div>
        </div>
        <n-space>
          <n-button secondary type="primary" @click="importImages">导入图片</n-button>
          <n-button secondary type="primary" @click="startScan">开始扫描识别</n-button>
          <n-button secondary type="primary" @click="startGrading">开始批阅</n-button>
          <n-button tertiary type="primary" @click="resumeGrading">断点续批</n-button>
          <n-button tertiary @click="exportResults">导出 JSON</n-button>
        </n-space>
      </div>

      <n-tabs v-model:value="activeTab" animated>
        <n-tab-pane name="overview" tab="概览">
          <div class="metrics-grid">
            <MetricCard label="导入答卷" :value="selectedProject.stats.importedPaperCount" hint="按试卷套数统计" />
            <MetricCard label="总页数" :value="selectedProject.stats.pageCount" hint="原始图片页数" />
            <MetricCard label="已扫描" :value="selectedProject.stats.scannedPaperCount" hint="已生成扫描件" />
            <MetricCard label="已批改" :value="selectedProject.stats.gradedPaperCount" hint="可进入结果复核" />
            <MetricCard label="平均分" :value="selectedProject.stats.averageScore" hint="按当前最终成绩计算" />
            <MetricCard label="最近任务" :value="selectedProject.stats.lastTaskSummary" />
          </div>
          <div class="two-pane">
            <n-card title="参考答案预览" class="surface-card">
              <MarkdownRenderer :source="detail.referenceAnswerMarkdown" />
            </n-card>
            <n-card title="最近后台任务" class="surface-card">
              <div v-if="detail.recentJobs.length" class="task-preview-list">
                <div v-for="task in detail.recentJobs" :key="task.id" class="task-preview-row">
                  <div>
                    <div class="task-preview-title">{{ task.kind === 'scan' ? '扫描任务' : '批阅任务' }}</div>
                    <div class="task-preview-meta">{{ task.summary }}</div>
                  </div>
                  <StatusPill :value="task.status" />
                </div>
              </div>
              <n-empty v-else description="当前项目还没有任务记录" />
            </n-card>
          </div>
        </n-tab-pane>

        <n-tab-pane name="originals" tab="原始答卷库">
          <div v-if="papers.length" class="paper-grid">
            <n-card v-for="paper in papers" :key="paper.id" class="surface-card" :title="paper.paperCode">
              <template #header-extra>
                <StatusPill :value="paper.scanStatus" />
              </template>
              <div class="paper-meta">
                <span>{{ paper.pageCount }} 页</span>
                <span>批改状态：{{ paper.gradingStatus === 'completed' ? '已完成' : '待处理' }}</span>
              </div>
              <div class="image-grid">
                <ImagePreviewTile
                  v-for="page in paper.originalPages"
                  :key="`${paper.id}-${page.pageIndex}`"
                  :image="{
                    src: page.originalPath,
                    title: `${paper.paperCode} · 原始图 ${page.pageIndex + 1}`,
                    caption: '点击单独预览窗口放大查看'
                  }"
                />
              </div>
            </n-card>
          </div>
          <n-empty v-else description="还没有导入原始答卷图片" />
        </n-tab-pane>

        <n-tab-pane name="scans" tab="扫描答卷库">
          <div v-if="papers.length" class="paper-grid">
            <n-card v-for="paper in papers" :key="paper.id" class="surface-card" :title="paper.paperCode">
              <template #header-extra>
                <StatusPill :value="paper.scanStatus" />
              </template>
              <div class="scan-panel">
                <div class="scan-column">
                  <div class="scan-column-title">扫描结果</div>
                  <div class="image-grid">
                    <ImagePreviewTile
                      v-for="page in paper.originalPages"
                      :key="`${paper.id}-${page.pageIndex}-scan`"
                      :image="{
                        src: page.scannedPath || page.originalPath,
                        title: `${paper.paperCode} · 扫描图 ${page.pageIndex + 1}`,
                        caption: page.scannedPath ? '已生成扫描件' : '等待扫描'
                      }"
                    />
                  </div>
                </div>
                <div class="scan-column">
                  <div class="scan-column-title">边界标注</div>
                  <div class="image-grid">
                    <ImagePreviewTile
                      v-for="page in paper.originalPages"
                      :key="`${paper.id}-${page.pageIndex}-debug`"
                      :image="{
                        src: page.debugPreviewPath || page.originalPath,
                        title: `${paper.paperCode} · 边界图 ${page.pageIndex + 1}`,
                        caption: page.debugPreviewPath ? '已生成边界预览' : '等待扫描'
                      }"
                    />
                  </div>
                </div>
              </div>
            </n-card>
          </div>
          <n-empty v-else description="导入原始答卷后即可启动扫描识别" />
        </n-tab-pane>

        <n-tab-pane name="results" tab="批阅结果">
          <div v-if="results.length && editableResult && selectedPaper" class="result-layout">
            <div class="result-list surface-card">
              <div class="result-list-head">已批改答卷</div>
              <button
                v-for="item in results"
                :key="item.id"
                class="result-row"
                :class="{ active: item.id === selectedResult?.id }"
                @click="selectedResultId = item.id"
              >
                <div>
                  <div class="result-row-title">
                    {{ papers.find((paper) => paper.id === item.paperId)?.paperCode || '未命名答卷' }}
                  </div>
                  <div class="result-row-subtitle">{{ item.finalResult.studentInfo.name || '未识别姓名' }}</div>
                </div>
                <div class="result-row-score">{{ computeDisplayedTotal(item.finalResult) }}</div>
              </button>
            </div>

            <div class="result-detail surface-card">
              <div class="result-detail-head">
                <div class="result-section-title">评分明细与人工修订</div>
                <n-button type="primary" @click="saveResult">保存修改</n-button>
              </div>

              <n-form v-if="editableResult" label-placement="top">
                <div class="three-col">
                  <n-form-item label="班级">
                    <n-input v-model:value="editableResult.studentInfo.className" />
                  </n-form-item>
                  <n-form-item label="学号">
                    <n-input v-model:value="editableResult.studentInfo.studentId" />
                  </n-form-item>
                  <n-form-item label="姓名">
                    <n-input v-model:value="editableResult.studentInfo.name" />
                  </n-form-item>
                </div>
                <div class="two-col">
                  <n-form-item label="总分">
                    <n-input-number
                      v-model:value="editableResult.manualTotalScore"
                      :min="0"
                      :max="100"
                    />
                  </n-form-item>
                  <n-form-item label="模型总分">
                    <n-input :value="String(editableResult.totalScore)" readonly />
                  </n-form-item>
                </div>
              </n-form>

              <div class="question-list">
                <div
                  v-for="question in editableResult.questionScores"
                  :key="question.questionId"
                  class="question-card"
                >
                  <div class="question-card-head">
                    <div>
                      <div class="question-card-title">{{ question.questionId }} · {{ question.questionTitle }}</div>
                      <div class="question-card-meta">满分 {{ question.maxScore }}</div>
                    </div>
                    <n-input-number v-model:value="question.score" :min="0" :max="question.maxScore" />
                  </div>
                  <MarkdownRenderer :source="question.reasoning" />
                  <div v-if="question.issues.length" class="issues-box">
                    <strong>问题点</strong>
                    <ul>
                      <li v-for="issue in question.issues" :key="issue">{{ issue }}</li>
                    </ul>
                  </div>
                </div>
              </div>

              <n-card title="整体评语" embedded class="surface-card nested">
                <MarkdownRenderer :source="editableResult.overallComment" />
              </n-card>
            </div>

            <div class="result-stage surface-card">
              <div class="result-detail-head">
                <div class="result-section-title">原图 / 扫描图与批阅区域</div>
                <n-space>
                  <n-button
                    size="small"
                    :type="previewMode === 'original' ? 'primary' : 'default'"
                    @click="previewMode = 'original'"
                  >
                    原始答卷
                  </n-button>
                  <n-button
                    size="small"
                    :type="previewMode === 'scanned' ? 'primary' : 'default'"
                    @click="previewMode = 'scanned'"
                  >
                    扫描答卷
                  </n-button>
                  <n-button tertiary size="small" @click="openStagePreview">单独预览</n-button>
                </n-space>
              </div>
              <div class="stage-stack">
                <div v-for="image in resultPreviewImages" :key="image.title" class="stage-card">
                  <div class="stage-card-title">{{ image.title }}</div>
                  <div class="paper-stage" @click="openStagePreview">
                    <img class="paper-stage-image" :src="toImageSrc(image.src)" :alt="image.title" />
                    <div
                      v-for="region in image.regions"
                      :key="`${image.title}-${region.questionId}`"
                      class="paper-stage-region"
                      :style="{
                        left: `${region.x * 100}%`,
                        top: `${region.y * 100}%`,
                        width: `${region.width * 100}%`,
                        height: `${region.height * 100}%`
                      }"
                    >
                      <span>{{ region.questionId }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <n-empty v-else description="完成扫描和批阅后，这里会显示三栏复核视图。" />
        </n-tab-pane>

        <n-tab-pane name="project-settings" tab="项目设置">
          <n-card class="surface-card" title="项目级批阅设置">
            <n-form v-if="selectedProject" label-placement="top">
              <div class="two-col">
                <n-form-item label="批阅并行数">
                  <n-input-number
                    v-model:value="selectedProject.settings.gradingConcurrency"
                    :min="1"
                  />
                </n-form-item>
                <n-form-item label="图像细节">
                  <n-select
                    v-model:value="selectedProject.settings.defaultImageDetail"
                    :options="[
                      { label: '高', value: 'high' },
                      { label: '自动', value: 'auto' },
                      { label: '低', value: 'low' }
                    ]"
                  />
                </n-form-item>
              </div>
              <n-form-item label="绘制批阅区域">
                <n-switch v-model:value="selectedProject.settings.drawRegions" />
              </n-form-item>
              <n-button type="primary" @click="saveProjectSettings">保存项目设置</n-button>
            </n-form>
          </n-card>
        </n-tab-pane>
      </n-tabs>
    </section>

    <n-empty v-else description="先创建一个阅卷项目。" />

    <CreateProjectModal
      :show="showCreateModal"
      @close="showCreateModal = false"
      @submit="handleCreateProject"
    />
  </div>
</template>
