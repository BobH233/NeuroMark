<script setup lang="ts">
import { computed, onMounted, ref, toRaw, watch } from 'vue';
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
  useMessage,
} from 'naive-ui';
import type {
  FinalResult,
  PaperRecord,
  PreviewImageItem,
  ResultRecord,
  ScoreBreakdownItem,
} from '@preload/contracts';
import ImagePreviewTile from '@/components/ImagePreviewTile.vue';
import JsonTreeView from '@/components/JsonTreeView.vue';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import MetricCard from '@/components/MetricCard.vue';
import StatusPill from '@/components/StatusPill.vue';
import { useProjectsStore } from '@/stores/projects';
import { useTasksStore } from '@/stores/tasks';
import { toImageSrc } from '@/utils/file';
import { cloneFinalResult, computeDisplayedTotal } from '@/utils/result';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const projectsStore = useProjectsStore();
const tasksStore = useTasksStore();

const activeTab = ref('overview');
const selectedResultId = ref('');
const editableResult = ref<FinalResult | null>(null);
const referenceAnswerDraft = ref('');
const referenceAnswerSaving = ref(false);
const projectNameDraft = ref('');
const rubricLoading = ref(false);
const referenceAnswerDraftProjectId = ref('');
const referenceAnswerDraftVersion = ref(0);
const deletingProject = ref(false);
const scanActionLoading = ref(false);
const gradingActionLoading = ref(false);
const projectSettingsSaving = ref(false);
const removingPaperId = ref('');
const deletingResultPaperId = ref('');
const activeQuestionId = ref('');

const projectId = computed(() => String(route.params.projectId ?? ''));
const detail = computed(() =>
  projectsStore.detail?.project.id === projectId.value ? projectsStore.detail : null,
);
const selectedProject = computed(() => detail.value?.project ?? null);
const liveProjectTasks = computed(() =>
  tasksStore.tasks.filter((task) => task.projectId === projectId.value),
);
const recentJobs = computed(() => {
  const snapshotJobs = detail.value?.recentJobs ?? [];
  const liveJobMap = new Map(liveProjectTasks.value.map((task) => [task.id, task]));

  const mergedJobs = snapshotJobs.map((task) => liveJobMap.get(task.id) ?? task);
  const knownJobIds = new Set(mergedJobs.map((task) => task.id));
  const appendedLiveJobs = liveProjectTasks.value.filter((task) => !knownJobIds.has(task.id));

  return [...mergedJobs, ...appendedLiveJobs].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
});
const recentTaskSummary = computed(
  () => recentJobs.value[0]?.summary ?? selectedProject.value?.stats.lastTaskSummary ?? '尚未启动任务',
);
const currentScanTask = computed(() =>
  tasksStore.tasks.find(
    (task) =>
      task.projectId === projectId.value &&
      task.kind === 'scan' &&
      ['queued', 'running', 'paused'].includes(task.status),
  ) ?? null,
);
const hasActiveScanTask = computed(() => Boolean(currentScanTask.value));
const currentGradingTask = computed(() =>
  tasksStore.tasks.find(
    (task) =>
      task.projectId === projectId.value &&
      task.kind === 'grading' &&
      ['queued', 'running', 'paused'].includes(task.status),
  ) ?? null,
);
const hasActiveGradingTask = computed(() => Boolean(currentGradingTask.value));
const results = computed(() =>
  (detail.value?.results ?? []).filter(
    (item): item is ResultRecord & { finalResult: FinalResult; modelResult: NonNullable<ResultRecord['modelResult']> } =>
      Boolean(item.finalResult && item.modelResult),
  ),
);
const papers = computed(() => detail.value?.originals ?? []);
const gradedPaperIds = computed(() => new Set(results.value.map((item) => item.paperId)));
const ungradedPapers = computed(() =>
  papers.value.filter((paper) => !gradedPaperIds.value.has(paper.id)),
);
const gradedResultEntries = computed(() =>
  results.value.map((item) => {
    const paper = papers.value.find((paperItem) => paperItem.id === item.paperId) ?? null;

    return {
      result: item,
      paper,
      paperLabel: paper?.paperCode ?? '未命名答卷',
      studentName: item.finalResult.studentInfo.name,
      studentId: item.finalResult.studentInfo.studentId,
      className: item.finalResult.studentInfo.className,
      displayScore: computeDisplayedTotal(item.finalResult),
    };
  }),
);

