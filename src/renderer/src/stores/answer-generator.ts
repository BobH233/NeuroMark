import { defineStore } from 'pinia';
import type {
  AnswerDraftInput,
  AnswerDraftRecord,
  AnswerGeneratorSnapshot,
  PromptPreset,
  PromptPresetInput,
} from '@preload/contracts';

export const useAnswerGeneratorStore = defineStore('answer-generator', {
  state: () => ({
    drafts: [] as AnswerDraftRecord[],
    presets: [] as PromptPreset[],
    programPromptText: '',
    unbind: null as null | (() => void),
  }),
  getters: {
    draftMap(state) {
      return new Map(state.drafts.map((item) => [item.id, item]));
    },
  },
  actions: {
    async bootstrap() {
      const snapshot = await window.neuromark.answerGenerator.getState();
      this.applySnapshot(snapshot);
      if (!this.unbind) {
        this.unbind = window.neuromark.answerGenerator.onUpdated((nextSnapshot) => {
          this.applySnapshot(nextSnapshot);
        });
      }
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
    async startGeneration(draftId: string) {
      const updated = await window.neuromark.answerGenerator.startGeneration(draftId);
      await this.bootstrap();
      return updated;
    },
    getDraftById(draftId: string) {
      return this.drafts.find((item) => item.id === draftId) ?? null;
    },
    applySnapshot(snapshot: AnswerGeneratorSnapshot) {
      this.drafts = snapshot.drafts;
      this.presets = snapshot.presets;
      this.programPromptText = snapshot.programPromptText;
    },
  },
});
