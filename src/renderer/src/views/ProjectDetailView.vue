<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRaw,
  watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MdEditor } from 'md-editor-v3';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  type GridComponentOption,
  type TooltipComponentOption,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ComposeOption, ECharts } from 'echarts/core';
import type { LineSeriesOption } from 'echarts/charts';
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NPopconfirm,
  NRadio,
  NRadioGroup,
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
  ExportResultsOptions,
  FinalResult,
  NameMatchStatus,
  PaperRecord,
  PreviewDisplayOptions,
  PreviewImageItem,
  StudentInfo,
  StudentRosterColumnField,
  StudentRosterEntry,
  ResultExportScope,
  ResultRecord,
  ScoreBreakdownItem,
  SmartNameMatchScope,
  SmartNameMatchSnapshot,
  SmartNameMatchSuggestion,
  ProjectSettings,
} from '@preload/contracts';
import ImagePreviewTile from '@/components/ImagePreviewTile.vue';
import JsonTreeView from '@/components/JsonTreeView.vue';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import MetricCard from '@/components/MetricCard.vue';
import ScorePostProcessPanel from '@/components/ScorePostProcessPanel.vue';
import StatusPill from '@/components/StatusPill.vue';
import StudentInfoAutocompleteInput from '@/components/StudentInfoAutocompleteInput.vue';
import { useDebugPanelStore } from '@/stores/debug-panel';
import { useProjectsStore } from '@/stores/projects';
import { useScorePostProcessStore } from '@/stores/score-post-process';
import { useTasksStore } from '@/stores/tasks';
import { useTokenVisualizerStore } from '@/stores/token-visualizer';
import { toImageSrc } from '@/utils/file';
import { cloneFinalResult, computeDisplayedTotal } from '@/utils/result';
import {
  buildStudentRosterData,
  detectStudentRosterColumnFields,
  getNameSearchKeys,
  normalizeSearchText,
  normalizeStudentRosterColumnFields,
  parseStudentRosterText,
} from '@/utils/student-roster';

echarts.use([CanvasRenderer, GridComponent, LineChart, TooltipComponent]);

type ScoreDistributionChartOption = ComposeOption<
  GridComponentOption | TooltipComponentOption | LineSeriesOption
>;

const route = useRoute();
const router = useRouter();
const message = useMessage();
const projectsStore = useProjectsStore();
const scorePostProcessStore = useScorePostProcessStore();
const tasksStore = useTasksStore();
const debugPanelStore = useDebugPanelStore();
const visualizerStore = useTokenVisualizerStore();

const DEFAULT_PREVIEW_DISPLAY_OPTIONS: PreviewDisplayOptions = {
  showQuestionTags: true,
  showQuestionBoxes: true,
  showQuestionScores: false,
};
const PREVIEW_DISPLAY_OPTIONS_STORAGE_KEY_PREFIX =
  'neuromark:preview-display-options:';
const STUDENT_ROSTER_COLUMN_FIELD_OPTIONS = [
  { label: '忽略此列', value: 'ignore' },
  { label: '学号', value: 'studentId' },
  { label: '姓名', value: 'name' },
  { label: '班级', value: 'className' },
] satisfies Array<{ label: string; value: StudentRosterColumnField }>;

function cloneStudentRosterEntries(
  entries: StudentRosterEntry[],
): StudentRosterEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function cloneProjectSettings(settings: ProjectSettings): ProjectSettings {
  return {
    gradingConcurrency: settings.gradingConcurrency,
    drawRegions: settings.drawRegions,
    defaultImageDetail: settings.defaultImageDetail,
    enableScanPostProcess: settings.enableScanPostProcess,
    skipScanProcessing: settings.skipScanProcessing,
    scanMarginRatio: settings.scanMarginRatio,
    studentRoster: settings.studentRoster
      ? {
          rawText: settings.studentRoster.rawText,
          columnFields: [...settings.studentRoster.columnFields],
          entries: cloneStudentRosterEntries(settings.studentRoster.entries),
        }
      : null,
  };
}

const activeTab = ref('overview');
const selectedResultId = ref('');
const resultSearchKeyword = ref('');
type ResultSortMode =
  | 'input-order'
  | 'score-desc'
  | 'score-asc'
  | 'student-id'
  | 'unverified-first'
  | 'verified-first';
const resultSortMode = ref<ResultSortMode>('input-order');
const editableResult = ref<FinalResult | null>(null);
const referenceAnswerDraft = ref('');
const savedReferenceAnswerMarkdown = ref('');
const referenceAnswerSaving = ref(false);
const projectNameDraft = ref('');
const projectSettingsDraft = ref<ProjectSettings>({
  gradingConcurrency: 1,
  drawRegions: false,
  defaultImageDetail: 'high',
  enableScanPostProcess: true,
  skipScanProcessing: false,
  scanMarginRatio: 1,
  studentRoster: null,
});
const projectSettingsDraftProjectId = ref('');
const rubricLoading = ref(false);
const referenceAnswerDraftProjectId = ref('');
const deletingProject = ref(false);
const scanActionLoading = ref(false);
const gradingActionLoading = ref(false);
const exportDialogVisible = ref(false);
const exportJsonLoading = ref(false);
const exportExcelLoading = ref(false);
const exportQuestionAccuracyExcelLoading = ref(false);
const exportAllPdfsLoading = ref(false);
const stoppingResultPdfExport = ref(false);
const printResultLoading = ref(false);
const exportScope = ref<ResultExportScope>('graded');
const statisticsScoreMode = ref<'original' | 'post-processed'>('original');
const projectSettingsSaving = ref(false);
const removingPaperId = ref('');
const deletingResultPaperId = ref('');
const markResultAsVerifiedOnSave = ref(true);
const importActionLoading = ref(false);
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
const scoreDistributionChartRef = ref<HTMLElement | null>(null);
const activeQuestionId = ref('');
const previewDisplayOptions = ref<PreviewDisplayOptions>({
  ...DEFAULT_PREVIEW_DISPLAY_OPTIONS,
});
const isReviewScrollActive = ref(false);
const expandedQuestionIds = ref<string[]>([]);
const isResultPrintMode = ref(false);
const expandedQuestionIdsBeforePrint = ref<string[] | null>(null);
const pageStackRef = ref<HTMLElement | null>(null);
const shellScrollHost = ref<HTMLElement | null>(null);
const canScrollOuterToTop = ref(false);
const canScrollOuterToBottom = ref(false);

let lockedShellContent: HTMLElement | null = null;
let smartNameMatchUnsubscribe: (() => void) | null = null;
let shellScrollObserver: ResizeObserver | null = null;
let resultPrintDocumentTitleBeforePrint: string | null = null;
let scoreDistributionChart: ECharts | null = null;
const scorePostProcessSnapshot = computed(() =>
  projectId.value
    ? scorePostProcessStore.getProjectSnapshot(projectId.value)
    : null,
);

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

function loadStoredPreviewDisplayOptions(
  targetProjectId: string,
): PreviewDisplayOptions {
  if (typeof window === 'undefined' || !targetProjectId) {
    return { ...DEFAULT_PREVIEW_DISPLAY_OPTIONS };
  }

  try {
    const raw = window.localStorage.getItem(
      getPreviewDisplayOptionsStorageKey(targetProjectId),
    );
    if (!raw) {
      return { ...DEFAULT_PREVIEW_DISPLAY_OPTIONS };
    }

    const parsed = JSON.parse(raw) as Partial<PreviewDisplayOptions>;
    return {
      showQuestionTags:
        parsed.showQuestionTags ??
        DEFAULT_PREVIEW_DISPLAY_OPTIONS.showQuestionTags,
      showQuestionBoxes:
        parsed.showQuestionBoxes ??
        DEFAULT_PREVIEW_DISPLAY_OPTIONS.showQuestionBoxes,
      showQuestionScores:
        parsed.showQuestionScores ??
        DEFAULT_PREVIEW_DISPLAY_OPTIONS.showQuestionScores,
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

function shouldHideOuterScrollButtons(): boolean {
  return false;
}

function detachShellScrollHost() {
  shellScrollObserver?.disconnect();
  shellScrollObserver = null;

  if (shellScrollHost.value) {
    shellScrollHost.value.removeEventListener('scroll', updateOuterScrollState);
  }

  shellScrollHost.value = null;
}

function attachShellScrollHost() {
  if (typeof document === 'undefined') {
    return;
  }

  const nextHost = document.querySelector<HTMLElement>('.shell-content');
  if (!nextHost) {
    detachShellScrollHost();
    return;
  }

  if (shellScrollHost.value === nextHost) {
    return;
  }

  detachShellScrollHost();
  shellScrollHost.value = nextHost;
  shellScrollHost.value.addEventListener('scroll', updateOuterScrollState, {
    passive: true,
  });

  if (typeof ResizeObserver !== 'undefined') {
    shellScrollObserver = new ResizeObserver(() => {
      updateOuterScrollState();
    });
    shellScrollObserver.observe(shellScrollHost.value);
    if (pageStackRef.value) {
      shellScrollObserver.observe(pageStackRef.value);
    }
  }
}

function updateOuterScrollState() {
  const host = shellScrollHost.value;
  if (!host || shouldHideOuterScrollButtons()) {
    canScrollOuterToTop.value = false;
    canScrollOuterToBottom.value = false;
    return;
  }

  const threshold = 12;
  const maxScrollTop = Math.max(host.scrollHeight - host.clientHeight, 0);
  const remainingBottom = maxScrollTop - host.scrollTop;

  canScrollOuterToTop.value = host.scrollTop > threshold;
  canScrollOuterToBottom.value = remainingBottom > threshold;
}

async function refreshOuterScrollState() {
  await nextTick();
  attachShellScrollHost();
  updateOuterScrollState();
}

function scrollOuterToTop() {
  shellScrollHost.value?.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollOuterToBottom() {
  const host = shellScrollHost.value;
  if (!host) {
    return;
  }

  host.scrollTo({ top: host.scrollHeight, behavior: 'smooth' });
}

const projectId = computed(() => String(route.params.projectId ?? ''));
const detail = computed(() =>
  projectsStore.detail?.project.id === projectId.value
    ? projectsStore.detail
    : null,
);
const selectedProject = computed(() => detail.value?.project ?? null);
const liveProjectTasks = computed(() =>
  tasksStore.tasks.filter((task) => task.projectId === projectId.value),
);
const recentJobs = computed(() => {
  const snapshotJobs = detail.value?.recentJobs ?? [];
  const liveJobMap = new Map(
    liveProjectTasks.value.map((task) => [task.id, task]),
  );

  const mergedJobs = snapshotJobs.map(
    (task) => liveJobMap.get(task.id) ?? task,
  );
  const knownJobIds = new Set(mergedJobs.map((task) => task.id));
  const appendedLiveJobs = liveProjectTasks.value.filter(
    (task) => !knownJobIds.has(task.id),
  );

  return [...mergedJobs, ...appendedLiveJobs].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
});
const recentTaskSummary = computed(
  () =>
    recentJobs.value[0]?.summary ??
    selectedProject.value?.stats.lastTaskSummary ??
    '尚未启动任务',
);
const currentScanTask = computed(
  () =>
    tasksStore.tasks.find(
      (task) =>
        task.projectId === projectId.value &&
        task.kind === 'scan' &&
        ['queued', 'running', 'paused'].includes(task.status),
    ) ?? null,
);
const hasActiveScanTask = computed(() => Boolean(currentScanTask.value));
const currentGradingTask = computed(
  () =>
    tasksStore.tasks.find(
      (task) =>
        task.projectId === projectId.value &&
        task.kind === 'grading' &&
        ['queued', 'running', 'paused'].includes(task.status),
    ) ?? null,
);
const hasActiveGradingTask = computed(() => Boolean(currentGradingTask.value));
const currentResultPdfExportTask = computed(
  () =>
    tasksStore.tasks.find(
      (task) =>
        task.projectId === projectId.value &&
        task.kind === 'result-pdf-export' &&
        ['queued', 'running', 'paused'].includes(task.status),
    ) ?? null,
);
const visualizerSourceTask = computed(
  () =>
    currentGradingTask.value ??
    recentJobs.value.find(
      (task) =>
        task.kind === 'grading' &&
        (task.streamPreviewText.trim().length > 0 ||
          task.streamReasoningText.trim().length > 0),
    ) ??
    null,
);
const results = computed(() =>
  (detail.value?.results ?? []).filter(
    (
      item,
    ): item is ResultRecord & {
      finalResult: FinalResult;
      modelResult: NonNullable<ResultRecord['modelResult']>;
    } => Boolean(item.finalResult && item.modelResult),
  ),
);
const papers = computed(() => detail.value?.originals ?? []);
const gradedPaperIds = computed(
  () => new Set(results.value.map((item) => item.paperId)),
);
const ungradedPapers = computed(() =>
  papers.value.filter((paper) => !gradedPaperIds.value.has(paper.id)),
);
const paperOrderMap = computed(
  () => new Map(papers.value.map((paper, index) => [paper.id, index])),
);
const resultSortOptions = [
  { label: '按录入顺序', value: 'input-order' },
  { label: '按分数由高到低', value: 'score-desc' },
  { label: '按分数由低到高', value: 'score-asc' },
  { label: '按学号排序', value: 'student-id' },
  { label: '按未核对名优先', value: 'unverified-first' },
  { label: '按已核名优先', value: 'verified-first' },
];
const gradedResultEntries = computed(() =>
  results.value
    .map((item) => {
      const paper =
        papers.value.find((paperItem) => paperItem.id === item.paperId) ?? null;

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
      const leftPaperOrder =
        paperOrderMap.value.get(left.result.paperId) ?? Number.MAX_SAFE_INTEGER;
      const rightPaperOrder =
        paperOrderMap.value.get(right.result.paperId) ??
        Number.MAX_SAFE_INTEGER;
      const fallback =
        leftPaperOrder - rightPaperOrder ||
        left.paperLabel.localeCompare(right.paperLabel, 'zh-CN');

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
          return (
            leftStudentId.localeCompare(rightStudentId, 'zh-CN', {
              numeric: true,
            }) || fallback
          );
        }

        if (leftStudentId) {
          return -1;
        }

        if (rightStudentId) {
          return 1;
        }
      }

      if (resultSortMode.value === 'unverified-first') {
        const leftPriority = left.result.nameMatchStatus === 'verified' ? 1 : 0;
        const rightPriority =
          right.result.nameMatchStatus === 'verified' ? 1 : 0;
        return leftPriority - rightPriority || fallback;
      }

      if (resultSortMode.value === 'verified-first') {
        const leftPriority = left.result.nameMatchStatus === 'verified' ? 0 : 1;
        const rightPriority =
          right.result.nameMatchStatus === 'verified' ? 0 : 1;
        return leftPriority - rightPriority || fallback;
      }

      return fallback;
    }),
);
const normalizedResultSearchKeyword = computed(() =>
  normalizeResultSearchText(resultSearchKeyword.value),
);
const reviewResultEntries = computed(() =>
  gradedResultEntries.value.filter((entry) =>
    matchesResultSearch(entry, normalizedResultSearchKeyword.value),
  ),
);
const reviewUngradedPapers = computed(() =>
  ungradedPapers.value.filter((paper) =>
    normalizeResultSearchText(paper.paperCode ?? '').includes(
      normalizedResultSearchKeyword.value,
    ),
  ),
);
const selectableResultEntries = computed(() =>
  activeTab.value === 'results'
    ? reviewResultEntries.value
    : gradedResultEntries.value,
);
const latestPostProcessRun = computed(
  () =>
    scorePostProcessSnapshot.value?.projectId === projectId.value
      ? scorePostProcessSnapshot.value.latestRun
      : null,
);
const latestPostProcessScoreMap = computed(
  () =>
    new Map(
      (latestPostProcessRun.value?.results ?? []).map((item) => [
        item.paperId,
        item.processedScore,
      ]),
    ),
);
const hasPostProcessedScores = computed(() =>
  latestPostProcessRun.value?.results.some((item) =>
    Number.isFinite(item.processedScore),
  ),
);
const statisticsScoreOptions = computed(() => {
  const options: Array<{
    label: string;
    value: 'original' | 'post-processed';
  }> = [
    { label: '原始分数', value: 'original' as const },
  ];

  if (hasPostProcessedScores.value) {
    options.push({ label: '后处理分数', value: 'post-processed' as const });
  }

  return options;
});
const statisticsScoreEntries = computed(() =>
  gradedResultEntries.value.map((entry) => {
    const originalScore = entry.displayScore;
    const postProcessedScore =
      latestPostProcessScoreMap.value.get(entry.result.paperId) ?? null;

    return {
      ...entry,
      originalScore,
      postProcessedScore,
      statisticsScore:
        statisticsScoreMode.value === 'post-processed' && postProcessedScore != null
          ? postProcessedScore
          : originalScore,
    };
  }),
);
const scoreValues = computed(() =>
  statisticsScoreEntries.value.map((entry) => entry.statisticsScore),
);
const scoreStats = computed(() => {
  const scores = scoreValues.value;
  if (!scores.length) {
    return {
      count: 0,
      average: 0,
      max: 0,
      min: 0,
      variance: 0,
      standardDeviation: 0,
    };
  }

  const sum = scores.reduce((total, score) => total + score, 0);
  const average = sum / scores.length;
  const variance =
    scores.reduce((total, score) => total + (score - average) ** 2, 0) /
    scores.length;

  return {
    count: scores.length,
    average,
    max: Math.max(...scores),
    min: Math.min(...scores),
    variance,
    standardDeviation: Math.sqrt(variance),
  };
});
const questionStats = computed(() => {
  const questionMap = new Map<
    string,
    {
      questionId: string;
      questionTitle: string;
      maxScore: number;
      correctCount: number;
      totalCount: number;
    }
  >();

  for (const entry of gradedResultEntries.value) {
    for (const question of entry.result.finalResult.questionScores) {
      const current =
        questionMap.get(question.questionId) ??
        {
          questionId: question.questionId,
          questionTitle: question.questionTitle,
          maxScore: question.maxScore,
          correctCount: 0,
          totalCount: 0,
        };

      current.totalCount += 1;
      if (question.score >= question.maxScore) {
        current.correctCount += 1;
      }
      questionMap.set(question.questionId, current);
    }
  }

  return [...questionMap.values()]
    .map((item) => ({
      ...item,
      correctRate: item.totalCount
        ? (item.correctCount / item.totalCount) * 100
        : 0,
    }))
    .sort((left, right) =>
      left.questionId.localeCompare(right.questionId, 'zh-CN', {
        numeric: true,
      }),
    );
});
const scoreDistribution = computed(() => {
  const scores = scoreValues.value;
  if (!scores.length) {
    return [] as Array<{ score: number; count: number }>;
  }

  const bucketMap = new Map<number, number>();
  for (const score of scores) {
    const bucket = Math.round(score);
    bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + 1);
  }

  return [...bucketMap.entries()]
    .map(([score, count]) => ({ score, count }))
    .sort((left, right) => left.score - right.score);
});
const exportAllPdfsButtonText = computed(() => {
  const task = currentResultPdfExportTask.value;
  if (!exportAllPdfsLoading.value && !task) {
    return '批量导出 PDF';
  }

  if (!task) {
    return '正在导出 PDF';
  }

  return `正在导出 ${Math.round(task.progress * 100)}%`;
});

function formatStatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function renderScoreDistributionChart() {
  const chartHost = scoreDistributionChartRef.value;
  if (!chartHost) {
    return;
  }

  if (
    scoreDistributionChart &&
    scoreDistributionChart.getDom() !== chartHost
  ) {
    scoreDistributionChart.dispose();
    scoreDistributionChart = null;
  }

  scoreDistributionChart ??= echarts.init(chartHost);
  const distribution = scoreDistribution.value;
  const minScore = distribution.length
    ? Math.min(...distribution.map((item) => item.score))
    : 0;
  const maxScore = distribution.length
    ? Math.max(...distribution.map((item) => item.score))
    : 100;
  const option: ScoreDistributionChartOption = {
    color: ['#0f8b8d'],
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params;
        const value = Array.isArray(item.value) ? item.value : [item.name, item.value];
        return `总分：${value[0]}<br />人数：${value[1]}`;
      },
    },
    grid: {
      left: 40,
      right: 22,
      top: 28,
      bottom: 34,
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      name: '分数',
      min: minScore - 1,
      max: maxScore + 1,
      interval:
        maxScore - minScore <= 10
          ? 1
          : Math.max(Math.ceil((maxScore - minScore) / 10), 1),
      axisLine: { lineStyle: { color: '#b8c4d1' } },
      axisLabel: { color: '#5f7388' },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: '#5f7388' },
      splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.2)' } },
    },
    series: [
      {
        name: '人数',
        type: 'line',
        smooth: true,
        symbolSize: 8,
        data: distribution.map((item) => [item.score, item.count]),
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(15, 139, 141, 0.28)' },
              { offset: 1, color: 'rgba(15, 139, 141, 0.02)' },
            ],
          },
        },
        lineStyle: { width: 3 },
      },
    ],
  };

  scoreDistributionChart.setOption(option, true);
}

