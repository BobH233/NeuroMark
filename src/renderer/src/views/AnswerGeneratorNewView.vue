<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NCard, NEmpty, NInput, NSelect, NSpace, NTag } from 'naive-ui';
import { useAnswerGeneratorStore } from '@/stores/answer-generator';
import { toImageSrc } from '@/utils/file';

interface PendingImage {
  id: string;
  source: string;
  name: string;
}

const router = useRouter();
const store = useAnswerGeneratorStore();

const selectedPreset = ref('');
const draftTitle = ref(createDefaultTitle());
const promptText = ref('');
const selectedImages = ref<PendingImage[]>([]);
const uploadZoneRef = ref<HTMLElement | null>(null);

const presetOptions = computed(() =>
  store.presets.map((item) => ({ label: item.name, value: item.id })),
);
const currentPreset = computed(() =>
  store.presets.find((item) => item.id === selectedPreset.value) ?? null,
);
const selectedImageSources = computed(() => selectedImages.value.map((item) => item.source));
const canCreate = computed(
  () =>
    draftTitle.value.trim().length > 0 &&
    promptText.value.trim().length > 0 &&
    selectedImages.value.length > 0,
);

watch(
  () => store.presets,
  (presets) => {
    if (!selectedPreset.value && presets.length > 0) {
      selectedPreset.value = presets[0].id;
    }
  },
  { immediate: true },
);

watch(
  () => selectedPreset.value,
  (value, previousValue) => {
    if (!value) {
      return;
    }

    const preset = store.presets.find((item) => item.id === value);
    if (!preset) {
      return;
    }

    if (value !== previousValue || !promptText.value.trim()) {
      promptText.value = preset.prompt;
    }
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('paste', handlePaste);
});

onBeforeUnmount(() => {
  window.removeEventListener('paste', handlePaste);
});

