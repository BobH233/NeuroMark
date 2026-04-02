<script lang="ts">
import katex from 'katex';
import { config } from 'md-editor-v3';

config({
  editorExtensions: {
    katex: {
      instance: katex,
    },
  },
});
</script>

<script setup lang="ts">
import DOMPurify from 'dompurify';
import { MdPreview } from 'md-editor-v3';

const props = defineProps<{
  source: string;
}>();

const previewId = `markdown-preview-${Math.random().toString(36).slice(2, 10)}`;

function sanitize(html: string) {
  return DOMPurify.sanitize(html);
}
</script>

<template>
  <MdPreview
    :editor-id="previewId"
    class="markdown-preview"
    theme="light"
    preview-theme="default"
    :model-value="props.source || ''"
    :sanitize="sanitize"
    :no-highlight="true"
    :no-mermaid="true"
    :no-echarts="true"
    no-img-zoom-in
  />
</template>
