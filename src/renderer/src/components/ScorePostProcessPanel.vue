<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NInput,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui';
import type {
  ProjectMeta,
  PreviewImageItem,
  ResultRecord,
  PaperRecord,
  ScorePostProcessPaperResult,
  ScorePostProcessScriptError,
} from '@preload/contracts';
import JsonTreeView from '@/components/JsonTreeView.vue';
import { useScorePostProcessStore } from '@/stores/score-post-process';
import {
  SCORE_POST_PROCESS_EDITOR_TYPES,
  SCORE_POST_PROCESS_SCRIPT_DOC_ITEMS,
} from '@/utils/score-post-process';
import CodeEditor from './CodeEditor.vue';

const props = defineProps<{
  project: ProjectMeta;
  results: ResultRecord[];
  papers: PaperRecord[];
}>();

const message = useMessage();
const store = useScorePostProcessStore();

type ProcessedResultSortMode =
  | 'input-order'
  | 'score-desc'
  | 'score-asc'
  | 'student-id';

const scriptName = ref('');
const selectedPresetId = ref<string | null>(null);
const scriptCode = ref('');
const searchKeyword = ref('');
const selectedPaperId = ref('');
const processedResultSortMode = ref<ProcessedResultSortMode>('input-order');
const running = ref(false);
const exporting = ref(false);
const executionError = ref<ScorePostProcessScriptError | null>(null);
const scriptDocsExpanded = ref(false);
const aiScriptExpanded = ref(false);
const aiInstruction = ref('');
const aiReasoningStreamRef = ref<HTMLElement | null>(null);
const aiJsonStreamRef = ref<HTMLElement | null>(null);
const lastAppliedAiSnapshotAt = ref('');

