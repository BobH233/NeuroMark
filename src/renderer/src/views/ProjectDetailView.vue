<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MdEditor } from 'md-editor-v3';
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NPopconfirm,
  NSelect,
  NSpace,
  NSwitch,
  NTabPane,
  NTag,
  NTabs,
} from 'naive-ui';
import type { FinalResult, PaperRecord, PreviewImageItem, ResultRecord } from '@preload/contracts';
import ImagePreviewTile from '@/components/ImagePreviewTile.vue';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import MetricCard from '@/components/MetricCard.vue';
import StatusPill from '@/components/StatusPill.vue';
import { useProjectsStore } from '@/stores/projects';
import { toImageSrc } from '@/utils/file';
import { cloneFinalResult, computeDisplayedTotal } from '@/utils/result';

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();

const activeTab = ref('overview');
const selectedResultId = ref('');
const previewMode = ref<'original' | 'scanned'>('scanned');
const editableResult = ref<FinalResult | null>(null);
const referenceAnswerDraft = ref('');
const referenceAnswerSaving = ref(false);
const referenceAnswerDraftProjectId = ref('');
const referenceAnswerDraftVersion = ref(0);
const deletingProject = ref(false);

const projectId = computed(() => String(route.params.projectId ?? ''));
const detail = computed(() =>
  projectsStore.detail?.project.id === projectId.value ? projectsStore.detail : null,
);
const selectedProject = computed(() => detail.value?.project ?? null);
const results = computed(() => detail.value?.results ?? []);
const papers = computed(() => detail.value?.originals ?? []);
const latestReferenceAnswerVersion = computed(() => selectedProject.value?.referenceAnswerVersion ?? 1);
const referenceAnswerDirty = computed(() =>
  detail.value ? referenceAnswerDraft.value !== detail.value.referenceAnswerMarkdown : false,
);
const selectedResultUsesLatestReference = computed(() => {
  if (!selectedResult.value) {
    return true;
  }
  return selectedResult.value.referenceAnswerVersion === latestReferenceAnswerVersion.value;
});

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
    regions: currentResult.modelResult.questionRegions?.filter((region) => region.pageIndex === index) ?? [],
  }));
});

watch(
  () => [detail.value?.project.id, detail.value?.project.referenceAnswerVersion] as const,
  ([nextProjectId, nextVersion]) => {
    if (!nextProjectId) {
      referenceAnswerDraft.value = '';
      referenceAnswerDraftProjectId.value = '';
      referenceAnswerDraftVersion.value = 0;
      return;
    }

    if (
      referenceAnswerDraftProjectId.value !== nextProjectId ||
      referenceAnswerDraftVersion.value !== (nextVersion ?? 0)
    ) {
      referenceAnswerDraft.value = detail.value?.referenceAnswerMarkdown ?? '';
      referenceAnswerDraftProjectId.value = nextProjectId;
      referenceAnswerDraftVersion.value = nextVersion ?? 0;
    }
  },
  { immediate: true },
);