function resizeScoreDistributionChart() {
  scoreDistributionChart?.resize();
}

async function loadScorePostProcessSnapshot() {
  if (!projectId.value) {
    return;
  }

  await scorePostProcessStore.loadProjectSnapshot(projectId.value);
}

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
    cacheKey: page.debugPreviewPath
      ? page.debugPreviewVersion
      : page.originalVersion,
    title: `${paper.paperCode} · 边界图 ${index + 1}`,
    caption: page.debugPreviewPath ? '已生成边界预览' : '等待扫描',
  };
}

const allOriginalPreviewImages = computed<PreviewImageItem[]>(() =>
  papers.value.flatMap((paper) =>
    paper.originalPages.map((page, index) =>
      buildOriginalPreviewImage(paper, page, index),
    ),
  ),
);
const allScannedPreviewImages = computed<PreviewImageItem[]>(() =>
  papers.value.flatMap((paper) =>
    paper.originalPages.map((page, index) =>
      buildScannedPreviewImage(paper, page, index),
    ),
  ),
);
const allDebugPreviewImages = computed<PreviewImageItem[]>(() =>
  papers.value.flatMap((paper) =>
    paper.originalPages.map((page, index) =>
      buildDebugPreviewImage(paper, page, index),
    ),
  ),
);
const latestReferenceAnswerVersion = computed(
  () => selectedProject.value?.referenceAnswerVersion ?? 1,
);
const rubricDebug = computed(() =>
  projectsStore.rubricDebug?.projectId === projectId.value
    ? projectsStore.rubricDebug
    : null,
);
const showRubricDebugTab = computed(() => debugPanelStore.enabled);
const referenceAnswerDirty = computed(
  () => referenceAnswerDraft.value !== savedReferenceAnswerMarkdown.value,
);
const normalizedProjectRosterDraft = computed(() => {
  const currentRoster = projectSettingsDraft.value.studentRoster;
  if (!currentRoster?.rawText.trim()) {
    return null;
  }

  return {
    rawText: currentRoster.rawText,
    columnFields: currentRoster.columnFields,
    entries: currentRoster.entries,
  };
});
const serializedProjectRosterDraft = computed(() =>
  JSON.stringify(normalizedProjectRosterDraft.value),
);
const projectSettingsDirty = computed(() => {
  if (!selectedProject.value) {
    return false;
  }

  const current = selectedProject.value;
  return (
    projectNameDraft.value !== current.name ||
    projectSettingsDraft.value.gradingConcurrency !==
      current.settings.gradingConcurrency ||
    projectSettingsDraft.value.drawRegions !== current.settings.drawRegions ||
    projectSettingsDraft.value.defaultImageDetail !==
      current.settings.defaultImageDetail ||
    projectSettingsDraft.value.enableScanPostProcess !==
      current.settings.enableScanPostProcess ||
    projectSettingsDraft.value.skipScanProcessing !==
      current.settings.skipScanProcessing ||
    projectSettingsDraft.value.scanMarginRatio !==
      current.settings.scanMarginRatio ||
    serializedProjectRosterDraft.value !==
      JSON.stringify(current.settings.studentRoster ?? null)
  );
});
const projectRosterDraftText = computed({
  get: () => projectSettingsDraft.value.studentRoster?.rawText ?? '',
  set: (value: string) => {
    const currentRoster = projectSettingsDraft.value.studentRoster;
    if (!value.trim() && !(currentRoster?.entries.length ?? 0)) {
      projectSettingsDraft.value.studentRoster = null;
      return;
    }
    projectSettingsDraft.value.studentRoster = {
      rawText: value,
      columnFields: currentRoster?.columnFields ?? [],
      entries: currentRoster?.entries ?? [],
    };
  },
});
const parsedProjectRoster = computed(() =>
  parseStudentRosterText(projectRosterDraftText.value),
);
const projectRosterColumnFields = computed({
  get: () => {
    const currentFields =
      projectSettingsDraft.value.studentRoster?.columnFields;
    if (!parsedProjectRoster.value.columnCount) {
      return [];
    }
    if (currentFields?.length === parsedProjectRoster.value.columnCount) {
      return normalizeStudentRosterColumnFields(
        parsedProjectRoster.value.columnCount,
        currentFields,
      );
    }
    return detectStudentRosterColumnFields(parsedProjectRoster.value);
  },
  set: (value: StudentRosterColumnField[]) => {
    const nextColumnFields = normalizeStudentRosterColumnFields(
      parsedProjectRoster.value.columnCount,
      value,
    );
    const currentRoster = projectSettingsDraft.value.studentRoster;
    if (!currentRoster?.rawText.trim()) {
      projectSettingsDraft.value.studentRoster = null;
      return;
    }
    projectSettingsDraft.value.studentRoster = {
      rawText: currentRoster?.rawText ?? '',
      columnFields: nextColumnFields,
      entries: currentRoster?.entries ?? [],
    };
  },
});
const projectRosterPreviewEntries = computed(
  () =>
    buildStudentRosterData(
      projectRosterDraftText.value,
      projectRosterColumnFields.value,
    )?.entries ?? [],
);
const savedProjectRosterEntries = computed<StudentRosterEntry[]>(
  () => selectedProject.value?.settings.studentRoster?.entries ?? [],
);
const defaultSmartNameRosterText = computed(() => {
  if (!savedProjectRosterEntries.value.length) {
    return '';
  }

  return [
    '班级 学号 姓名',
    ...savedProjectRosterEntries.value.map(
      (entry) => `${entry.className} ${entry.studentId} ${entry.name}`,
    ),
  ].join('\n');
});
const selectedResultUsesLatestReference = computed(() => {
  if (!selectedResult.value) {
    return true;
  }
  return (
    selectedResult.value.referenceAnswerVersion ===
    latestReferenceAnswerVersion.value
  );
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
const smartNameMatchIsRunning = computed(
  () => smartNameMatchState.value.status === 'running',
);
const smartNameMatchHasResult = computed(() =>
  Boolean(smartNameMatchState.value.result),
);
const smartNameLayoutShouldExpandLogs = computed(
  () =>
    smartNameWorkspaceMode.value === 'auto' &&
    smartNameMatchIsRunning.value &&
    !smartNameMatchHasResult.value,
);
const smartNameMatchSuggestions = computed<SmartNameMatchSuggestion[]>(
  () => smartNameMatchState.value.result?.suggestions ?? [],
);
const smartNameMatchCertainSuggestions = computed(() =>
  smartNameMatchSuggestions.value.filter(
    (item) =>
      item.decision === 'certain_update' || item.decision === 'certain_keep',
  ),
);
const smartNameMatchCertainUpdateSuggestions = computed(() =>
  smartNameMatchSuggestions.value.filter(
    (item) => item.decision === 'certain_update',
  ),
);
const smartNameMatchCertainKeepSuggestions = computed(() =>
  smartNameMatchSuggestions.value.filter(
    (item) => item.decision === 'certain_keep',
  ),
);
const verifiedResultCount = computed(
  () =>
    results.value.filter((item) => item.nameMatchStatus === 'verified').length,
);
const unverifiedResultCount = computed(
  () =>
    results.value.filter((item) => item.nameMatchStatus !== 'verified').length,
);
const smartNameMatchUncertainSuggestions = computed(() =>
  smartNameMatchSuggestions.value.filter(
    (item) => item.decision === 'uncertain' || item.decision === 'no_match',
  ),
);
const simpleSmartNameDuplicateCheck = computed(() => {
  const nameGroups = new Map<
    string,
    Array<{
      paperId: string;
      paperCode: string;
      studentName: string;
      studentId: string;
      className: string;
    }>
  >();
  const studentIdGroups = new Map<
    string,
    Array<{
      paperId: string;
      paperCode: string;
      studentName: string;
      studentId: string;
      className: string;
    }>
  >();

  gradedResultEntries.value.forEach((entry) => {
    const studentName = entry.studentName.trim();
    const studentId = entry.studentId.trim();
    const className = entry.className.trim();
    const item = {
      paperId: entry.result.paperId,
      paperCode: entry.paperLabel,
      studentName,
      studentId,
      className,
    };

    if (studentName) {
      const bucket = nameGroups.get(studentName) ?? [];
      bucket.push(item);
      nameGroups.set(studentName, bucket);
    }

    if (studentId) {
      const bucket = studentIdGroups.get(studentId) ?? [];
      bucket.push(item);
      studentIdGroups.set(studentId, bucket);
    }
  });

  const duplicateNames = Array.from(nameGroups.entries())
    .filter(([, items]) => items.length > 1)
    .map(([value, items]) => ({
      value,
      items,
    }))
    .sort((left, right) => right.items.length - left.items.length);
  const duplicateStudentIds = Array.from(studentIdGroups.entries())
    .filter(([, items]) => items.length > 1)
    .map(([value, items]) => ({
      value,
      items,
    }))
    .sort((left, right) => right.items.length - left.items.length);

  return {
    duplicateNames,
    duplicateStudentIds,
    duplicateNamePaperCount: duplicateNames.reduce(
      (sum, group) => sum + group.items.length,
      0,
    ),
    duplicateStudentIdPaperCount: duplicateStudentIds.reduce(
      (sum, group) => sum + group.items.length,
      0,
    ),
    hasIssue: duplicateNames.length > 0 || duplicateStudentIds.length > 0,
  };
});
const smartNameMatchHasPreview = computed(() =>
  Boolean(smartNameMatchState.value.previewText.trim()),
);
const selectedResult = computed<ResultRecord | null>(() => {
  const selectedEntry = selectableResultEntries.value.find(
    (entry) => entry.result.id === selectedResultId.value,
  );
  return (
    selectedEntry?.result ?? selectableResultEntries.value[0]?.result ?? null
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
      .reduce(
        (sum, question) =>
          sum + (typeof question.score === 'number' ? question.score : 0),
        0,
      )
      .toFixed(2),
  );
});

function formatScoreValue(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatScoreBreakdownBadge(point: ScoreBreakdownItem): string {
  return `${formatScoreValue(point.score)}/${formatScoreValue(point.maxScore)}`;
}

function formatRegionScore(
  score?: number | null,
  maxScore?: number | null,
): string {
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
  () =>
    selectedProject.value
      ? {
          id: selectedProject.value.id,
          name: selectedProject.value.name,
          settings: selectedProject.value.settings,
        }
      : null,
  (nextProject) => {
    if (!nextProject) {
      projectNameDraft.value = '';
      projectSettingsDraftProjectId.value = '';
      projectSettingsDraft.value = cloneProjectSettings({
        gradingConcurrency: 1,
        drawRegions: false,
        defaultImageDetail: 'high',
        enableScanPostProcess: true,
        skipScanProcessing: false,
        scanMarginRatio: 1,
        studentRoster: null,
      });
      return;
    }

    const switchedProject =
      projectSettingsDraftProjectId.value !== nextProject.id;
    if (
      switchedProject ||
      (!projectSettingsDirty.value && !projectSettingsSaving.value)
    ) {
      projectSettingsDraftProjectId.value = nextProject.id;
      projectNameDraft.value = nextProject.name;
      projectSettingsDraft.value = cloneProjectSettings(nextProject.settings);
    }
  },
  { immediate: true, deep: true },
);

watch(
  () =>
    [
      detail.value?.project.id ?? '',
      detail.value?.referenceAnswerMarkdown ?? '',
    ] as const,
  ([nextProjectId, nextMarkdown]) => {
    if (!nextProjectId) {
      referenceAnswerDraft.value = '';
      savedReferenceAnswerMarkdown.value = '';
      referenceAnswerDraftProjectId.value = '';
      return;
    }

    if (referenceAnswerDraftProjectId.value !== nextProjectId) {
      referenceAnswerDraft.value = nextMarkdown;
      savedReferenceAnswerMarkdown.value = nextMarkdown;
      referenceAnswerDraftProjectId.value = nextProjectId;
      return;
    }

    if (
      !referenceAnswerDirty.value ||
      nextMarkdown === referenceAnswerDraft.value
    ) {
      referenceAnswerDraft.value = nextMarkdown;
      savedReferenceAnswerMarkdown.value = nextMarkdown;
    }
  },
  { immediate: true },
);

watch(
  () => selectableResultEntries.value,
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

function normalizeResultSearchText(value: string): string {
  return normalizeSearchText(value.trim());
}

function matchesResultSearch(
  entry: (typeof gradedResultEntries.value)[number],
  keyword: string,
): boolean {
  if (!keyword) {
    return true;
  }

  const nameSearchKeys = getNameSearchKeys(entry.studentName);

  return [
    entry.paperLabel,
    entry.studentId,
    entry.className,
    nameSearchKeys.text,
    nameSearchKeys.fullPinyin,
    nameSearchKeys.initials,
  ].some((field) => normalizeResultSearchText(field ?? '').includes(keyword));
}

watch(
  () => selectedResult.value,
  (value) => {
    editableResult.value = value?.finalResult
      ? cloneFinalResult(value.finalResult)
      : null;
    expandedQuestionIds.value = [];
    markResultAsVerifiedOnSave.value = true;
  },
  { immediate: true },
);

watch(
  () => smartNameManualResult.value,
  (value) => {
    manualSmartNameDraft.value = value?.finalResult
      ? cloneFinalResult(value.finalResult)
      : null;
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
  () =>
    editableResult.value?.questionScores.map((question) => question.score) ??
    [],
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
    previewDisplayOptions.value =
      loadStoredPreviewDisplayOptions(nextProjectId);
  },
  { immediate: true },
);

watch(
  previewDisplayOptions,
  async (displayOptions) => {
    const plainDisplayOptions = toPlainPreviewDisplayOptions(displayOptions);
    persistPreviewDisplayOptions(projectId.value, plainDisplayOptions);
    await window.neuromark.preview.setDisplayOptions(null, plainDisplayOptions);
  },
  { deep: true },
);

watch(
  () => [activeTab.value, isReviewScrollActive.value] as const,
  ([tab, reviewScrollActive]) => {
    setShellScrollLocked(
      (tab === 'results' || tab === 'smart-name-match') && reviewScrollActive,
    );
    void refreshOuterScrollState();
  },
  { immediate: true },
);

watch(
  () => smartNameMatchState.value.reasoningText,
  async () => {
    visualizerStore.syncText(
      `smart-name-match:${projectId.value}`,
      'reasoning',
      smartNameMatchState.value.reasoningText,
    );
    if (!smartNameMatchIsRunning.value || smartNameMatchHasPreview.value) {
      return;
    }
    await Promise.resolve();
    if (smartNameReasoningRef.value) {
      smartNameReasoningRef.value.scrollTop =
        smartNameReasoningRef.value.scrollHeight;
    }
  },
);

watch(
  () => smartNameMatchState.value.previewText,
  async () => {
    visualizerStore.syncText(
      `smart-name-match:${projectId.value}`,
      'preview',
      smartNameMatchState.value.previewText,
    );
    if (!smartNameMatchIsRunning.value || !smartNameMatchHasPreview.value) {
      return;
    }
    await Promise.resolve();
    if (smartNamePreviewRef.value) {
      smartNamePreviewRef.value.scrollTop =
        smartNamePreviewRef.value.scrollHeight;
    }
  },
);

watch(
  () => visualizerSourceTask.value?.streamReasoningText ?? '',
  (nextText) => {
    visualizerStore.syncText(
      `grading-task:${visualizerSourceTask.value?.id ?? projectId.value}`,
      'reasoning',
      nextText,
    );
  },
  { immediate: true },
);

watch(
  () => visualizerSourceTask.value?.streamPreviewText ?? '',
  (nextText) => {
    visualizerStore.syncText(
      `grading-task:${visualizerSourceTask.value?.id ?? projectId.value}`,
      'preview',
      nextText,
    );
  },
  { immediate: true },
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

watch(
  hasPostProcessedScores,
  (value) => {
    if (!value && statisticsScoreMode.value === 'post-processed') {
      statisticsScoreMode.value = 'original';
    }
  },
  { immediate: true },
);

watch(
  [scoreDistribution, activeTab],
  async () => {
    if (activeTab.value !== 'statistics-export') {
      return;
    }
    await nextTick();
    renderScoreDistributionChart();
    scoreDistributionChart?.resize();
  },
  { deep: true },
);

onMounted(async () => {
  window.addEventListener('afterprint', restoreResultPrintMode);
  window.addEventListener('resize', updateOuterScrollState);
  window.addEventListener('resize', resizeScoreDistributionChart);
  await debugPanelStore.initialize();
  smartNameMatchUnsubscribe = window.neuromark.results.onSmartNameMatchUpdated(
    (snapshot) => {
      if (snapshot.projectId === projectId.value) {
        smartNameMatchSnapshot.value = snapshot;
        if (!smartNameRosterText.value.trim()) {
          smartNameRosterText.value = resolveSmartNameRosterText(
            snapshot.rosterText,
          );
        }
      }
    },
  );

  if (projectsStore.projects.length === 0) {
    await projectsStore.bootstrap();
  }

  await loadScorePostProcessSnapshot();
  await refreshOuterScrollState();
});

onBeforeUnmount(() => {
  window.removeEventListener('afterprint', restoreResultPrintMode);
  window.removeEventListener('resize', updateOuterScrollState);
  window.removeEventListener('resize', resizeScoreDistributionChart);
  restoreResultPrintMode();
  scoreDistributionChart?.dispose();
  scoreDistributionChart = null;
  smartNameMatchUnsubscribe?.();
  smartNameMatchUnsubscribe = null;
  smartNameContextMenu.value.visible = false;
  detachShellScrollHost();
  if (lockedShellContent) {
    lockedShellContent.classList.remove('shell-content--scroll-locked');
    lockedShellContent = null;
  }
});

watch(projectId, () => {
  void loadScorePostProcessSnapshot();
  void refreshOuterScrollState();
});

watch(
  () =>
    [
      activeTab.value,
      selectedProject.value?.id ?? '',
      detail.value?.recentJobs.length ?? 0,
      papers.value.length,
      results.value.length,
      reviewResultEntries.value.length,
      reviewUngradedPapers.value.length,
      selectedResultId.value,
      isResultPrintMode.value,
    ] as const,
  () => {
    void refreshOuterScrollState();
  },
);

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
      projectsStore.clearSelection();
      smartNameMatchSnapshot.value = null;
      smartNameRosterText.value = '';
      return;
    }

    await projectsStore.selectProject(nextProjectId);

    const snapshot =
      await window.neuromark.results.getSmartNameMatchSnapshot(nextProjectId);
    if (projectId.value !== nextProjectId) {
      return;
    }

    smartNameMatchSnapshot.value = snapshot;
    smartNameRosterText.value = resolveSmartNameRosterText(snapshot.rosterText);

    if (showRubricDebugTab.value) {
      await loadRubricDebug();
    }
  },
  { immediate: true },
);

watch(
  projectId,
  async (nextProjectId) => {
    if (!nextProjectId) {
      smartNameMatchSnapshot.value = null;
      smartNameRosterText.value = '';
      return;
    }

    const snapshot =
      await window.neuromark.results.getSmartNameMatchSnapshot(nextProjectId);
    smartNameMatchSnapshot.value = snapshot;
    smartNameRosterText.value = resolveSmartNameRosterText(snapshot.rosterText);
  },
  { immediate: false },
);

watch(
  defaultSmartNameRosterText,
  (nextDefaultText) => {
    if (
      !smartNameRosterText.value.trim() &&
      !(smartNameMatchSnapshot.value?.rosterText.trim() ?? '')
    ) {
      smartNameRosterText.value = nextDefaultText;
    }
  },
  { immediate: true },
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
  if (!selectedProject.value || importActionLoading.value) {
    return;
  }
  importActionLoading.value = true;
  try {
    const files = await window.neuromark.app.selectImages();
    if (files.length === 0) {
      return;
    }
    const result = await projectsStore.importOriginalImages(
      selectedProject.value.id,
      files,
    );
    message.success(
      `已导入 ${result.addedPaperCount} 份试卷，共 ${result.addedPageCount} 页。`,
    );
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导入图片失败。');
  } finally {
    importActionLoading.value = false;
  }
}

async function importImageDirectory() {
  if (!selectedProject.value || importActionLoading.value) {
    return;
  }
  importActionLoading.value = true;
  try {
    const directoryPath =
      await window.neuromark.app.selectPaperImageDirectory();
    if (!directoryPath) {
      return;
    }
    const result = await projectsStore.importOriginalImageDirectory(
      selectedProject.value.id,
      directoryPath,
    );
    message.success(
      `已从文件夹导入 ${result.addedPaperCount} 份试卷，共 ${result.addedPageCount} 页。`,
    );
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导入文件夹失败。');
  } finally {
    importActionLoading.value = false;
  }
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
  if (
    !selectedProject.value ||
    scanActionLoading.value ||
    hasActiveScanTask.value
  ) {
    return;
  }
  scanActionLoading.value = true;
  try {
    await window.neuromark.scan.start(selectedProject.value.id, {
      skipCompleted: true,
    });
    await Promise.all([
      tasksStore.refresh(),
      projectsStore.loadProjectDetail(selectedProject.value.id),
    ]);
    message.success('扫描任务已开始。');
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '启动扫描任务失败。',
    );
  } finally {
    scanActionLoading.value = false;
  }
}

async function forceRescan() {
  if (
    !selectedProject.value ||
    scanActionLoading.value ||
    hasActiveScanTask.value
  ) {
    return;
  }
  scanActionLoading.value = true;
  try {
    await window.neuromark.scan.start(selectedProject.value.id, {
      skipCompleted: false,
    });
    await Promise.all([
      tasksStore.refresh(),
      projectsStore.loadProjectDetail(selectedProject.value.id),
    ]);
    message.success('重新扫描任务已开始。');
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '启动重新扫描任务失败。',
    );
  } finally {
    scanActionLoading.value = false;
  }
}