const gradedResults = computed(() =>
  props.results.filter((result) => result.finalResult && result.modelResult),
);
const paperOrderMap = computed(
  () => new Map(props.papers.map((paper, index) => [paper.id, index])),
);
const latestSnapshot = computed(() =>
  store.getProjectSnapshot(props.project.id),
);
const latestRun = computed(() => latestSnapshot.value.latestRun);
const aiSnapshot = computed(() =>
  store.getAiScriptSnapshot(props.project.id),
);
const aiGenerationResult = computed(() => aiSnapshot.value.result);
const aiGenerating = computed(() => aiSnapshot.value.status === 'running');
const showAiReasoningStreamPanel = computed(
  () => aiGenerating.value && !aiSnapshot.value.previewText.trim().length,
);
const showAiJsonStreamPanel = computed(
  () => aiGenerating.value && Boolean(aiSnapshot.value.previewText.trim().length),
);
const presetOptions = computed(() =>
  store.presets.map((preset) => ({
    label: preset.name,
    value: preset.id,
  })),
);
const processedResultSortOptions = [
  { label: '按录入顺序', value: 'input-order' },
  { label: '按分数由高到低', value: 'score-desc' },
  { label: '按分数由低到高', value: 'score-asc' },
  { label: '按学号排序', value: 'student-id' },
];
const editorMarkers = computed(() => {
  if (!executionError.value?.lineNumber) {
    return [];
  }

  return [
    {
      message: executionError.value.message,
      startLineNumber: executionError.value.lineNumber,
      startColumn: executionError.value.columnNumber ?? 1,
      endLineNumber: executionError.value.lineNumber,
      endColumn: (executionError.value.columnNumber ?? 1) + 1,
      severity: 'error' as const,
    },
  ];
});
const filteredResults = computed(() => {
  const keyword = searchKeyword.value.trim().toLocaleLowerCase('zh-CN');
  const rows = [...(latestRun.value?.results ?? [])].sort((left, right) => {
    const leftPaperOrder =
      paperOrderMap.value.get(left.paperId) ?? Number.MAX_SAFE_INTEGER;
    const rightPaperOrder =
      paperOrderMap.value.get(right.paperId) ?? Number.MAX_SAFE_INTEGER;
    const fallback =
      leftPaperOrder - rightPaperOrder ||
      left.paperCode.localeCompare(right.paperCode, 'zh-CN', {
        numeric: true,
      });

    if (processedResultSortMode.value === 'score-desc') {
      return right.processedScore - left.processedScore || fallback;
    }

    if (processedResultSortMode.value === 'score-asc') {
      return left.processedScore - right.processedScore || fallback;
    }

    if (processedResultSortMode.value === 'student-id') {
      const leftStudentId = left.studentInfo.studentId.trim();
      const rightStudentId = right.studentInfo.studentId.trim();

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

    return fallback;
  });
  if (!keyword) {
    return rows;
  }

  return rows.filter((row) =>
    [
      row.paperCode,
      row.studentInfo.name,
      row.studentInfo.studentId,
      row.studentInfo.className,
      row.gradeLabel ?? '',
    ].some((field) => field.toLocaleLowerCase('zh-CN').includes(keyword)),
  );
});
const selectedProcessedResult = computed<ScorePostProcessPaperResult | null>(
  () => {
    const matched = filteredResults.value.find(
      (row) => row.paperId === selectedPaperId.value,
    );
    return matched ?? filteredResults.value[0] ?? null;
  },
);
const selectedProcessedPaper = computed<PaperRecord | null>(() =>
  props.papers.find((paper) => paper.id === selectedProcessedResult.value?.paperId) ?? null,
);

function formatScore(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatDelta(value: number): string {
  if (Math.abs(value) < 0.000001) {
    return '0';
  }
  return `${value > 0 ? '+' : ''}${formatScore(value)}`;
}

function buildOriginalPreviewImages(paper: PaperRecord | null): PreviewImageItem[] {
  if (!paper) {
    return [];
  }

  return paper.originalPages.map((page, index) => ({
    src: page.originalPath,
    cacheKey: page.originalVersion,
    title: `${paper.paperCode} · 第 ${index + 1} 页`,
    caption: '原始答卷',
  }));
}

async function openSelectedOriginalPreview() {
  const previewImages = buildOriginalPreviewImages(selectedProcessedPaper.value);
  if (!previewImages.length) {
    message.warning('当前答卷还没有可预览的原始图片。');
    return;
  }

  await window.neuromark.preview.open(previewImages, 0, '原卷图片预览');
}

function hydrateEditorFromPreset(presetId: string | null) {
  if (!presetId) {
    return;
  }

  const preset = store.presetMap.get(presetId);
  if (!preset) {
    return;
  }

  selectedPresetId.value = preset.id;
  scriptName.value = preset.name;
  scriptCode.value = preset.code;
  executionError.value = null;
}

function hydrateEditorFromLatestRun() {
  if (!latestRun.value) {
    return;
  }

  selectedPresetId.value = latestRun.value.presetId;
  scriptName.value = latestRun.value.scriptName;
  scriptCode.value = latestRun.value.scriptCode;
  executionError.value = null;
}

function applyAiScriptResult() {
  if (!aiGenerationResult.value) {
    return;
  }

  selectedPresetId.value = null;
  scriptName.value = aiGenerationResult.value.scriptName;
  scriptCode.value = aiGenerationResult.value.scriptCode;
  executionError.value = null;
  aiScriptExpanded.value = true;
}

async function runScript() {
  if (!scriptCode.value.trim() || running.value) {
    return;
  }

  running.value = true;
  executionError.value = null;
  try {
    const result = await store.execute(props.project.id, {
      scriptName: scriptName.value.trim() || undefined,
      presetId: selectedPresetId.value,
      scriptCode: scriptCode.value,
    });

    if (!result.success || !result.run) {
      executionError.value = result.error;
      message.error(result.error?.message ?? '脚本执行失败。');
      return;
    }

    selectedPaperId.value = result.run.results[0]?.paperId ?? '';
    message.success(
      `脚本执行完成，已生成 ${result.run.results.length} 份后处理结果。`,
    );
  } catch (error) {
    message.error(error instanceof Error ? error.message : '脚本执行失败。');
  } finally {
    running.value = false;
  }
}

async function generateAiScript() {
  if (!aiInstruction.value.trim() || aiGenerating.value) {
    return;
  }

  aiScriptExpanded.value = true;
  try {
    await store.startAiScriptGeneration(props.project.id, {
      instruction: aiInstruction.value.trim(),
    });
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : 'AI 脚本生成失败。',
    );
  }
}

async function exportLatest() {
  if (!latestRun.value || exporting.value) {
    return;
  }

  const targetDirectory = await window.neuromark.app.selectExportDirectory();
  if (!targetDirectory) {
    return;
  }

  exporting.value = true;
  try {
    const outputPath = await store.exportLatest(props.project.id, {
      targetDirectory,
    });
    message.success(`后处理 JSON 已导出到 ${outputPath}`);
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '导出后处理结果失败。',
    );
  } finally {
    exporting.value = false;
  }
}

