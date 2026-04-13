<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
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
  ResultRecord,
  PaperRecord,
  ScorePostProcessPaperResult,
  ScorePostProcessScriptError,
} from '@preload/contracts';
import JsonTreeView from '@/components/JsonTreeView.vue';
import { useScorePostProcessStore } from '@/stores/score-post-process';
import { SCORE_POST_PROCESS_EDITOR_TYPES } from '@/utils/score-post-process';
import CodeEditor from './CodeEditor.vue';

const props = defineProps<{
  project: ProjectMeta;
  results: ResultRecord[];
  papers: PaperRecord[];
}>();

const message = useMessage();
const store = useScorePostProcessStore();

const scriptName = ref('');
const selectedPresetId = ref<string | null>(null);
const scriptCode = ref('');
const searchKeyword = ref('');
const selectedPaperId = ref('');
const running = ref(false);
const exporting = ref(false);
const executionError = ref<ScorePostProcessScriptError | null>(null);
const scriptDocsExpanded = ref(false);

const gradedResults = computed(() =>
  props.results.filter((result) => result.finalResult && result.modelResult),
);
const latestSnapshot = computed(() =>
  store.getProjectSnapshot(props.project.id),
);
const latestRun = computed(() => latestSnapshot.value.latestRun);
const presetOptions = computed(() =>
  store.presets.map((preset) => ({
    label: preset.name,
    value: preset.id,
  })),
);
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
  const rows = latestRun.value?.results ?? [];
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

function formatScore(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatDelta(value: number): string {
  if (Math.abs(value) < 0.000001) {
    return '0';
  }
  return `${value > 0 ? '+' : ''}${formatScore(value)}`;
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

async function openExportPath() {
  if (!latestRun.value?.exportPath) {
    return;
  }
  await window.neuromark.app.openPath(latestRun.value.exportPath);
}

onMounted(async () => {
  await Promise.all([
    store.presets.length ? Promise.resolve() : store.loadPresets(),
    store.loadProjectSnapshot(props.project.id),
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
    await store.loadProjectSnapshot(projectId);
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
              <div class="score-postprocess-doc-item">
                <div class="preset-panel-title">可用全局对象</div>
                <div class="preset-panel-copy">
                  <code>project</code>、<code>papers</code>、<code>utils</code>、
                  <code>output()</code>、<code>outputMany()</code>、<code>log()</code>
                </div>
              </div>

              <div class="score-postprocess-doc-item">
                <div class="preset-panel-title">project</div>
                <div class="preset-panel-copy">
                  当前项目信息，包含项目名、路径、参考答案版本、统计信息和项目设置。
                </div>
              </div>

              <div class="score-postprocess-doc-item">
                <div class="preset-panel-title">papers</div>
                <div class="preset-panel-copy">
                  已批改答卷数组。<code>papers[*].totalScore</code> 就是当前最终分数，
                  <code>studentInfo</code> 里能拿到姓名、学号、班级，<code>questionScores</code>
                  里能拿到每题分数。
                </div>
              </div>

              <div class="score-postprocess-doc-item">
                <div class="preset-panel-title">utils</div>
                <div class="preset-panel-copy">
                  内置数学工具，包含 <code>round</code>、<code>clamp</code>、
                  <code>average</code>、<code>quantile</code>、<code>percentile</code>、
                  <code>zScore</code>、<code>normalizeToRange</code> 等。
                </div>
              </div>

              <div class="score-postprocess-doc-item">
                <div class="preset-panel-title">输出结果</div>
                <div class="preset-panel-copy">
                  你可以直接 <code>return [...]</code>，也可以逐条调用
                  <code>output(...)</code>，批量则用 <code>outputMany(...)</code>。每条输出至少要有
                  <code>paperId</code>，可选返回 <code>processedScore</code>、
                  <code>gradeLabel</code>、<code>note</code>、<code>metadata</code>。
                </div>
              </div>

              <div class="score-postprocess-doc-item">
                <div class="preset-panel-title">log() 有什么用</div>
                <div class="preset-panel-copy">
                  <code>log(...args)</code> 用来在脚本执行时输出调试日志，方便你排查逻辑。日志会显示在本页执行结果下方的“脚本日志”区域里，也会跟随本次后处理结果一起保存和导出。
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="score-postprocess-script-grid">
        <div class="score-postprocess-script-field">
          <div class="field-label">脚本名称</div>
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
        <n-button
          tertiary
          :disabled="!latestRun?.exportPath"
          @click="openExportPath"
        >
          打开导出位置
        </n-button>
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
