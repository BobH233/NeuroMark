<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NInput } from 'naive-ui';
import type {
  StudentRosterEntry,
  StudentRosterField,
} from '@preload/contracts';
import {
  searchStudentRosterEntries,
  type StudentRosterSuggestion,
} from '@/utils/student-roster';

const props = withDefaults(
  defineProps<{
    value: string;
    field: StudentRosterField;
    rosterEntries: StudentRosterEntry[];
    placeholder?: string;
    disabled?: boolean;
  }>(),
  {
    placeholder: '',
    disabled: false,
  },
);

const emit = defineEmits<{
  'update:value': [value: string];
  'select-entry': [entry: StudentRosterEntry];
}>();

const focused = ref(false);
const activeIndex = ref(0);
let blurTimer: ReturnType<typeof setTimeout> | null = null;

const suggestions = computed<StudentRosterSuggestion[]>(() =>
  searchStudentRosterEntries(
    props.rosterEntries,
    props.field,
    props.value,
  ).slice(0, 8),
);

const showSuggestions = computed(
  () => focused.value && suggestions.value.length > 0 && !props.disabled,
);

watch(
  suggestions,
  (nextSuggestions) => {
    if (!nextSuggestions.length) {
      activeIndex.value = 0;
      return;
    }
    if (activeIndex.value >= nextSuggestions.length) {
      activeIndex.value = 0;
    }
  },
  { immediate: true },
);

function clearBlurTimer() {
  if (blurTimer) {
    clearTimeout(blurTimer);
    blurTimer = null;
  }
}

function handleInput(value: string) {
  emit('update:value', value);
  focused.value = true;
  activeIndex.value = 0;
}

function handleFocus() {
  clearBlurTimer();
  focused.value = true;
}

function handleBlur() {
  clearBlurTimer();
  blurTimer = setTimeout(() => {
    focused.value = false;
  }, 120);
}

function selectSuggestion(entry: StudentRosterEntry) {
  clearBlurTimer();
  emit('update:value', entry[props.field]);
  emit('select-entry', entry);
  focused.value = false;
}

function moveActiveIndex(delta: number) {
  if (!suggestions.value.length) {
    return;
  }

  const total = suggestions.value.length;
  activeIndex.value = (activeIndex.value + delta + total) % total;
}

function handleKeydown(event: KeyboardEvent) {
  if (!showSuggestions.value) {
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveActiveIndex(1);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveActiveIndex(-1);
    return;
  }

  if (event.key === 'Enter') {
    const activeSuggestion = suggestions.value[activeIndex.value];
    if (!activeSuggestion) {
      return;
    }
    event.preventDefault();
    selectSuggestion(activeSuggestion);
    return;
  }

  if (event.key === 'Escape') {
    focused.value = false;
  }
}
</script>

<template>
  <div class="student-info-autocomplete">
    <n-input
      :value="value"
      :placeholder="placeholder"
      :disabled="disabled"
      @update:value="handleInput"
      @focus="handleFocus"
      @blur="handleBlur"
      @keydown="handleKeydown"
    />
    <div v-if="showSuggestions" class="student-info-autocomplete__panel">
      <button
        v-for="(entry, index) in suggestions"
        :key="entry.id"
        type="button"
        class="student-info-autocomplete__option"
        :class="{ 'is-active': index === activeIndex }"
        @mouseenter="activeIndex = index"
        @mousedown.prevent="selectSuggestion(entry)"
      >
        <span class="student-info-autocomplete__name">
          {{ entry.name || '未识别姓名' }}
        </span>
        <span class="student-info-autocomplete__meta">
          学号 {{ entry.studentId || '未填写' }} · 班级
          {{ entry.className || '未填写' }}
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.student-info-autocomplete {
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
}

.student-info-autocomplete :deep(.n-input) {
  width: 100%;
}

.student-info-autocomplete__panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.12);
  max-height: 280px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.student-info-autocomplete__option {
  display: flex;
  flex-direction: column;
  width: 100%;
  align-items: flex-start;
  gap: 3px;
  padding: 9px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #172033;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;
}

.student-info-autocomplete__option:hover,
.student-info-autocomplete__option.is-active {
  background: rgba(15, 118, 110, 0.08);
  color: #0f766e;
}

.student-info-autocomplete__name {
  font-size: 14px;
  font-weight: 600;
}

.student-info-autocomplete__meta {
  font-size: 12px;
  color: #607085;
}
</style>