onMounted(async () => {
  await Promise.all([
    store.presets.length ? Promise.resolve() : store.loadPresets(),
    store.loadProjectSnapshot(props.project.id),
    store.loadAiScriptSnapshot(props.project.id),
  ]);

  if (latestRun.value) {
    hydrateEditorFromLatestRun();
    selectedPaperId.value = latestRun.value.results[0]?.paperId ?? '';
    return;
  }

  if (store.presets.length) {
    hydrateEditorFromPreset(store.presets[0].id);
  }
});

watch(
  () => props.project.id,
  async (projectId) => {
    executionError.value = null;
    searchKeyword.value = '';
    selectedPaperId.value = '';
    lastAppliedAiSnapshotAt.value = '';
    await store.loadProjectSnapshot(projectId);
    await store.loadAiScriptSnapshot(projectId);
    if (latestRun.value) {
      hydrateEditorFromLatestRun();
      selectedPaperId.value = latestRun.value.results[0]?.paperId ?? '';
    } else if (store.presets.length) {
      hydrateEditorFromPreset(store.presets[0].id);
    }
  },
);

watch(
  () => filteredResults.value,
  (rows) => {
    if (!rows.length) {
      selectedPaperId.value = '';
      return;
    }
    if (!rows.some((row) => row.paperId === selectedPaperId.value)) {
      selectedPaperId.value = rows[0].paperId;
    }
  },
  { immediate: true },
);

watch(
  () => aiSnapshot.value.reasoningText,
  async () => {
    if (!showAiReasoningStreamPanel.value) {
      return;
    }
    await nextTick();
    if (aiReasoningStreamRef.value) {
      aiReasoningStreamRef.value.scrollTop =
        aiReasoningStreamRef.value.scrollHeight;
    }
  },
);

watch(
  () => aiSnapshot.value.previewText,
  async () => {
    if (!showAiJsonStreamPanel.value) {
      return;
    }
    await nextTick();
    if (aiJsonStreamRef.value) {
      aiJsonStreamRef.value.scrollTop = aiJsonStreamRef.value.scrollHeight;
    }
  },
);

watch(
  () => aiSnapshot.value.updatedAt,
  () => {
    if (
      aiSnapshot.value.status !== 'completed' ||
      !aiGenerationResult.value ||
      lastAppliedAiSnapshotAt.value === aiSnapshot.value.updatedAt
    ) {
      return;
    }

    lastAppliedAiSnapshotAt.value = aiSnapshot.value.updatedAt;
    applyAiScriptResult();
    message.success('AI 脚本已通过生成前校验，请点击“执行脚本”。');
  },
);
</script>

