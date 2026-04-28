<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue';
import {
  NButton,
  NCard,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NPopconfirm,
  NTag,
  useMessage,
} from 'naive-ui';
import type { ScorePostProcessPreset } from '@preload/contracts';
import { useScorePostProcessStore } from '@/stores/score-post-process';
import { SCORE_POST_PROCESS_EDITOR_TYPES } from '@/utils/score-post-process';
import CodeEditor from './CodeEditor.vue';

const message = useMessage();
const store = useScorePostProcessStore();

const presetForm = reactive({
  id: '',
  name: '',
  description: '',
  code: '',
  readonly: false,
});

const presets = computed(() => store.presets);
const editorTitle = computed(() => {
  if (presetForm.readonly) {
    return '查看内置预设';
  }
  return presetForm.id ? '编辑自定义预设' : '新建自定义预设';
});

onMounted(async () => {
  if (!store.presets.length) {
    await store.loadPresets();
  }

  if (store.presets.length && !presetForm.code) {
    editPreset(store.presets[0]);
  }
});

function editPreset(preset: ScorePostProcessPreset) {
  presetForm.id = preset.id;
  presetForm.name = preset.name;
  presetForm.description = preset.description;
  presetForm.code = preset.code;
  presetForm.readonly = preset.readonly;
}

function startCreatePreset() {
  presetForm.id = '';
  presetForm.name = '';
  presetForm.description = '';
  presetForm.code = `return papers.map((paper) => ({
  paperId: paper.paperId,
  processedScore: paper.totalScore,
  note: '这里开始写你的后处理逻辑。',
  metadata: {
    originalScore: paper.totalScore,
  },
}));`;
  presetForm.readonly = false;
}

async function savePreset() {
  try {
    await store.savePreset({
      id: presetForm.readonly ? undefined : presetForm.id || undefined,
      name: presetForm.name,
      description: presetForm.description,
      code: presetForm.code,
    });
    message.success('脚本预设已保存。');
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '保存脚本预设失败。',
    );
  }
}

async function clonePreset() {
  try {
    const preset = await store.savePreset({
      name: `${presetForm.name.trim() || '未命名脚本'} 复制`,
      description: presetForm.description,
      code: presetForm.code,
    });
    editPreset(preset);
    message.success('已复制为新的自定义预设。');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '复制预设失败。');
  }
}

async function deletePreset(presetId: string) {
  try {
    await store.deletePreset(presetId);
    message.success('自定义脚本预设已删除。');
    startCreatePreset();
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '删除脚本预设失败。',
    );
  }
}
</script>

<template>
  <section class="settings-template-layout">
    <n-card class="surface-card" title="分数后处理脚本预设">
      <div v-if="presets.length" class="settings-template-list">
        <button
          v-for="preset in presets"
          :key="preset.id"
          class="settings-template-item"
          :class="{ active: presetForm.id === preset.id }"
          @click="editPreset(preset)"
        >
          <div
            class="settings-template-item-head settings-template-item-head--with-tag"
          >
            <div class="settings-template-item-title">{{ preset.name }}</div>
            <n-tag
              size="small"
              round
              :type="preset.source === 'builtin' ? 'info' : 'success'"
              :bordered="false"
            >
              {{ preset.source === 'builtin' ? '内置' : '自定义' }}
            </n-tag>
          </div>
          <div class="settings-template-item-copy">
            {{ preset.description || '未填写脚本说明' }}
          </div>
        </button>
      </div>
      <n-empty
        v-else
        class="settings-template-empty"
        description="还没有分数后处理脚本预设。"
      />

      <div
        class="settings-actions settings-template-actions"
        :class="{ 'settings-actions--empty': !presets.length }"
      >
        <n-button tertiary @click="startCreatePreset">新建预设</n-button>
        <n-button
          v-if="presetForm.code.trim()"
          tertiary
          type="primary"
          @click="clonePreset"
        >
          克隆预设
        </n-button>
        <n-popconfirm
          v-if="presetForm.id && !presetForm.readonly"
          positive-text="删除"
          negative-text="取消"
          @positive-click="deletePreset(presetForm.id)"
        >
          <template #trigger>
            <n-button tertiary type="error">删除预设</n-button>
          </template>
          删除后将无法恢复，确认继续吗？
        </n-popconfirm>
      </div>
    </n-card>

    <n-card class="surface-card" :title="editorTitle">
      <n-form label-placement="top">
        <n-form-item label="脚本名称">
          <n-input
            v-model:value="presetForm.name"
            :disabled="presetForm.readonly"
            placeholder="例如：作业归一化到 60-100"
          />
        </n-form-item>
        <n-form-item label="脚本说明">
          <n-input
            v-model:value="presetForm.description"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 5 }"
            :disabled="presetForm.readonly"
            placeholder="简单说明这个脚本适合的场景"
          />
        </n-form-item>
        <n-form-item label="脚本内容（JavaScript）">
          <CodeEditor
            v-model="presetForm.code"
            :readonly="presetForm.readonly"
            height="460px"
            :extra-libs="[
              {
                content: SCORE_POST_PROCESS_EDITOR_TYPES,
                filePath: 'inmemory://score-post-process/global.d.ts',
              },
            ]"
          />
        </n-form-item>

        <div class="settings-actions">
          <n-button
            v-if="!presetForm.readonly"
            type="primary"
            :disabled="!presetForm.name.trim() || !presetForm.code.trim()"
            @click="savePreset"
          >
            保存预设
          </n-button>
          <div v-else class="detail-subtitle">
            当前是系统内置预设，不能直接修改；如需调整，请先复制为自定义预设。
          </div>
        </div>
      </n-form>
    </n-card>
  </section>
</template>
