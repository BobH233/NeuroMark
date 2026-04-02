<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { NButton, NCard, NEmpty } from 'naive-ui';
import { useRouter } from 'vue-router';
import { useDebugPanelStore } from '@/stores/debug-panel';

const router = useRouter();
const debugPanelStore = useDebugPanelStore();
const outputRef = ref<HTMLElement | null>(null);

const isEnabled = computed(() => debugPanelStore.enabled);
const outputText = computed(() => debugPanelStore.output);
const formattedOutputText = computed(() => debugPanelStore.formattedOutput);

onMounted(async () => {
  await debugPanelStore.initialize();
});

watch(
  () => debugPanelStore.entries.length,
  async () => {
    await nextTick();
    const element = outputRef.value;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  },
);

async function copyOutput() {
  if (!formattedOutputText.value.trim()) {
    return;
  }

  await navigator.clipboard.writeText(formattedOutputText.value);
}

async function openDevTools() {
  await window.neuromark.app.openDevTools();
}

function goToSettings() {
  void router.push('/settings');
}
</script>

<template>
  <div class="page-stack">
    <section class="hero-panel">
      <div>
        <div class="eyebrow">运行时排错工具</div>
        <h2 class="section-title">调试面板</h2>
        <p class="section-copy">
          同步展示主进程标准输出，便于在打包版本中收集现场日志。
        </p>
      </div>
    </section>

    <n-card v-if="isEnabled" class="surface-card" title="终端输出">
      <div class="settings-actions debug-panel-actions">
        <n-button tertiary @click="openDevTools">
          打开开发者工具
        </n-button>
        <n-button tertiary type="primary" :disabled="!outputText.trim()" @click="copyOutput">
          复制全部日志
        </n-button>
      </div>

      <div v-if="formattedOutputText.trim()" ref="outputRef" class="debug-output-panel">
        <pre class="debug-output-text">{{ formattedOutputText }}</pre>
      </div>
      <n-empty
        v-else
        class="settings-template-empty"
        description="当前还没有捕获到主进程标准输出。"
      />
    </n-card>

    <n-card v-else class="surface-card" title="调试面板未启用">
      <n-empty description="打包版本默认隐藏。连续点击左上角 Logo 5 次后即可启用。">
        <template #extra>
          <n-button tertiary @click="goToSettings">返回全局设置</n-button>
        </template>
      </n-empty>
    </n-card>
  </div>
</template>