function buildOriginalPreviewImage(
  paper: PaperRecord,
  page: PaperRecord['originalPages'][number],
  index: number,
): PreviewImageItem {
  return {
    src: page.originalPath,
    cacheKey: page.originalVersion,
    title: `${paper.paperCode} · 原始图 ${index + 1}`,
    caption: '点击单独预览窗口放大查看',
  };
}

function buildScannedPreviewImage(
  paper: PaperRecord,
  page: PaperRecord['originalPages'][number],
  index: number,
): PreviewImageItem {
  return {
    src: page.scannedPath || page.originalPath,
    cacheKey: page.scannedPath ? page.scannedVersion : page.originalVersion,
    title: `${paper.paperCode} · 扫描图 ${index + 1}`,
    caption: page.scannedPath ? '已生成扫描件' : '等待扫描',
  };
}

function buildDebugPreviewImage(
  paper: PaperRecord,
  page: PaperRecord['originalPages'][number],
  index: number,
): PreviewImageItem {
  return {
    src: page.debugPreviewPath || page.originalPath,
    cacheKey: page.debugPreviewPath ? page.debugPreviewVersion : page.originalVersion,
    title: `${paper.paperCode} · 边界图 ${index + 1}`,
    caption: page.debugPreviewPath ? '已生成边界预览' : '等待扫描',
  };
}

const allOriginalPreviewImages = computed<PreviewImageItem[]>(() =>
  papers.value.flatMap((paper) =>
    paper.originalPages.map((page, index) => buildOriginalPreviewImage(paper, page, index)),
  ),
);
const allScannedPreviewImages = computed<PreviewImageItem[]>(() =>
  papers.value.flatMap((paper) =>
    paper.originalPages.map((page, index) => buildScannedPreviewImage(paper, page, index)),
  ),
);
const allDebugPreviewImages = computed<PreviewImageItem[]>(() =>
  papers.value.flatMap((paper) =>
    paper.originalPages.map((page, index) => buildDebugPreviewImage(paper, page, index)),
  ),
);
const latestReferenceAnswerVersion = computed(() => selectedProject.value?.referenceAnswerVersion ?? 1);
const rubricDebug = computed(() =>
  projectsStore.rubricDebug?.projectId === projectId.value ? projectsStore.rubricDebug : null,
);
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
    src: page.scannedPath || page.originalPath,
    cacheKey: page.scannedPath ? page.scannedVersion : page.originalVersion,
    title: `${paper.paperCode} · 第 ${index + 1} 页`,
    caption: page.scannedPath ? '扫描答卷与批阅区域' : '原始答卷（扫描件缺失）',
    regions: currentResult.modelResult?.questionRegions?.filter((region) => region.pageIndex === index) ?? [],
  }));
});
const editableAutoTotal = computed(() => {
  if (!editableResult.value) {
    return 0;
  }

  return Number(
    editableResult.value.questionScores
      .reduce((sum, question) => sum + (typeof question.score === 'number' ? question.score : 0), 0)
      .toFixed(2),
  );
});

function formatScoreValue(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatScoreBreakdownBadge(point: ScoreBreakdownItem): string {
  return `${formatScoreValue(point.score)}/${formatScoreValue(point.maxScore)}`;
}

function getScoreBreakdownBadgeClass(point: ScoreBreakdownItem): string {
  const epsilon = 0.001;

  if (point.maxScore > 0 && Math.abs(point.score - point.maxScore) <= epsilon) {
    return 'score-breakdown-badge--full';
  }

  if (point.score <= epsilon) {
    return 'score-breakdown-badge--zero';
  }

  return 'score-breakdown-badge--partial';
}

watch(
  () => [selectedProject.value?.id, selectedProject.value?.name] as const,
  ([nextProjectId, nextProjectName]) => {
    if (!nextProjectId) {
      projectNameDraft.value = '';
      return;
    }

    projectNameDraft.value = nextProjectName ?? '';
  },
  { immediate: true },
);

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
    editableResult.value = value?.finalResult ? cloneFinalResult(value.finalResult) : null;
  },
  { immediate: true },
);

watch(
  () => editableResult.value,
  (value) => {
    activeQuestionId.value = value?.questionScores[0]?.questionId ?? '';

    if (value) {
      value.manualTotalScore = editableAutoTotal.value;
    }
  },
  { immediate: true },
);

