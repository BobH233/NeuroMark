<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MdEditor } from 'md-editor-v3';
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NPopconfirm,
  NSpin,
  NTag,
} from 'naive-ui';
import ImagePreviewTile from '@/components/ImagePreviewTile.vue';
import StatusPill from '@/components/StatusPill.vue';
import { useAnswerGeneratorStore } from '@/stores/answer-generator';

const route = useRoute();
const router = useRouter();
const store = useAnswerGeneratorStore();
const markdown = ref('');
const retrying = ref(false);
const saving = ref(false);
const promptExpanded = ref(false);
const programPromptExpanded = ref(false);
const logsExpanded = ref(false);
const reasoningStreamRef = ref<HTMLElement | null>(null);
const jsonStreamRef = ref<HTMLElement | null>(null);

const draftId = computed(() => String(route.params.draftId ?? ''));
const draft = computed(() => store.getDraftById(draftId.value));
const preset = computed(() =>
  store.presets.find((item) => item.id === draft.value?.promptPreset) ?? null,
);
const isGenerating = computed(() =>
  ['queued', 'running'].includes(draft.value?.generationStatus ?? ''),
);
const generationStatusCopy = computed(() => {
  if (draft.value?.generationStatus === 'queued') {
    return '正在准备本次参考答案请求。';
  }
  if (draft.value?.generationStatus === 'running') {
    return draft.value.generationStage || '正在请求大模型并解析返回结果。';
  }
  return '';
});
const canRetry = computed(
  () => Boolean(draft.value) && !isGenerating.value,
);
const promptDisplayText = computed(() =>
  promptExpanded.value ? (draft.value?.promptText ?? '') : collapseText(draft.value?.promptText ?? '', 160),
);
const programPromptDisplayText = computed(() =>
  programPromptExpanded.value
    ? store.programPromptText
    : collapseText(store.programPromptText, 160),
);
const generationLogsText = computed(() => (draft.value?.generationLogs ?? []).join('\n'));
const generationLogsDisplayText = computed(() =>
  logsExpanded.value
    ? generationLogsText.value
    : collapseText((draft.value?.generationLogs ?? []).slice(-4).join('\n'), 240),
);
const generationPreviewDisplayText = computed(() =>
  draft.value?.generationPreviewText?.trim().length
    ? draft.value.generationPreviewText
    : '模型尚未返回任何文本片段。',
);
const generationReasoningDisplayText = computed(() =>
  draft.value?.generationReasoningText?.trim().length
    ? draft.value.generationReasoningText
    : '当前还没有接收到模型的思考文本。',
);
const hasJsonStreamOutput = computed(() =>
  Boolean(draft.value?.generationPreviewText?.trim().length),
);
const showReasoningStreamPanel = computed(() =>
  isGenerating.value && !hasJsonStreamOutput.value,
);
const showJsonStreamPanel = computed(() =>
  isGenerating.value && hasJsonStreamOutput.value,
);

watch(
  () => draft.value?.markdown,
  (value) => {
    markdown.value = value ?? '';
  },
  { immediate: true },
);

watch(
  () => draft.value?.generationReasoningText ?? '',
  async () => {
    if (!showReasoningStreamPanel.value) {
      return;
    }
    await nextTick();
    if (reasoningStreamRef.value) {
      reasoningStreamRef.value.scrollTop = reasoningStreamRef.value.scrollHeight;
    }
  },
);

watch(
  () => draft.value?.generationPreviewText ?? '',
  async () => {
    if (!showJsonStreamPanel.value) {
      return;
    }
    await nextTick();
    if (jsonStreamRef.value) {
      jsonStreamRef.value.scrollTop = jsonStreamRef.value.scrollHeight;
    }
  },
);

onMounted(async () => {
  if (store.drafts.length === 0 || store.presets.length === 0) {
    await store.bootstrap();
  }
});

async function saveDraft(value: string) {
  markdown.value = value;
  if (!draft.value || isGenerating.value || saving.value) {
    return;
  }

  saving.value = true;
  try {
    await store.updateDraft(draft.value.id, value);
  } finally {
    saving.value = false;
  }
}

function goBack() {
  router.push('/answer-generator');
}

