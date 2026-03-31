<script setup lang="ts">
import { reactive, watch } from 'vue';
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSwitch,
} from 'naive-ui';
import type { CreateProjectInput } from '@preload/contracts';

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'submit', payload: CreateProjectInput): void;
}>();

const model = reactive<CreateProjectInput>({
  name: '',
  basePath: '',
  gradingConcurrency: 1,
  drawRegions: false,
  defaultImageDetail: 'high',
});

async function fillDefaultBasePath(force = false) {
  if (model.basePath && !force) {
    return;
  }
  model.basePath = await window.neuromark.app.getDefaultProjectBasePath();
}

watch(
  () => props.show,
  async (value) => {
    if (!value) {
      model.name = '';
      model.basePath = '';
      model.gradingConcurrency = 1;
      model.drawRegions = false;
      model.defaultImageDetail = 'high';
      return;
    }

    await fillDefaultBasePath();
  },
);

async function chooseDirectory() {
  const selected = await window.neuromark.app.selectDirectory();
  if (selected) {
    model.basePath = selected;
  }
}

function submit() {
  emit('submit', { ...model });
}
</script>

<template>
  <n-modal :show="show" preset="card" title="新建阅卷项目" class="project-modal" @close="emit('close')">
    <n-form label-placement="top" class="stack-form create-project-form">
      <n-form-item label="项目名称">
        <n-input v-model:value="model.name" placeholder="例如：第二章随堂练习" />
      </n-form-item>
      <n-form-item label="项目目录">
        <div class="create-project-path-row">
          <n-input
            v-model:value="model.basePath"
            class="create-project-path-input"
            placeholder="请选择项目保存目录"
          />
          <n-button secondary type="primary" @click="chooseDirectory">选择目录</n-button>
        </div>
      </n-form-item>
      <div class="two-col create-project-settings-grid">
        <n-form-item label="默认并行数">
          <n-input-number v-model:value="model.gradingConcurrency" :min="1" class="create-project-half-input" />
        </n-form-item>
        <n-form-item label="默认图像细节">
          <n-select
            v-model:value="model.defaultImageDetail"
            class="create-project-half-input"
            :options="[
              { label: '高', value: 'high' },
              { label: '自动', value: 'auto' },
              { label: '低', value: 'low' },
            ]"
          />
        </n-form-item>
      </div>
      <div class="create-project-toggle-row">
        <div class="create-project-toggle-copy">
          <div class="field-label">默认启用绘制批阅区域</div>
          <div class="field-hint">开启后会在批阅视图中显示题目边界框，便于复核。</div>
        </div>
        <n-switch v-model:value="model.drawRegions" />
      </div>
    </n-form>
    <template #footer>
      <div class="modal-footer">
        <n-button @click="emit('close')">取消</n-button>
        <n-button type="primary" :disabled="!model.name || !model.basePath" @click="submit">
          创建项目
        </n-button>
      </div>
    </template>
  </n-modal>
</template>