watch(
  () => results.value,
  (value) => {
    if (!value.length) {
      selectedResultId.value = '';
      return;
    }

    if (!value.some((item) => item.id === selectedResultId.value)) {
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

onMounted(async () => {
  if (projectsStore.projects.length === 0) {
    await projectsStore.bootstrap();
  }

  if (projectId.value) {
    await projectsStore.selectProject(projectId.value);
  }
});

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

async function forceRescan() {
  if (!selectedProject.value) {
    return;
  }
  await window.neuromark.scan.start(selectedProject.value.id, { skipCompleted: false });
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

async function saveReferenceAnswer() {
  if (!selectedProject.value || !referenceAnswerDirty.value || referenceAnswerSaving.value) {
    return;
  }

  const nextMarkdown = referenceAnswerDraft.value.trim();
  if (!nextMarkdown) {
    window.alert('参考答案不能为空。');
    return;
  }

  referenceAnswerSaving.value = true;
  try {
    await projectsStore.updateReferenceAnswer(selectedProject.value.id, nextMarkdown);
  } finally {
    referenceAnswerSaving.value = false;
  }
}

async function deleteProject() {
  if (!selectedProject.value || deletingProject.value) {
    return;
  }

  deletingProject.value = true;
  try {
    const projectIdToDelete = selectedProject.value.id;
    await projectsStore.deleteProject(projectIdToDelete);
    router.replace('/projects');
  } finally {
    deletingProject.value = false;
  }
}

function handleReferenceAnswerChange(value: string) {
  referenceAnswerDraft.value = value;
}

async function openStagePreview() {
  if (resultPreviewImages.value.length === 0) {
    return;
  }
  await window.neuromark.preview.open(resultPreviewImages.value, 0, '答卷图片预览');
}

function getOriginalPreviewImages(paper: PaperRecord): PreviewImageItem[] {
  return paper.originalPages.map((page, index) => ({
    src: page.originalPath,
    title: `${paper.paperCode} · 原始图 ${index + 1}`,
    caption: '点击单独预览窗口放大查看',
  }));
}

function getScannedPreviewImages(paper: PaperRecord): PreviewImageItem[] {
  return paper.originalPages.map((page, index) => ({
    src: page.scannedPath || page.originalPath,
    title: `${paper.paperCode} · 扫描图 ${index + 1}`,
    caption: page.scannedPath ? '已生成扫描件' : '等待扫描',
  }));
}

function getDebugPreviewImages(paper: PaperRecord): PreviewImageItem[] {
  return paper.originalPages.map((page, index) => ({
    src: page.debugPreviewPath || page.originalPath,
    title: `${paper.paperCode} · 边界图 ${index + 1}`,
    caption: page.debugPreviewPath ? '已生成边界预览' : '等待扫描',
  }));
}

function isResultOutdated(result: ResultRecord) {
  return result.referenceAnswerVersion !== latestReferenceAnswerVersion.value;
}

function formatTaskTime(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getTaskStartedAtLabel(value: string | null | undefined) {
  return formatTaskTime(value, '未开始');
}

function getTaskFinishedAtLabel(value: string | null | undefined, status: string) {
  if (value) {
    return formatTaskTime(value, '未结束');
  }

  if (status === 'queued') {
    return '等待开始';
  }

  if (status === 'running' || status === 'paused') {
    return '进行中';
  }

  return '未结束';
}

function getTaskProgressLabel(progress: number, status: string) {
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    return '100%';
  }

  return `${Math.round(progress * 100)}%`;
}

function goBack() {
  router.push('/projects');
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">项目详情</div>
        <h2 class="section-title">{{ selectedProject?.name || '项目详情' }}</h2>
        <p class="section-copy">
          在这里查看项目概览、答卷库、批阅结果与项目设置。
        </p>
        <div v-if="selectedProject" class="hero-actions hero-actions-primary">
          <n-button secondary type="primary" @click="importImages">导入图片</n-button>
          <n-button secondary type="primary" @click="startScan">开始扫描识别</n-button>
          <n-button secondary type="warning" @click="forceRescan">强制重新扫描</n-button>
          <n-button secondary type="primary" @click="startGrading">开始批阅</n-button>
          <n-button tertiary type="primary" @click="resumeGrading">断点续批</n-button>
          <n-button tertiary @click="exportResults">导出 JSON</n-button>
        </div>
      </div>
      <div class="hero-actions">
        <n-button tertiary @click="goBack">返回项目列表</n-button>
      </div>
    </section>

    <section v-if="selectedProject && detail" class="detail-panel">
      <div class="detail-panel-head project-detail-head">
        <div>
          <div class="eyebrow">当前项目</div>
          <h3 class="detail-title">{{ selectedProject.name }}</h3>
          <div class="detail-subtitle">{{ selectedProject.rootPath }}</div>
        </div>
      </div>

      <n-tabs v-model:value="activeTab" animated>
        <n-tab-pane name="overview" tab="概览">
          <div class="project-overview-stack">
            <section class="project-overview-section">
              <div class="project-section-head">
                <div class="project-section-title">项目概览</div>
                <div class="project-section-copy">可以先快速浏览关键指标，再继续查看参考答案预览和最近任务。</div>
              </div>
              <div class="metrics-grid project-overview-metrics">
                <MetricCard label="导入答卷" :value="selectedProject.stats.importedPaperCount" hint="按试卷套数统计" />
                <MetricCard label="总页数" :value="selectedProject.stats.pageCount" hint="原始图片页数" />
                <MetricCard label="已扫描" :value="selectedProject.stats.scannedPaperCount" hint="已生成扫描件" />
                <MetricCard label="已批改" :value="selectedProject.stats.gradedPaperCount" hint="可进入结果复核" />
                <MetricCard label="平均分" :value="selectedProject.stats.averageScore" hint="按当前最终成绩计算" />
                <MetricCard
                  label="最近任务"
                  :value="selectedProject.stats.lastTaskSummary"
                  value-mode="text"
                  card-class="metric-card-wide"
                />
              </div>
            </section>

            <section class="project-overview-section">
              <div class="project-section-head">
                <div class="project-section-title">参考答案预览</div>
                <div class="project-section-copy">当前项目参考答案版本：v{{ latestReferenceAnswerVersion }}</div>
              </div>
              <n-card class="surface-card flat-card">
                <MarkdownRenderer :source="detail.referenceAnswerMarkdown" />
              </n-card>
            </section>

            <section class="project-overview-section">
              <div class="project-section-head">
                <div class="project-section-title">最近后台任务</div>
              </div>
              <n-card class="surface-card flat-card">
                <div v-if="detail.recentJobs.length" class="task-preview-list">
                  <div v-for="task in detail.recentJobs" :key="task.id" class="task-preview-row">
                    <div class="task-preview-main">
                      <div class="task-preview-topline">
                        <div class="task-preview-title">
                          {{
                            task.kind === 'scan'
                              ? '扫描任务'
                              : task.kind === 'grading'
                                ? '批阅任务'
                                : '参考答案生成任务'
                          }}
                        </div>
                        <div class="task-preview-inline-tags">
                          <n-tag
                            v-if="task.kind === 'grading' && task.referenceAnswerVersion"
                            size="small"
                            round
                            :bordered="false"
                          >
                            参考答案 v{{ task.referenceAnswerVersion }}
                          </n-tag>
                          <n-tag size="small" round :bordered="false">
                            进度 {{ getTaskProgressLabel(task.progress, task.status) }}
                          </n-tag>
                        </div>
                      </div>
                      <div class="task-preview-meta">{{ task.summary }}</div>
                      <div class="task-preview-grid">
                        <div class="task-preview-item">
                          <span>开始时间</span>
                          <strong>{{ getTaskStartedAtLabel(task.startedAt) }}</strong>
                        </div>
                        <div class="task-preview-item">
                          <span>结束时间</span>
                          <strong>{{ getTaskFinishedAtLabel(task.finishedAt, task.status) }}</strong>
                        </div>
                        <div class="task-preview-item">
                          <span>当前答卷</span>
                          <strong>{{ task.currentPaperLabel || '暂未分配' }}</strong>
                        </div>
                        <div class="task-preview-item">
                          <span>预计完成</span>
                          <strong>{{ task.eta || (task.status === 'completed' ? '已完成' : '暂无') }}</strong>
                        </div>
                      </div>
                    </div>
                    <StatusPill :value="task.status" />
                  </div>
                </div>
                <n-empty v-else description="当前项目还没有任务记录" />
              </n-card>
            </section>
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
                  v-for="(page, pageIndex) in paper.originalPages"
                  :key="`${paper.id}-${page.pageIndex}`"
                  :image="{
                    src: page.originalPath,
                    title: `${paper.paperCode} · 原始图 ${page.pageIndex + 1}`,
                    caption: '点击单独预览窗口放大查看'
                  }"
                  :preview-images="getOriginalPreviewImages(paper)"
                  :initial-index="pageIndex"
                  :preview-title="`${paper.paperCode} · 原始答卷预览`"
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
                      v-for="(page, pageIndex) in paper.originalPages"
                      :key="`${paper.id}-${page.pageIndex}-scan`"
                      :image="{
                        src: page.scannedPath || page.originalPath,
                        title: `${paper.paperCode} · 扫描图 ${page.pageIndex + 1}`,
                        caption: page.scannedPath ? '已生成扫描件' : '等待扫描'
                      }"
                      :preview-images="getScannedPreviewImages(paper)"
                      :initial-index="pageIndex"
                      :preview-title="`${paper.paperCode} · 扫描答卷预览`"
                    />
                  </div>
                </div>
                <div class="scan-column">
                  <div class="scan-column-title">边界标注</div>
                  <div class="image-grid">
                    <ImagePreviewTile
                      v-for="(page, pageIndex) in paper.originalPages"
                      :key="`${paper.id}-${page.pageIndex}-debug`"
                      :image="{
                        src: page.debugPreviewPath || page.originalPath,
                        title: `${paper.paperCode} · 边界图 ${page.pageIndex + 1}`,
                        caption: page.debugPreviewPath ? '已生成边界预览' : '等待扫描'
                      }"
                      :preview-images="getDebugPreviewImages(paper)"
                      :initial-index="pageIndex"
                      :preview-title="`${paper.paperCode} · 边界标注预览`"
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
                <div class="result-row-meta">
                  <div class="result-row-title">
                    {{ papers.find((paper) => paper.id === item.paperId)?.paperCode || '未命名答卷' }}
                  </div>
                  <div class="result-row-subtitle">{{ item.finalResult.studentInfo.name || '未识别姓名' }}</div>
                  <div class="result-version-tags">
                    <n-tag size="small" round :bordered="false">参考答案 v{{ item.referenceAnswerVersion }}</n-tag>
                    <n-tag
                      v-if="isResultOutdated(item)"
                      size="small"
                      round
                      type="warning"
                      :bordered="false"
                    >
                      不是最新版本
                    </n-tag>
                  </div>
                </div>
                <div class="result-row-score">{{ computeDisplayedTotal(item.finalResult) }}</div>
              </button>
            </div>

            <div class="result-detail surface-card">
              <div class="result-detail-head">
                <div class="result-section-title">评分明细与人工修订</div>
                <n-button type="primary" @click="saveResult">保存修改</n-button>
              </div>

              <n-alert
                v-if="selectedResult && !selectedResultUsesLatestReference"
                type="warning"
                class="result-version-alert"
                :show-icon="false"
              >
                当前结果基于参考答案 v{{ selectedResult.referenceAnswerVersion }} 批阅，项目最新版本为
                v{{ latestReferenceAnswerVersion }}。如需和最新标准保持一致，建议重新批阅。
              </n-alert>

              <div v-else-if="selectedResult" class="result-version-row">
                <n-tag size="small" round :bordered="false">参考答案 v{{ selectedResult.referenceAnswerVersion }}</n-tag>
                <span class="detail-subtitle">当前结果已使用最新参考答案版本。</span>
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
          <div class="project-settings-stack">
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

            <n-card class="surface-card" title="参考答案与评分标准">
              <div class="reference-editor-head">
                <div class="project-section-copy">
                  在这里维护当前项目使用的参考答案。点击保存后才会生效，并自动升级到下一版。
                </div>
                <div class="reference-editor-actions">
                  <n-tag round :bordered="false">当前版本 v{{ latestReferenceAnswerVersion }}</n-tag>
                  <n-tag v-if="referenceAnswerDirty" round type="warning" :bordered="false">有未保存修改</n-tag>
                  <n-button
                    type="primary"
                    :disabled="!referenceAnswerDirty"
                    :loading="referenceAnswerSaving"
                    @click="saveReferenceAnswer"
                  >
                    保存参考答案
                  </n-button>
                </div>
              </div>
              <div class="editor-card-resizer reference-editor-card">
                <MdEditor
                  class="editor-card-editor"
                  :model-value="referenceAnswerDraft"
                  language="zh-CN"
                  preview-theme="github"
                  code-theme="github"
                  :toolbars-exclude="['pageFullscreen', 'fullscreen', 'github']"
                  @update:model-value="handleReferenceAnswerChange"
                />
              </div>
            </n-card>

            <n-card class="surface-card project-danger-card" title="危险操作">
              <div class="project-danger-copy" style="margin-bottom: 10px;">
                删除项目后，会同时删除这个项目的目录，以及数据库里和该项目相关的任务与结果记录，无法恢复。
              </div>
              <n-popconfirm
                positive-text="确认删除"
                negative-text="取消"
                @positive-click="deleteProject"
              >
                <template #trigger>
                  <n-button type="error" :loading="deletingProject">
                    删除当前项目
                  </n-button>
                </template>
                确认彻底删除当前项目吗？这会清空项目目录和数据库中的相关数据。
              </n-popconfirm>
            </n-card>
          </div>
        </n-tab-pane>
      </n-tabs>
    </section>

    <n-card v-else class="surface-card projects-empty-state">
      <n-empty description="未找到这个项目，或者项目数据还没有加载成功。">
        <template #extra>
          <n-button type="primary" @click="goBack">返回项目列表</n-button>
        </template>
      </n-empty>
    </n-card>
  </div>
</template>
