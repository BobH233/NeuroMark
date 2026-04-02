<script setup lang="ts">
import { computed } from 'vue';
import DOMPurify from 'dompurify';
import katex from 'katex';
import MarkdownIt from 'markdown-it';

const props = defineProps<{
  source: string;
}>();

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
});

function normalizeMarkdownMath(source: string) {
  return source
    .replace(/\\\[((?:.|\n|\r)*?)\\\]/g, (_match, content: string) => `$$${content}$$`)
    .replace(/\\\(((?:.|\n|\r)*?)\\\)/g, (_match, content: string) => `$${content}$`);
}

function installKatexPlugin(md: MarkdownIt) {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const src = state.src.slice(state.pos);
    const match = src.match(/^(\${1,2})([\s\S]+?)\1/);
    if (!match) {
      return false;
    }

    const [fullMatch, delimiter, content] = match;
    if (!content.trim()) {
      return false;
    }

    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = content;
      token.meta = { displayMode: delimiter.length === 2 };
    }

    state.pos += fullMatch.length;
    return true;
  });

  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const firstLine = state.src.slice(start, max).trim();

    if (!firstLine.startsWith('$$')) {
      return false;
    }

    let content = firstLine.slice(2);
    let nextLine = startLine;

    if (content.endsWith('$$') && content.length > 2) {
      content = content.slice(0, -2);
    } else {
      let found = false;
      while (++nextLine < endLine) {
        const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
        const lineEnd = state.eMarks[nextLine];
        const line = state.src.slice(lineStart, lineEnd);
        const closeIndex = line.indexOf('$$');

        if (closeIndex >= 0) {
          content += `\n${line.slice(0, closeIndex)}`;
          found = true;
          break;
        }

        content += `\n${line}`;
      }

      if (!found) {
        return false;
      }
    }

    if (silent) {
      return true;
    }

    state.line = nextLine + 1;

    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = content.trim();
    token.meta = { displayMode: true };
    token.map = [startLine, state.line];
    return true;
  });

  const renderMath = (content: string, displayMode: boolean) =>
    katex.renderToString(content, {
      throwOnError: false,
      displayMode,
      output: 'htmlAndMathml',
      strict: 'ignore',
    });

  md.renderer.rules.math_inline = (tokens, idx) =>
    renderMath(tokens[idx].content, Boolean(tokens[idx].meta?.displayMode));

  md.renderer.rules.math_block = (tokens, idx) =>
    `${renderMath(tokens[idx].content, true)}\n`;
}

installKatexPlugin(markdown);

const renderedHtml = computed(() =>
  DOMPurify.sanitize(markdown.render(normalizeMarkdownMath(props.source || ''))),
);
</script>

<template>
  <div class="markdown-preview markdown-body" v-html="renderedHtml" />
</template>
