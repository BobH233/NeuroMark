import { defineStore } from 'pinia';
import type {
  GlobalLlmSettings,
  SaveGlobalLlmSettingsInput,
  TestLlmConnectionPayload,
} from '@preload/contracts';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: null as GlobalLlmSettings | null,
    testing: false,
  }),
  actions: {
    async load() {
      this.settings = await window.neuromark.settings.get();
    },
    async save(input: SaveGlobalLlmSettingsInput) {
      this.settings = await window.neuromark.settings.save(input);
      return this.settings;
    },
    async test(payload: TestLlmConnectionPayload) {
      this.testing = true;
      try {
        return await window.neuromark.settings.testLlmConnection(payload);
      } finally {
        this.testing = false;
      }
    },
  },
});

