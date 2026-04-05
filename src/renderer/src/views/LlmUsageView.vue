<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue';
import { NButton, NCard, NEmpty, NForm, NFormItem, NInputNumber, NPagination, NSpin } from 'naive-ui';
import { useLlmUsageStore } from '@/stores/llm-usage';

const store = useLlmUsageStore();

const pricingForm = reactive({
  inputPerMillion: 2,
  outputPerMillion: 12,
  cacheReadPerMillion: 0.2,
  cacheWritePerMillion: 0,
  reasoningPerMillion: 0,
});

const summary = computed(() => store.summary);
const recordPage = computed(() => store.recordPage);
const recentRecords = computed(() => recordPage.value?.records ?? []);
const breakdown = computed(() => summary.value?.breakdown ?? []);

const statCards = computed(() => {
  if (!summary.value) {
    return [];
  }

  return [
    {
      key: 'cost',
      label: '累计费用估算',
      value: formatAmount(summary.value.estimatedCost),
      hint: `共记录 ${summary.value.requestCount} 次模型请求`,
    },
    {
      key: 'total',
      label: '累计总 Token',
      value: formatInteger(summary.value.totalTokens),
      hint: `输入 ${formatInteger(summary.value.inputTokens)} / 输出 ${formatInteger(summary.value.outputTokens)}`,
    },
    {
      key: 'input',
      label: '标准输入计费量',
      value: formatInteger(summary.value.billableInputTokens),
      hint: `缓存读取 ${formatInteger(summary.value.cacheReadTokens)} Token`,
    },
    {
      key: 'output',
      label: '输出计费量',
      value: formatInteger(summary.value.billableOutputTokens),
      hint: `思考 ${formatInteger(summary.value.reasoningTokens)} Token`,
    },
  ];
});

onMounted(async () => {
  const [loaded] = await Promise.all([
    store.loadSummary(),
    store.loadRecordPage(1, 20),
  ]);
  if (loaded) {
    applyPricing(loaded.pricing);
  }
});

async function refreshAll() {
  await Promise.all([
    store.loadSummary(),
    store.loadRecordPage(recordPage.value?.page ?? 1, recordPage.value?.pageSize ?? 20),
  ]);
}

function applyPricing(pricing: typeof pricingForm) {
  pricingForm.inputPerMillion = pricing.inputPerMillion;
  pricingForm.outputPerMillion = pricing.outputPerMillion;
  pricingForm.cacheReadPerMillion = pricing.cacheReadPerMillion;
  pricingForm.cacheWritePerMillion = pricing.cacheWritePerMillion;
  pricingForm.reasoningPerMillion = pricing.reasoningPerMillion;
}

async function savePricing() {
  const pricing = await store.savePricing({
    currency: 'CNY',
    inputPerMillion: pricingForm.inputPerMillion,
    outputPerMillion: pricingForm.outputPerMillion,
    cacheReadPerMillion: pricingForm.cacheReadPerMillion,
    cacheWritePerMillion: pricingForm.cacheWritePerMillion,
    reasoningPerMillion: pricingForm.reasoningPerMillion,
  });
  applyPricing(pricing);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('zh-CN', {
    hour12: false,
  });
}