async function chooseImages() {
  try {
    const filePaths = await window.neuromark.app.selectImages();
    appendImages(
      filePaths.map((filePath, index) => ({
        id: createImageId(index),
        source: filePath,
        name: extractFileName(filePath, `题目图片 ${selectedImages.value.length + index + 1}`),
      })),
    );
  } catch (error) {
    window.alert(
      `打开图片选择器失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function createDraft() {
  if (!canCreate.value) {
    return;
  }

  const draft = await store.createDraft({
    title: draftTitle.value.trim(),
    promptPreset: selectedPreset.value,
    promptText: promptText.value.trim(),
    sourceImages: selectedImageSources.value,
  });
  router.replace(`/answer-generator/${draft.id}`);
}

function goBack() {
  router.push('/answer-generator');
}

function removeImage(imageId: string) {
  selectedImages.value = selectedImages.value.filter((item) => item.id !== imageId);
}

async function openPreview(imageId: string) {
  const currentIndex = selectedImages.value.findIndex((item) => item.id === imageId);
  if (currentIndex < 0) {
    return;
  }

  await window.neuromark.preview.open(
    selectedImages.value.map((item, index) => ({
      src: item.source,
      title: `题目图片 ${index + 1}`,
      caption: item.name,
    })),
    currentIndex,
    '题目图片预览',
  );
}

function clearImages() {
  selectedImages.value = [];
}

function focusUploadZone() {
  uploadZoneRef.value?.focus();
}

function handlePaste(event: ClipboardEvent) {
  const clipboardItems = Array.from(event.clipboardData?.items ?? []).filter((item) =>
    item.type.startsWith('image/'),
  );
  if (!clipboardItems.length) {
    return;
  }

  const target = event.target instanceof HTMLElement ? event.target : null;
  const targetInsideUploadZone = !!(target && uploadZoneRef.value?.contains(target));
  if (isEditableTarget(target) && !targetInsideUploadZone) {
    return;
  }

  event.preventDefault();
  void appendClipboardImages(clipboardItems);
}

async function appendClipboardImages(items: DataTransferItem[]) {
  const pastedImages = await Promise.all(
    items
      .map((item, index) => {
        const file = item.getAsFile();
        if (!file) {
          return null;
        }

        return readFileAsDataUrl(file).then((source) => ({
          id: createImageId(index),
          source,
          name: `粘贴图片 ${selectedImages.value.length + index + 1}.${getImageExtension(file.type)}`,
        }));
      })
      .filter((item): item is Promise<PendingImage> => item !== null),
  );

  appendImages(pastedImages);
}

function appendImages(images: PendingImage[]) {
  if (!images.length) {
    return;
  }

  const existingSources = new Set(selectedImages.value.map((item) => item.source));
  const uniqueImages = images.filter((item) => !existingSources.has(item.source));
  if (!uniqueImages.length) {
    return;
  }

  selectedImages.value = [...selectedImages.value, ...uniqueImages];
}

function createDefaultTitle() {
  return `参考答案草稿 ${new Date().toLocaleString('zh-CN')}`;
}

function createImageId(index: number) {
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 10)}`;
}

function extractFileName(filePath: string, fallback: string) {
  return filePath.split(/[/\\]/).pop() || fallback;
}

function isEditableTarget(target: HTMLElement | null) {
  if (!target) {
    return false;
  }

  return Boolean(target.closest('input, textarea, [contenteditable="true"]'));
}

function getImageExtension(mimeType: string) {
  return mimeType.split('/')[1] || 'png';
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取粘贴图片失败'));
    reader.readAsDataURL(file);
  });
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">
          新建生成任务
        </div>
        <h2 class="section-title">
          新建参考答案生成
        </h2>
        <p class="section-copy">
          按步骤填写本次生成信息。模板内容会先带入到本次提示词里，你可以继续手动改，但不会影响原模板。
        </p>
      </div>
      <n-button
        tertiary
        @click="goBack"
      >
        返回历史记录
      </n-button>
    </section>

    <section class="generator-create-flow">
      <n-card
        class="surface-card create-step-card"
        title="第一步：标题、模板与本次提示词"
      >
        <div class="stack-gap">
          <div class="stack-gap create-form-grid">
            <div class="stack-gap">
              <label
                class="field-label"
                for="answer-draft-title"
              >标题</label>
              <n-input
                id="answer-draft-title"
                v-model:value="draftTitle"
                placeholder="输入这次参考答案的标题"
                clearable
              />
            </div>

            <div class="stack-gap">
              <label
                class="field-label"
                for="answer-draft-preset"
              >模板选择</label>
              <n-select
                id="answer-draft-preset"
                v-model:value="selectedPreset"
                :options="presetOptions"
                placeholder="选择提示词模板"
                clearable
              />
            </div>
          </div>

          <div
            v-if="currentPreset"
            class="preset-panel"
          >
            <div class="preset-panel-title">
              {{ currentPreset.name }}
            </div>
            <div class="preset-panel-copy">
              {{ currentPreset.description }}
            </div>
          </div>

          <div class="stack-gap">
            <div class="field-head">
              <label
                class="field-label"
                for="answer-draft-prompt"
              >本次发送给 LLM 的内容</label>
            </div>
            <n-input
              id="answer-draft-prompt"
              v-model:value="promptText"
              type="textarea"
              placeholder="可以在模板基础上继续调整这次要发送给 LLM 的内容"
              :autosize="{ minRows: 7, maxRows: 14 }"
            />
          </div>
        </div>
      </n-card>

      <n-card
        class="surface-card create-step-card"
        title="第二步：上传题目图片"
      >
        <div class="stack-gap">
          <div class="field-head">
            <div class="field-label">
              题目图片
            </div>
            <span class="field-hint">支持点击选择，也支持聚焦此区域后按 Ctrl+V / Cmd+V 粘贴图片</span>
          </div>

          <div
            ref="uploadZoneRef"
            class="image-upload-zone"
            tabindex="0"
            @click="chooseImages"
            @keydown.enter.prevent="chooseImages"
            @keydown.space.prevent="chooseImages"
          >
            <div class="image-upload-title">
              点击选择图片或直接粘贴
            </div>
            <div class="image-upload-copy">
              可多次追加上传，支持 png、jpg、jpeg、webp、bmp、tif、tiff、svg。
            </div>
          </div>

          <NSpace>
            <n-button
              secondary
              type="primary"
              @click="chooseImages"
            >
              选择题目图片
            </n-button>
            <n-button
              tertiary
              :disabled="!selectedImages.length"
              @click="clearImages"
            >
              清空全部
            </n-button>
          </NSpace>

          <div
            v-if="selectedImages.length"
            class="upload-preview-grid"
          >
            <button
              v-for="(image, index) in selectedImages"
              :key="image.id"
              class="upload-preview-card"
              type="button"
              @click="openPreview(image.id)"
            >
              <img
                class="upload-preview-image"
                :src="toImageSrc(image.source)"
                :alt="image.name"
              >
              <div class="upload-preview-meta">
                <div class="upload-preview-title">
                  题目图片 {{ index + 1 }}
                </div>
                <div class="upload-preview-name">
                  {{ image.name }}
                </div>
              </div>
              <button
                class="upload-preview-remove"
                type="button"
                @click.stop="removeImage(image.id)"
              >
                删除
              </button>
            </button>
          </div>
          <n-empty
            v-else
            description="还没有上传题目图片"
          />
        </div>
      </n-card>

      <n-card
        class="surface-card create-step-card"
        title="第三步：确认创建"
      >
        <div class="stack-gap">
          <div class="summary-row">
            <span>标题</span>
            <strong>{{ draftTitle.trim() || '未填写' }}</strong>
          </div>
          <div class="summary-row">
            <span>模板</span>
            <strong>{{ currentPreset?.name || '未选择' }}</strong>
          </div>
          <div class="summary-row">
            <span>提示词字数</span>
            <strong>{{ promptText.trim().length }}</strong>
          </div>
          <div class="summary-row">
            <span>图片数量</span>
            <strong>{{ selectedImages.length }}</strong>
          </div>
          <div class="summary-row">
            <span>创建后</span>
            <strong>进入详情页继续编辑 Markdown</strong>
          </div>

          <div class="selected-tags">
            <n-tag
              v-if="draftTitle.trim()"
              type="info"
              round
            >
              {{ draftTitle.trim() }}
            </n-tag>
            <n-tag
              v-if="currentPreset"
              type="primary"
              round
            >
              {{ currentPreset.name }}
            </n-tag>
            <n-tag
              v-if="selectedImages.length"
              type="success"
              round
            >
              {{ selectedImages.length }} 张图片
            </n-tag>
          </div>

          <n-button
            type="primary"
            size="large"
            :disabled="!canCreate"
            @click="createDraft"
          >
            创建并进入详情
          </n-button>
        </div>
      </n-card>
    </section>
  </div>
</template>
