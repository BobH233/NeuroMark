<script setup lang="ts">
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';
import markdownItKatex from 'markdown-it-katex';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';

const props = defineProps<{
  source: string;
}>();

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(code, language): string {
    if (language && hljs.getLanguage(language)) {
      return `<pre class="hljs"><code>${hljs.highlight(code, {
        language,
      }).value}</code></pre>`;
    }
    return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
  },
});

md.use(markdownItKatex);

const html = computed(() =>
  DOMPurify.sanitize(md.render(props.source || '')),
);
</script>

<template>
  <div class="markdown-body" v-html="html" />
</template>
