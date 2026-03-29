<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import { useAnswerGeneratorStore } from '@/stores/answer-generator';

const store = useAnswerGeneratorStore();

onMounted(async () => {
  await store.bootstrap();
});
</script>

<template>
  <RouterView />
</template>
