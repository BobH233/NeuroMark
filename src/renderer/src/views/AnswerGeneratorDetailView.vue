<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MdEditor } from 'md-editor-v3';
import { NButton, NCard, NEmpty, NTag } from 'naive-ui';
import ImagePreviewTile from '@/components/ImagePreviewTile.vue';
import { useAnswerGeneratorStore } from '@/stores/answer-generator';

const route = useRoute();
const router = useRouter();
const store = useAnswerGeneratorStore();
const markdown = ref('');

const draftId = computed(() => String(route.params.draftId ?? ''));
const draft = computed(() => store.getDraftById(draftId.value));
const preset = computed(() =>
  store.presets.find((item) => item.id === draft.value?.promptPreset) ?? null,
);

watch(
  () => draft.value,
  (value) => {
    markdown.value = value?.markdown ?? '';
  },
  { immediate: true },
);

onMounted(async () => {
  if (store.drafts.length === 0) {
    await store.bootstrap();
  }
});

async function saveDraft(value: string) {
  markdown.value = value;
  if (!draft.value) {
    return;
  }
  await store.updateDraft(draft.value.id, value);
}

function goBack() {
  router.push('/answer-generator');
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">详情页</div>
        <h2 class="section-title">{{ draft?.title || '参考答案详情' }}</h2>
        <p class="section-copy">
          在这里查看 Markdown 预览、直接编辑内容，并回看本次生成关联的题目图片。
        </p>
      </div>
      <n-button tertiary @click="goBack">返回历史记录</n-button>
    </section>

    <template v-if="draft">
      <section class="answer-detail-layout">
        <n-card class="surface-card answer-side-card" title="任务信息">
          <div class="stack-gap">
            <div class="summary-row">
              <span>标题</span>
              <strong>{{ draft.title }}</strong>
            </div>
            <div class="summary-row">
              <span>模板</span>
              <strong>{{ preset?.name || draft.promptPreset }}</strong>
            </div>
            <div class="summary-row">
              <span>更新时间</span>
              <strong>{{ draft.updatedAt }}</strong>
            </div>
            <div class="selected-tags">
              <n-tag type="primary" round>{{ preset?.name || draft.promptPreset }}</n-tag>
              <n-tag type="info" round>{{ draft.sourceImages.length }} 张图片</n-tag>
            </div>
            <div v-if="preset" class="preset-panel">
              <div class="preset-panel-title">模板说明</div>
              <div class="preset-panel-copy">{{ preset.description }}</div>
            </div>
          </div>
        </n-card>

        <n-card class="surface-card editor-card" title="Markdown 编辑与预览">
          <MdEditor
            :model-value="markdown"
            language="zh-CN"
            preview-theme="github"
            code-theme="github"
            @update:model-value="saveDraft"
          />
        </n-card>
      </section>

      <n-card class="surface-card" title="题目图片">
        <div v-if="draft.sourceImages.length" class="image-grid">
          <ImagePreviewTile
            v-for="(image, index) in draft.sourceImages"
            :key="image"
            :image="{
              src: image,
              title: `题目图片 ${index + 1}`,
              caption: image.split('/').pop()
            }"
          />
        </div>
        <n-empty v-else description="当前草稿没有关联题目图片" />
      </n-card>
    </template>

    <n-card v-else class="surface-card">
      <n-empty description="未找到这份参考答案草稿">
        <template #extra>
          <n-button type="primary" @click="goBack">返回历史记录</n-button>
        </template>
      </n-empty>
    </n-card>
  </div>
</template>
