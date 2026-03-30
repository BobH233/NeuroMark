<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NPopconfirm,
  NSelect,
} from 'naive-ui';
import type { LlmReasoningEffort, PromptPreset } from '@preload/contracts';
import { useAnswerGeneratorStore } from '@/stores/answer-generator';
import { useSettingsStore } from '@/stores/settings';

const settingsStore = useSettingsStore();
const answerGeneratorStore = useAnswerGeneratorStore();

const form = reactive({
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1',
  apiKey: '',
  timeoutMs: 180000,
  reasoningEffort: 'medium' as LlmReasoningEffort,
});

const reasoningEffortOptions = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
] satisfies Array<{ label: string; value: LlmReasoningEffort }>;

const presetForm = reactive({
  id: '',
  name: '',
  description: '',
  prompt: '',
});

const presets = computed(() => answerGeneratorStore.presets);
const presetEditorTitle = computed(() => (presetForm.id ? '编辑模板' : '新建模板'));
const testFeedback = ref<{
  type: 'success' | 'error';
  title: string;
  text: string;
} | null>(null);

onMounted(async () => {
  await Promise.all([settingsStore.load(), answerGeneratorStore.bootstrap()]);

  if (settingsStore.settings) {
    form.baseUrl = settingsStore.settings.baseUrl;
    form.model = settingsStore.settings.model;
    form.apiKey = settingsStore.settings.apiKey;
    form.timeoutMs = settingsStore.settings.timeoutMs;
    form.reasoningEffort = settingsStore.settings.reasoningEffort;
  }
});

async function save() {
  const settings = await settingsStore.save({ ...form });
  form.apiKey = settings.apiKey;
}

async function test() {
  if (!form.apiKey.trim()) {
    testFeedback.value = {
      type: 'error',
      title: '请先填写 API Key',
      text: '当前还没有可用的 API Key，无法发起连接测试。',
    };
    return;
  }

  try {
    const result = await settingsStore.test({ ...form, apiKey: form.apiKey || '' });
    testFeedback.value = result.success
      ? {
          type: 'success',
          title: '连接测试成功',
          text: `${result.message} 耗时：${result.latencyMs} ms`,
        }
      : {
          type: 'error',
          title: '连接测试失败',
          text: `${result.message} 耗时：${result.latencyMs} ms`,
        };
  } catch (error) {
    testFeedback.value = {
      type: 'error',
      title: '连接测试失败',
      text: error instanceof Error ? error.message : '发生了未知错误，请检查配置后重试。',
    };
  }
}

function startCreatePreset() {
  presetForm.id = '';
  presetForm.name = '';
  presetForm.description = '';
  presetForm.prompt = '';
}

function editPreset(preset: PromptPreset) {
  presetForm.id = preset.id;
  presetForm.name = preset.name;
  presetForm.description = preset.description;
  presetForm.prompt = preset.prompt;
}

async function savePreset() {
  await answerGeneratorStore.savePromptPreset({
    id: presetForm.id || undefined,
    name: presetForm.name,
    description: presetForm.description,
    prompt: presetForm.prompt,
  });
  startCreatePreset();
}

async function clonePreset() {
  if (!presetForm.id) {
    return;
  }

  const clonedPreset = await answerGeneratorStore.savePromptPreset({
    name: `${presetForm.name.trim() || '未命名模板'} 复制`,
    description: presetForm.description,
    prompt: presetForm.prompt,
  });
  editPreset(clonedPreset);
}

async function deletePreset(presetId: string) {
  await answerGeneratorStore.deletePromptPreset(presetId);
  if (presetForm.id === presetId) {
    startCreatePreset();
  }
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">全局后端能力配置</div>
        <h2 class="section-title">全局设置页面</h2>
        <p class="section-copy">
          配置模型后端，并统一维护参考答案生成使用的模板。
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
            placeholder="直接填写用于调用模型的 API Key"
          />
        </n-form-item>
        <n-form-item label="请求超时（毫秒）">
          <n-input-number v-model:value="form.timeoutMs" :min="5000" :max="600000" />
        </n-form-item>
        <n-form-item label="思考强度">
          <n-select
            v-model:value="form.reasoningEffort"
            :options="reasoningEffortOptions"
            placeholder="选择模型思考强度"
          />
        </n-form-item>

        <div class="settings-actions">
          <n-button secondary type="primary" :loading="settingsStore.testing" @click="test">
            测试连接
          </n-button>
          <n-button type="primary" @click="save">保存设置</n-button>
        </div>

        <n-alert
          v-if="testFeedback"
          class="settings-inline-feedback"
          :type="testFeedback.type"
          :title="testFeedback.title"
          show-icon
        >
          {{ testFeedback.text }}
        </n-alert>
      </n-form>
    </n-card>

    <section class="settings-template-layout">
      <n-card class="surface-card" title="参考答案生成模板">
        <div v-if="presets.length" class="settings-template-list">
          <button
            v-for="preset in presets"
            :key="preset.id"
            class="settings-template-item"
            :class="{ active: presetForm.id === preset.id }"
            @click="editPreset(preset)"
          >
            <div class="settings-template-item-head">
              <div class="settings-template-item-title">{{ preset.name }}</div>
            </div>
            <div class="settings-template-item-copy">
              {{ preset.description || '未填写模板说明' }}
            </div>
          </button>
        </div>
        <n-empty
          v-else
          class="settings-template-empty"
          description="还没有模板，先新建一个参考答案生成模板。"
        />

        <div
          class="settings-actions settings-template-actions"
          :class="{ 'settings-actions--empty': !presets.length }"
        >
          <n-button tertiary @click="startCreatePreset">新建模板</n-button>
          <n-button
            v-if="presetForm.id"
            tertiary
            type="primary"
            @click="clonePreset"
          >
            克隆模板
          </n-button>
          <n-popconfirm
            v-if="presetForm.id"
            positive-text="删除"
            negative-text="取消"
            @positive-click="deletePreset(presetForm.id)"
          >
            <template #trigger>
              <n-button tertiary type="error">删除当前模板</n-button>
            </template>
            删除这个模板后将无法恢复，确认继续吗？
          </n-popconfirm>
        </div>
      </n-card>

      <n-card class="surface-card" :title="presetEditorTitle">
        <n-form label-placement="top">
          <n-form-item label="模板名称">
            <n-input v-model:value="presetForm.name" placeholder="例如：物理计算题模板" />
          </n-form-item>
          <n-form-item label="模板说明">
            <n-input
              v-model:value="presetForm.description"
              placeholder="简单说明这个模板适合什么场景"
            />
          </n-form-item>
          <n-form-item label="模板内容（Markdown）">
            <n-input
              v-model:value="presetForm.prompt"
              type="textarea"
              :autosize="{ minRows: 12, maxRows: 20 }"
              placeholder="在这里填写 Markdown 格式的参考答案生成模板内容"
            />
          </n-form-item>

          <div class="settings-actions">
            <n-button type="primary" :disabled="!presetForm.name.trim() || !presetForm.prompt.trim()" @click="savePreset">
              保存模板
            </n-button>
          </div>
        </n-form>
      </n-card>
    </section>
  </div>
</template>
