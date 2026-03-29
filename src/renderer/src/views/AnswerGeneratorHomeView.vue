<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NCard, NEmpty, NTag } from 'naive-ui';
import { useAnswerGeneratorStore } from '@/stores/answer-generator';

const router = useRouter();
const store = useAnswerGeneratorStore();

const drafts = computed(() => store.drafts);

function openDraft(draftId: string) {
  router.push(`/answer-generator/${draftId}`);
}

function createNewDraft() {
  router.push('/answer-generator/new');
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">历史记录</div>
        <h2 class="section-title">参考答案生成</h2>
        <p class="section-copy">
          查看已经生成过的参考答案，或新建一次新的生成任务。
        </p>
      </div>
      <n-button type="primary" size="large" @click="createNewDraft">
        新建参考答案生成
      </n-button>
    </section>

    <section v-if="drafts.length" class="draft-grid">
      <button
        v-for="draft in drafts"
        :key="draft.id"
        class="draft-card"
        @click="openDraft(draft.id)"
      >
        <div class="draft-card-head">
          <div class="draft-card-title">{{ draft.title }}</div>
          <n-tag size="small" round type="primary">
            {{ draft.promptPreset }}
          </n-tag>
        </div>
        <div class="draft-card-meta">
          最近更新时间：{{ draft.updatedAt }}
        </div>
        <div class="draft-card-meta">
          图片数量：{{ draft.sourceImages.length }}
        </div>
        <div class="draft-card-snippet">
          {{ draft.markdown.slice(0, 120) }}{{ draft.markdown.length > 120 ? '...' : '' }}
        </div>
      </button>
    </section>

    <n-card v-else class="surface-card">
      <n-empty description="暂无历史记录">
        <template #extra>
          <n-button type="primary" @click="createNewDraft">新建参考答案生成</n-button>
        </template>
      </n-empty>
    </n-card>
  </div>
</template>

