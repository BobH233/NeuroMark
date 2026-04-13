<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

interface EditorMarker {
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  severity?: 'error' | 'warning' | 'info' | 'hint';
}

interface ExtraLibEntry {
  content: string;
  filePath: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language?: string;
    height?: string;
    readonly?: boolean;
    markers?: EditorMarker[];
    extraLibs?: ExtraLibEntry[];
  }>(),
  {
    language: 'javascript',
    height: '420px',
    readonly: false,
    markers: () => [],
    extraLibs: () => [],
  },
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
}>();

const editorRootRef = ref<HTMLDivElement | null>(null);
const editorRef = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null);
const modelRef = shallowRef<monaco.editor.ITextModel | null>(null);
const extraLibDisposables = shallowRef<monaco.IDisposable[]>([]);

let applyingExternalValue = false;
let themeRegistered = false;

const monacoEnvironment = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_moduleId: string, label: string) => Worker;
  };
};

if (!monacoEnvironment.MonacoEnvironment) {
  monacoEnvironment.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    },
  };
}

function ensureMonacoTheme() {
  if (themeRegistered) {
    return;
  }

  monaco.editor.defineTheme('neuromark-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7A8794', fontStyle: 'italic' },
      { token: 'keyword', foreground: '0F6CBD', fontStyle: 'bold' },
      { token: 'keyword.flow', foreground: '0F6CBD', fontStyle: 'bold' },
      { token: 'string', foreground: 'B54708' },
      { token: 'string.escape', foreground: '7C3AED' },
      { token: 'number', foreground: 'C2410C' },
      { token: 'regexp', foreground: '0F766E' },
      { token: 'delimiter', foreground: '475569' },
      { token: 'delimiter.bracket', foreground: '334155' },
      { token: 'operator', foreground: '7C3AED' },
      { token: 'type.identifier', foreground: '0F766E' },
      { token: 'identifier', foreground: '1E293B' },
      { token: 'identifier.js', foreground: '1E293B' },
      { token: 'variable', foreground: '1E293B' },
      { token: 'variable.predefined', foreground: 'AF2F64' },
      { token: 'constant', foreground: 'C2410C' },
      { token: 'constant.language', foreground: 'AF2F64' },
      { token: 'function', foreground: '9A3412' },
      { token: 'function.call', foreground: '9A3412' },
      { token: 'method', foreground: '9A3412' },
      { token: 'property', foreground: '0F766E' },
    ],
    colors: {
      'editor.background': '#fbfcfd',
      'editor.foreground': '#1e293b',
      'editorLineNumber.foreground': '#94a3b8',
      'editorLineNumber.activeForeground': '#475569',
      'editorGutter.background': '#fbfcfd',
      'editorOverviewRuler.border': '#00000000',
      'editorIndentGuide.background1': '#e2e8f0',
      'editorIndentGuide.activeBackground1': '#94a3b8',
      'editorCursor.foreground': '#0f4c75',
      'editor.selectionBackground': '#d7ebff',
      'editor.inactiveSelectionBackground': '#eaf4ff',
      'editor.lineHighlightBackground': '#f3f8fb',
    },
  });

  const typescriptLanguageService = monaco.languages.typescript;
  if (typescriptLanguageService?.javascriptDefaults) {
    typescriptLanguageService.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    typescriptLanguageService.javascriptDefaults.setCompilerOptions({
      allowJs: true,
      checkJs: true,
      target: typescriptLanguageService.ScriptTarget.ES2020,
      lib: ['es2020', 'dom'],
      moduleResolution: typescriptLanguageService.ModuleResolutionKind.NodeJs,
    });
  }

  themeRegistered = true;
}

function toMonacoSeverity(
  value: EditorMarker['severity'],
): monaco.MarkerSeverity {
  if (value === 'warning') {
    return monaco.MarkerSeverity.Warning;
  }
  if (value === 'info') {
    return monaco.MarkerSeverity.Info;
  }
  if (value === 'hint') {
    return monaco.MarkerSeverity.Hint;
  }
  return monaco.MarkerSeverity.Error;
}

function applyMarkers() {
  if (!modelRef.value) {
    return;
  }

  monaco.editor.setModelMarkers(
    modelRef.value,
    'neuromark-editor',
    props.markers.map((marker) => ({
      ...marker,
      severity: toMonacoSeverity(marker.severity),
    })),
  );
}

function applyExtraLibs() {
  const typescriptLanguageService = monaco.languages.typescript;
  if (!typescriptLanguageService?.javascriptDefaults) {
    return;
  }

  extraLibDisposables.value.forEach((disposable) => disposable.dispose());
  extraLibDisposables.value = props.extraLibs.map((entry) =>
    typescriptLanguageService.javascriptDefaults.addExtraLib(entry.content, entry.filePath),
  );
}

function syncLineNumberGutter() {
  if (!editorRef.value || !modelRef.value) {
    return;
  }

  const digits = String(modelRef.value.getLineCount()).length;
  editorRef.value.updateOptions({
    lineNumbersMinChars: Math.max(4, digits + 1),
  });
}

onMounted(() => {
  if (!editorRootRef.value) {
    return;
  }

  ensureMonacoTheme();
  modelRef.value = monaco.editor.createModel(
    props.modelValue,
    props.language,
    monaco.Uri.parse(
      `inmemory://neuromark/${Math.random().toString(36).slice(2)}.${props.language === 'javascript' ? 'js' : 'txt'}`,
    ),
  );
  editorRef.value = monaco.editor.create(editorRootRef.value, {
    model: modelRef.value,
    theme: 'neuromark-light',
    automaticLayout: true,
    minimap: { enabled: false },
    lineNumbersMinChars: 5,
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    tabSize: 2,
    fontSize: 13,
    lineHeight: 26,
    fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
    padding: {
      top: 12,
      bottom: 12,
    },
    roundedSelection: true,
    renderLineHighlight: 'line',
    readOnly: props.readonly,
  });
  syncLineNumberGutter();

  editorRef.value.onDidChangeModelContent(() => {
    if (!modelRef.value || applyingExternalValue) {
      return;
    }
    syncLineNumberGutter();
    emit('update:modelValue', modelRef.value.getValue());
  });

  applyExtraLibs();
  applyMarkers();
});

watch(
  () => props.modelValue,
  (value) => {
    if (!modelRef.value || value === modelRef.value.getValue()) {
      return;
    }
    applyingExternalValue = true;
    modelRef.value.pushEditOperations(
      [],
      [
        {
          range: modelRef.value.getFullModelRange(),
          text: value,
        },
      ],
      () => null,
    );
    applyingExternalValue = false;
    syncLineNumberGutter();
  },
);

watch(
  () => props.readonly,
  (readonly) => {
    editorRef.value?.updateOptions({ readOnly: readonly });
  },
);

watch(
  () => props.markers,
  () => {
    applyMarkers();
  },
  { deep: true },
);

watch(
  () => props.extraLibs,
  () => {
    applyExtraLibs();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  extraLibDisposables.value.forEach((disposable) => disposable.dispose());
  extraLibDisposables.value = [];
  if (modelRef.value) {
    monaco.editor.setModelMarkers(modelRef.value, 'neuromark-editor', []);
    modelRef.value.dispose();
    modelRef.value = null;
  }
  editorRef.value?.dispose();
  editorRef.value = null;
});
</script>

<template>
  <div class="code-editor-shell" :style="{ height }">
    <div ref="editorRootRef" class="code-editor-root" />
  </div>
</template>
