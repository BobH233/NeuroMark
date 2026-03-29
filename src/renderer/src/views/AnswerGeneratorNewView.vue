<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NCard, NEmpty, NSelect, NSpace, NTag } from 'naive-ui';
import { useAnswerGeneratorStore } from '@/stores/answer-generator';

const router = useRouter();
const store = useAnswerGeneratorStore();

const selectedPreset = ref('');
const selectedImages = ref<string[]>([]);

const currentPreset = computed(() =>
  store.presets.find((item) => item.id === selectedPreset.value) ?? null,
);

if (!selectedPreset.value && store.presets.length > 0) {
  selectedPreset.value = store.presets[0].id;
}

async function chooseImages() {
  selectedImages.value = await window.neuromark.app.selectImages();
}

async function createDraft() {
  if (!selectedPreset.value) {
    return;
  }
  const draft = await store.createDraft({
    promptPreset: selectedPreset.value,
    sourceImages: selectedImages.value,
  });
  router.replace(`/answer-generator/${draft.id}`);
}

function goBack() {
  router.push('/answer-generator');
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">新建生成任务</div>
        <h2 class="section-title">新建参考答案生成</h2>
        <p class="section-copy">
          先选择模板和题目图片，创建完成后进入详情页查看预览与编辑结果。
        </p>
      </div>
      <n-button tertiary @click="goBack">返回历史记录</n-button>
    </section>

    <section class="generator-create-layout">
      <n-card class="surface-card" title="模板选择">
        <div class="stack-gap">
          <n-select
            v-model:value="selectedPreset"
            :options="store.presets.map((item) => ({ label: item.name, value: item.id }))"
            placeholder="选择提示词模板"
          />
          <div v-if="currentPreset" class="preset-panel">
            <div class="preset-panel-title">{{ currentPreset.name }}</div>
            <div class="preset-panel-copy">{{ currentPreset.description }}</div>
            <div class="preset-panel-prompt">{{ currentPreset.prompt }}</div>
          </div>
          <n-empty v-else description="请选择一个模板" />
        </div>
      </n-card>

      <n-card class="surface-card" title="题目图片">
        <div class="stack-gap">
          <NSpace>
            <n-button secondary type="primary" @click="chooseImages">选择题目图片</n-button>
            <n-button tertiary @click="selectedImages = []">清空</n-button>
          </NSpace>
          <div v-if="selectedImages.length" class="selected-files">
            <span
              v-for="file in selectedImages"
              :key="file"
              class="file-chip"
            >
              {{ file.split('/').pop() }}
            </span>
          </div>
          <n-empty v-else description="还没有选择图片" />
        </div>
      </n-card>

      <n-card class="surface-card" title="创建确认">
        <div class="stack-gap">
          <div class="summary-row">
            <span>模板</span>
            <strong>{{ currentPreset?.name || '未选择' }}</strong>
          </div>
          <div class="summary-row">
            <span>图片数量</span>
            <strong>{{ selectedImages.length }}</strong>
          </div>
          <div class="summary-row">
            <span>创建后</span>
            <strong>进入详情页编辑 Markdown</strong>
          </div>
          <div class="selected-tags">
            <n-tag v-if="currentPreset" type="primary" round>{{ currentPreset.name }}</n-tag>
            <n-tag v-if="selectedImages.length" type="success" round>{{ selectedImages.length }} 张图片</n-tag>
          </div>
          <n-button
            type="primary"
            size="large"
            :disabled="!selectedPreset"
            @click="createDraft"
          >
            创建并进入详情
          </n-button>
        </div>
      </n-card>
    </section>
  </div>
</template>

