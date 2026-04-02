<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
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
  NSpin,
  NSwitch,
  NTabPane,
  NTag,
  NTabs,
  NTooltip,
  useMessage,
} from 'naive-ui';
import type {
  FinalResult,
  NameMatchStatus,
  PaperRecord,
  PreviewDisplayOptions,
  PreviewImageItem,
  ResultRecord,
  ScoreBreakdownItem,
  SmartNameMatchSnapshot,
  SmartNameMatchSuggestion,
} from '@preload/contracts';
import ImagePreviewTile from '@/components/ImagePreviewTile.vue';
import JsonTreeView from '@/components/JsonTreeView.vue';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import MetricCard from '@/components/MetricCard.vue';
import StatusPill from '@/components/StatusPill.vue';
import { useDebugPanelStore } from '@/stores/debug-panel';
import { useProjectsStore } from '@/stores/projects';
import { useTasksStore } from '@/stores/tasks';
import { toImageSrc } from '@/utils/file';
import { cloneFinalResult, computeDisplayedTotal } from '@/utils/result';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const projectsStore = useProjectsStore();
const tasksStore = useTasksStore();
const debugPanelStore = useDebugPanelStore();

const DEFAULT_PREVIEW_DISPLAY_OPTIONS: PreviewDisplayOptions = {
  showQuestionTags: true,
  showQuestionBoxes: true,
  showQuestionScores: false,
};
const PREVIEW_DISPLAY_OPTIONS_STORAGE_KEY_PREFIX = 'neuromark:preview-display-options:';

const activeTab = ref('overview');
const selectedResultId = ref('');
type ResultSortMode = 'input-order' | 'score-desc' | 'score-asc' | 'student-id';
const resultSortMode = ref<ResultSortMode>('input-order');
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
const smartNameMatchSnapshot = ref<SmartNameMatchSnapshot | null>(null);
const smartNameRosterText = ref('');
const smartNameSubmitting = ref(false);
const smartNameApplying = ref(false);
const smartNameKeepExpanded = ref(false);
const smartNameWorkspaceMode = ref<'auto' | 'manual'>('auto');
const smartNameManualPaperId = ref('');
const smartNameContextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  paperId: '',
});
const smartNameReasoningRef = ref<HTMLElement | null>(null);
const smartNamePreviewRef = ref<HTMLElement | null>(null);
const activeQuestionId = ref('');
const previewDisplayOptions = ref<PreviewDisplayOptions>({ ...DEFAULT_PREVIEW_DISPLAY_OPTIONS });
const isReviewScrollActive = ref(false);
const expandedQuestionIds = ref<string[]>([]);

let lockedShellContent: HTMLElement | null = null;
let smartNameMatchUnsubscribe: (() => void) | null = null;

function setShellScrollLocked(locked: boolean) {
  if (typeof document === 'undefined') {
    return;
  }

  const shellContent = document.querySelector<HTMLElement>('.shell-content');
  if (!shellContent) {
    return;
  }

  shellContent.classList.toggle('shell-content--scroll-locked', locked);
  lockedShellContent = locked ? shellContent : null;
}

function getPreviewDisplayOptionsStorageKey(targetProjectId: string): string {
  return `${PREVIEW_DISPLAY_OPTIONS_STORAGE_KEY_PREFIX}${targetProjectId}`;
}

function loadStoredPreviewDisplayOptions(targetProjectId: string): PreviewDisplayOptions {
  if (typeof window === 'undefined' || !targetProjectId) {
    return { ...DEFAULT_PREVIEW_DISPLAY_OPTIONS };
  }

  try {
    const raw = window.localStorage.getItem(getPreviewDisplayOptionsStorageKey(targetProjectId));
    if (!raw) {
      return { ...DEFAULT_PREVIEW_DISPLAY_OPTIONS };
    }

    const parsed = JSON.parse(raw) as Partial<PreviewDisplayOptions>;
    return {
      showQuestionTags: parsed.showQuestionTags ?? DEFAULT_PREVIEW_DISPLAY_OPTIONS.showQuestionTags,
      showQuestionBoxes: parsed.showQuestionBoxes ?? DEFAULT_PREVIEW_DISPLAY_OPTIONS.showQuestionBoxes,
      showQuestionScores:
        parsed.showQuestionScores ?? DEFAULT_PREVIEW_DISPLAY_OPTIONS.showQuestionScores,
    };
  } catch {
    return { ...DEFAULT_PREVIEW_DISPLAY_OPTIONS };
  }
}