function openSettings() {
  router.push('/settings');
}

function collapseText(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '暂无内容';
  }

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength)}...`;
}

function formatLocalDateTime(value: string | null | undefined) {
  if (!value) {
    return '暂无';
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

async function retryGeneration() {
  if (!draft.value || !canRetry.value) {
    return;
  }

  retrying.value = true;
  try {
    await store.startGeneration(draft.value.id);
  } catch (error) {
    window.alert(
      `重新生成失败：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    retrying.value = false;
  }
}

async function deleteDraft() {
  if (!draft.value) {
    return;
  }

  try {
    await store.deleteDraft(draft.value.id);
    router.replace('/answer-generator');
  } catch (error) {
    window.alert(
      `删除草稿失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">
          详情页
        </div>
        <h2 class="section-title">
          {{ draft?.title || '参考答案详情' }}
        </h2>
        <p class="section-copy">
          参考答案生成任务在后端执行。即使你切换到其他页面，这个任务也会继续运行，返回后会自动同步结果。
        </p>
      </div>
      <div class="hero-actions">
        <n-button
          v-if="draft"
          tertiary
          type="primary"
          :loading="retrying"
          :disabled="!canRetry"
          @click="retryGeneration"
        >
          重新生成
        </n-button>
        <n-popconfirm
          v-if="draft"
          positive-text="删除"
          negative-text="取消"
          @positive-click="deleteDraft"
        >
          <template #trigger>
            <n-button
              tertiary
              type="error"
            >
              删除草稿
            </n-button>
          </template>
          删除这份参考答案草稿后将无法恢复，确认继续吗？
        </n-popconfirm>
        <n-button
          tertiary
          @click="goBack"
        >
          返回历史记录
        </n-button>
      </div>
    </section>

    <template v-if="draft">
      <n-alert
        v-if="isGenerating"
        type="info"
        show-icon
        class="answer-generation-alert"
      >
        <template #header>
          正在请求大模型
        </template>
        {{ generationStatusCopy }}
      </n-alert>

      <n-alert
        v-else-if="draft.generationStatus === 'failed' && draft.generationError"
        type="error"
        show-icon
        class="answer-generation-alert"
      >
        <template #header>
          参考答案生成失败
        </template>
        <div class="stack-gap">
          <div>{{ draft.generationError }}</div>
          <div class="hero-actions">
            <n-button
              tertiary
              type="primary"
              :loading="retrying"
              @click="retryGeneration"
            >
              重新生成
            </n-button>
            <n-button
              tertiary
              @click="openSettings"
            >
              前往设置检查后端
            </n-button>
          </div>
        </div>
      </n-alert>

      <n-card
        class="surface-card"
        title="任务信息"
      >
        <div class="stack-gap">
          <div class="summary-row">
            <span>标题</span>
            <strong>{{ draft.title }}</strong>
          </div>
          <div class="summary-row">
            <span>模板</span>
            <strong>{{ preset?.name || '自定义内容' }}</strong>
          </div>
          <div class="summary-row">
            <span>生成状态</span>
            <StatusPill :value="draft.generationStatus" />
          </div>
          <div
            v-if="draft.generationStage"
            class="summary-row summary-row--stacked"
          >
            <span>当前阶段</span>
            <strong>{{ draft.generationStage }}</strong>
          </div>
          <div class="summary-row">
            <span>更新时间</span>
            <strong>{{ formatLocalDateTime(draft.updatedAt) }}</strong>
          </div>
          <div
            v-if="draft.lastGenerationStartedAt"
            class="summary-row"
          >
            <span>开始生成</span>
            <strong>{{ formatLocalDateTime(draft.lastGenerationStartedAt) }}</strong>
          </div>
          <div
            v-if="draft.lastGenerationCompletedAt"
            class="summary-row"
          >
            <span>最近结束</span>
            <strong>{{ formatLocalDateTime(draft.lastGenerationCompletedAt) }}</strong>
          </div>
          <div class="selected-tags">
            <n-tag
              type="primary"
              round
            >
              {{ preset?.name || '自定义内容' }}
            </n-tag>
            <n-tag
              type="info"
              round
            >
              {{ draft.sourceImages.length }} 张图片
            </n-tag>
          </div>
          <div
            v-if="preset"
            class="preset-panel"
          >
            <div class="preset-panel-title">
              模板说明
            </div>
            <div class="preset-panel-copy">
              {{ preset.description }}
            </div>
          </div>
          <div class="preset-panel">
            <div class="collapsible-panel-head">
              <div class="preset-panel-title">
                本次生成提示词
              </div>
              <n-button
                text
                type="primary"
                @click="promptExpanded = !promptExpanded"
              >
                {{ promptExpanded ? '收起' : '展开' }}
              </n-button>
            </div>
            <div class="preset-panel-prompt">
              {{ promptDisplayText }}
            </div>
          </div>
          <div class="preset-panel preset-panel--secondary">
            <div class="collapsible-panel-head">
              <div class="preset-panel-title">
                程序级提示词
              </div>
              <n-button
                text
                type="primary"
                @click="programPromptExpanded = !programPromptExpanded"
              >
                {{ programPromptExpanded ? '收起' : '展开' }}
              </n-button>
            </div>
            <div class="preset-panel-copy">
              {{ programPromptDisplayText }}
            </div>
          </div>
        </div>
      </n-card>

      <n-card
        class="surface-card editor-card"
        :title="isGenerating ? '生成中预览' : 'Markdown 编辑与预览'"
      >
        <div
          v-if="isGenerating"
          class="answer-generation-pending"
        >
          <n-spin size="large" />
          <div class="answer-generation-pending-copy">
            <strong>正在请求大模型</strong>
            <span>{{ draft.generationStage || '你可以离开当前页面，主进程会继续执行这个任务。' }}</span>
          </div>
          <div
            v-if="showReasoningStreamPanel"
            class="preset-panel preset-panel--stream"
          >
            <div class="preset-panel-title">
              模型思考过程（实时）
            </div>
            <div
              ref="reasoningStreamRef"
              class="preset-panel-copy preset-panel-copy--log stream-output-box"
            >
              {{ generationReasoningDisplayText }}
            </div>
          </div>
          <div
            v-if="showJsonStreamPanel"
            class="preset-panel preset-panel--stream"
          >
            <div class="preset-panel-title">
              模型实时输出（JSON 草稿）
            </div>
            <div
              ref="jsonStreamRef"
              class="preset-panel-copy preset-panel-copy--log stream-output-box"
            >
              {{ generationPreviewDisplayText }}
            </div>
          </div>
        </div>

        <div
          v-else
          class="editor-card-resizer"
        >
          <MdEditor
            class="editor-card-editor"
            :model-value="markdown"
            language="zh-CN"
            preview-theme="github"
            code-theme="github"
            :toolbars-exclude="['pageFullscreen', 'fullscreen', 'github']"
            @update:model-value="saveDraft"
          />
        </div>
      </n-card>

      <n-card
        class="surface-card"
        title="题目图片"
      >
        <div
          v-if="draft.sourceImages.length"
          class="image-grid"
        >
          <ImagePreviewTile
            v-for="(image, index) in draft.sourceImages"
            :key="image.src"
            :image="{
              src: image.src,
              title: `题目图片 ${index + 1}`,
              caption: image.name
            }"
          />
        </div>
        <n-empty
          v-else
          description="当前草稿没有关联题目图片"
        />
      </n-card>

      <n-card
        class="surface-card"
        title="后端日志"
      >
        <div class="preset-panel preset-panel--log">
          <div class="collapsible-panel-head">
            <div class="preset-panel-title">
              后端日志
            </div>
            <n-button
              text
              type="primary"
              @click="logsExpanded = !logsExpanded"
            >
              {{ logsExpanded ? '收起' : '展开' }}
            </n-button>
          </div>
          <div class="preset-panel-copy preset-panel-copy--log">
            {{ generationLogsDisplayText || '暂无后端日志' }}
          </div>
        </div>
      </n-card>
    </template>

    <n-card
      v-else
      class="surface-card"
    >
      <n-empty description="未找到这份参考答案草稿">
        <template #extra>
          <n-button
            type="primary"
            @click="goBack"
          >
            返回历史记录
          </n-button>
        </template>
      </n-empty>
    </n-card>
  </div>
</template>
