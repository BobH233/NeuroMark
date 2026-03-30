import { defineStore } from 'pinia';
import type {
  AnswerDraftInput,
  AnswerDraftRecord,
  PromptPreset,
  PromptPresetInput,
} from '@preload/contracts';

export const useAnswerGeneratorStore = defineStore('answer-generator', {
  state: () => ({
    drafts: [] as AnswerDraftRecord[],
    presets: [] as PromptPreset[],
  }),
  getters: {
    draftMap(state) {
      return new Map(state.drafts.map((item) => [item.id, item]));
    },
  },
  actions: {
    async bootstrap() {
      const [drafts, presets] = await Promise.all([
        window.neuromark.answerGenerator.listDrafts(),
        window.neuromark.answerGenerator.listPromptPresets(),
      ]);
      this.drafts = drafts;
      this.presets = presets;
    },
    async createDraft(input: AnswerDraftInput) {
      const draft = await window.neuromark.answerGenerator.createDraft(input);
      await this.bootstrap();
      return draft;
    },
    async savePromptPreset(input: PromptPresetInput) {
      const preset = await window.neuromark.answerGenerator.savePromptPreset(input);
      await this.bootstrap();
      return preset;
    },
    async deletePromptPreset(presetId: string) {
      await window.neuromark.answerGenerator.deletePromptPreset(presetId);
      await this.bootstrap();
    },
    async updateDraft(draftId: string, markdown: string) {
      const updated = await window.neuromark.answerGenerator.updateDraft(
        draftId,
        markdown,
      );
      await this.bootstrap();
      return updated;
    },
    async deleteDraft(draftId: string) {
      await window.neuromark.answerGenerator.deleteDraft(draftId);
      await this.bootstrap();
    },
    getDraftById(draftId: string) {
      return this.drafts.find((item) => item.id === draftId) ?? null;
    },
  },
});