function persistPreviewDisplayOptions(
  targetProjectId: string,
  displayOptions: PreviewDisplayOptions,
): void {
  if (typeof window === 'undefined' || !targetProjectId) {
    return;
  }

  window.localStorage.setItem(
    getPreviewDisplayOptionsStorageKey(targetProjectId),
    JSON.stringify(displayOptions),
  );
}

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
const paperOrderMap = computed(() => new Map(papers.value.map((paper, index) => [paper.id, index])));
const resultSortOptions = [
  { label: '按录入顺序', value: 'input-order' },
  { label: '按分数由高到低', value: 'score-desc' },
  { label: '按分数由低到高', value: 'score-asc' },
  { label: '按学号排序', value: 'student-id' },
];
const gradedResultEntries = computed(() =>
  results.value
    .map((item) => {
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
    })
    .sort((left, right) => {
      const leftPaperOrder = paperOrderMap.value.get(left.result.paperId) ?? Number.MAX_SAFE_INTEGER;
      const rightPaperOrder = paperOrderMap.value.get(right.result.paperId) ?? Number.MAX_SAFE_INTEGER;
      const fallback = leftPaperOrder - rightPaperOrder || left.paperLabel.localeCompare(right.paperLabel, 'zh-CN');

      if (resultSortMode.value === 'score-desc') {
        return right.displayScore - left.displayScore || fallback;
      }

      if (resultSortMode.value === 'score-asc') {
        return left.displayScore - right.displayScore || fallback;
      }

      if (resultSortMode.value === 'student-id') {
        const leftStudentId = left.studentId.trim();
        const rightStudentId = right.studentId.trim();

        if (leftStudentId && rightStudentId) {
          return leftStudentId.localeCompare(rightStudentId, 'zh-CN', { numeric: true }) || fallback;
        }

        if (leftStudentId) {
          return -1;
        }

        if (rightStudentId) {
          return 1;
        }
      }

      return fallback;
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
const showRubricDebugTab = computed(() => debugPanelStore.enabled);
const referenceAnswerDirty = computed(() =>
  detail.value ? referenceAnswerDraft.value !== detail.value.referenceAnswerMarkdown : false,
);
const selectedResultUsesLatestReference = computed(() => {
  if (!selectedResult.value) {
    return true;
  }
  return selectedResult.value.referenceAnswerVersion === latestReferenceAnswerVersion.value;
});
const editableStudentInfoChanged = computed(() => {
  if (!selectedResult.value?.finalResult || !editableResult.value) {
    return false;
  }

  const current = selectedResult.value.finalResult.studentInfo;
  const next = editableResult.value.studentInfo;
  return (
    current.className !== next.className ||
    current.studentId !== next.studentId ||
    current.name !== next.name
  );
});
const smartNameManualResult = computed(() => {
  const paperId = smartNameManualPaperId.value;
  if (!paperId) {
    return null;
  }
  return results.value.find((item) => item.paperId === paperId) ?? null;
});
const smartNameManualPaper = computed(() => {
  const paperId = smartNameManualPaperId.value;
  if (!paperId) {
    return null;
  }
  return papers.value.find((item) => item.id === paperId) ?? null;
});
const manualSmartNameDraft = ref<FinalResult | null>(null);
const manualSmartNameSaving = ref(false);
const manualSmartNameChanged = computed(() => {
  if (!smartNameManualResult.value?.finalResult || !manualSmartNameDraft.value) {
    return false;
  }

  const current = smartNameManualResult.value.finalResult.studentInfo;
  const next = manualSmartNameDraft.value.studentInfo;
  return (
    current.className !== next.className ||
    current.studentId !== next.studentId ||
    current.name !== next.name
  );
});
const smartNameMatchState = computed<SmartNameMatchSnapshot>(() =>
  smartNameMatchSnapshot.value?.projectId === projectId.value
    ? smartNameMatchSnapshot.value
    : {
        projectId: projectId.value,
        status: 'idle',
        rosterText: '',
        stage: null,
        reasoningText: '',
        previewText: '',
        errorMessage: null,
        result: null,
        updatedAt: '',
      },
);
const smartNameMatchIsRunning = computed(() => smartNameMatchState.value.status === 'running');
const smartNameMatchSuggestions = computed<SmartNameMatchSuggestion[]>(
  () => smartNameMatchState.value.result?.suggestions ?? [],
);
const smartNameMatchCertainSuggestions = computed(() =>
  smartNameMatchSuggestions.value.filter(
    (item) => item.decision === 'certain_update' || item.decision === 'certain_keep',
  ),
);
const smartNameMatchCertainUpdateSuggestions = computed(() =>
  smartNameMatchSuggestions.value.filter((item) => item.decision === 'certain_update'),
);
const smartNameMatchCertainKeepSuggestions = computed(() =>
  smartNameMatchSuggestions.value.filter((item) => item.decision === 'certain_keep'),
);
const smartNameMatchUncertainSuggestions = computed(() =>
  smartNameMatchSuggestions.value.filter(
    (item) => item.decision === 'uncertain' || item.decision === 'no_match',
  ),
);
const smartNameMatchHasPreview = computed(() => Boolean(smartNameMatchState.value.previewText.trim()));

const selectedResult = computed<ResultRecord | null>(() => {
  return (
    results.value.find((item) => item.id === selectedResultId.value) ??
    gradedResultEntries.value[0]?.result ??
    null
  );
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
  const currentEditableResult = editableResult.value;
  if (!paper || !currentResult || !currentEditableResult) {
    return [];
  }

  const scoreMap = new Map(
    currentEditableResult.questionScores.map((question) => [
      question.questionId,
      {
        score: question.score,
        maxScore: question.maxScore,
      },
    ]),
  );

  return paper.originalPages.map((page, index) => ({
    src: page.scannedPath || page.originalPath,
    cacheKey: page.scannedPath ? page.scannedVersion : page.originalVersion,
    title: `${paper.paperCode} · 第 ${index + 1} 页`,
    caption: page.scannedPath ? '扫描答卷与批阅区域' : '原始答卷（扫描件缺失）',
    regions:
      currentResult.modelResult?.questionRegions
        ?.filter((region) => region.pageIndex === index)
        .map((region) => ({
          ...region,
          score: scoreMap.get(region.questionId)?.score ?? null,
          maxScore: scoreMap.get(region.questionId)?.maxScore ?? null,
        })) ?? [],
  }));
});
const hasVisibleRegionOverlay = computed(
  () =>
    previewDisplayOptions.value.showQuestionBoxes ||
    previewDisplayOptions.value.showQuestionTags ||
    previewDisplayOptions.value.showQuestionScores,
);
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

function formatRegionScore(score?: number | null, maxScore?: number | null): string {
  if (typeof score !== 'number' || typeof maxScore !== 'number') {
    return '';
  }

  return `${formatScoreValue(score)}/${formatScoreValue(maxScore)}`;
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
  () => gradedResultEntries.value,
  (value) => {
    if (!value.length) {
      selectedResultId.value = '';
      return;
    }

    if (!value.some((item) => item.result.id === selectedResultId.value)) {
      selectedResultId.value = value[0].result.id;
    }
  },
  { immediate: true },
);

watch(
  () => selectedResult.value,
  (value) => {
    editableResult.value = value?.finalResult ? cloneFinalResult(value.finalResult) : null;
    expandedQuestionIds.value = [];
  },
  { immediate: true },
);

watch(
  () => smartNameManualResult.value,
  (value) => {
    manualSmartNameDraft.value = value?.finalResult ? cloneFinalResult(value.finalResult) : null;
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

watch(
  activeQuestionId,
  async (questionId) => {
    await window.neuromark.preview.setActiveQuestion(null, questionId);
  },
  { flush: 'post' },
);

watch(
  projectId,
  (nextProjectId) => {
    previewDisplayOptions.value = loadStoredPreviewDisplayOptions(nextProjectId);
  },
  { immediate: true },
);

watch(
  previewDisplayOptions,
  async (displayOptions) => {
    const plainDisplayOptions = toPlainPreviewDisplayOptions(displayOptions);
    persistPreviewDisplayOptions(projectId.value, plainDisplayOptions);
    await window.neuromark.preview.setDisplayOptions(
      null,
      plainDisplayOptions,
    );
  },
  { deep: true },
);

watch(
  () => [activeTab.value, isReviewScrollActive.value] as const,
  ([tab, reviewScrollActive]) => {
    setShellScrollLocked(
      (tab === 'results' || tab === 'smart-name-match') && reviewScrollActive,
    );
  },
  { immediate: true },
);

watch(
  () => smartNameMatchState.value.reasoningText,
  async () => {
    if (!smartNameMatchIsRunning.value || smartNameMatchHasPreview.value) {
      return;
    }
    await Promise.resolve();
    if (smartNameReasoningRef.value) {
      smartNameReasoningRef.value.scrollTop = smartNameReasoningRef.value.scrollHeight;
    }
  },
);

watch(
  () => smartNameMatchState.value.previewText,
  async () => {
    if (!smartNameMatchIsRunning.value || !smartNameMatchHasPreview.value) {
      return;
    }
    await Promise.resolve();
    if (smartNamePreviewRef.value) {
      smartNamePreviewRef.value.scrollTop = smartNamePreviewRef.value.scrollHeight;
    }
  },
);

watch(
  showRubricDebugTab,
  async (visible) => {
    if (!visible && activeTab.value === 'rubric-debug') {
      activeTab.value = 'overview';
      return;
    }

    if (visible && projectId.value) {
      await loadRubricDebug();
    }
  },
  { immediate: true },
);

onMounted(async () => {
  await debugPanelStore.initialize();
  smartNameMatchUnsubscribe = window.neuromark.results.onSmartNameMatchUpdated((snapshot) => {
    if (snapshot.projectId === projectId.value) {
      smartNameMatchSnapshot.value = snapshot;
      if (!smartNameRosterText.value.trim() && snapshot.rosterText.trim()) {
        smartNameRosterText.value = snapshot.rosterText;
      }
    }
  });

  if (projectsStore.projects.length === 0) {
    await projectsStore.bootstrap();
  }

  if (projectId.value) {
    await projectsStore.selectProject(projectId.value);
    smartNameMatchSnapshot.value = await window.neuromark.results.getSmartNameMatchSnapshot(projectId.value);
    if (smartNameMatchSnapshot.value.rosterText.trim()) {
      smartNameRosterText.value = smartNameMatchSnapshot.value.rosterText;
    }
    if (showRubricDebugTab.value) {
      await loadRubricDebug();
    }
  }
});

onBeforeUnmount(() => {
  smartNameMatchUnsubscribe?.();
  smartNameMatchUnsubscribe = null;
  smartNameContextMenu.value.visible = false;
  if (lockedShellContent) {
    lockedShellContent.classList.remove('shell-content--scroll-locked');
    lockedShellContent = null;
  }
});

watch(
  () => [projectId.value, latestReferenceAnswerVersion.value] as const,
  async ([nextProjectId]) => {
    if (!nextProjectId || !showRubricDebugTab.value) {
      return;
    }
    await loadRubricDebug();
  },
);

watch(
  projectId,
  async (nextProjectId) => {
    if (!nextProjectId) {
      smartNameMatchSnapshot.value = null;
      smartNameRosterText.value = '';
      return;
    }

    const snapshot = await window.neuromark.results.getSmartNameMatchSnapshot(nextProjectId);
    smartNameMatchSnapshot.value = snapshot;
    if (snapshot.rosterText.trim()) {
      smartNameRosterText.value = snapshot.rosterText;
    }
  },
  { immediate: false },
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
  const saveOptions = editableStudentInfoChanged.value
    ? {
        nameMatchStatus: 'verified' as NameMatchStatus,
        nameMatchUpdatedAt: new Date().toISOString(),
        nameMatchSource: 'manual-review',
      }
    : undefined;
  await projectsStore.saveFinalResult(
    selectedProject.value.id,
    selectedResult.value.paperId,
    nextResult,
    saveOptions,
  );
}

async function startSmartNameMatch() {
  if (!selectedProject.value || smartNameSubmitting.value || smartNameMatchIsRunning.value) {
    return;
  }

  const rosterText = smartNameRosterText.value.trim();
  if (!rosterText) {
    message.error('请先输入班级名册。');
    return;
  }

  smartNameSubmitting.value = true;
  try {
    smartNameMatchSnapshot.value = await window.neuromark.results.startSmartNameMatch(
      selectedProject.value.id,
      rosterText,
    );
    message.success('智能核名已开始。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '启动智能核名失败。');
  } finally {
    smartNameSubmitting.value = false;
  }
}

async function applySmartNameMatch() {
  if (!selectedProject.value || smartNameApplying.value) {
    return;
  }

  smartNameApplying.value = true;
  try {
    const updatedPaperIds = await window.neuromark.results.applySmartNameMatch(selectedProject.value.id);
    await Promise.all([
      projectsStore.loadProjectDetail(selectedProject.value.id),
      window.neuromark.results.getSmartNameMatchSnapshot(selectedProject.value.id).then((snapshot) => {
        smartNameMatchSnapshot.value = snapshot;
      }),
    ]);
    message.success(`已应用 ${updatedPaperIds.length} 份确定核名结果。`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '应用智能核名失败。');
  } finally {
    smartNameApplying.value = false;
  }
}

function getSmartNameDecisionLabel(suggestion: SmartNameMatchSuggestion): string {
  if (suggestion.decision === 'certain_update') {
    return '确定修改';
  }
  if (suggestion.decision === 'certain_keep') {
    return '确定无误';
  }
  if (suggestion.decision === 'uncertain') {
    return '待确认';
  }
  return '未匹配';
}

function getSmartNameDecisionType(suggestion: SmartNameMatchSuggestion) {
  if (suggestion.decision === 'certain_update') {
    return 'warning' as const;
  }
  if (suggestion.decision === 'certain_keep') {
    return 'success' as const;
  }
  if (suggestion.decision === 'uncertain') {
    return 'warning' as const;
  }
  return 'default' as const;
}

function formatStudentInfo(studentInfo: { className: string; studentId: string; name: string } | null): string {
  if (!studentInfo) {
    return '未给出候选';
  }

  return [
    studentInfo.name || '未识别姓名',
    `学号 ${studentInfo.studentId || '未识别'}`,
    `班级 ${studentInfo.className || '未识别'}`,
  ].join(' · ');
}

function getSmartNameFieldLabel(field: 'className' | 'studentId' | 'name'): string {
  if (field === 'className') {
    return '班级';
  }
  if (field === 'studentId') {
    return '学号';
  }
  return '姓名';
}

function isSmartNameFieldChanged(
  suggestion: SmartNameMatchSuggestion,
  field: 'className' | 'studentId' | 'name',
): boolean {
  return suggestion.changedFields.includes(field);
}

function getSmartNameFieldCurrentValue(
  suggestion: SmartNameMatchSuggestion,
  field: 'className' | 'studentId' | 'name',
): string {
  return suggestion.currentStudentInfo[field] || '未识别';
}

function getSmartNameFieldSuggestedValue(
  suggestion: SmartNameMatchSuggestion,
  field: 'className' | 'studentId' | 'name',
): string {
  const nextInfo = suggestion.suggestedStudentInfo || suggestion.currentStudentInfo;
  return nextInfo[field] || '未识别';
}

function buildPaperPreviewImages(paperId: string): PreviewImageItem[] {
  const paper = papers.value.find((item) => item.id === paperId);
  if (!paper) {
    return [];
  }

  return paper.originalPages.map((page, index) => ({
    src: page.scannedPath || page.originalPath,
    cacheKey: page.scannedPath ? page.scannedVersion : page.originalVersion,
    title: `${paper.paperCode} · 第 ${index + 1} 页`,
    caption: page.scannedPath ? '扫描答卷' : '原始答卷',
  }));
}

async function openPaperPreviewByPaperId(paperId: string) {
  const previewImages = buildPaperPreviewImages(paperId);
  if (!previewImages.length) {
    return;
  }

  await window.neuromark.preview.open(
    previewImages,
    0,
    '答卷图片预览',
  );
}

function hideSmartNameContextMenu() {
  smartNameContextMenu.value.visible = false;
}

function openSmartNameContextMenu(event: MouseEvent, paperId: string) {
  event.preventDefault();
  smartNameContextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    paperId,
  };
}

function startManualSmartName(paperId: string) {
  smartNameWorkspaceMode.value = 'manual';
  smartNameManualPaperId.value = paperId;
  selectedResultId.value = results.value.find((item) => item.paperId === paperId)?.id ?? selectedResultId.value;
  hideSmartNameContextMenu();
}

function backToAutoSmartName() {
  smartNameWorkspaceMode.value = 'auto';
}

async function saveManualSmartName() {
  if (!selectedProject.value || !smartNameManualResult.value || !manualSmartNameDraft.value) {
    return;
  }

  manualSmartNameSaving.value = true;
  try {
    await projectsStore.saveFinalResult(
      selectedProject.value.id,
      smartNameManualResult.value.paperId,
      cloneFinalResult(manualSmartNameDraft.value),
      {
        nameMatchStatus: 'verified',
        nameMatchUpdatedAt: new Date().toISOString(),
        nameMatchSource: 'manual-name-match',
      },
    );
    message.success('手动核名已保存。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存手动核名失败。');
  } finally {
    manualSmartNameSaving.value = false;
  }
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
  await window.neuromark.preview.open(
    previewImages,
    safeIndex,
    '答卷图片预览',
    activeQuestionId.value,
    toPlainPreviewDisplayOptions(previewDisplayOptions.value),
  );
}

function togglePreviewDisplayOption(option: keyof PreviewDisplayOptions) {
  previewDisplayOptions.value = {
    ...previewDisplayOptions.value,
    [option]: !previewDisplayOptions.value[option],
  };
}

function toPlainPreviewDisplayOptions(
  value: PreviewDisplayOptions,
): PreviewDisplayOptions {
  const rawValue = toRaw(value);

  return {
    showQuestionTags: rawValue.showQuestionTags,
    showQuestionBoxes: rawValue.showQuestionBoxes,
    showQuestionScores: rawValue.showQuestionScores,
  };
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

function isQuestionExpanded(questionId: string) {
  return expandedQuestionIds.value.includes(questionId);
}

function toggleQuestionExpanded(questionId: string) {
  if (isQuestionExpanded(questionId)) {
    expandedQuestionIds.value = expandedQuestionIds.value.filter((item) => item !== questionId);
    return;
  }

  expandedQuestionIds.value = [...expandedQuestionIds.value, questionId];
  focusQuestion(questionId);
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

function getTaskRuntimeLogs(task: { runtimeLogs?: string[] }, maxCount = 3) {
  return (task.runtimeLogs ?? []).slice(-maxCount).reverse();
}

function isErrorLogLine(line: string) {
  return /^\[[^\]]+\]\s*ERROR:/.test(line) || line.includes('尝试失败：ERROR:');
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
                      <div v-if="getTaskRuntimeLogs(task).length" class="task-log-list task-log-list--compact">
                        <div
                          v-for="line in getTaskRuntimeLogs(task)"
                          :key="`${task.id}-${line}`"
                          class="task-log-line"
                          :class="{ 'task-log-line--error': isErrorLogLine(line) }"
                        >
                          {{ line }}
                        </div>
                      </div>
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
          <div
            v-if="papers.length"
            class="result-review-layout"
            @mouseenter="isReviewScrollActive = true"
            @mouseleave="isReviewScrollActive = false"
          >
            <aside class="result-sidebar surface-card">
              <div class="result-sidebar-head">
                <div>
                  <div class="result-section-title">答卷导航</div>
                  <div class="detail-subtitle">浏览所有已批阅答卷。</div>
                </div>
                <div class="result-sidebar-sort">
                  <span class="result-sidebar-sort-label">排序方式</span>
                  <n-select
                    v-model:value="resultSortMode"
                    size="small"
                    :options="resultSortOptions"
                  />
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
                          v-if="entry.result.nameMatchStatus === 'verified'"
                          size="small"
                          round
                          type="success"
                          :bordered="false"
                        >
                          已核名
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
                      <div class="result-panel-head result-panel-head--with-tools">
                        <div>
                          <div class="result-section-title">扫描答卷与答题区域</div>
                          <div class="detail-subtitle">用于对照当前小题对应的答题区域。</div>
                        </div>
                        <div class="preview-overlay-controls" aria-label="预览覆盖层开关">
                          <n-tooltip trigger="hover">
                            <template #trigger>
                              <button
                                class="preview-overlay-toggle"
                                :class="{ 'is-active': previewDisplayOptions.showQuestionTags }"
                                :aria-pressed="previewDisplayOptions.showQuestionTags"
                                aria-label="切换题目标号"
                                @click="togglePreviewDisplayOption('showQuestionTags')"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M8 8h10" />
                                  <path d="M8 12h7" />
                                  <path d="M8 16h10" />
                                  <path d="M4.5 4.5 7.5 7.5" />
                                  <path d="M7.5 4.5 4.5 7.5" />
                                </svg>
                              </button>
                            </template>
                            显示题目标号
                          </n-tooltip>
                          <n-tooltip trigger="hover">
                            <template #trigger>
                              <button
                                class="preview-overlay-toggle"
                                :class="{ 'is-active': previewDisplayOptions.showQuestionBoxes }"
                                :aria-pressed="previewDisplayOptions.showQuestionBoxes"
                                aria-label="切换题目方框"
                                @click="togglePreviewDisplayOption('showQuestionBoxes')"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <rect x="5" y="5" width="14" height="14" rx="3" ry="3" />
                                  <path d="M8 9h8" />
                                  <path d="M8 12h6" />
                                  <path d="M8 15h8" />
                                </svg>
                              </button>
                            </template>
                            显示题目方框
                          </n-tooltip>
                          <n-tooltip trigger="hover">
                            <template #trigger>
                              <button
                                class="preview-overlay-toggle"
                                :class="{ 'is-active': previewDisplayOptions.showQuestionScores }"
                                :aria-pressed="previewDisplayOptions.showQuestionScores"
                                aria-label="切换小题得分"
                                @click="togglePreviewDisplayOption('showQuestionScores')"
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M5 8h10" />
                                  <path d="M5 12h7" />
                                  <path d="M5 16h10" />
                                  <path d="M16.5 5.5 19.5 8.5" />
                                  <path d="M19.5 5.5 16.5 8.5" />
                                </svg>
                              </button>
                            </template>
                            显示小题得分
                          </n-tooltip>
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
                              v-if="hasVisibleRegionOverlay"
                              v-for="region in image.regions"
                              :key="`${image.title}-${region.questionId}`"
                              class="paper-stage-region"
                              :class="{
                                'paper-stage-region--active': region.questionId === activeQuestionId,
                                'paper-stage-region--box-hidden': !previewDisplayOptions.showQuestionBoxes
                              }"
                              :style="{
                                left: `${region.x * 100}%`,
                                top: `${region.y * 100}%`,
                                width: `${region.width * 100}%`,
                                height: `${region.height * 100}%`
                              }"
                            >
                              <span v-if="previewDisplayOptions.showQuestionTags">{{ region.questionId }}</span>
                              <strong
                                v-if="previewDisplayOptions.showQuestionScores"
                                class="paper-stage-region-score"
                              >
                                {{ formatRegionScore(region.score, region.maxScore) }}
                              </strong>
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
                        <div v-if="editableStudentInfoChanged" class="smart-name-save-hint">
                          保存后，这份答卷会被标记为已核名。
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
                              <div class="question-card-title question-card-title--markdown">
                                <span class="question-card-title-prefix">{{ question.questionId }} · </span>
                                <MarkdownRenderer
                                  class="question-card-title-content"
                                  :source="question.questionTitle"
                                />
                              </div>
                              <div class="question-card-meta">满分 {{ question.maxScore }}</div>
                            </div>
                            <div class="question-card-actions">
                              <div class="question-score-pill">
                                当前得分 {{ formatScoreValue(question.score) }}/{{ formatScoreValue(question.maxScore) }}
                              </div>
                              <n-button
                                text
                                type="primary"
                                class="question-toggle-button"
                                @click.stop="toggleQuestionExpanded(question.questionId)"
                              >
                                {{ isQuestionExpanded(question.questionId) ? '收起' : '展开' }}
                              </n-button>
                            </div>
                          </div>
                          <div v-if="question.issues.length" class="issues-box">
                            <strong>问题点</strong>
                            <ul>
                              <li v-for="issue in question.issues" :key="issue">
                                <MarkdownRenderer :source="issue" />
                              </li>
                            </ul>
                          </div>
                          <div v-else-if="!isQuestionExpanded(question.questionId)" class="detail-subtitle">
                            当前没有模型标记的问题点。
                          </div>
                          <template v-if="isQuestionExpanded(question.questionId)">
                            <div class="question-card-expanded">
                              <div class="question-score-editor">
                                <div class="detail-subtitle">手动调整本题分数，保存后会重新汇总总分。</div>
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
                                    <MarkdownRenderer :source="point.criterion" />
                                    <MarkdownRenderer :source="point.evidence" />
                                  </li>
                                </ul>
                              </div>
                            </div>
                          </template>
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
                          <MarkdownRenderer :source="editableResult.overallAdvice.summary" />
                        </div>

                        <div class="question-card question-card--advice">
                          <div class="question-card-title">表现较好的方面</div>
                          <div v-if="editableResult.overallAdvice.strengths.length" class="issues-box">
                            <ul>
                              <li v-for="item in editableResult.overallAdvice.strengths" :key="item">
                                <MarkdownRenderer :source="item" />
                              </li>
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
                                <MarkdownRenderer :source="item" />
                              </li>
                            </ul>
                          </div>
                          <div v-else class="detail-subtitle">当前没有明确需要优先补强的知识点。</div>
                        </div>

                        <div class="question-card question-card--advice">
                          <div class="question-card-title">答题注意事项</div>
                          <div v-if="editableResult.overallAdvice.attentionPoints.length" class="issues-box">
                            <ul>
                              <li v-for="item in editableResult.overallAdvice.attentionPoints" :key="item">
                                <MarkdownRenderer :source="item" />
                              </li>
                            </ul>
                          </div>
                          <div v-else class="detail-subtitle">当前没有额外的答题习惯提醒。</div>
                        </div>

                        <div class="question-card question-card--advice">
                          <div class="question-card-title">鼓励与提醒</div>
                          <MarkdownRenderer :source="editableResult.overallAdvice.encouragement" />
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

        <n-tab-pane name="smart-name-match" tab="智能核名">
          <div
            v-if="results.length"
            class="result-review-layout"
            @mouseenter="isReviewScrollActive = true"
            @mouseleave="isReviewScrollActive = false"
            @click="hideSmartNameContextMenu"
          >
            <aside class="result-sidebar surface-card">
              <div class="result-sidebar-head">
                <div>
                  <div class="result-section-title">已批阅答卷</div>
                  <div class="detail-subtitle">核对当前项目的学生身份信息。</div>
                </div>
                <div class="result-sidebar-stats">
                  <n-tag size="small" round :bordered="false">已批改 {{ results.length }}</n-tag>
                  <n-tag size="small" round type="success" :bordered="false">
                    已核名 {{ results.filter((item) => item.nameMatchStatus === 'verified').length }}
                  </n-tag>
                </div>
              </div>

              <div class="result-sidebar-scroll">
                <div class="result-nav-section">
                  <button
                    v-for="entry in gradedResultEntries"
                    :key="`smart-${entry.result.id}`"
                    class="result-row"
                    :class="{ active: entry.result.id === selectedResult?.id }"
                    @click="selectedResultId = entry.result.id"
                    @contextmenu="openSmartNameContextMenu($event, entry.result.paperId)"
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
                          v-if="entry.result.nameMatchStatus === 'verified'"
                          size="small"
                          round
                          type="success"
                          :bordered="false"
                        >
                          已核名
                        </n-tag>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </aside>

            <section class="result-workspace surface-card">
              <div class="result-workspace-head">
                <div>
                  <div class="result-section-title">
                    {{ smartNameWorkspaceMode === 'manual' ? '手动核名' : '智能核名' }}
                  </div>
                  <div class="detail-subtitle">
                    {{
                      smartNameWorkspaceMode === 'manual'
                        ? '查看原卷并手动修正班级、学号、姓名。'
                        : '提交班级名册后，系统会结合当前已批阅结果自动生成核名建议。'
                    }}
                  </div>
                </div>
                <n-space>
                  <n-button
                    v-if="smartNameWorkspaceMode === 'manual'"
                    secondary
                    @click="backToAutoSmartName"
                  >
                    返回智能核名
                  </n-button>
                  <n-button
                    v-if="smartNameWorkspaceMode === 'auto'"
                    :disabled="smartNameMatchCertainSuggestions.length === 0 || smartNameMatchIsRunning"
                    :loading="smartNameApplying"
                    type="primary"
                    @click="applySmartNameMatch"
                  >
                    应用确定项
                  </n-button>
                </n-space>
              </div>

              <div class="result-workspace-scroll">
                <div v-if="smartNameWorkspaceMode === 'manual' && smartNameManualResult && manualSmartNameDraft && smartNameManualPaper" class="result-workspace-stack">
                  <div class="result-paper-summary">
                    <div class="result-paper-title">{{ smartNameManualPaper.paperCode }}</div>
                    <div class="result-paper-meta">
                      {{ manualSmartNameDraft.studentInfo.name || '未识别姓名' }}
                      <span>学号 {{ manualSmartNameDraft.studentInfo.studentId || '未识别' }}</span>
                      <span>班级 {{ manualSmartNameDraft.studentInfo.className || '未识别' }}</span>
                    </div>
                  </div>

                  <div class="result-subsection-card">
                    <div class="result-panel-head result-panel-head--with-tools">
                      <div>
                        <div class="result-section-title">查看试卷</div>
                      </div>
                      <n-button secondary @click="openPaperPreviewByPaperId(smartNameManualResult.paperId)">
                        查看原卷
                      </n-button>
                    </div>

                    <div class="result-stage-stack result-stage-stack--embedded">
                      <div
                        v-for="(image, imageIndex) in buildPaperPreviewImages(smartNameManualResult.paperId)"
                        :key="`manual-${image.title}`"
                        class="stage-card"
                      >
                        <div class="stage-card-title">{{ image.title }}</div>
                        <div class="paper-stage paper-stage--thumbnail" @click="openPaperPreviewByPaperId(smartNameManualResult.paperId)">
                          <img
                            class="paper-stage-image"
                            :src="toImageSrc(image.src, image.cacheKey)"
                            :alt="image.title"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="result-subsection-card">
                    <div class="result-panel-head">
                      <div>
                        <div class="result-section-title">身份信息</div>
                      </div>
                    </div>
                    <n-form label-placement="top">
                      <div class="three-col">
                        <n-form-item label="班级">
                          <n-input v-model:value="manualSmartNameDraft.studentInfo.className" />
                        </n-form-item>
                        <n-form-item label="学号">
                          <n-input v-model:value="manualSmartNameDraft.studentInfo.studentId" />
                        </n-form-item>
                        <n-form-item label="姓名">
                          <n-input v-model:value="manualSmartNameDraft.studentInfo.name" />
                        </n-form-item>
                      </div>
                      <div class="smart-name-save-hint">
                        保存后，这份答卷会被标记为已核名。
                      </div>
                    </n-form>
                    <div class="reference-editor-actions">
                      <n-button
                        type="primary"
                        :loading="manualSmartNameSaving"
                        @click="saveManualSmartName"
                      >
                        保存手动核名
                      </n-button>
                    </div>
                  </div>
                </div>

                <div v-else class="result-workspace-stack">
                  <div class="result-subsection-card">
                    <div class="result-panel-head">
                      <div>
                        <div class="result-section-title">班级名册</div>
                      </div>
                    </div>

                    <n-input
                      v-model:value="smartNameRosterText"
                      type="textarea"
                      :autosize="{ minRows: 10, maxRows: 18 }"
                      placeholder="逐行粘贴班级、姓名、学号等内容"
                    />

                    <div class="reference-editor-actions">
                      <n-button
                        type="primary"
                        :loading="smartNameSubmitting"
                        :disabled="smartNameMatchIsRunning"
                        @click="startSmartNameMatch"
                      >
                        开始智能核名
                      </n-button>
                      <n-tag
                        v-if="smartNameMatchState.stage"
                        round
                        :bordered="false"
                      >
                        {{ smartNameMatchState.stage }}
                      </n-tag>
                    </div>
                  </div>

                  <n-alert
                    v-if="smartNameMatchState.status === 'failed' && smartNameMatchState.errorMessage"
                    type="error"
                    class="answer-generation-alert"
                    :show-icon="false"
                  >
                    {{ smartNameMatchState.errorMessage }}
                  </n-alert>

                  <div v-if="smartNameMatchIsRunning" class="result-subsection-card">
                    <div class="answer-generation-pending">
                      <n-spin size="large" />
                      <div class="answer-generation-pending-copy">
                        <strong>正在智能核名</strong>
                        <span>{{ smartNameMatchState.stage || '正在请求模型。' }}</span>
                      </div>
                      <div
                        v-if="!smartNameMatchHasPreview"
                        class="preset-panel preset-panel--stream"
                      >
                        <div class="preset-panel-title">模型思考过程（实时）</div>
                        <div
                          ref="smartNameReasoningRef"
                          class="preset-panel-copy preset-panel-copy--log stream-output-box"
                        >
                          {{ smartNameMatchState.reasoningText || '当前还没有接收到模型推理文本。' }}
                        </div>
                      </div>
                      <div
                        v-else
                        class="preset-panel preset-panel--stream"
                      >
                        <div class="preset-panel-title">模型实时输出（JSON 草稿）</div>
                        <div
                          ref="smartNamePreviewRef"
                          class="preset-panel-copy preset-panel-copy--log stream-output-box"
                        >
                          {{ smartNameMatchState.previewText }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <template v-if="smartNameMatchState.result">
                    <div class="result-subsection-card">
                      <div class="result-panel-head">
                        <div>
                          <div class="result-section-title">结果概览</div>
                        </div>
                      </div>

                      <div class="smart-name-summary-grid">
                        <div class="result-score-summary-card">
                          <span>确定修改</span>
                          <strong>{{ smartNameMatchState.result.summary.certainUpdateCount }}</strong>
                        </div>
                        <div class="result-score-summary-card">
                          <span>确定无误</span>
                          <strong>{{ smartNameMatchState.result.summary.certainKeepCount }}</strong>
                        </div>
                        <div class="result-score-summary-card">
                          <span>待确认</span>
                          <strong>{{ smartNameMatchState.result.summary.uncertainCount }}</strong>
                        </div>
                        <div class="result-score-summary-card">
                          <span>未匹配</span>
                          <strong>{{ smartNameMatchState.result.summary.noMatchCount }}</strong>
                        </div>
                        <div class="result-score-summary-card">
                          <span>疑似重复卷</span>
                          <strong>{{ smartNameMatchState.result.summary.duplicateGroupCount }}</strong>
                        </div>
                      </div>
                    </div>

                    <div class="result-subsection-card">
                      <div class="result-panel-head">
                        <div>
                          <div class="result-section-title">疑似重复录入</div>
                        </div>
                      </div>

                      <div
                        v-if="smartNameMatchState.result.duplicateGroups.length"
                        class="question-list"
                      >
                        <div
                          v-for="(group, groupIndex) in smartNameMatchState.result.duplicateGroups"
                          :key="`duplicate-${groupIndex}`"
                          class="question-card question-card--smart-name"
                        >
                          <div class="smart-name-card-head">
                            <div>
                              <div class="question-card-title">{{ group.paperCodes.join(' / ') }}</div>
                              <div class="question-card-meta">
                                置信度 {{ Math.round(group.confidence * 100) }}%
                              </div>
                            </div>
                            <n-tag size="small" round :bordered="false" type="warning">
                              疑似重复
                            </n-tag>
                          </div>
                          <div class="detail-subtitle">{{ group.reason }}</div>
                          <div v-if="group.evidence.length" class="issues-box">
                            <strong>依据</strong>
                            <ul>
                              <li v-for="evidence in group.evidence" :key="evidence">
                                {{ evidence }}
                              </li>
                            </ul>
                          </div>
                        </div>
                      </div>
                      <n-empty v-else description="当前没有发现疑似重复录入的卷子。" />
                    </div>

                    <div class="result-subsection-card">
                      <div class="result-panel-head">
                        <div>
                          <div class="result-section-title">确定修改</div>
                        </div>
                      </div>

                      <div v-if="smartNameMatchCertainUpdateSuggestions.length" class="question-list">
                        <div
                          v-for="suggestion in smartNameMatchCertainUpdateSuggestions"
                          :key="`certain-update-${suggestion.paperId}`"
                          class="question-card question-card--smart-name"
                        >
                          <div class="smart-name-card-head">
                            <div>
                              <div class="question-card-title">{{ suggestion.paperCode }}</div>
                              <div class="question-card-meta">{{ formatStudentInfo(suggestion.currentStudentInfo) }}</div>
                            </div>
                            <n-tag
                              size="small"
                              round
                              :bordered="false"
                              :type="getSmartNameDecisionType(suggestion)"
                            >
                              {{ getSmartNameDecisionLabel(suggestion) }}
                            </n-tag>
                          </div>
                          <div class="reference-editor-actions">
                            <n-button secondary size="small" @click="openPaperPreviewByPaperId(suggestion.paperId)">
                              查看原卷
                            </n-button>
                          </div>
                          <div class="smart-name-diff-list">
                            <div
                              v-for="field in ['name', 'studentId', 'className']"
                              :key="`${suggestion.paperId}-${field}`"
                              class="smart-name-diff-row"
                              :class="{ 'is-changed': isSmartNameFieldChanged(suggestion, field as 'className' | 'studentId' | 'name') }"
                            >
                              <div class="smart-name-diff-label">
                                {{ getSmartNameFieldLabel(field as 'className' | 'studentId' | 'name') }}
                              </div>
                              <div class="smart-name-diff-values">
                                <span
                                  class="smart-name-diff-value smart-name-diff-value--before"
                                  :class="{ 'is-muted': !isSmartNameFieldChanged(suggestion, field as 'className' | 'studentId' | 'name') }"
                                >
                                  {{ getSmartNameFieldCurrentValue(suggestion, field as 'className' | 'studentId' | 'name') }}
                                </span>
                                <span
                                  class="smart-name-diff-arrow"
                                  :class="{ 'is-hidden': !isSmartNameFieldChanged(suggestion, field as 'className' | 'studentId' | 'name') }"
                                >
                                  →
                                </span>
                                <span
                                  class="smart-name-diff-value smart-name-diff-value--after"
                                  :class="{ 'is-muted': !isSmartNameFieldChanged(suggestion, field as 'className' | 'studentId' | 'name') }"
                                >
                                  {{ getSmartNameFieldSuggestedValue(suggestion, field as 'className' | 'studentId' | 'name') }}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div class="detail-subtitle">{{ suggestion.reason }}</div>
                          <div v-if="suggestion.matchedRosterLine" class="preset-panel preset-panel--secondary">
                            <div class="preset-panel-title">命中名册</div>
                            <div class="preset-panel-copy">{{ suggestion.matchedRosterLine }}</div>
                          </div>
                        </div>
                      </div>
                      <n-empty v-else description="当前没有确定修改的核名结果。" />
                    </div>

                    <div class="result-subsection-card">
                      <div class="result-panel-head">
                        <div>
                          <div class="result-section-title">待人工确认</div>
                        </div>
                      </div>

                      <div v-if="smartNameMatchUncertainSuggestions.length" class="question-list">
                        <div
                          v-for="suggestion in smartNameMatchUncertainSuggestions"
                          :key="`uncertain-${suggestion.paperId}`"
                          class="question-card question-card--smart-name"
                        >
                          <div class="smart-name-card-head">
                            <div>
                              <div class="question-card-title">{{ suggestion.paperCode }}</div>
                              <div class="question-card-meta">
                                置信度 {{ Math.round(suggestion.confidence * 100) }}%
                              </div>
                            </div>
                            <n-tag
                              size="small"
                              round
                              :bordered="false"
                              :type="getSmartNameDecisionType(suggestion)"
                            >
                              {{ getSmartNameDecisionLabel(suggestion) }}
                            </n-tag>
                          </div>
                          <div class="reference-editor-actions">
                            <n-button secondary size="small" @click="openPaperPreviewByPaperId(suggestion.paperId)">
                              查看原卷
                            </n-button>
                          </div>
                          <div class="smart-name-diff-list">
                            <div
                              v-for="field in ['name', 'studentId', 'className']"
                              :key="`${suggestion.paperId}-${field}`"
                              class="smart-name-diff-row"
                              :class="{ 'is-changed': isSmartNameFieldChanged(suggestion, field as 'className' | 'studentId' | 'name') }"
                            >
                              <div class="smart-name-diff-label">
                                {{ getSmartNameFieldLabel(field as 'className' | 'studentId' | 'name') }}
                              </div>
                              <div class="smart-name-diff-values">
                                <span
                                  class="smart-name-diff-value smart-name-diff-value--before"
                                  :class="{ 'is-muted': !isSmartNameFieldChanged(suggestion, field as 'className' | 'studentId' | 'name') }"
                                >
                                  {{ getSmartNameFieldCurrentValue(suggestion, field as 'className' | 'studentId' | 'name') }}
                                </span>
                                <span
                                  class="smart-name-diff-arrow"
                                  :class="{ 'is-hidden': !isSmartNameFieldChanged(suggestion, field as 'className' | 'studentId' | 'name') }"
                                >
                                  →
                                </span>
                                <span
                                  class="smart-name-diff-value smart-name-diff-value--after"
                                  :class="{ 'is-muted': !isSmartNameFieldChanged(suggestion, field as 'className' | 'studentId' | 'name') }"
                                >
                                  {{ getSmartNameFieldSuggestedValue(suggestion, field as 'className' | 'studentId' | 'name') }}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div class="detail-subtitle">{{ suggestion.reason }}</div>
                          <div v-if="suggestion.uncertaintyNotes.length" class="issues-box">
                            <strong>不确定原因</strong>
                            <ul>
                              <li v-for="note in suggestion.uncertaintyNotes" :key="note">
                                {{ note }}
                              </li>
                            </ul>
                          </div>
                          <div v-if="suggestion.matchedRosterLine" class="preset-panel preset-panel--secondary">
                            <div class="preset-panel-title">候选名册</div>
                            <div class="preset-panel-copy">{{ suggestion.matchedRosterLine }}</div>
                          </div>
                        </div>
                      </div>
                      <n-empty v-else description="当前没有需要人工确认的条目。" />
                    </div>

                    <div class="result-subsection-card">
                      <div class="result-panel-head result-panel-head--with-tools">
                        <div>
                          <div class="result-section-title">确定无误</div>
                        </div>
                        <n-button text type="primary" @click="smartNameKeepExpanded = !smartNameKeepExpanded">
                          {{ smartNameKeepExpanded ? '收起' : `展开 ${smartNameMatchCertainKeepSuggestions.length} 项` }}
                        </n-button>
                      </div>

                      <div v-if="smartNameKeepExpanded && smartNameMatchCertainKeepSuggestions.length" class="question-list">
                        <div
                          v-for="suggestion in smartNameMatchCertainKeepSuggestions"
                          :key="`certain-keep-${suggestion.paperId}`"
                          class="question-card question-card--smart-name"
                        >
                          <div class="smart-name-card-head">
                            <div>
                              <div class="question-card-title">{{ suggestion.paperCode }}</div>
                              <div class="question-card-meta">{{ formatStudentInfo(suggestion.currentStudentInfo) }}</div>
                            </div>
                            <n-tag
                              size="small"
                              round
                              :bordered="false"
                              :type="getSmartNameDecisionType(suggestion)"
                            >
                              {{ getSmartNameDecisionLabel(suggestion) }}
                            </n-tag>
                          </div>
                          <div class="reference-editor-actions">
                            <n-button secondary size="small" @click="openPaperPreviewByPaperId(suggestion.paperId)">
                              查看原卷
                            </n-button>
                          </div>
                          <div class="detail-subtitle">{{ suggestion.reason }}</div>
                          <div v-if="suggestion.matchedRosterLine" class="preset-panel preset-panel--secondary">
                            <div class="preset-panel-title">命中名册</div>
                            <div class="preset-panel-copy">{{ suggestion.matchedRosterLine }}</div>
                          </div>
                        </div>
                      </div>
                      <n-empty
                        v-else-if="!smartNameMatchCertainKeepSuggestions.length"
                        description="当前没有确定无误的条目。"
                      />
                      <div v-else class="detail-subtitle">
                        已折叠 {{ smartNameMatchCertainKeepSuggestions.length }} 条确定无误结果。
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </section>

            <div
              v-if="smartNameContextMenu.visible"
              class="preview-context-menu smart-name-context-menu"
              :style="{ left: `${smartNameContextMenu.x}px`, top: `${smartNameContextMenu.y}px` }"
              @click.stop
            >
              <button
                class="preview-context-menu__item"
                @click="startManualSmartName(smartNameContextMenu.paperId)"
              >
                手动核名
              </button>
            </div>
          </div>
          <n-empty v-else description="先完成批阅后再进行智能核名。" />
        </n-tab-pane>

        <n-tab-pane name="project-settings" tab="项目设置">
          <div class="project-settings-stack">
            <n-card class="surface-card" title="项目级批阅设置">
              <n-form v-if="selectedProject" label-placement="top" class="stack-form">
                <n-form-item label="项目名称">
                  <n-input v-model:value="projectNameDraft" placeholder="例如：第二章随堂练习" />
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
                  在此处修改项目批改用的参考答案内容，保存后版本号自动递增。
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

        <n-tab-pane v-if="showRubricDebugTab" name="rubric-debug" tab="Rubric 调试">
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