<template>
  <div class="score-postprocess-stack">
    <n-card class="surface-card" title="脚本工作台">
      <div class="score-postprocess-toolbar">
        <div class="score-postprocess-toolbar-copy">
          <div class="detail-subtitle">
            这里的脚本只读取已经批改完成的答卷结果，不会覆盖原始批阅数据。脚本输出会作为附加结果单独保存。
          </div>
        </div>
        <div class="score-postprocess-preset-stack">
          <div class="score-postprocess-preset-row">
            <n-select
              v-model:value="selectedPresetId"
              class="score-postprocess-preset-select"
              placeholder="选择一个脚本预设"
              :options="presetOptions"
            />
            <n-button tertiary @click="hydrateEditorFromPreset(selectedPresetId)">
              加载预设
            </n-button>
          </div>
        </div>
      </div>

      <div class="three-col score-postprocess-summary-grid">
        <div class="result-score-summary-card">
          <span>可处理答卷</span>
          <strong>{{ gradedResults.length }}</strong>
        </div>
        <div class="result-score-summary-card">
          <span>最近执行</span>
          <strong>{{
            latestRun
              ? latestRun.createdAt.replace('T', ' ').slice(0, 19)
              : '尚未执行'
          }}</strong>
        </div>
        <div class="result-score-summary-card">
          <span>最近应用到</span>
          <strong>{{
            latestRun
              ? `${latestRun.summary.appliedCount}/${latestRun.summary.paperCount}`
              : '-'
          }}</strong>
        </div>
      </div>

      <section
        class="score-postprocess-docs"
        :class="{ 'is-expanded': scriptDocsExpanded }"
      >
        <button
          type="button"
          class="score-postprocess-docs-toggle"
          :aria-expanded="scriptDocsExpanded"
          @click="scriptDocsExpanded = !scriptDocsExpanded"
        >
          <span class="score-postprocess-docs-toggle__title">脚本文档</span>
          <span
            class="score-postprocess-docs-toggle__arrow"
            :class="{ 'is-expanded': scriptDocsExpanded }"
            aria-hidden="true"
          >
            ›
          </span>
        </button>

        <div v-if="scriptDocsExpanded" class="score-postprocess-docs-panel">
          <div class="score-postprocess-api-box">
            <div class="score-postprocess-doc-grid">
              <div
                v-for="item in SCORE_POST_PROCESS_SCRIPT_DOC_ITEMS"
                :key="item.title"
                class="score-postprocess-doc-item"
              >
                <div class="preset-panel-title">{{ item.title }}</div>
                <div class="preset-panel-copy">{{ item.description }}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        class="score-postprocess-docs"
        :class="{ 'is-expanded': aiScriptExpanded }"
      >
        <button
          type="button"
          class="score-postprocess-docs-toggle"
          :aria-expanded="aiScriptExpanded"
          @click="aiScriptExpanded = !aiScriptExpanded"
        >
          <span class="score-postprocess-docs-toggle__title">AI脚本</span>
          <span
            class="score-postprocess-docs-toggle__arrow"
            :class="{ 'is-expanded': aiScriptExpanded }"
            aria-hidden="true"
          >
            ›
          </span>
        </button>

        <div v-if="aiScriptExpanded" class="score-postprocess-docs-panel">
          <div class="score-postprocess-ai-panel stack-gap">
            <div class="detail-subtitle">
              用自然语言描述你想如何处理当前这批分数。
            </div>
            <n-input
              v-model:value="aiInstruction"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 8 }"
              placeholder="例如：把 80 分以上的同学分数保留不动，80 分以下的全部压缩进 60-80 分段。"
            />
            <div class="settings-actions score-postprocess-actions score-postprocess-ai-actions">
              <n-button
                type="primary"
                :loading="aiGenerating"
                :disabled="!aiInstruction.trim()"
                @click="generateAiScript"
              >
                生成脚本
              </n-button>
              <n-button
                tertiary
                :disabled="!aiGenerationResult"
                @click="applyAiScriptResult"
              >
                将 AI 生成脚本填入编辑器
              </n-button>
            </div>

            <n-alert
              v-if="aiGenerating"
              type="info"
              class="settings-inline-feedback"
              title="AI 正在生成脚本"
              show-icon
            >
              {{ aiSnapshot.stage || '正在请求模型。' }}
            </n-alert>

            <n-alert
              v-else-if="aiSnapshot.status === 'failed' && aiSnapshot.errorMessage"
              type="error"
              class="settings-inline-feedback"
              title="AI 脚本生成失败"
              show-icon
            >
              {{ aiSnapshot.errorMessage }}
            </n-alert>

            <n-alert
              v-else-if="aiSnapshot.status === 'completed' && aiGenerationResult"
              type="success"
              class="settings-inline-feedback"
              title="AI 脚本已通过生成前校验"
              show-icon
            >
              AI 脚本已填入当前编辑器，请点击“执行脚本”确认结果。
            </n-alert>

            <div
              v-if="showAiReasoningStreamPanel"
              class="preset-panel preset-panel--stream"
            >
              <div class="preset-panel-title">模型思考过程（实时）</div>
              <div
                ref="aiReasoningStreamRef"
                class="preset-panel-copy preset-panel-copy--log stream-output-box"
              >
                {{
                  aiSnapshot.reasoningText || '当前还没有接收到模型的思考文本。'
                }}
              </div>
            </div>

            <div
              v-if="showAiJsonStreamPanel"
              class="preset-panel preset-panel--stream"
            >
              <div class="preset-panel-title">模型实时输出（JSON 草稿）</div>
              <div
                ref="aiJsonStreamRef"
                class="preset-panel-copy preset-panel-copy--log stream-output-box"
              >
                {{ aiSnapshot.previewText || '模型尚未返回任何文本片段。' }}
              </div>
            </div>

            <div
              v-if="aiSnapshot.status === 'completed' && aiGenerationResult"
              class="score-postprocess-api-box"
            >
              <div class="score-postprocess-doc-grid">
                <div class="score-postprocess-doc-item">
                  <div class="preset-panel-title">AI 标题</div>
                  <div class="preset-panel-copy">
                    {{ aiGenerationResult.scriptName }}
                  </div>
                </div>
                <div class="score-postprocess-doc-item">
                  <div class="preset-panel-title">AI 摘要</div>
                  <div class="preset-panel-copy">
                    {{ aiGenerationResult.summary }}
                  </div>
                </div>
                <div class="score-postprocess-doc-item">
                  <div class="preset-panel-title">假设与提醒</div>
                  <div class="preset-panel-copy">
                    {{
                      aiGenerationResult.assumptions.length
                        ? aiGenerationResult.assumptions.join('；')
                        : '无额外假设。'
                    }}
                  </div>
                </div>
                <div class="score-postprocess-doc-item">
                  <div class="preset-panel-title">当前状态</div>
                  <div class="preset-panel-copy">
                    已自动填充脚本名称与代码，等待你手动执行。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="score-postprocess-script-grid">
        <div class="score-postprocess-script-field">
          <div class="field-label" style="margin-left: 10px;">脚本名称</div>
          <n-input
            v-model:value="scriptName"
            placeholder="例如：线性归一化到 60-100"
          />
        </div>
      </div>

      <CodeEditor
        class="score-postprocess-editor"
        v-model="scriptCode"
        height="520px"
        :markers="editorMarkers"
        :extra-libs="[
          {
            content: SCORE_POST_PROCESS_EDITOR_TYPES,
            filePath: 'inmemory://score-post-process/project-panel.d.ts',
          },
        ]"
      />

      <div class="settings-actions score-postprocess-actions">
        <n-button
          type="primary"
          :loading="running"
          :disabled="!scriptCode.trim()"
          @click="runScript"
        >
          执行脚本
        </n-button>
        <n-button
          secondary
          :disabled="!latestRun"
          :loading="exporting"
          @click="exportLatest"
        >
          导出后处理 JSON
        </n-button>
        <!-- <n-button
          tertiary
          :disabled="!latestRun?.exportPath"
          @click="openExportPath"
        >
          打开导出位置
        </n-button> -->
      </div>

      <n-alert
        v-if="executionError"
        type="error"
        class="settings-inline-feedback"
        title="脚本执行失败"
        show-icon
      >
        <div>{{ executionError.message }}</div>
        <div v-if="executionError.lineNumber" class="detail-subtitle">
          位置：第 {{ executionError.lineNumber }} 行，第
          {{ executionError.columnNumber || 1 }} 列
        </div>
        <pre class="score-postprocess-error-stack">{{
          executionError.stack
        }}</pre>
      </n-alert>
    </n-card>

    <template v-if="latestRun">
      <div class="score-postprocess-result-layout">
        <aside class="score-postprocess-sidebar surface-card">
          <div class="result-sidebar-head">
            <div>
              <div class="result-section-title">处理后成绩</div>
              <div class="detail-subtitle">{{ latestRun.scriptName }}</div>
            </div>
            <div class="result-sidebar-sort">
              <span class="result-sidebar-sort-label">排序方式</span>
              <n-select
                v-model:value="processedResultSortMode"
                size="small"
                :options="processedResultSortOptions"
              />
            </div>
            <n-input
              v-model:value="searchKeyword"
              size="small"
              clearable
              placeholder="搜索试卷、姓名、学号、班级"
            />
            <div class="result-sidebar-stats">
              <n-tag size="small" round :bordered="false"
                >总计 {{ latestRun.summary.paperCount }}</n-tag
              >
              <n-tag size="small" round type="success" :bordered="false">
                已输出 {{ latestRun.summary.appliedCount }}
              </n-tag>
              <n-tag size="small" round type="info" :bordered="false">
                均分 {{ formatScore(latestRun.summary.averageProcessedScore) }}
              </n-tag>
            </div>
          </div>

          <div class="result-sidebar-scroll">
            <button
              v-for="row in filteredResults"
              :key="row.paperId"
              class="result-row"
              :class="{
                active: row.paperId === selectedProcessedResult?.paperId,
              }"
              @click="selectedPaperId = row.paperId"
            >
              <div class="result-row-main">
                <div class="result-row-topline">
                  <div class="result-row-title">{{ row.paperCode }}</div>
                  <div class="result-row-score">
                    {{ formatScore(row.processedScore) }}
                  </div>
                </div>
                <div class="result-row-student">
                  {{ row.studentInfo.name || '未识别姓名' }}
                </div>
                <div class="result-row-student-meta">
                  <span>原始 {{ formatScore(row.originalScore) }}</span>
                  <span>变化 {{ formatDelta(row.scoreDelta) }}</span>
                </div>
                <div class="result-version-tags">
                  <n-tag
                    size="small"
                    round
                    :bordered="false"
                    :type="row.applied ? 'success' : 'warning'"
                  >
                    {{ row.applied ? '脚本已输出' : '保留原分' }}
                  </n-tag>
                  <n-tag
                    v-if="row.gradeLabel"
                    size="small"
                    round
                    type="info"
                    :bordered="false"
                  >
                    {{ row.gradeLabel }}
                  </n-tag>
                </div>
              </div>
            </button>
            <div v-if="!filteredResults.length" class="result-nav-empty">
              没有匹配的后处理结果。
            </div>
          </div>
        </aside>

        <section
          v-if="selectedProcessedResult"
          class="score-postprocess-workspace surface-card"
        >
          <div class="result-workspace-head">
            <div>
              <div class="result-section-title">结果明细</div>
              <div class="detail-subtitle">
                {{ selectedProcessedResult.paperCode }} ·
                {{ selectedProcessedResult.studentInfo.name || '未识别姓名' }}
              </div>
            </div>
            <n-button
              tertiary
              :disabled="!selectedProcessedPaper"
              @click="openSelectedOriginalPreview"
            >
              查看原卷图片
            </n-button>
          </div>

          <div class="result-workspace-scroll">
            <div class="result-workspace-stack">
              <div class="result-subsection-card">
                <div class="result-panel-head">
                  <div>
                    <div class="result-section-title">分数摘要</div>
                  </div>
                </div>
                <div class="three-col score-postprocess-summary-grid">
                  <div class="result-score-summary-card">
                    <span>原始分数</span>
                    <strong>{{
                      formatScore(selectedProcessedResult.originalScore)
                    }}</strong>
                  </div>
                  <div class="result-score-summary-card">
                    <span>处理后分数</span>
                    <strong>{{
                      formatScore(selectedProcessedResult.processedScore)
                    }}</strong>
                  </div>
                  <div class="result-score-summary-card">
                    <span>变化</span>
                    <strong>{{
                      formatDelta(selectedProcessedResult.scoreDelta)
                    }}</strong>
                  </div>
                </div>
                <div class="result-paper-meta">
                  <span
                    >学号
                    {{
                      selectedProcessedResult.studentInfo.studentId || '未识别'
                    }}</span
                  >
                  <span
                    >班级
                    {{
                      selectedProcessedResult.studentInfo.className || '未识别'
                    }}</span
                  >
                  <span
                    >脚本状态
                    {{
                      selectedProcessedResult.applied
                        ? '已输出'
                        : '未输出，保留原分'
                    }}</span
                  >
                </div>
              </div>

              <div class="result-subsection-card">
                <div class="result-panel-head">
                  <div>
                    <div class="result-section-title">附加说明</div>
                  </div>
                </div>
                <div class="question-list">
                  <div class="question-card question-card--advice">
                    <div class="question-card-title">标签</div>
                    <div class="detail-subtitle">
                      {{ selectedProcessedResult.gradeLabel || '未提供标签' }}
                    </div>
                  </div>
                  <div class="question-card question-card--advice">
                    <div class="question-card-title">备注</div>
                    <div class="detail-subtitle">
                      {{ selectedProcessedResult.note || '脚本未提供备注。' }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="result-subsection-card">
                <div class="result-panel-head">
                  <div>
                    <div class="result-section-title">元数据</div>
                    <div class="detail-subtitle">
                      脚本返回的自定义 metadata 会显示在这里。
                    </div>
                  </div>
                </div>
                <div class="json-tree-shell">
                  <JsonTreeView
                    :value="selectedProcessedResult.metadata"
                    label="metadata"
                    :depth="0"
                    :initially-expanded="true"
                  />
                </div>
              </div>

              <div
                v-if="latestRun.scriptSummary"
                class="result-subsection-card"
              >
                <div class="result-panel-head">
                  <div>
                    <div class="result-section-title">脚本汇总</div>
                  </div>
                </div>
                <div class="json-tree-shell">
                  <JsonTreeView
                    :value="latestRun.scriptSummary"
                    label="summary"
                    :depth="0"
                    :initially-expanded="true"
                  />
                </div>
              </div>

              <div v-if="latestRun.logs.length" class="result-subsection-card">
                <div class="result-panel-head">
                  <div>
                    <div class="result-section-title">脚本日志</div>
                  </div>
                </div>
                <div class="task-log-list">
                  <div
                    v-for="(line, index) in latestRun.logs"
                    :key="`${index}-${line}`"
                    class="task-log-line"
                  >
                    {{ line }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>

    <n-card v-else class="surface-card">
      <n-empty
        description="执行一次脚本后，这里会显示每份答卷的处理后分数和附加元数据。"
      />
    </n-card>
  </div>
</template>