async function handlePageChange(page: number) {
  await store.loadRecordPage(page, recordPage.value?.pageSize ?? 20);
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">模型用量与费用估算</div>
        <h2 class="section-title">模型计费</h2>
        <p class="section-copy">
          查看每次模型请求的 Token 用量，并按你设定的价格自动估算当前累计成本。
        </p>
      </div>
      <div class="hero-actions">
        <n-button tertiary :loading="store.loading || store.recordsLoading" @click="refreshAll">
          刷新统计
        </n-button>
      </div>
    </section>

    <section v-if="summary" class="llm-usage-stat-grid">
      <article
        v-for="item in statCards"
        :key="item.key"
        class="llm-usage-stat-card surface-card"
      >
        <div class="llm-usage-stat-label">{{ item.label }}</div>
        <div class="llm-usage-stat-value">{{ item.value }}</div>
        <div class="llm-usage-stat-hint">{{ item.hint }}</div>
      </article>
    </section>

    <section class="llm-usage-layout">
      <n-card class="surface-card" title="价格设置">
        <n-form label-placement="top">
          <n-form-item label="标准输入（每百万 Token）">
            <n-input-number v-model:value="pricingForm.inputPerMillion" :min="0" :precision="4" />
          </n-form-item>
          <n-form-item label="标准输出（每百万 Token）">
            <n-input-number v-model:value="pricingForm.outputPerMillion" :min="0" :precision="4" />
          </n-form-item>
          <n-form-item label="上下文缓存读取（每百万 Token）">
            <n-input-number v-model:value="pricingForm.cacheReadPerMillion" :min="0" :precision="4" />
          </n-form-item>
          <n-form-item label="上下文缓存写入（每百万 Token）">
            <n-input-number v-model:value="pricingForm.cacheWritePerMillion" :min="0" :precision="4" />
          </n-form-item>
          <n-form-item label="思考 Token（每百万 Token）">
            <n-input-number v-model:value="pricingForm.reasoningPerMillion" :min="0" :precision="4" />
          </n-form-item>

          <div class="settings-actions">
            <n-button type="primary" :loading="store.saving" @click="savePricing">
              保存价格设置
            </n-button>
          </div>
        </n-form>
      </n-card>

      <n-card class="surface-card" title="按请求类型统计">
        <div v-if="breakdown.length" class="llm-usage-breakdown">
          <div v-for="item in breakdown" :key="item.source" class="llm-usage-breakdown-row">
            <div>
              <div class="llm-usage-breakdown-title">{{ item.label }}</div>
              <div class="llm-usage-breakdown-copy">
                {{ item.requestCount }} 次请求 · 总 Token {{ formatInteger(item.totalTokens) }}
              </div>
            </div>
            <div class="llm-usage-breakdown-meta">
              {{ formatAmount(item.estimatedCost) }}
            </div>
          </div>
        </div>
        <n-empty
          v-else
          description="还没有可统计的模型请求记录。完成一次生成、批阅或连接测试后，这里会自动出现数据。"
        />
      </n-card>
    </section>

    <n-card class="surface-card" title="请求明细">
      <n-spin :show="store.recordsLoading">
      <div v-if="recentRecords.length" class="llm-usage-record-list">
        <article v-for="record in recentRecords" :key="record.id" class="llm-usage-record">
          <div class="llm-usage-record-head">
            <div>
              <div class="llm-usage-record-title">{{ record.label }}</div>
              <div class="llm-usage-record-subtitle">
                {{ record.model }} · {{ formatTime(record.createdAt) }}
              </div>
            </div>
            <div class="llm-usage-record-cost">
              {{ formatAmount(record.estimatedCost) }}
            </div>
          </div>

          <div class="llm-usage-record-grid">
            <div class="llm-usage-record-item">
              <div class="llm-usage-record-label">输入</div>
              <div class="llm-usage-record-value">{{ formatInteger(record.inputTokens) }}</div>
            </div>
            <div class="llm-usage-record-item">
              <div class="llm-usage-record-label">输出</div>
              <div class="llm-usage-record-value">{{ formatInteger(record.outputTokens) }}</div>
            </div>
            <div class="llm-usage-record-item">
              <div class="llm-usage-record-label">思考</div>
              <div class="llm-usage-record-value">{{ formatInteger(record.reasoningTokens) }}</div>
            </div>
            <div class="llm-usage-record-item">
              <div class="llm-usage-record-label">缓存读取</div>
              <div class="llm-usage-record-value">{{ formatInteger(record.cacheReadTokens) }}</div>
            </div>
            <div class="llm-usage-record-item">
              <div class="llm-usage-record-label">缓存写入</div>
              <div class="llm-usage-record-value">{{ formatInteger(record.cacheWriteTokens) }}</div>
            </div>
            <div class="llm-usage-record-item">
              <div class="llm-usage-record-label">总 Token</div>
              <div class="llm-usage-record-value">{{ formatInteger(record.totalTokens) }}</div>
            </div>
          </div>
        </article>
        <div class="llm-usage-pagination">
          <n-pagination
            :page="recordPage?.page || 1"
            :page-size="recordPage?.pageSize || 20"
            :item-count="recordPage?.total || 0"
            @update:page="handlePageChange"
          />
        </div>
      </div>
      <n-empty
        v-else
        description="还没有请求明细。完成一次模型调用后，这里会自动记录。"
      />
      </n-spin>
    </n-card>
  </div>
</template>