async function stopScan() {
  if (
    !selectedProject.value ||
    scanActionLoading.value ||
    !currentScanTask.value
  ) {
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
    message.error(
      error instanceof Error ? error.message : '停止扫描任务失败。',
    );
  } finally {
    scanActionLoading.value = false;
  }
}

async function startGrading() {
  if (
    !selectedProject.value ||
    gradingActionLoading.value ||
    hasActiveGradingTask.value
  ) {
    return;
  }
  gradingActionLoading.value = true;
  try {
    await window.neuromark.grading.start(selectedProject.value.id, {
      skipCompleted: true,
    });
    await Promise.all([
      tasksStore.refresh(),
      projectsStore.loadProjectDetail(selectedProject.value.id),
    ]);
    message.success('批阅任务已开始。');
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '启动批阅任务失败。',
    );
  } finally {
    gradingActionLoading.value = false;
  }
}

async function stopGrading() {
  if (
    !selectedProject.value ||
    gradingActionLoading.value ||
    !currentGradingTask.value
  ) {
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
    message.error(
      error instanceof Error ? error.message : '停止批阅任务失败。',
    );
  } finally {
    gradingActionLoading.value = false;
  }
}

async function exportResults() {
  if (!selectedProject.value) {
    return;
  }

  exportScope.value = 'graded';
  exportDialogVisible.value = true;
}

function normalizeExportFileName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-');

  return normalized || 'neuromark-project';
}

