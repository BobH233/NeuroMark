import { defineStore } from 'pinia';
import type { LlmPricingSettings, LlmUsageRecordPage, LlmUsageSummary } from '@preload/contracts';

export const useLlmUsageStore = defineStore('llm-usage', {
  state: () => ({
    summary: null as LlmUsageSummary | null,
    recordPage: null as LlmUsageRecordPage | null,
    loading: false,
    recordsLoading: false,
    saving: false,
  }),
  actions: {
    async loadSummary() {
      this.loading = true;
      try {
        this.summary = await window.neuromark.llmUsage.getSummary();
        return this.summary;
      } finally {
        this.loading = false;
      }
    },
    async loadRecordPage(page = 1, pageSize?: number) {
      this.recordsLoading = true;
      try {
        this.recordPage = await window.neuromark.llmUsage.getRecordPage(
          page,
          pageSize ?? this.recordPage?.pageSize ?? 20,
        );
        return this.recordPage;
      } finally {
        this.recordsLoading = false;
      }
    },
    async savePricing(input: LlmPricingSettings) {
      this.saving = true;
      try {
        const pricing = await window.neuromark.llmUsage.savePricing(input);
        this.summary = await window.neuromark.llmUsage.getSummary();
        this.recordPage = await window.neuromark.llmUsage.getRecordPage(
          this.recordPage?.page ?? 1,
          this.recordPage?.pageSize ?? 20,
        );
        return pricing;
      } finally {
        this.saving = false;
      }
    },
  },
});