watch(
  () => editableResult.value?.questionScores.map((question) => question.score) ?? [],
  () => {
    if (editableResult.value) {
      editableResult.value.manualTotalScore = editableAutoTotal.value;
    }
  },
  { deep: true, immediate: true },
);

onMounted(async () => {
  if (projectsStore.projects.length === 0) {
    await projectsStore.bootstrap();
  }

  if (projectId.value) {
    await projectsStore.selectProject(projectId.value);
    await loadRubricDebug();
  }
});

watch(
  () => [projectId.value, latestReferenceAnswerVersion.value] as const,
  async ([nextProjectId]) => {
    if (!nextProjectId) {
      return;
    }
    await loadRubricDebug();
  },
);

async function loadRubricDebug() {
  if (!projectId.value) {
    return;
  }
  rubricLoading.value = true;
  try {
    await projectsStore.loadProjectRubricDebug(projectId.value);
  } finally {
    rubricLoading.value = false;
  }
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

async function removePaper(paperId: string) {
  if (!selectedProject.value || removingPaperId.value) {
    return;
  }

  removingPaperId.value = paperId;
  try {
    await projectsStore.removePaper(selectedProject.value.id, paperId);
    await tasksStore.refresh();
    message.success('试卷已移除，相关扫描结果和批阅结果已同步清理。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '移除试卷失败。');
  } finally {
    removingPaperId.value = '';
  }
}

async function startScan() {
  if (!selectedProject.value || scanActionLoading.value || hasActiveScanTask.value) {
    return;
  }
  scanActionLoading.value = true;
  try {
    await window.neuromark.scan.start(selectedProject.value.id, { skipCompleted: true });
    await Promise.all([
      tasksStore.refresh(),
      projectsStore.loadProjectDetail(selectedProject.value.id),
    ]);
    message.success('扫描任务已开始。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '启动扫描任务失败。');
  } finally {
    scanActionLoading.value = false;
  }
}

async function forceRescan() {
  if (!selectedProject.value || scanActionLoading.value || hasActiveScanTask.value) {
    return;
  }
  scanActionLoading.value = true;
  try {
    await window.neuromark.scan.start(selectedProject.value.id, { skipCompleted: false });
    await Promise.all([
      tasksStore.refresh(),
      projectsStore.loadProjectDetail(selectedProject.value.id),
    ]);
    message.success('重新扫描任务已开始。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '启动重新扫描任务失败。');
  } finally {
    scanActionLoading.value = false;
  }
}

async function stopScan() {
  if (!selectedProject.value || scanActionLoading.value || !currentScanTask.value) {
    return;
  }

  scanActionLoading.value = true;
  try {
    await window.neuromark.scan.cancel(currentScanTask.value.id);
    await Promise.all([
      tasksStore.refresh(),
      projectsStore.loadProjectDetail(selectedProject.value.id),
    ]);
    message.success('当前扫描任务已停止。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '停止扫描任务失败。');
  } finally {
    scanActionLoading.value = false;
  }
}

async function startGrading() {
  if (!selectedProject.value || gradingActionLoading.value || hasActiveGradingTask.value) {
    return;
  }
  gradingActionLoading.value = true;
  try {
    await window.neuromark.grading.start(selectedProject.value.id, { skipCompleted: true });
    await Promise.all([
      tasksStore.refresh(),
      projectsStore.loadProjectDetail(selectedProject.value.id),
    ]);
    message.success('批阅任务已开始。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '启动批阅任务失败。');
  } finally {
    gradingActionLoading.value = false;
  }
}

async function stopGrading() {
  if (!selectedProject.value || gradingActionLoading.value || !currentGradingTask.value) {
    return;
  }
  gradingActionLoading.value = true;
  try {
    await window.neuromark.grading.cancel(currentGradingTask.value.id);
    await Promise.all([
      tasksStore.refresh(),
      projectsStore.loadProjectDetail(selectedProject.value.id),
    ]);
    message.success('当前批阅任务已停止。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '停止批阅任务失败。');
  } finally {
    gradingActionLoading.value = false;
  }
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
  const nextResult = cloneFinalResult(editableResult.value);
  nextResult.manualTotalScore = editableAutoTotal.value;
  await projectsStore.saveFinalResult(
    selectedProject.value.id,
    selectedResult.value.paperId,
    nextResult,
  );
}

async function deleteSelectedResult() {
  if (
    !selectedProject.value ||
    !selectedResult.value ||
    deletingResultPaperId.value ||
    hasActiveGradingTask.value
  ) {
    return;
  }

  deletingResultPaperId.value = selectedResult.value.paperId;
  try {
    await projectsStore.deleteResult(selectedProject.value.id, selectedResult.value.paperId);
    await tasksStore.refresh();
    message.success('该试卷的批阅数据已删除，现在可以重新批阅。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '删除批阅数据失败。');
  } finally {
    deletingResultPaperId.value = '';
  }
}

async function saveProjectSettings() {
  if (!selectedProject.value || projectSettingsSaving.value) {
    return;
  }

  const nextName = projectNameDraft.value.trim();
  if (!nextName) {
    message.error('项目名称不能为空。');
    return;
  }

  const nextSettings = {
    gradingConcurrency: selectedProject.value.settings.gradingConcurrency,
    drawRegions: selectedProject.value.settings.drawRegions,
    defaultImageDetail: selectedProject.value.settings.defaultImageDetail,
    enableScanPostProcess: selectedProject.value.settings.enableScanPostProcess,
  };
  const projectIdToSave = selectedProject.value.id;
  const nameChanged = nextName !== selectedProject.value.name;

  projectSettingsSaving.value = true;
  try {
    if (nameChanged) {
      await projectsStore.updateProjectName(projectIdToSave, nextName);
    }
    await projectsStore.updateProjectSettings(projectIdToSave, nextSettings);
    await tasksStore.refresh();
    message.success(nameChanged ? '项目名称和设置已保存。' : '项目设置已保存。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存项目设置失败。');
  } finally {
    projectSettingsSaving.value = false;
  }
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
    await loadRubricDebug();
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

async function openStagePreview(initialIndex = 0) {
  if (resultPreviewImages.value.length === 0) {
    return;
  }
  const safeIndex = Math.min(Math.max(initialIndex, 0), resultPreviewImages.value.length - 1);
  const previewImages = resultPreviewImages.value.map((image) => ({
    src: image.src,
    cacheKey: image.cacheKey,
    title: image.title,
    caption: image.caption,
    regions: image.regions?.map((region) => ({
      ...toRaw(region),
    })),
  }));
  await window.neuromark.preview.open(previewImages, safeIndex, '答卷图片预览');
}

function getPaperPagePreviewIndex(paperId: string, pageIndex: number) {
  let indexOffset = 0;

  for (const paper of papers.value) {
    if (paper.id === paperId) {
      return indexOffset + pageIndex;
    }
    indexOffset += paper.originalPages.length;
  }

  return 0;
}

function focusQuestion(questionId: string) {
  activeQuestionId.value = questionId;
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
          <n-button
            v-if="hasActiveScanTask"
            secondary
            type="error"
            :loading="scanActionLoading"
            @click="stopScan"
          >
            停止当前扫描任务
          </n-button>
          <template v-else>
            <n-button
              secondary
              type="primary"
              :loading="scanActionLoading"
              @click="startScan"
            >
              开始扫描识别
            </n-button>
            <n-button
              secondary
              type="warning"
              :loading="scanActionLoading"
              @click="forceRescan"
            >
              强制重新扫描
            </n-button>
          </template>
          <n-button
            v-if="hasActiveGradingTask"
            secondary
            type="error"
            :loading="gradingActionLoading"
            @click="stopGrading"
          >
            停止当前批阅
          </n-button>
          <n-button
            v-else
            secondary
            type="primary"
            :loading="gradingActionLoading"
            @click="startGrading"
          >
            开始批阅
          </n-button>
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
                  :value="recentTaskSummary"
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
                <div v-if="recentJobs.length" class="task-preview-list">
                  <div v-for="task in recentJobs" :key="task.id" class="task-preview-row">
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
                <div class="task-preview-inline-tags">
                  <StatusPill :value="paper.scanStatus" />
                  <n-popconfirm
                    positive-text="确认移除"
                    negative-text="取消"
                    @positive-click="removePaper(paper.id)"
                  >
                    <template #trigger>
                      <n-button
                        tertiary
                        type="error"
                        size="small"
                        :loading="removingPaperId === paper.id"
                      >
                        移除试卷
                      </n-button>
                    </template>
                    移除后会同时删除该试卷的原始图片、扫描结果、边界标注和批阅结果。确认继续吗？
                  </n-popconfirm>
                </div>
              </template>
              <div class="paper-meta">
                <span>{{ paper.pageCount }} 页</span>
                <span>批改状态：{{ paper.gradingStatus === 'completed' ? '已完成' : paper.gradingStatus === 'failed' ? '失败' : paper.gradingStatus === 'processing' ? '批阅中' : '待处理' }}</span>
                <span v-if="paper.gradingReferenceAnswerVersion">参考答案 v{{ paper.gradingReferenceAnswerVersion }}</span>
              </div>
              <n-alert
                v-if="paper.gradingError"
                type="error"
                :show-icon="false"
                class="result-version-alert"
              >
                {{ paper.gradingError }}
              </n-alert>
              <div class="image-grid">
                <ImagePreviewTile
                  v-for="(page, pageIndex) in paper.originalPages"
                  :key="`${paper.id}-${page.pageIndex}`"
                  :image="buildOriginalPreviewImage(paper, page, pageIndex)"
                  :preview-images="allOriginalPreviewImages"
                  :initial-index="getPaperPagePreviewIndex(paper.id, pageIndex)"
                  preview-title="原始答卷总览"
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
                      :image="buildScannedPreviewImage(paper, page, pageIndex)"
                      :preview-images="allScannedPreviewImages"
                      :initial-index="getPaperPagePreviewIndex(paper.id, pageIndex)"
                      preview-title="扫描结果总览"
                    />
                  </div>
                </div>
                <div class="scan-column">
                  <div class="scan-column-title">边界标注</div>
                  <div class="image-grid">
                    <ImagePreviewTile
                      v-for="(page, pageIndex) in paper.originalPages"
                      :key="`${paper.id}-${page.pageIndex}-debug`"
                      :image="buildDebugPreviewImage(paper, page, pageIndex)"
                      :preview-images="allDebugPreviewImages"
                      :initial-index="getPaperPagePreviewIndex(paper.id, pageIndex)"
                      preview-title="边界标注总览"
                    />
                  </div>
                </div>
              </div>
            </n-card>
          </div>
          <n-empty v-else description="导入原始答卷后即可启动扫描识别" />
        </n-tab-pane>

        <n-tab-pane name="results" tab="批阅结果">
          <div v-if="papers.length" class="result-review-layout">
            <aside class="result-sidebar surface-card">
              <div class="result-sidebar-head">
                <div>
                  <div class="result-section-title">答卷导航</div>
                  <div class="detail-subtitle">这里独立滚动，快速切换答卷并查看批改进度。</div>
                </div>
                <div class="result-sidebar-stats">
                  <n-tag size="small" round :bordered="false">已批改 {{ results.length }}</n-tag>
                  <n-tag size="small" round type="warning" :bordered="false">未批改 {{ ungradedPapers.length }}</n-tag>
                </div>
              </div>

              <div class="result-sidebar-scroll">
                <div class="result-nav-section">
                  <div class="result-list-head">已批改</div>
                  <button
                    v-for="entry in gradedResultEntries"
                    :key="entry.result.id"
                    class="result-row"
                    :class="{ active: entry.result.id === selectedResult?.id }"
                    @click="selectedResultId = entry.result.id"
                  >
                    <div class="result-row-main">
                      <div class="result-row-topline">
                        <div class="result-row-title">{{ entry.paperLabel }}</div>
                        <div class="result-row-score">{{ entry.displayScore }}</div>
                      </div>
                      <div class="result-row-student">{{ entry.studentName || '未识别姓名' }}</div>
                      <div class="result-row-student-meta">
                        <span>学号 {{ entry.studentId || '未识别' }}</span>
                        <span>班级 {{ entry.className || '未识别' }}</span>
                      </div>
                      <div class="result-version-tags">
                        <n-tag size="small" round :bordered="false">
                          参考答案 v{{ entry.result.referenceAnswerVersion }}
                        </n-tag>
                        <n-tag
                          v-if="isResultOutdated(entry.result)"
                          size="small"
                          round
                          type="warning"
                          :bordered="false"
                        >
                          需复查
                        </n-tag>
                      </div>
                    </div>
                  </button>
                  <div v-if="!gradedResultEntries.length" class="result-nav-empty">
                    还没有已批改答卷。
                  </div>
                </div>

                <div class="result-nav-section">
                  <div class="result-list-head">未批改</div>
                  <div
                    v-for="paper in ungradedPapers"
                    :key="paper.id"
                    class="result-row result-row--pending"
                  >
                    <div class="result-row-main">
                      <div class="result-row-topline">
                        <div class="result-row-title">{{ paper.paperCode }}</div>
                        <StatusPill :value="paper.gradingStatus" />
                      </div>
                      <div class="result-row-subtitle">
                        扫描状态：{{ paper.scanStatus === 'completed' ? '已完成' : paper.scanStatus }}
                      </div>
                      <div class="result-row-student-meta">
                        <span>{{ paper.pageCount }} 页</span>
                        <span v-if="paper.gradingReferenceAnswerVersion">
                          参考答案 v{{ paper.gradingReferenceAnswerVersion }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div v-if="!ungradedPapers.length" class="result-nav-empty">
                    当前没有待批改答卷。
                  </div>
                </div>
              </div>
            </aside>

            <section class="result-workspace surface-card" v-if="selectedResult && editableResult && selectedPaper">
              <div class="result-workspace-head">
                <div>
                  <div class="result-section-title">手工核对工作区</div>
                  <div class="detail-subtitle">
                    可以在此处查看学生扫描卷信息，手动修改每一小题的得分情况。
                  </div>
                </div>
                <n-space>
                  <n-popconfirm
                    positive-text="确认删除"
                    negative-text="取消"
                    @positive-click="deleteSelectedResult"
                  >
                    <template #trigger>
                      <n-button
                        type="error"
                        secondary
                        :loading="deletingResultPaperId === selectedResult.paperId"
                        :disabled="hasActiveGradingTask"
                      >
                        删除批阅数据
                      </n-button>
                    </template>
                    删除后会移除这张试卷当前的批阅结果，并恢复为“未批改”状态，可重新发起批阅。确认继续吗？
                  </n-popconfirm>
                  <n-button type="primary" @click="saveResult">保存修改</n-button>
                </n-space>
              </div>

              <div class="result-workspace-scroll">
                <div class="result-workspace-stack">
                    <div class="result-subsection-card">
                      <div class="result-panel-head">
                        <div>
                          <div class="result-section-title">扫描答卷与答题区域</div>
                          <div class="detail-subtitle">
                            点击任意缩略图即可打开预览窗口放大查看。
                          </div>
                        </div>
                      </div>

                      <div class="result-stage-stack result-stage-stack--embedded">
                        <div v-for="(image, imageIndex) in resultPreviewImages" :key="image.title" class="stage-card">
                          <div class="stage-card-title">{{ image.title }}</div>
                          <div class="paper-stage paper-stage--thumbnail" @click="openStagePreview(imageIndex)">
                            <img
                              class="paper-stage-image"
                              :src="toImageSrc(image.src, image.cacheKey)"
                              :alt="image.title"
                            />
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
                              @click.stop="openStagePreview(imageIndex)"
                            >
                              <span>{{ region.questionId }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="result-panel-head">
                      <div>
                        <div class="result-section-title">当前答卷</div>
                      </div>
                    </div>

                    <div class="result-paper-summary">
                      <div class="result-paper-title">{{ selectedPaper.paperCode }}</div>
                      <div class="result-paper-meta">
                        {{ editableResult.studentInfo.name || '未识别姓名' }}
                        <span>学号 {{ editableResult.studentInfo.studentId || '未识别' }}</span>
                        <span>班级 {{ editableResult.studentInfo.className || '未识别' }}</span>
                        <span>自动汇总总分 {{ editableAutoTotal }}</span>
                      </div>
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
                      <n-tag size="small" round :bordered="false">
                        参考答案 v{{ selectedResult.referenceAnswerVersion }}
                      </n-tag>
                      <span class="detail-subtitle">当前结果已使用最新参考答案版本。</span>
                    </div>

                    <div class="result-subsection-card">
                      <div class="result-panel-head">
                        <div>
                          <div class="result-section-title">基础信息与总分</div>
                          <div class="detail-subtitle">
                            修改班级、学号、姓名和每题分数后，总分会自动重新汇总。
                          </div>
                        </div>
                      </div>

                      <n-form label-placement="top">
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
                      </n-form>

                      <div class="result-score-summary-grid">
                        <div class="result-score-summary-card">
                          <span>自动汇总总分</span>
                          <strong>{{ editableAutoTotal }}</strong>
                        </div>
                        <div class="result-score-summary-card">
                          <span>模型原始总分</span>
                          <strong>{{ editableResult.totalScore }}</strong>
                        </div>
                      </div>
                    </div>

                    <div class="result-subsection-card">
                      <div class="result-panel-head">
                        <div>
                          <div class="result-section-title">小题逐项核对</div>
                          <div class="detail-subtitle">可以在此修改学生每个小题的得分，系统自动计算新的总分</div>
                        </div>
                      </div>

                      <div class="question-list">
                        <div
                          v-for="question in editableResult.questionScores"
                          :key="question.questionId"
                          class="question-card"
                          :class="{ 'question-card--active': question.questionId === activeQuestionId }"
                          @click="focusQuestion(question.questionId)"
                        >
                          <div class="question-card-head">
                            <div>
                              <div class="question-card-title">{{ question.questionId }} · {{ question.questionTitle }}</div>
                              <div class="question-card-meta">满分 {{ question.maxScore }}</div>
                            </div>
                            <n-input-number v-model:value="question.score" :min="0" :max="question.maxScore" />
                          </div>
                          <MarkdownRenderer :source="question.reasoning" />
                          <div v-if="question.scoreBreakdown.length" class="issues-box">
                            <strong>采分明细</strong>
                            <ul class="score-breakdown-list">
                              <li
                                v-for="point in question.scoreBreakdown"
                                :key="`${question.questionId}-${point.criterionId}`"
                              >
                                <div class="score-breakdown-head">
                                  <span class="score-breakdown-criterion-id">{{ point.criterionId }} ·</span>
                                  <span
                                    class="score-breakdown-badge"
                                    :class="getScoreBreakdownBadgeClass(point)"
                                  >
                                    {{ formatScoreBreakdownBadge(point) }}
                                  </span>
                                </div>
                                <div class="score-breakdown-text">{{ point.criterion }}</div>
                                <div class="score-breakdown-evidence">{{ point.evidence }}</div>
                              </li>
                            </ul>
                          </div>
                          <div v-if="question.issues.length" class="issues-box">
                            <strong>问题点</strong>
                            <ul>
                              <li v-for="issue in question.issues" :key="issue">{{ issue }}</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div class="result-subsection-card">
                      <div class="result-panel-head">
                        <div>
                          <div class="result-section-title">整卷建议</div>
                          <div class="detail-subtitle">查看模型的整体建议与评语。</div>
                        </div>
                      </div>

                      <div class="question-list">
                        <div class="question-card question-card--advice">
                          <div class="question-card-title">总体判断</div>
                          <div class="detail-subtitle">{{ editableResult.overallAdvice.summary }}</div>
                        </div>

                        <div class="question-card question-card--advice">
                          <div class="question-card-title">表现较好的方面</div>
                          <div v-if="editableResult.overallAdvice.strengths.length" class="issues-box">
                            <ul>
                              <li v-for="item in editableResult.overallAdvice.strengths" :key="item">{{ item }}</li>
                            </ul>
                          </div>
                          <div v-else class="detail-subtitle">暂无特别突出的优势总结。</div>
                        </div>

                        <div class="question-card question-card--advice">
                          <div class="question-card-title">优先补强知识点</div>
                          <div v-if="editableResult.overallAdvice.priorityKnowledgePoints.length" class="issues-box">
                            <ul>
                              <li
                                v-for="item in editableResult.overallAdvice.priorityKnowledgePoints"
                                :key="item"
                              >
                                {{ item }}
                              </li>
                            </ul>
                          </div>
                          <div v-else class="detail-subtitle">当前没有明确需要优先补强的知识点。</div>
                        </div>

                        <div class="question-card question-card--advice">
                          <div class="question-card-title">答题注意事项</div>
                          <div v-if="editableResult.overallAdvice.attentionPoints.length" class="issues-box">
                            <ul>
                              <li v-for="item in editableResult.overallAdvice.attentionPoints" :key="item">{{ item }}</li>
                            </ul>
                          </div>
                          <div v-else class="detail-subtitle">当前没有额外的答题习惯提醒。</div>
                        </div>

                        <div class="question-card question-card--advice">
                          <div class="question-card-title">鼓励与提醒</div>
                          <div class="detail-subtitle">{{ editableResult.overallAdvice.encouragement }}</div>
                        </div>
                      </div>
                    </div>

                    <div class="result-subsection-card">
                      <div class="result-panel-head">
                        <div>
                          <div class="result-section-title">整体评语</div>
                        </div>
                      </div>
                      <MarkdownRenderer :source="editableResult.overallComment" />
                    </div>
                </div>
              </div>
            </section>

            <section v-else class="result-workspace result-workspace--empty">
              <div class="surface-card result-empty-state">
                <n-empty description="左侧还没有可查看的已批改答卷。" />
              </div>
            </section>
          </div>
          <n-empty v-else description="先导入答卷。批改后，这里会显示左侧导航与右侧核对工作区。" />
        </n-tab-pane>

        <n-tab-pane name="project-settings" tab="项目设置">
          <div class="project-settings-stack">
            <n-card class="surface-card" title="项目级批阅设置">
              <n-form v-if="selectedProject" label-placement="top" class="stack-form">
                <n-form-item label="项目名称">
                  <n-input v-model:value="projectNameDraft" placeholder="例如：第二章随堂练习" />
                  <div class="field-hint" style="margin-top: 8px;">
                    这里只修改项目显示名称，不会改动磁盘上的项目目录。
                  </div>
                </n-form-item>
                <div class="two-col create-project-settings-grid">
                  <n-form-item label="批阅并行数">
                    <n-input-number
                      v-model:value="selectedProject.settings.gradingConcurrency"
                      :min="1"
                      class="create-project-half-input"
                    />
                  </n-form-item>
                  <n-form-item label="图像细节">
                    <n-select
                      v-model:value="selectedProject.settings.defaultImageDetail"
                      class="create-project-half-input"
                      :options="[
                        { label: '高', value: 'high' },
                        { label: '自动', value: 'auto' },
                        { label: '低', value: 'low' }
                      ]"
                    />
                  </n-form-item>
                </div>
                <div class="create-project-toggle-row">
                  <div class="create-project-toggle-copy">
                    <div class="field-label">扫描后处理</div>
                    <div class="field-hint">关闭后只做边界识别、透视拉平与裁剪，不做增强和二值化。</div>
                  </div>
                  <n-switch v-model:value="selectedProject.settings.enableScanPostProcess" />
                </div>
                <div class="create-project-toggle-row">
                  <div class="create-project-toggle-copy">
                    <div class="field-label">绘制批阅区域</div>
                    <div class="field-hint">开启后会在批阅视图中显示题目边界框，便于复核。</div>
                  </div>
                  <n-switch v-model:value="selectedProject.settings.drawRegions" />
                </div>
                <n-button type="primary" :loading="projectSettingsSaving" @click="saveProjectSettings">
                  保存项目设置
                </n-button>
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
                  @on-save="saveReferenceAnswer"
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

        <n-tab-pane name="rubric-debug" tab="Rubric 调试">
          <div class="project-settings-stack">
            <n-card class="surface-card" title="当前 Rubric 缓存">
              <div class="reference-editor-head">
                <div class="project-section-copy">
                  这里展示当前项目最新参考答案版本对应的 rubric 缓存文件，内容就是后台批阅实际使用的结构化评分模板。
                </div>
                <div class="reference-editor-actions">
                  <n-tag round :bordered="false">参考答案 v{{ latestReferenceAnswerVersion }}</n-tag>
                  <n-button tertiary :loading="rubricLoading" @click="loadRubricDebug">
                    刷新 Rubric
                  </n-button>
                </div>
              </div>

              <div v-if="rubricDebug" class="rubric-debug-stack">
                <div class="rubric-debug-meta-grid">
                  <div class="task-list-meta-item">
                    <span class="task-list-meta-label">缓存文件</span>
                    <strong class="task-list-meta-value">{{ rubricDebug.rubricPath }}</strong>
                  </div>
                  <div class="task-list-meta-item">
                    <span class="task-list-meta-label">状态</span>
                    <strong class="task-list-meta-value">{{ rubricDebug.exists ? '已生成' : '尚未生成' }}</strong>
                  </div>
                  <div class="task-list-meta-item">
                    <span class="task-list-meta-label">更新时间</span>
                    <strong class="task-list-meta-value">{{ getTaskStartedAtLabel(rubricDebug.updatedAt) }}</strong>
                  </div>
                </div>

                <n-empty v-if="!rubricDebug.exists" description="当前版本的 rubric 还没有生成。首次启动批阅后会自动生成缓存。" />

                <template v-else>
                  <div class="rubric-debug-panel">
                    <div class="result-section-title">可展开 JSON Tree</div>
                    <div class="json-tree-shell">
                      <JsonTreeView
                        v-if="rubricDebug.rubricData"
                        :value="rubricDebug.rubricData"
                        label="root"
                        :depth="0"
                        :initially-expanded="true"
                      />
                      <n-empty v-else description="当前 rubric JSON 解析失败。" />
                    </div>
                  </div>
                </template>
              </div>
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