function sanitizeResultPdfFileNamePart(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSelectedResultPdfBaseName(): string {
  const paperFallback = sanitizeResultPdfFileNamePart(
    selectedPaper.value?.paperCode ?? '批阅结果',
  );
  const studentInfo = editableResult.value?.studentInfo;
  const shouldUseVerifiedStudentInfo =
    selectedResult.value?.nameMatchStatus === 'verified' ||
    editableStudentInfoChanged.value;

  if (!shouldUseVerifiedStudentInfo || !studentInfo) {
    return paperFallback;
  }

  const verifiedParts = [
    studentInfo.name,
    studentInfo.studentId,
    studentInfo.className,
  ]
    .map((item) => sanitizeResultPdfFileNamePart(item))
    .filter(Boolean);

  return verifiedParts.join('_') || paperFallback;
}

async function applySelectedResultPrintTitle(): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }

  if (resultPrintDocumentTitleBeforePrint == null) {
    resultPrintDocumentTitleBeforePrint = document.title;
  }

  const nextTitle = buildSelectedResultPdfBaseName();
  document.title = nextTitle;
  await window.neuromark.app.setMainWindowTitle(nextTitle);
}

async function restoreSelectedResultPrintTitle(): Promise<void> {
  if (
    typeof document === 'undefined' ||
    resultPrintDocumentTitleBeforePrint == null
  ) {
    return;
  }

  document.title = resultPrintDocumentTitleBeforePrint;
  await window.neuromark.app.setMainWindowTitle(
    resultPrintDocumentTitleBeforePrint,
  );
  resultPrintDocumentTitleBeforePrint = null;
}

function buildExportDefaultFileName(
  projectName: string,
  scope: ResultExportScope,
): string {
  const safeName = normalizeExportFileName(projectName);
  return scope === 'graded-and-verified'
    ? `${safeName}-verified-results.json`
    : `${safeName}-results.json`;
}

const exportScopeOptions = [
  {
    label: '全部已经批改',
    value: 'graded',
    description: '导出所有已生成批阅结果的试卷，无论是否完成核名。',
  },
  {
    label: '全部已经批改且核名',
    value: 'graded-and-verified',
    description: '只导出已批改且核名状态为“已核名”的试卷。',
  },
];

async function confirmExportResults() {
  if (!selectedProject.value || exportJsonLoading.value) {
    return;
  }

  const defaultFileName = buildExportDefaultFileName(
    selectedProject.value.name,
    exportScope.value,
  );
  const targetPath =
    await window.neuromark.app.selectJsonSavePath(defaultFileName);
  if (!targetPath) {
    return;
  }

  exportJsonLoading.value = true;
  try {
    const outputPath = await projectsStore.exportResults(
      selectedProject.value.id,
      {
        scope: exportScope.value,
        targetPath,
      } satisfies ExportResultsOptions,
    );
    exportDialogVisible.value = false;
    message.success(`JSON 已导出到 ${outputPath}`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出 JSON 失败。');
  } finally {
    exportJsonLoading.value = false;
  }
}

async function exportResultsExcel() {
  if (!selectedProject.value || exportExcelLoading.value) {
    return;
  }

  const defaultFileName = `${normalizeExportFileName(
    selectedProject.value.name,
  )}-scores.xlsx`;
  const targetPath =
    await window.neuromark.app.selectExcelSavePath(defaultFileName);
  if (!targetPath) {
    return;
  }

  exportExcelLoading.value = true;
  try {
    const outputPath = await projectsStore.exportResultsExcel(
      selectedProject.value.id,
      { targetPath },
    );
    message.success(`Excel 已导出到 ${outputPath}`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '导出 Excel 失败。');
  } finally {
    exportExcelLoading.value = false;
  }
}

async function exportQuestionAccuracyExcel() {
  if (!selectedProject.value || exportQuestionAccuracyExcelLoading.value) {
    return;
  }

  const defaultFileName = `${normalizeExportFileName(
    selectedProject.value.name,
  )}-question-accuracy.xlsx`;
  const targetPath =
    await window.neuromark.app.selectExcelSavePath(defaultFileName);
  if (!targetPath) {
    return;
  }

  exportQuestionAccuracyExcelLoading.value = true;
  try {
    const outputPath = await projectsStore.exportQuestionAccuracyExcel(
      selectedProject.value.id,
      { targetPath },
    );
    message.success(`小题正确率 Excel 已导出到 ${outputPath}`);
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '导出小题正确率 Excel 失败。',
    );
  } finally {
    exportQuestionAccuracyExcelLoading.value = false;
  }
}

