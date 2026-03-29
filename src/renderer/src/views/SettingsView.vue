<script setup lang="ts">
import { onMounted, reactive } from 'vue';
import { NButton, NCard, NForm, NFormItem, NInput, NInputNumber } from 'naive-ui';
import { useSettingsStore } from '@/stores/settings';

const store = useSettingsStore();
const form = reactive({
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1',
  apiKey: '',
  timeoutMs: 180000,
});

onMounted(async () => {
  await store.load();
  if (store.settings) {
    form.baseUrl = store.settings.baseUrl;
    form.model = store.settings.model;
    form.timeoutMs = store.settings.timeoutMs;
  }
});

async function save() {
  await store.save({ ...form });
}

async function test() {
  const result = await store.test({ ...form, apiKey: form.apiKey || '' });
  window.alert(`${result.message}\n耗时：${result.latencyMs} ms`);
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">全局后端能力配置</div>
        <h2 class="section-title">全局设置页面</h2>
        <p class="section-copy">
          配置用于参考答案生成与批阅任务的模型后端、访问密钥与连接参数。
        </p>
      </div>
    </section>

    <n-card class="surface-card settings-card" title="OpenAI 兼容后端">
      <n-form label-placement="top">
        <n-form-item label="Base URL">
          <n-input v-model:value="form.baseUrl" placeholder="https://api.openai.com/v1" />
        </n-form-item>
        <n-form-item label="模型名称">
          <n-input v-model:value="form.model" placeholder="gpt-4.1" />
        </n-form-item>
        <n-form-item label="API Key">
          <n-input
            v-model:value="form.apiKey"
            type="password"
            show-password-on="click"
            placeholder="留空则保持现有已保存的密钥"
          />
        </n-form-item>
        <n-form-item label="请求超时（毫秒）">
          <n-input-number v-model:value="form.timeoutMs" :min="5000" :max="600000" />
        </n-form-item>

        <div class="settings-foot">
          <div v-if="store.settings" class="stored-key-copy">
            已保存密钥：{{ store.settings.apiKeyStored ? store.settings.apiKeyMasked : '未设置' }} ·
            存储方式：{{ store.settings.storageMode === 'safeStorage' ? '系统加密' : '明文降级' }}
          </div>
          <div class="settings-actions">
            <n-button secondary type="primary" :loading="store.testing" @click="test">
              测试连接
            </n-button>
            <n-button type="primary" @click="save">保存设置</n-button>
          </div>
        </div>
      </n-form>
    </n-card>
  </div>
</template>