async function exportAllResultPdfs() {
  if (
    !selectedProject.value ||
    exportAllPdfsLoading.value ||
    currentResultPdfExportTask.value
  ) {
    return;
  }

  const targetDirectory = await window.neuromark.app.selectExportDirectory();
  if (!targetDirectory) {
    return;
  }

  exportAllPdfsLoading.value = true;

  try {
    await projectsStore.exportAllPdfs(selectedProject.value.id, {
      targetDirectory,
    });
    await tasksStore.refresh();
    message.success('批量 PDF 导出任务已在后台开始。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '批量导出 PDF 失败。');
  } finally {
    exportAllPdfsLoading.value = false;
  }
}

async function stopResultPdfExport() {
  const task = currentResultPdfExportTask.value;
  if (!task || stoppingResultPdfExport.value) {
    return;
  }

  stoppingResultPdfExport.value = true;
  try {
    await window.neuromark.grading.cancel(task.id);
    await tasksStore.refresh();
    message.success('PDF 导出任务已停止。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '停止 PDF 导出失败。');
  } finally {
    stoppingResultPdfExport.value = false;
  }
}

function restoreResultPrintMode() {
  if (!isResultPrintMode.value) {
    void restoreSelectedResultPrintTitle();
    printResultLoading.value = false;
    return;
  }

  isResultPrintMode.value = false;
  if (expandedQuestionIdsBeforePrint.value) {
    expandedQuestionIds.value = [...expandedQuestionIdsBeforePrint.value];
  }
  expandedQuestionIdsBeforePrint.value = null;
  void restoreSelectedResultPrintTitle();
  printResultLoading.value = false;
}

async function waitForSelectedResultPrintReady() {
  await nextTick();

  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
    } catch {
      // Ignore font readiness failures and continue with the best effort render.
    }
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

async function prepareSelectedResultForPrint() {
  await applySelectedResultPrintTitle();
  expandedQuestionIdsBeforePrint.value = [...expandedQuestionIds.value];
  expandedQuestionIds.value = editableResult.value!.questionScores.map(
    (question) => question.questionId,
  );
  isResultPrintMode.value = true;
  await waitForSelectedResultPrintReady();
}

async function printSelectedResult() {
  if (
    !selectedProject.value ||
    !selectedResult.value ||
    !editableResult.value ||
    printResultLoading.value
  ) {
    return;
  }

  printResultLoading.value = true;
  try {
    const targetPath = await window.neuromark.app.selectPdfSavePath(
      buildSelectedResultPdfBaseName(),
    );
    if (!targetPath) {
      printResultLoading.value = false;
      return;
    }

    await prepareSelectedResultForPrint();
    const outputPath =
      await window.neuromark.app.exportCurrentWindowToPdf(targetPath);
    message.success(`PDF 已导出到 ${outputPath}`);
    restoreResultPrintMode();
  } catch (error) {
    restoreResultPrintMode();
    message.error(error instanceof Error ? error.message : '打印导出失败。');
  }
}

async function saveResult(markAsVerified = editableStudentInfoChanged.value) {
  if (
    !selectedProject.value ||
    !selectedResult.value ||
    !editableResult.value
  ) {
    return;
  }
  const nextResult = cloneFinalResult(editableResult.value);
  nextResult.manualTotalScore = editableAutoTotal.value;
  const saveOptions =
    editableStudentInfoChanged.value && markAsVerified
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

async function saveResultByToggle() {
  await saveResult(markResultAsVerifiedOnSave.value);
}

async function startSmartNameMatch(scope: SmartNameMatchScope = 'unverified') {
  if (
    !selectedProject.value ||
    smartNameSubmitting.value ||
    smartNameMatchIsRunning.value
  ) {
    return;
  }

  const rosterText = smartNameRosterText.value.trim();
  if (!rosterText) {
    message.error('请先输入班级名册。');
    return;
  }

  smartNameSubmitting.value = true;
  try {
    smartNameMatchSnapshot.value =
      await window.neuromark.results.startSmartNameMatch(
        selectedProject.value.id,
        rosterText,
        { scope },
      );
    message.success(
      scope === 'all' ? '已开始重新全量核名。' : '已开始智能核名。',
    );
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '启动智能核名失败。',
    );
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
    const updatedPaperIds = await window.neuromark.results.applySmartNameMatch(
      selectedProject.value.id,
    );
    await Promise.all([
      projectsStore.loadProjectDetail(selectedProject.value.id),
      window.neuromark.results
        .getSmartNameMatchSnapshot(selectedProject.value.id)
        .then((snapshot) => {
          smartNameMatchSnapshot.value = snapshot;
        }),
    ]);
    message.success(`已应用 ${updatedPaperIds.length} 份确定核名结果。`);
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '应用智能核名失败。',
    );
  } finally {
    smartNameApplying.value = false;
  }
}

function getSmartNameDecisionLabel(
  suggestion: SmartNameMatchSuggestion,
): string {
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

function formatStudentInfo(
  studentInfo: { className: string; studentId: string; name: string } | null,
): string {
  if (!studentInfo) {
    return '未给出候选';
  }

  return [
    studentInfo.name || '未识别姓名',
    `学号 ${studentInfo.studentId || '未识别'}`,
    `班级 ${studentInfo.className || '未识别'}`,
  ].join(' · ');
}

function updateProjectRosterColumnField(
  index: number,
  value: StudentRosterColumnField,
) {
  const nextFields = [...projectRosterColumnFields.value];
  nextFields[index] = value;
  projectRosterColumnFields.value = nextFields;
}

function updateStudentInfoFromRosterEntry(
  target: StudentInfo,
  entry: StudentRosterEntry,
) {
  target.className = entry.className;
  target.studentId = entry.studentId;
  target.name = entry.name;
}

function applyRosterSuggestionToEditableResult(entry: StudentRosterEntry) {
  if (!editableResult.value) {
    return;
  }

  updateStudentInfoFromRosterEntry(editableResult.value.studentInfo, entry);
}

function applyRosterSuggestionToManualSmartName(entry: StudentRosterEntry) {
  if (!manualSmartNameDraft.value) {
    return;
  }

  updateStudentInfoFromRosterEntry(
    manualSmartNameDraft.value.studentInfo,
    entry,
  );
}

function resolveSmartNameRosterText(snapshotRosterText?: string | null): string {
  const trimmedSnapshotText = snapshotRosterText?.trim() ?? '';
  if (trimmedSnapshotText) {
    return trimmedSnapshotText;
  }

  return defaultSmartNameRosterText.value;
}

function getSmartNameFieldLabel(
  field: 'className' | 'studentId' | 'name',
): string {
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
  const nextInfo =
    suggestion.suggestedStudentInfo || suggestion.currentStudentInfo;
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

function focusResultByPaperId(paperId: string) {
  selectedResultId.value =
    results.value.find((result) => result.paperId === paperId)?.id ?? '';
}

async function openPaperPreviewByPaperId(paperId: string) {
  const previewImages = buildPaperPreviewImages(paperId);
  if (!previewImages.length) {
    return;
  }

  await window.neuromark.preview.open(previewImages, 0, '答卷图片预览');
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
  selectedResultId.value =
    results.value.find((item) => item.paperId === paperId)?.id ??
    selectedResultId.value;
  hideSmartNameContextMenu();
}

function backToAutoSmartName() {
  smartNameWorkspaceMode.value = 'auto';
}

async function saveManualSmartName() {
  if (
    !selectedProject.value ||
    !smartNameManualResult.value ||
    !manualSmartNameDraft.value
  ) {
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
    message.error(
      error instanceof Error ? error.message : '保存手动核名失败。',
    );
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
    await projectsStore.deleteResult(
      selectedProject.value.id,
      selectedResult.value.paperId,
    );
    await tasksStore.refresh();
    message.success('该试卷的批阅数据已删除，现在可以重新批阅。');
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '删除批阅数据失败。',
    );
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

  const nextStudentRoster = buildStudentRosterData(
    projectRosterDraftText.value,
    projectRosterColumnFields.value,
  );
  const assignedRosterFields = projectRosterColumnFields.value.filter(
    (field) => field !== 'ignore',
  );
  if (new Set(assignedRosterFields).size !== assignedRosterFields.length) {
    message.error('班级花名册的列属性不能重复，请调整列映射。');
    return;
  }
  if (
    projectRosterDraftText.value.trim() &&
    (!parsedProjectRoster.value.rows.length ||
      parsedProjectRoster.value.columnCount === 0)
  ) {
    message.error('班级花名册未识别出有效列，请检查粘贴内容。');
    return;
  }

  const nextSettings = {
    gradingConcurrency: projectSettingsDraft.value.gradingConcurrency,
    drawRegions: projectSettingsDraft.value.drawRegions,
    defaultImageDetail: projectSettingsDraft.value.defaultImageDetail,
    enableScanPostProcess: projectSettingsDraft.value.enableScanPostProcess,
    skipScanProcessing: projectSettingsDraft.value.skipScanProcessing,
    scanMarginRatio: projectSettingsDraft.value.scanMarginRatio,
    studentRoster: nextStudentRoster,
  };
  const projectIdToSave = selectedProject.value.id;
  const nameChanged = nextName !== selectedProject.value.name;

  projectSettingsSaving.value = true;
  try {
    if (nameChanged) {
      await projectsStore.updateProjectName(projectIdToSave, nextName);
    }
    await projectsStore.updateProjectSettings(projectIdToSave, nextSettings);
    if (nameChanged) {
      await tasksStore.refresh();
    }
    message.success(
      nameChanged ? '项目名称和设置已保存。' : '项目设置已保存。',
    );
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '保存项目设置失败。',
    );
  } finally {
    projectSettingsSaving.value = false;
  }
}

async function saveReferenceAnswer() {
  if (
    !selectedProject.value ||
    !referenceAnswerDirty.value ||
    referenceAnswerSaving.value
  ) {
    return;
  }

  const nextMarkdown = referenceAnswerDraft.value.trim();
  if (!nextMarkdown) {
    window.alert('参考答案不能为空。');
    return;
  }

  referenceAnswerDraft.value = nextMarkdown;
  referenceAnswerSaving.value = true;
  try {
    await projectsStore.updateReferenceAnswer(
      selectedProject.value.id,
      nextMarkdown,
    );
    savedReferenceAnswerMarkdown.value = nextMarkdown;
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
  const safeIndex = Math.min(
    Math.max(initialIndex, 0),
    resultPreviewImages.value.length - 1,
  );
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
    expandedQuestionIds.value = expandedQuestionIds.value.filter(
      (item) => item !== questionId,
    );
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

function getTaskFinishedAtLabel(
  value: string | null | undefined,
  status: string,
) {
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
  <div
    ref="pageStackRef"
    class="page-stack"
    :class="{ 'page-stack--result-print': isResultPrintMode }"
  >
    <n-modal
      :show="exportDialogVisible"
      preset="card"
      title="导出 JSON"
      class="project-modal"
      @close="exportDialogVisible = false"
    >
      <div class="stack-form create-project-form">
        <div class="detail-subtitle">
          请选择本次导出的试卷范围。导出的 JSON
          会包含批阅结果面板可见的完整元数据、当前版本
          rubric、参考答案原文，以及每页原始图片文件名。
        </div>
        <n-radio-group v-model:value="exportScope" class="export-scope-group">
          <div
            v-for="option in exportScopeOptions"
            :key="option.value"
            class="create-project-toggle-row export-scope-option"
          >
            <div class="create-project-toggle-copy">
              <div class="field-label">{{ option.label }}</div>
              <div class="field-hint">{{ option.description }}</div>
            </div>
            <n-radio :value="option.value" />
          </div>
        </n-radio-group>
      </div>
      <template #footer>
        <div class="modal-footer">
          <n-button
            :disabled="exportJsonLoading"
            @click="exportDialogVisible = false"
            >取消</n-button
          >
          <n-button
            type="primary"
            :loading="exportJsonLoading"
            @click="confirmExportResults"
          >
            选择保存位置并导出
          </n-button>
        </div>
      </template>
    </n-modal>

    <section class="hero-panel">
      <div>
        <div class="eyebrow">项目详情</div>
        <h2 class="section-title">{{ selectedProject?.name || '项目详情' }}</h2>
        <p class="section-copy">
          在这里查看项目概览、答卷库、批阅结果与项目设置。
        </p>
        <div v-if="selectedProject" class="hero-actions hero-actions-primary">
          <n-button
            secondary
            type="primary"
            :loading="importActionLoading"
            @click="importImages"
          >
            导入图片/PDF
          </n-button>
          <n-button
            secondary
            :loading="importActionLoading"
            @click="importImageDirectory"
          >
            导入文件夹
          </n-button>
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
                <div class="project-section-copy">
                  可以先快速浏览关键指标，再继续查看参考答案预览和最近任务。
                </div>
              </div>
              <div class="metrics-grid project-overview-metrics">
                <MetricCard
                  label="导入答卷"
                  :value="selectedProject.stats.importedPaperCount"
                  hint="按试卷套数统计"
                />
                <MetricCard
                  label="总页数"
                  :value="selectedProject.stats.pageCount"
                  hint="原始图片页数"
                />
                <MetricCard
                  label="已扫描"
                  :value="selectedProject.stats.scannedPaperCount"
                  hint="已生成扫描件"
                />
                <MetricCard
                  label="已批改"
                  :value="selectedProject.stats.gradedPaperCount"
                  hint="可进入结果复核"
                />
                <MetricCard
                  label="平均分"
                  :value="selectedProject.stats.averageScore"
                  hint="按当前最终成绩计算"
                />
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
                <div class="project-section-copy">
                  当前项目参考答案版本：v{{ latestReferenceAnswerVersion }}
                </div>
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
                  <div
                    v-for="task in recentJobs"
                    :key="task.id"
                    class="task-preview-row"
                  >
                    <div class="task-preview-main">
                      <div class="task-preview-topline">
                        <div class="task-preview-title">
                          {{
                            task.kind === 'scan'
                              ? '扫描任务'
                              : task.kind === 'grading'
                                ? '批阅任务'
                                : task.kind === 'result-pdf-export'
                                  ? 'PDF 导出任务'
                                  : '参考答案生成任务'
                          }}
                        </div>
                        <div class="task-preview-inline-tags">
                          <n-tag
                            v-if="
                              task.kind === 'grading' &&
                              task.referenceAnswerVersion
                            "
                            size="small"
                            round
                            :bordered="false"
                          >
                            参考答案 v{{ task.referenceAnswerVersion }}
                          </n-tag>
                          <n-tag size="small" round :bordered="false">
                            进度
                            {{
                              getTaskProgressLabel(task.progress, task.status)
                            }}
                          </n-tag>
                        </div>
                      </div>
                      <div class="task-preview-meta">{{ task.summary }}</div>
                      <div
                        v-if="getTaskRuntimeLogs(task).length"
                        class="task-log-list task-log-list--compact"
                      >
                        <div
                          v-for="line in getTaskRuntimeLogs(task)"
                          :key="`${task.id}-${line}`"
                          class="task-log-line"
                          :class="{
                            'task-log-line--error': isErrorLogLine(line),
                          }"
                        >
                          {{ line }}
                        </div>
                      </div>
                      <div class="task-preview-grid">
                        <div class="task-preview-item">
                          <span>开始时间</span>
                          <strong>{{
                            getTaskStartedAtLabel(task.startedAt)
                          }}</strong>
                        </div>
                        <div class="task-preview-item">
                          <span>结束时间</span>
                          <strong>{{
                            getTaskFinishedAtLabel(task.finishedAt, task.status)
                          }}</strong>
                        </div>
                        <div class="task-preview-item">
                          <span>当前答卷</span>
                          <strong>{{
                            task.currentPaperLabel || '暂未分配'
                          }}</strong>
                        </div>
                        <div class="task-preview-item">
                          <span>预计完成</span>
                          <strong>{{
                            task.eta ||
                            (task.status === 'completed' ? '已完成' : '暂无')
                          }}</strong>
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
            <n-card
              v-for="paper in papers"
              :key="paper.id"
              class="surface-card"
              :title="paper.paperCode"
            >
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
                <span
                  >批改状态：{{
                    paper.gradingStatus === 'completed'
                      ? '已完成'
                      : paper.gradingStatus === 'failed'
                        ? '失败'
                        : paper.gradingStatus === 'processing'
                          ? '批阅中'
                          : '待处理'
                  }}</span
                >
                <span v-if="paper.gradingReferenceAnswerVersion"
                  >参考答案 v{{ paper.gradingReferenceAnswerVersion }}</span
                >
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
            <n-card
              v-for="paper in papers"
              :key="paper.id"
              class="surface-card"
              :title="paper.paperCode"
            >
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
                      :initial-index="
                        getPaperPagePreviewIndex(paper.id, pageIndex)
                      "
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
                      :initial-index="
                        getPaperPagePreviewIndex(paper.id, pageIndex)
                      "
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
            :class="{ 'result-review-layout--print-host': isResultPrintMode }"
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
                <n-input
                  v-model:value="resultSearchKeyword"
                  size="small"
                  clearable
                  placeholder="搜索学号、姓名、班级或试卷名称"
                />
                <div class="result-sidebar-stats">
                  <n-tag size="small" round :bordered="false"
                    >已批改 {{ results.length }}</n-tag
                  >
                  <n-tag size="small" round type="warning" :bordered="false"
                    >未批改 {{ ungradedPapers.length }}</n-tag
                  >
                </div>
              </div>

              <div class="result-sidebar-scroll">
                <div class="result-nav-section">
                  <div class="result-list-head">已批改</div>
                  <button
                    v-for="entry in reviewResultEntries"
                    :key="entry.result.id"
                    class="result-row"
                    :class="{ active: entry.result.id === selectedResult?.id }"
                    @click="selectedResultId = entry.result.id"
                  >
                    <div class="result-row-main">
                      <div class="result-row-topline">
                        <div class="result-row-title">
                          {{ entry.paperLabel }}
                        </div>
                        <div class="result-row-score">
                          {{ entry.displayScore }}
                        </div>
                      </div>
                      <div class="result-row-student">
                        {{ entry.studentName || '未识别姓名' }}
                      </div>
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
                  <div
                    v-if="!reviewResultEntries.length"
                    class="result-nav-empty"
                  >
                    {{
                      resultSearchKeyword.trim()
                        ? '未找到匹配的已批改答卷。'
                        : '还没有已批改答卷。'
                    }}
                  </div>
                </div>

                <div class="result-nav-section">
                  <div class="result-list-head">未批改</div>
                  <div
                    v-for="paper in reviewUngradedPapers"
                    :key="paper.id"
                    class="result-row result-row--pending"
                  >
                    <div class="result-row-main">
                      <div class="result-row-topline">
                        <div class="result-row-title">
                          {{ paper.paperCode }}
                        </div>
                        <StatusPill :value="paper.gradingStatus" />
                      </div>
                      <div class="result-row-subtitle">
                        扫描状态：{{
                          paper.scanStatus === 'completed'
                            ? '已完成'
                            : paper.scanStatus
                        }}
                      </div>
                      <div class="result-row-student-meta">
                        <span>{{ paper.pageCount }} 页</span>
                        <span v-if="paper.gradingReferenceAnswerVersion">
                          参考答案 v{{ paper.gradingReferenceAnswerVersion }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div
                    v-if="!reviewUngradedPapers.length"
                    class="result-nav-empty"
                  >
                    {{
                      resultSearchKeyword.trim()
                        ? '未找到匹配的未批改答卷。'
                        : '当前没有待批改答卷。'
                    }}
                  </div>
                </div>
              </div>
            </aside>

            <section
              class="result-workspace surface-card"
              :class="{ 'result-workspace--print-mode': isResultPrintMode }"
              v-if="selectedResult && editableResult && selectedPaper"
            >
              <div class="result-workspace-head">
                <div>
                  <div class="result-section-title">手工核对工作区</div>
                  <div class="detail-subtitle">
                    可以在此处查看学生扫描卷信息，手动修改每一小题的得分情况。
                  </div>
                </div>
                <n-space class="result-print-actions">
                  <n-button
                    secondary
                    :loading="printResultLoading"
                    @click="printSelectedResult"
                  >
                    打印 / 导出 PDF
                  </n-button>
                  <n-popconfirm
                    positive-text="确认删除"
                    negative-text="取消"
                    @positive-click="deleteSelectedResult"
                  >
                    <template #trigger>
                      <n-button
                        type="error"
                        secondary
                        :loading="
                          deletingResultPaperId === selectedResult.paperId
                        "
                        :disabled="hasActiveGradingTask"
                      >
                        删除批阅数据
                      </n-button>
                    </template>
                    删除后会移除这张试卷当前的批阅结果，并恢复为“未批改”状态，可重新发起批阅。确认继续吗？
                  </n-popconfirm>
                  <n-button type="primary" @click="saveResultByToggle">
                    保存修改
                  </n-button>
                </n-space>
              </div>

              <div class="result-workspace-scroll">
                <div class="result-workspace-stack">
                  <div
                    class="result-subsection-card result-subsection-card--allow-overflow"
                  >
                    <div
                      class="result-panel-head result-panel-head--with-tools"
                    >
                      <div>
                        <div class="result-section-title">
                          扫描答卷与答题区域
                        </div>
                        <div class="detail-subtitle">
                          用于对照当前小题对应的答题区域。
                        </div>
                      </div>
                      <div
                        class="preview-overlay-controls"
                        aria-label="预览覆盖层开关"
                      >
                        <n-tooltip trigger="hover">
                          <template #trigger>
                            <button
                              class="preview-overlay-toggle"
                              :class="{
                                'is-active':
                                  previewDisplayOptions.showQuestionTags,
                              }"
                              :aria-pressed="
                                previewDisplayOptions.showQuestionTags
                              "
                              aria-label="切换题目标号"
                              @click="
                                togglePreviewDisplayOption('showQuestionTags')
                              "
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
                              :class="{
                                'is-active':
                                  previewDisplayOptions.showQuestionBoxes,
                              }"
                              :aria-pressed="
                                previewDisplayOptions.showQuestionBoxes
                              "
                              aria-label="切换题目方框"
                              @click="
                                togglePreviewDisplayOption('showQuestionBoxes')
                              "
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <rect
                                  x="5"
                                  y="5"
                                  width="14"
                                  height="14"
                                  rx="3"
                                  ry="3"
                                />
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
                              :class="{
                                'is-active':
                                  previewDisplayOptions.showQuestionScores,
                              }"
                              :aria-pressed="
                                previewDisplayOptions.showQuestionScores
                              "
                              aria-label="切换小题得分"
                              @click="
                                togglePreviewDisplayOption('showQuestionScores')
                              "
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

                    <div
                      class="result-stage-stack result-stage-stack--embedded"
                    >
                      <div
                        v-for="(image, imageIndex) in resultPreviewImages"
                        :key="image.title"
                        class="stage-card"
                      >
                        <div class="stage-card-title">{{ image.title }}</div>
                        <div
                          class="paper-stage paper-stage--thumbnail"
                          @click="openStagePreview(imageIndex)"
                        >
                          <img
                            class="paper-stage-image"
                            :src="toImageSrc(image.src, image.cacheKey)"
                            :alt="image.title"
                          />
                          <template v-if="hasVisibleRegionOverlay">
                            <div
                              v-for="region in image.regions"
                              :key="`${image.title}-${region.questionId}`"
                              class="paper-stage-region"
                              :class="{
                                'paper-stage-region--active':
                                  region.questionId === activeQuestionId,
                                'paper-stage-region--box-hidden':
                                  !previewDisplayOptions.showQuestionBoxes,
                              }"
                              :style="{
                                left: `${region.x * 100}%`,
                                top: `${region.y * 100}%`,
                                width: `${region.width * 100}%`,
                                height: `${region.height * 100}%`,
                              }"
                            >
                              <span
                                v-if="previewDisplayOptions.showQuestionTags"
                                >{{ region.questionId }}</span
                              >
                              <strong
                                v-if="previewDisplayOptions.showQuestionScores"
                                class="paper-stage-region-score"
                              >
                                {{
                                  formatRegionScore(
                                    region.score,
                                    region.maxScore,
                                  )
                                }}
                              </strong>
                            </div>
                          </template>
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
                    <div class="result-paper-title">
                      {{ selectedPaper.paperCode }}
                    </div>
                    <div class="result-paper-meta">
                      {{ editableResult.studentInfo.name || '未识别姓名' }}
                      <span
                        >学号
                        {{
                          editableResult.studentInfo.studentId || '未识别'
                        }}</span
                      >
                      <span
                        >班级
                        {{
                          editableResult.studentInfo.className || '未识别'
                        }}</span
                      >
                      <span>自动汇总总分 {{ editableAutoTotal }}</span>
                    </div>
                  </div>

                  <n-alert
                    v-if="selectedResult && !selectedResultUsesLatestReference"
                    type="warning"
                    class="result-version-alert"
                    :show-icon="false"
                  >
                    当前结果基于参考答案 v{{
                      selectedResult.referenceAnswerVersion
                    }}
                    批阅，项目最新版本为 v{{
                      latestReferenceAnswerVersion
                    }}。如需和最新标准保持一致，建议重新批阅。
                  </n-alert>

                  <div v-else-if="selectedResult" class="result-version-row">
                    <n-tag size="small" round :bordered="false">
                      参考答案 v{{ selectedResult.referenceAnswerVersion }}
                    </n-tag>
                    <span class="detail-subtitle"
                      >当前结果已使用最新参考答案版本。</span
                    >
                  </div>

                  <div
                    class="result-subsection-card result-subsection-card--allow-overflow"
                  >
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
                          <StudentInfoAutocompleteInput
                            v-model:value="editableResult.studentInfo.className"
                            field="className"
                            :roster-entries="savedProjectRosterEntries"
                            @select-entry="
                              applyRosterSuggestionToEditableResult
                            "
                          />
                        </n-form-item>
                        <n-form-item label="学号">
                          <StudentInfoAutocompleteInput
                            v-model:value="editableResult.studentInfo.studentId"
                            field="studentId"
                            :roster-entries="savedProjectRosterEntries"
                            @select-entry="
                              applyRosterSuggestionToEditableResult
                            "
                          />
                        </n-form-item>
                        <n-form-item label="姓名">
                          <StudentInfoAutocompleteInput
                            v-model:value="editableResult.studentInfo.name"
                            field="name"
                            :roster-entries="savedProjectRosterEntries"
                            @select-entry="
                              applyRosterSuggestionToEditableResult
                            "
                          />
                        </n-form-item>
                      </div>
                      <div
                        v-if="editableStudentInfoChanged"
                        class="smart-name-save-hint"
                        style="
                          display: inline-flex;
                          align-items: center;
                          gap: 12px;
                        "
                      >
                        <span>标记为已核名</span>
                        <n-switch
                          v-model:value="markResultAsVerifiedOnSave"
                          style="flex-shrink: 0"
                        />
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
                        <div class="detail-subtitle">
                          可以在此修改学生每个小题的得分，系统自动计算新的总分
                        </div>
                      </div>
                    </div>

                    <div class="question-list">
                      <div
                        v-for="question in editableResult.questionScores"
                        :key="question.questionId"
                        class="question-card"
                        :class="{
                          'question-card--active':
                            question.questionId === activeQuestionId,
                        }"
                        @click="focusQuestion(question.questionId)"
                      >
                        <div class="question-card-head">
                          <div>
                            <div
                              class="question-card-title question-card-title--markdown"
                            >
                              <span class="question-card-title-prefix"
                                >{{ question.questionId }} ·
                              </span>
                              <MarkdownRenderer
                                class="question-card-title-content"
                                :source="question.questionTitle"
                              />
                            </div>
                            <div class="question-card-meta">
                              满分 {{ question.maxScore }}
                            </div>
                          </div>
                          <div class="question-card-actions">
                            <div class="question-score-pill">
                              当前得分 {{ formatScoreValue(question.score) }}/{{
                                formatScoreValue(question.maxScore)
                              }}
                            </div>
                            <n-button
                              text
                              type="primary"
                              class="question-toggle-button"
                              @click.stop="
                                toggleQuestionExpanded(question.questionId)
                              "
                            >
                              {{
                                isQuestionExpanded(question.questionId)
                                  ? '收起'
                                  : '展开'
                              }}
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
                        <div
                          v-else-if="!isQuestionExpanded(question.questionId)"
                          class="detail-subtitle"
                        >
                          当前没有模型标记的问题点。
                        </div>
                        <template
                          v-if="isQuestionExpanded(question.questionId)"
                        >
                          <div class="question-card-expanded">
                            <div class="question-score-editor">
                              <div class="detail-subtitle">
                                手动调整本题分数，保存后会重新汇总总分。
                              </div>
                              <n-input-number
                                v-model:value="question.score"
                                :min="0"
                                :max="question.maxScore"
                              />
                            </div>
                            <MarkdownRenderer :source="question.reasoning" />
                            <div
                              v-if="question.scoreBreakdown.length"
                              class="issues-box"
                            >
                              <strong>采分明细</strong>
                              <ul class="score-breakdown-list">
                                <li
                                  v-for="point in question.scoreBreakdown"
                                  :key="`${question.questionId}-${point.criterionId}`"
                                >
                                  <div class="score-breakdown-head">
                                    <span class="score-breakdown-criterion-id"
                                      >{{ point.criterionId }} ·</span
                                    >
                                    <span
                                      class="score-breakdown-badge"
                                      :class="
                                        getScoreBreakdownBadgeClass(point)
                                      "
                                    >
                                      {{ formatScoreBreakdownBadge(point) }}
                                    </span>
                                  </div>
                                  <div class="score-breakdown-line">
                                    <span
                                      class="score-breakdown-logo score-breakdown-logo--standard"
                                    >
                                      标准
                                    </span>
                                    <MarkdownRenderer
                                      :source="point.criterion"
                                    />
                                  </div>
                                  <div class="score-breakdown-line">
                                    <span
                                      class="score-breakdown-logo score-breakdown-logo--evidence"
                                    >
                                      判定
                                    </span>
                                    <MarkdownRenderer
                                      :source="point.evidence"
                                    />
                                  </div>
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
                        <div class="detail-subtitle">
                          查看模型的整体建议与评语。
                        </div>
                      </div>
                    </div>

                    <div class="question-list">
                      <div class="question-card question-card--advice">
                        <div class="question-card-title">总体判断</div>
                        <MarkdownRenderer
                          :source="editableResult.overallAdvice.summary"
                        />
                      </div>

                      <div class="question-card question-card--advice">
                        <div class="question-card-title">表现较好的方面</div>
                        <div
                          v-if="editableResult.overallAdvice.strengths.length"
                          class="issues-box"
                        >
                          <ul>
                            <li
                              v-for="item in editableResult.overallAdvice
                                .strengths"
                              :key="item"
                            >
                              <MarkdownRenderer :source="item" />
                            </li>
                          </ul>
                        </div>
                        <div v-else class="detail-subtitle">
                          暂无特别突出的优势总结。
                        </div>
                      </div>

                      <div class="question-card question-card--advice">
                        <div class="question-card-title">优先补强知识点</div>
                        <div
                          v-if="
                            editableResult.overallAdvice.priorityKnowledgePoints
                              .length
                          "
                          class="issues-box"
                        >
                          <ul>
                            <li
                              v-for="item in editableResult.overallAdvice
                                .priorityKnowledgePoints"
                              :key="item"
                            >
                              <MarkdownRenderer :source="item" />
                            </li>
                          </ul>
                        </div>
                        <div v-else class="detail-subtitle">
                          当前没有明确需要优先补强的知识点。
                        </div>
                      </div>

                      <div class="question-card question-card--advice">
                        <div class="question-card-title">答题注意事项</div>
                        <div
                          v-if="
                            editableResult.overallAdvice.attentionPoints.length
                          "
                          class="issues-box"
                        >
                          <ul>
                            <li
                              v-for="item in editableResult.overallAdvice
                                .attentionPoints"
                              :key="item"
                            >
                              <MarkdownRenderer :source="item" />
                            </li>
                          </ul>
                        </div>
                        <div v-else class="detail-subtitle">
                          当前没有额外的答题习惯提醒。
                        </div>
                      </div>

                      <div class="question-card question-card--advice">
                        <div class="question-card-title">鼓励与提醒</div>
                        <MarkdownRenderer
                          :source="editableResult.overallAdvice.encouragement"
                        />
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
          <n-empty
            v-else
            description="先导入答卷。批改后，这里会显示左侧导航与右侧核对工作区。"
          />
        </n-tab-pane>

        <n-tab-pane name="smart-name-match" tab="智能核名">
          <div
            v-if="results.length"
            class="smart-name-layout"
            :class="{
              'smart-name-layout--expanded-logs': smartNameLayoutShouldExpandLogs,
              'smart-name-layout--suggestions': smartNameMatchHasResult,
            }"
            @mouseenter="isReviewScrollActive = true"
            @mouseleave="isReviewScrollActive = false"
            @click="hideSmartNameContextMenu"
          >
            <aside class="result-sidebar surface-card">
              <div class="result-sidebar-head">
                <div>
                  <div class="result-section-title">已批阅答卷</div>
                  <div class="detail-subtitle">
                    核对当前项目的学生身份信息。
                  </div>
                </div>
                <div class="result-sidebar-stats">
                  <n-tag size="small" round :bordered="false"
                    >已批改 {{ results.length }}</n-tag
                  >
                  <n-tag size="small" round type="success" :bordered="false">
                    已核名 {{ verifiedResultCount }}
                  </n-tag>
                  <n-tag size="small" round type="warning" :bordered="false">
                    待核名 {{ unverifiedResultCount }}
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
                    @contextmenu="
                      openSmartNameContextMenu($event, entry.result.paperId)
                    "
                  >
                    <div class="result-row-main">
                      <div class="result-row-topline">
                        <div class="result-row-title">
                          {{ entry.paperLabel }}
                        </div>
                        <div class="result-row-score">
                          {{ entry.displayScore }}
                        </div>
                      </div>
                      <div class="result-row-student">
                        {{ entry.studentName || '未识别姓名' }}
                      </div>
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

            <div class="smart-name-main">
              <section class="surface-card result-duplicate-check-panel">
                <div class="result-panel-head">
                  <div>
                    <div class="result-section-title">基础重复检查</div>
                    <div class="detail-subtitle">
                      检查当前批阅结果中存在的重复卷情况。
                    </div>
                  </div>
                </div>

                <div class="smart-name-summary-grid">
                  <div class="result-score-summary-card">
                    <span>重复姓名组</span>
                    <strong>{{
                      simpleSmartNameDuplicateCheck.duplicateNames.length
                    }}</strong>
                  </div>
                  <div class="result-score-summary-card">
                    <span>重复姓名试卷</span>
                    <strong>{{
                      simpleSmartNameDuplicateCheck.duplicateNamePaperCount
                    }}</strong>
                  </div>
                  <div class="result-score-summary-card">
                    <span>重复学号组</span>
                    <strong>{{
                      simpleSmartNameDuplicateCheck.duplicateStudentIds.length
                    }}</strong>
                  </div>
                  <div class="result-score-summary-card">
                    <span>重复学号试卷</span>
                    <strong>{{
                      simpleSmartNameDuplicateCheck.duplicateStudentIdPaperCount
                    }}</strong>
                  </div>
                </div>

                <template v-if="simpleSmartNameDuplicateCheck.hasIssue">
                  <div
                    v-if="simpleSmartNameDuplicateCheck.duplicateNames.length"
                    class="question-list"
                  >
                    <div
                      v-for="group in simpleSmartNameDuplicateCheck.duplicateNames"
                      :key="`simple-duplicate-name-${group.value}`"
                      class="question-card question-card--smart-name"
                    >
                      <div class="smart-name-card-head">
                        <div>
                          <div class="question-card-title">
                            重复姓名：{{ group.value }}
                          </div>
                          <div class="question-card-meta">
                            共 {{ group.items.length }} 份试卷
                          </div>
                        </div>
                        <n-tag
                          size="small"
                          round
                          type="error"
                          :bordered="false"
                        >
                          姓名重复
                        </n-tag>
                      </div>
                      <div class="smart-name-duplicate-list">
                        <div
                          v-for="item in group.items"
                          :key="`simple-duplicate-name-item-${group.value}-${item.paperId}`"
                          class="smart-name-duplicate-item smart-name-duplicate-item--danger"
                        >
                          <div class="smart-name-duplicate-item__meta">
                            <strong>{{ item.paperCode }}</strong>
                            <span>{{
                              formatStudentInfo({
                                name: item.studentName,
                                studentId: item.studentId,
                                className: item.className,
                              })
                            }}</span>
                          </div>
                          <n-button
                            secondary
                            size="small"
                            @click="focusResultByPaperId(item.paperId)"
                          >
                            定位试卷
                          </n-button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="simpleSmartNameDuplicateCheck.duplicateStudentIds.length"
                    class="question-list"
                  >
                    <div
                      v-for="group in simpleSmartNameDuplicateCheck.duplicateStudentIds"
                      :key="`simple-duplicate-student-id-${group.value}`"
                      class="question-card question-card--smart-name"
                    >
                      <div class="smart-name-card-head">
                        <div>
                          <div class="question-card-title">
                            重复学号：{{ group.value }}
                          </div>
                          <div class="question-card-meta">
                            共 {{ group.items.length }} 份试卷
                          </div>
                        </div>
                        <n-tag
                          size="small"
                          round
                          type="error"
                          :bordered="false"
                        >
                          学号重复
                        </n-tag>
                      </div>
                      <div class="smart-name-duplicate-list">
                        <div
                          v-for="item in group.items"
                          :key="`simple-duplicate-student-id-item-${group.value}-${item.paperId}`"
                          class="smart-name-duplicate-item smart-name-duplicate-item--danger"
                        >
                          <div class="smart-name-duplicate-item__meta">
                            <strong>{{ item.paperCode }}</strong>
                            <span>{{
                              formatStudentInfo({
                                name: item.studentName,
                                studentId: item.studentId,
                                className: item.className,
                              })
                            }}</span>
                          </div>
                          <n-button
                            secondary
                            size="small"
                            @click="focusResultByPaperId(item.paperId)"
                          >
                            定位试卷
                          </n-button>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>

                <n-empty
                  v-else
                  description="当前没有发现姓名重复或学号重复的试卷。"
                />
              </section>

              <section class="result-workspace surface-card">
              <div class="result-workspace-head">
                <div>
                  <div class="result-section-title">
                    {{
                      smartNameWorkspaceMode === 'manual'
                        ? '手动核名'
                        : '智能核名'
                    }}
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
                    :disabled="
                      smartNameMatchCertainSuggestions.length === 0 ||
                      smartNameMatchIsRunning
                    "
                    :loading="smartNameApplying"
                    type="primary"
                    @click="applySmartNameMatch"
                  >
                    应用确定项
                  </n-button>
                </n-space>
              </div>

              <div class="result-workspace-scroll">
                <div
                  v-if="
                    smartNameWorkspaceMode === 'manual' &&
                    smartNameManualResult &&
                    manualSmartNameDraft &&
                    smartNameManualPaper
                  "
                  class="result-workspace-stack"
                >
                  <div class="result-paper-summary">
                    <div class="result-paper-title">
                      {{ smartNameManualPaper.paperCode }}
                    </div>
                    <div class="result-paper-meta">
                      {{
                        manualSmartNameDraft.studentInfo.name || '未识别姓名'
                      }}
                      <span
                        >学号
                        {{
                          manualSmartNameDraft.studentInfo.studentId || '未识别'
                        }}</span
                      >
                      <span
                        >班级
                        {{
                          manualSmartNameDraft.studentInfo.className || '未识别'
                        }}</span
                      >
                    </div>
                  </div>

                  <div class="result-subsection-card">
                    <div
                      class="result-panel-head result-panel-head--with-tools"
                    >
                      <div>
                        <div class="result-section-title">查看试卷</div>
                      </div>
                      <n-button
                        secondary
                        @click="
                          openPaperPreviewByPaperId(
                            smartNameManualResult.paperId,
                          )
                        "
                      >
                        查看原卷
                      </n-button>
                    </div>

                    <div
                      class="result-stage-stack result-stage-stack--embedded"
                    >
                      <div
                        v-for="image in buildPaperPreviewImages(
                          smartNameManualResult.paperId,
                        )"
                        :key="`manual-${image.title}`"
                        class="stage-card"
                      >
                        <div class="stage-card-title">{{ image.title }}</div>
                        <div
                          class="paper-stage paper-stage--thumbnail"
                          @click="
                            openPaperPreviewByPaperId(
                              smartNameManualResult.paperId,
                            )
                          "
                        >
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
                          <StudentInfoAutocompleteInput
                            v-model:value="
                              manualSmartNameDraft.studentInfo.className
                            "
                            field="className"
                            :roster-entries="savedProjectRosterEntries"
                            @select-entry="
                              applyRosterSuggestionToManualSmartName
                            "
                          />
                        </n-form-item>
                        <n-form-item label="学号">
                          <StudentInfoAutocompleteInput
                            v-model:value="
                              manualSmartNameDraft.studentInfo.studentId
                            "
                            field="studentId"
                            :roster-entries="savedProjectRosterEntries"
                            @select-entry="
                              applyRosterSuggestionToManualSmartName
                            "
                          />
                        </n-form-item>
                        <n-form-item label="姓名">
                          <StudentInfoAutocompleteInput
                            v-model:value="
                              manualSmartNameDraft.studentInfo.name
                            "
                            field="name"
                            :roster-entries="savedProjectRosterEntries"
                            @select-entry="
                              applyRosterSuggestionToManualSmartName
                            "
                          />
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
                        :disabled="
                          smartNameMatchIsRunning || unverifiedResultCount === 0
                        "
                        @click="startSmartNameMatch('unverified')"
                      >
                        开始智能核名
                      </n-button>
                      <n-button
                        secondary
                        :loading="smartNameSubmitting"
                        :disabled="
                          smartNameMatchIsRunning || results.length === 0
                        "
                        @click="startSmartNameMatch('all')"
                      >
                        重新全量核名
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
                    v-if="
                      smartNameMatchState.status === 'failed' &&
                      smartNameMatchState.errorMessage
                    "
                    type="error"
                    class="answer-generation-alert"
                    :show-icon="false"
                  >
                    {{ smartNameMatchState.errorMessage }}
                  </n-alert>

                  <div
                    v-if="smartNameMatchIsRunning"
                    class="result-subsection-card"
                  >
                    <div class="answer-generation-pending">
                      <n-spin size="large" />
                      <div class="answer-generation-pending-copy">
                        <strong>正在智能核名</strong>
                        <span>{{
                          smartNameMatchState.stage || '正在请求模型。'
                        }}</span>
                      </div>
                      <div
                        v-if="!smartNameMatchHasPreview"
                        class="preset-panel preset-panel--stream"
                      >
                        <div class="preset-panel-title">
                          模型思考过程（实时）
                        </div>
                        <div
                          ref="smartNameReasoningRef"
                          class="preset-panel-copy preset-panel-copy--log stream-output-box"
                        >
                          {{
                            smartNameMatchState.reasoningText ||
                            '当前还没有接收到模型推理文本。'
                          }}
                        </div>
                      </div>
                      <div v-else class="preset-panel preset-panel--stream">
                        <div class="preset-panel-title">
                          模型实时输出（JSON 草稿）
                        </div>
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
                          <strong>{{
                            smartNameMatchState.result.summary
                              .certainUpdateCount
                          }}</strong>
                        </div>
                        <div class="result-score-summary-card">
                          <span>确定无误</span>
                          <strong>{{
                            smartNameMatchState.result.summary.certainKeepCount
                          }}</strong>
                        </div>
                        <div class="result-score-summary-card">
                          <span>待确认</span>
                          <strong>{{
                            smartNameMatchState.result.summary.uncertainCount
                          }}</strong>
                        </div>
                        <div class="result-score-summary-card">
                          <span>未匹配</span>
                          <strong>{{
                            smartNameMatchState.result.summary.noMatchCount
                          }}</strong>
                        </div>
                        <div class="result-score-summary-card">
                          <span>疑似重复卷</span>
                          <strong>{{
                            smartNameMatchState.result.summary
                              .duplicateGroupCount
                          }}</strong>
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
                          v-for="(group, groupIndex) in smartNameMatchState
                            .result.duplicateGroups"
                          :key="`duplicate-${groupIndex}`"
                          class="question-card question-card--smart-name"
                        >
                          <div class="smart-name-card-head">
                            <div>
                              <div class="question-card-title">
                                {{ group.paperCodes.join(' / ') }}
                              </div>
                              <div class="question-card-meta">
                                置信度 {{ Math.round(group.confidence * 100) }}%
                              </div>
                            </div>
                            <n-tag
                              size="small"
                              round
                              :bordered="false"
                              type="warning"
                            >
                              疑似重复
                            </n-tag>
                          </div>
                          <div class="detail-subtitle">{{ group.reason }}</div>
                          <div v-if="group.evidence.length" class="issues-box">
                            <strong>依据</strong>
                            <ul>
                              <li
                                v-for="evidence in group.evidence"
                                :key="evidence"
                              >
                                {{ evidence }}
                              </li>
                            </ul>
                          </div>
                        </div>
                      </div>
                      <n-empty
                        v-else
                        description="当前没有发现疑似重复录入的卷子。"
                      />
                    </div>

                    <div class="result-subsection-card">
                      <div class="result-panel-head">
                        <div>
                          <div class="result-section-title">确定修改</div>
                        </div>
                      </div>

                      <div
                        v-if="smartNameMatchCertainUpdateSuggestions.length"
                        class="question-list"
                      >
                        <div
                          v-for="suggestion in smartNameMatchCertainUpdateSuggestions"
                          :key="`certain-update-${suggestion.paperId}`"
                          class="question-card question-card--smart-name"
                        >
                          <div class="smart-name-card-head">
                            <div>
                              <div class="question-card-title">
                                {{ suggestion.paperCode }}
                              </div>
                              <div class="question-card-meta">
                                {{
                                  formatStudentInfo(
                                    suggestion.currentStudentInfo,
                                  )
                                }}
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
                            <n-button
                              secondary
                              size="small"
                              @click="
                                openPaperPreviewByPaperId(suggestion.paperId)
                              "
                            >
                              查看原卷
                            </n-button>
                          </div>
                          <div class="smart-name-diff-list">
                            <div
                              v-for="field in [
                                'name',
                                'studentId',
                                'className',
                              ]"
                              :key="`${suggestion.paperId}-${field}`"
                              class="smart-name-diff-row"
                              :class="{
                                'is-changed': isSmartNameFieldChanged(
                                  suggestion,
                                  field as 'className' | 'studentId' | 'name',
                                ),
                              }"
                            >
                              <div class="smart-name-diff-label">
                                {{
                                  getSmartNameFieldLabel(
                                    field as 'className' | 'studentId' | 'name',
                                  )
                                }}
                              </div>
                              <div class="smart-name-diff-values">
                                <span
                                  class="smart-name-diff-value smart-name-diff-value--before"
                                  :class="{
                                    'is-muted': !isSmartNameFieldChanged(
                                      suggestion,
                                      field as
                                        | 'className'
                                        | 'studentId'
                                        | 'name',
                                    ),
                                  }"
                                >
                                  {{
                                    getSmartNameFieldCurrentValue(
                                      suggestion,
                                      field as
                                        | 'className'
                                        | 'studentId'
                                        | 'name',
                                    )
                                  }}
                                </span>
                                <span
                                  class="smart-name-diff-arrow"
                                  :class="{
                                    'is-hidden': !isSmartNameFieldChanged(
                                      suggestion,
                                      field as
                                        | 'className'
                                        | 'studentId'
                                        | 'name',
                                    ),
                                  }"
                                >
                                  →
                                </span>
                                <span
                                  class="smart-name-diff-value smart-name-diff-value--after"
                                  :class="{
                                    'is-muted': !isSmartNameFieldChanged(
                                      suggestion,
                                      field as
                                        | 'className'
                                        | 'studentId'
                                        | 'name',
                                    ),
                                  }"
                                >
                                  {{
                                    getSmartNameFieldSuggestedValue(
                                      suggestion,
                                      field as
                                        | 'className'
                                        | 'studentId'
                                        | 'name',
                                    )
                                  }}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div class="detail-subtitle">
                            {{ suggestion.reason }}
                          </div>
                          <div
                            v-if="suggestion.matchedRosterLine"
                            class="preset-panel preset-panel--secondary"
                          >
                            <div class="preset-panel-title">命中名册</div>
                            <div class="preset-panel-copy">
                              {{ suggestion.matchedRosterLine }}
                            </div>
                          </div>
                        </div>
                      </div>
                      <n-empty
                        v-else
                        description="当前没有确定修改的核名结果。"
                      />
                    </div>

                    <div class="result-subsection-card">
                      <div class="result-panel-head">
                        <div>
                          <div class="result-section-title">待人工确认</div>
                        </div>
                      </div>

                      <div
                        v-if="smartNameMatchUncertainSuggestions.length"
                        class="question-list"
                      >
                        <div
                          v-for="suggestion in smartNameMatchUncertainSuggestions"
                          :key="`uncertain-${suggestion.paperId}`"
                          class="question-card question-card--smart-name"
                        >
                          <div class="smart-name-card-head">
                            <div>
                              <div class="question-card-title">
                                {{ suggestion.paperCode }}
                              </div>
                              <div class="question-card-meta">
                                置信度
                                {{ Math.round(suggestion.confidence * 100) }}%
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
                            <n-button
                              secondary
                              size="small"
                              @click="
                                openPaperPreviewByPaperId(suggestion.paperId)
                              "
                            >
                              查看原卷
                            </n-button>
                          </div>
                          <div class="smart-name-diff-list">
                            <div
                              v-for="field in [
                                'name',
                                'studentId',
                                'className',
                              ]"
                              :key="`${suggestion.paperId}-${field}`"
                              class="smart-name-diff-row"
                              :class="{
                                'is-changed': isSmartNameFieldChanged(
                                  suggestion,
                                  field as 'className' | 'studentId' | 'name',
                                ),
                              }"
                            >
                              <div class="smart-name-diff-label">
                                {{
                                  getSmartNameFieldLabel(
                                    field as 'className' | 'studentId' | 'name',
                                  )
                                }}
                              </div>
                              <div class="smart-name-diff-values">
                                <span
                                  class="smart-name-diff-value smart-name-diff-value--before"
                                  :class="{
                                    'is-muted': !isSmartNameFieldChanged(
                                      suggestion,
                                      field as
                                        | 'className'
                                        | 'studentId'
                                        | 'name',
                                    ),
                                  }"
                                >
                                  {{
                                    getSmartNameFieldCurrentValue(
                                      suggestion,
                                      field as
                                        | 'className'
                                        | 'studentId'
                                        | 'name',
                                    )
                                  }}
                                </span>
                                <span
                                  class="smart-name-diff-arrow"
                                  :class="{
                                    'is-hidden': !isSmartNameFieldChanged(
                                      suggestion,
                                      field as
                                        | 'className'
                                        | 'studentId'
                                        | 'name',
                                    ),
                                  }"
                                >
                                  →
                                </span>
                                <span
                                  class="smart-name-diff-value smart-name-diff-value--after"
                                  :class="{
                                    'is-muted': !isSmartNameFieldChanged(
                                      suggestion,
                                      field as
                                        | 'className'
                                        | 'studentId'
                                        | 'name',
                                    ),
                                  }"
                                >
                                  {{
                                    getSmartNameFieldSuggestedValue(
                                      suggestion,
                                      field as
                                        | 'className'
                                        | 'studentId'
                                        | 'name',
                                    )
                                  }}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div class="detail-subtitle">
                            {{ suggestion.reason }}
                          </div>
                          <div
                            v-if="suggestion.uncertaintyNotes.length"
                            class="issues-box"
                          >
                            <strong>不确定原因</strong>
                            <ul>
                              <li
                                v-for="note in suggestion.uncertaintyNotes"
                                :key="note"
                              >
                                {{ note }}
                              </li>
                            </ul>
                          </div>
                          <div
                            v-if="suggestion.matchedRosterLine"
                            class="preset-panel preset-panel--secondary"
                          >
                            <div class="preset-panel-title">候选名册</div>
                            <div class="preset-panel-copy">
                              {{ suggestion.matchedRosterLine }}
                            </div>
                          </div>
                        </div>
                      </div>
                      <n-empty
                        v-else
                        description="当前没有需要人工确认的条目。"
                      />
                    </div>

                    <div class="result-subsection-card">
                      <div
                        class="result-panel-head result-panel-head--with-tools"
                      >
                        <div>
                          <div class="result-section-title">确定无误</div>
                        </div>
                        <n-button
                          text
                          type="primary"
                          @click="
                            smartNameKeepExpanded = !smartNameKeepExpanded
                          "
                        >
                          {{
                            smartNameKeepExpanded
                              ? '收起'
                              : `展开 ${smartNameMatchCertainKeepSuggestions.length} 项`
                          }}
                        </n-button>
                      </div>

                      <div
                        v-if="
                          smartNameKeepExpanded &&
                          smartNameMatchCertainKeepSuggestions.length
                        "
                        class="question-list"
                      >
                        <div
                          v-for="suggestion in smartNameMatchCertainKeepSuggestions"
                          :key="`certain-keep-${suggestion.paperId}`"
                          class="question-card question-card--smart-name"
                        >
                          <div class="smart-name-card-head">
                            <div>
                              <div class="question-card-title">
                                {{ suggestion.paperCode }}
                              </div>
                              <div class="question-card-meta">
                                {{
                                  formatStudentInfo(
                                    suggestion.currentStudentInfo,
                                  )
                                }}
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
                            <n-button
                              secondary
                              size="small"
                              @click="
                                openPaperPreviewByPaperId(suggestion.paperId)
                              "
                            >
                              查看原卷
                            </n-button>
                          </div>
                          <div class="detail-subtitle">
                            {{ suggestion.reason }}
                          </div>
                          <div
                            v-if="suggestion.matchedRosterLine"
                            class="preset-panel preset-panel--secondary"
                          >
                            <div class="preset-panel-title">命中名册</div>
                            <div class="preset-panel-copy">
                              {{ suggestion.matchedRosterLine }}
                            </div>
                          </div>
                        </div>
                      </div>
                      <n-empty
                        v-else-if="!smartNameMatchCertainKeepSuggestions.length"
                        description="当前没有确定无误的条目。"
                      />
                      <div v-else class="detail-subtitle">
                        已折叠
                        {{ smartNameMatchCertainKeepSuggestions.length }}
                        条确定无误结果。
                      </div>
                    </div>
                  </template>
                </div>
              </div>
              </section>

              <div
                v-if="smartNameContextMenu.visible"
                class="preview-context-menu smart-name-context-menu"
                :style="{
                  left: `${smartNameContextMenu.x}px`,
                  top: `${smartNameContextMenu.y}px`,
                }"
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
          </div>
          <n-empty v-else description="先完成批阅后再进行智能核名。" />
        </n-tab-pane>

        <n-tab-pane name="score-post-process" tab="分数后处理">
          <ScorePostProcessPanel
            v-if="selectedProject && detail"
            :project="selectedProject"
            :results="detail.results"
            :papers="detail.originals"
          />
        </n-tab-pane>

        <n-tab-pane name="statistics-export" tab="统计与导出">
          <div class="statistics-export-stack">
            <n-card class="surface-card statistics-export-hero">
              <div class="statistics-export-hero-copy">
                <div class="eyebrow">统计与导出</div>
                <div class="project-section-title">
                  阅卷统计信息及导出选项
                </div>
                <div class="project-section-copy">
                  你可以在此处查看试卷分数的分布情况，以及题目的错误率，也可以导出结果为各种格式。
                </div>
              </div>
              <div class="statistics-export-actions">
                <n-button
                  type="primary"
                  secondary
                  :loading="exportJsonLoading"
                  @click="exportResults"
                >
                  导出 JSON
                </n-button>
                <n-button
                  type="primary"
                  secondary
                  :loading="exportExcelLoading"
                  @click="exportResultsExcel"
                >
                  导出成绩 Excel
                </n-button>
                <n-button
                  type="primary"
                  secondary
                  :loading="exportAllPdfsLoading || Boolean(currentResultPdfExportTask)"
                  :disabled="!gradedResultEntries.length || Boolean(currentResultPdfExportTask)"
                  @click="exportAllResultPdfs"
                >
                  {{ exportAllPdfsButtonText }}
                </n-button>
                <n-button
                  v-if="currentResultPdfExportTask"
                  tertiary
                  type="error"
                  :loading="stoppingResultPdfExport"
                  @click="stopResultPdfExport"
                >
                  停止导出
                </n-button>
              </div>
            </n-card>

            <div v-if="gradedResultEntries.length" class="statistics-main-column">
              <section class="statistics-main-column">
                <n-card
                  v-if="hasPostProcessedScores"
                  class="surface-card statistics-filter-card"
                >
                  <div class="statistics-filter-row">
                    <div>
                      <div class="project-section-title">统计口径</div>
                      <div class="project-section-copy">
                        选择按原始分数还是后处理分数查看统计图表与汇总指标。
                      </div>
                    </div>
                    <n-select
                      v-model:value="statisticsScoreMode"
                      class="statistics-filter-select"
                      :options="statisticsScoreOptions"
                    />
                  </div>
                </n-card>

                <div class="metrics-grid statistics-metrics-grid">
                  <MetricCard
                    label="已批改"
                    :value="scoreStats.count"
                    value-mode="text"
                    hint="参与统计的答卷数"
                  />
                  <MetricCard
                    label="平均分"
                    :value="formatStatNumber(scoreStats.average)"
                    value-mode="text"
                    :hint="
                      statisticsScoreMode === 'post-processed'
                        ? '后处理总分平均值'
                        : '原始最终总分平均值'
                    "
                  />
                  <MetricCard
                    label="最高分"
                    :value="formatStatNumber(scoreStats.max)"
                    value-mode="text"
                    :hint="
                      statisticsScoreMode === 'post-processed'
                        ? '后处理总分最高值'
                        : '原始最终总分最高值'
                    "
                  />
                  <MetricCard
                    label="最低分"
                    :value="formatStatNumber(scoreStats.min)"
                    value-mode="text"
                    :hint="
                      statisticsScoreMode === 'post-processed'
                        ? '后处理总分最低值'
                        : '原始最终总分最低值'
                    "
                  />
                  <MetricCard
                    label="方差"
                    :value="formatStatNumber(scoreStats.variance)"
                    value-mode="text"
                    hint="按总体方差计算"
                  />
                  <MetricCard
                    label="标准差"
                    :value="formatStatNumber(scoreStats.standardDeviation)"
                    value-mode="text"
                    hint="分数离散程度"
                  />
                </div>

                <n-card class="surface-card statistics-chart-card">
                  <div class="project-section-head">
                    <div class="project-section-title">总分分布</div>
                    <div class="project-section-copy" style="margin-bottom:10px;">
                      图表统计自动四舍五入到整数。
                    </div>
                  </div>
                  <div
                    ref="scoreDistributionChartRef"
                    class="statistics-score-chart"
                  />
                </n-card>

                <n-card class="surface-card statistics-question-card">
                  <div
                    class="project-section-head statistics-question-card-head"
                  >
                    <div>
                      <div class="project-section-title">小题正确率</div>
                      <div class="project-section-copy">
                        满分记为正确，非满分记为错误。
                      </div>
                    </div>
                    <n-button
                      secondary
                      :loading="exportQuestionAccuracyExcelLoading"
                      @click="exportQuestionAccuracyExcel"
                    >
                      导出正确率 Excel
                    </n-button>
                  </div>
                  <div class="statistics-question-list">
                    <div
                      v-for="question in questionStats"
                      :key="question.questionId"
                      class="statistics-question-row"
                    >
                      <div class="statistics-question-row-head">
                        <div class="statistics-question-main">
                          <n-tag
                            size="small"
                            round
                            :bordered="false"
                            type="info"
                          >
                            {{ question.questionId }}
                          </n-tag>
                          <div>
                            <div
                              class="statistics-question-title question-card-title--markdown"
                            >
                              <MarkdownRenderer
                                class="question-card-title-content"
                                :source="
                                  question.questionTitle || question.questionId
                                "
                              />
                            </div>
                            <div class="statistics-question-meta">
                              满分 {{ question.maxScore }} 分 ·
                              {{ question.correctCount }}/{{
                                question.totalCount
                              }}
                              人满分
                            </div>
                          </div>
                        </div>
                        <strong>
                          {{ formatStatNumber(question.correctRate) }}%
                        </strong>
                      </div>
                      <div class="statistics-rate-track">
                        <div
                          class="statistics-rate-bar"
                          :style="{ width: `${question.correctRate}%` }"
                        />
                      </div>
                    </div>
                  </div>
                </n-card>
              </section>
            </div>

            <n-empty
              v-else
              description="完成批阅后，这里会显示分数统计与导出入口。"
            />
          </div>
        </n-tab-pane>

        <n-tab-pane name="project-settings" tab="项目设置">
          <div class="project-settings-stack">
            <n-card class="surface-card" title="项目级批阅设置">
              <n-form
                v-if="selectedProject"
                label-placement="top"
                class="stack-form"
              >
                <n-form-item label="项目名称">
                  <n-input
                    v-model:value="projectNameDraft"
                    placeholder="例如：第二章随堂练习"
                  />
                </n-form-item>
                <div class="two-col create-project-settings-grid">
                  <n-form-item label="批阅并行数">
                    <n-input-number
                      v-model:value="projectSettingsDraft.gradingConcurrency"
                      :min="1"
                      class="create-project-half-input"
                    />
                  </n-form-item>
                  <n-form-item label="图像细节">
                    <n-select
                      v-model:value="projectSettingsDraft.defaultImageDetail"
                      class="create-project-half-input"
                      :options="[
                        { label: '高', value: 'high' },
                        { label: '自动', value: 'auto' },
                        { label: '低', value: 'low' },
                      ]"
                    />
                  </n-form-item>
                  <n-form-item label="扫描裕度比例">
                    <n-input-number
                      v-model:value="projectSettingsDraft.scanMarginRatio"
                      :min="1"
                      :step="0.01"
                      :precision="2"
                      class="create-project-half-input"
                    />
                  </n-form-item>
                </div>
                <div class="create-project-toggle-row">
                  <div class="create-project-toggle-copy">
                    <div class="field-label">跳过扫描处理</div>
                    <div class="field-hint">
                      开启后不再识别边界，直接将原始答卷图片作为扫描结果使用。
                    </div>
                  </div>
                  <n-switch
                    v-model:value="projectSettingsDraft.skipScanProcessing"
                  />
                </div>
                <div class="create-project-toggle-row">
                  <div class="create-project-toggle-copy">
                    <div class="field-label">扫描后处理</div>
                    <div class="field-hint">
                      关闭后只做边界识别、透视拉平与裁剪，不做增强和二值化。
                    </div>
                  </div>
                  <n-switch
                    v-model:value="projectSettingsDraft.enableScanPostProcess"
                    :disabled="projectSettingsDraft.skipScanProcessing"
                  />
                </div>
                <div class="create-project-toggle-row">
                  <div class="create-project-toggle-copy">
                    <div class="field-label">绘制批阅区域</div>
                    <div class="field-hint">
                      开启后会在批阅视图中显示题目边界框，便于复核。
                    </div>
                  </div>
                  <n-switch v-model:value="projectSettingsDraft.drawRegions" />
                </div>
                <div class="result-subsection-card">
                  <div class="result-panel-head">
                    <div>
                      <div class="result-section-title">班级花名册</div>
                      <div class="detail-subtitle">
                        粘贴花名册文本后，系统会自动拆分列，并允许你指定每一列对应学号、姓名或班级。
                      </div>
                    </div>
                    <n-tag round :bordered="false">
                      已保存 {{ savedProjectRosterEntries.length }} 条
                    </n-tag>
                  </div>

                  <n-input
                    v-model:value="projectRosterDraftText"
                    type="textarea"
                    :autosize="{ minRows: 6, maxRows: 12 }"
                    placeholder="逐行粘贴花名册，如：8394726105    韩知远    C7A4"
                  />

                  <div
                    v-if="parsedProjectRoster.columnCount"
                    class="project-roster-column-grid"
                  >
                    <div
                      v-for="columnIndex in parsedProjectRoster.columnCount"
                      :key="columnIndex"
                      class="project-roster-column-card"
                    >
                      <div class="field-label">第 {{ columnIndex }} 列</div>
                      <n-select
                        :value="projectRosterColumnFields[columnIndex - 1]"
                        :options="STUDENT_ROSTER_COLUMN_FIELD_OPTIONS"
                        @update:value="
                          (value) =>
                            updateProjectRosterColumnField(
                              columnIndex - 1,
                              value,
                            )
                        "
                      />
                      <div class="project-roster-column-sample">
                        示例：
                        {{
                          parsedProjectRoster.rows
                            .slice(0, 3)
                            .map((row) => row[columnIndex - 1] || '空')
                            .join(' / ')
                        }}
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="projectRosterPreviewEntries.length"
                    class="project-roster-preview"
                  >
                    <div class="project-roster-preview-head">
                      <span class="field-label">
                        预览 {{ projectRosterPreviewEntries.length }} 条
                      </span>
                      <span class="detail-subtitle">
                        点击保存项目设置后生效
                      </span>
                    </div>
                    <div class="project-roster-preview-list">
                      <div
                        v-for="entry in projectRosterPreviewEntries.slice(0, 5)"
                        :key="entry.id"
                        class="project-roster-preview-row"
                      >
                        <strong>{{ entry.name || '未填写姓名' }}</strong>
                        <span>学号 {{ entry.studentId || '未填写' }}</span>
                        <span>班级 {{ entry.className || '未填写' }}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <n-button
                  type="primary"
                  :loading="projectSettingsSaving"
                  @click="saveProjectSettings"
                >
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
                  <n-tag round :bordered="false"
                    >当前版本 v{{ latestReferenceAnswerVersion }}</n-tag
                  >
                  <n-tag
                    v-if="referenceAnswerDirty"
                    round
                    type="warning"
                    :bordered="false"
                    >有未保存修改</n-tag
                  >
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
              <div class="project-danger-copy" style="margin-bottom: 10px">
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

        <n-tab-pane
          v-if="showRubricDebugTab"
          name="rubric-debug"
          tab="Rubric 调试"
        >
          <div class="project-settings-stack">
            <n-card class="surface-card" title="当前 Rubric 缓存">
              <div class="reference-editor-head">
                <div class="project-section-copy">
                  这里展示当前项目最新参考答案版本对应的 rubric
                  缓存文件，内容就是后台批阅实际使用的结构化评分模板。
                </div>
                <div class="reference-editor-actions">
                  <n-tag round :bordered="false"
                    >参考答案 v{{ latestReferenceAnswerVersion }}</n-tag
                  >
                  <n-button
                    tertiary
                    :loading="rubricLoading"
                    @click="loadRubricDebug"
                  >
                    刷新 Rubric
                  </n-button>
                </div>
              </div>

              <div v-if="rubricDebug" class="rubric-debug-stack">
                <div class="rubric-debug-meta-grid">
                  <div class="task-list-meta-item">
                    <span class="task-list-meta-label">缓存文件</span>
                    <strong class="task-list-meta-value">{{
                      rubricDebug.rubricPath
                    }}</strong>
                  </div>
                  <div class="task-list-meta-item">
                    <span class="task-list-meta-label">状态</span>
                    <strong class="task-list-meta-value">{{
                      rubricDebug.exists ? '已生成' : '尚未生成'
                    }}</strong>
                  </div>
                  <div class="task-list-meta-item">
                    <span class="task-list-meta-label">更新时间</span>
                    <strong class="task-list-meta-value">{{
                      getTaskStartedAtLabel(rubricDebug.updatedAt)
                    }}</strong>
                  </div>
                </div>

                <n-empty
                  v-if="!rubricDebug.exists"
                  description="当前版本的 rubric 还没有生成。首次启动批阅后会自动生成缓存。"
                />

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
                      <n-empty
                        v-else
                        description="当前 rubric JSON 解析失败。"
                      />
                    </div>
                  </div>
                </template>
              </div>
            </n-card>
          </div>
        </n-tab-pane>
      </n-tabs>
    </section>

    <n-card
      v-else-if="projectsStore.loading"
      class="surface-card projects-empty-state"
    >
      <n-spin size="large" />
    </n-card>

    <n-card v-else class="surface-card projects-empty-state">
      <n-empty description="未找到这个项目，或者项目数据还没有加载成功。">
        <template #extra>
          <n-button type="primary" @click="goBack">返回项目列表</n-button>
        </template>
      </n-empty>
    </n-card>

    <div
      v-if="
        !isResultPrintMode && (canScrollOuterToTop || canScrollOuterToBottom)
      "
      class="project-scroll-fab-stack"
    >
      <button
        v-if="canScrollOuterToTop"
        type="button"
        class="project-scroll-fab project-scroll-fab--top"
        aria-label="滚动到页面顶部"
        @click="scrollOuterToTop"
      >
        <span class="project-scroll-fab__icon">↑</span>
        <span class="project-scroll-fab__label">顶部</span>
      </button>
      <button
        v-if="canScrollOuterToBottom"
        type="button"
        class="project-scroll-fab project-scroll-fab--bottom"
        aria-label="滚动到页面底部"
        @click="scrollOuterToBottom"
      >
        <span class="project-scroll-fab__icon">↓</span>
        <span class="project-scroll-fab__label">底部</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.result-subsection-card--allow-overflow {
  position: relative;
  z-index: 12;
  overflow: visible;
  contain: layout;
  content-visibility: visible;
}

.project-roster-column-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.project-roster-column-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.9);
}

.project-roster-column-sample {
  font-size: 12px;
  line-height: 1.6;
  color: #64748b;
}

.project-roster-preview {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid rgba(15, 118, 110, 0.12);
  border-radius: 14px;
  background: rgba(240, 253, 250, 0.65);
}

.project-roster-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.project-roster-preview-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.project-roster-preview-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.86);
  color: #1e293b;
}
</style>
