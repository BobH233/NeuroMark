import { defineStore } from 'pinia';
import type {
  ExecuteScorePostProcessInput,
  ExportScorePostProcessOptions,
  GenerateScorePostProcessAiScriptInput,
  ScorePostProcessAiScriptSnapshot,
  ScorePostProcessExecutionResult,
  ScorePostProcessPreset,
  ScorePostProcessPresetInput,
  ScorePostProcessProjectSnapshot,
} from '@preload/contracts';

export const useScorePostProcessStore = defineStore('score-post-process', {
  state: () => ({
    presets: [] as ScorePostProcessPreset[],
    projectSnapshots: {} as Record<string, ScorePostProcessProjectSnapshot>,
    aiSnapshots: {} as Record<string, ScorePostProcessAiScriptSnapshot>,
    loadingPresets: false,
    aiUnbind: null as null | (() => void),
  }),
  getters: {
    presetMap(state) {
      return new Map(state.presets.map((preset) => [preset.id, preset]));
    },
    getProjectSnapshot(state) {
      return (projectId: string) =>
        state.projectSnapshots[projectId] ?? {
          projectId,
          latestRun: null,
        };
    },
    getAiScriptSnapshot(state) {
      return (projectId: string) =>
        state.aiSnapshots[projectId] ?? {
          projectId,
          status: 'idle',
          stage: null,
          reasoningText: '',
          previewText: '',
          errorMessage: null,
          result: null,
          updatedAt: new Date(0).toISOString(),
        };
    },
  },
  actions: {
    ensureAiSubscription() {
      if (this.aiUnbind) {
        return;
      }
      this.aiUnbind = window.neuromark.scorePostProcess.onAiScriptUpdated(
        (snapshot) => {
          this.aiSnapshots = {
            ...this.aiSnapshots,
            [snapshot.projectId]: snapshot,
          };
        },
      );
    },
    async loadPresets() {
      this.loadingPresets = true;
      try {
        this.presets = await window.neuromark.scorePostProcess.listPresets();
      } finally {
        this.loadingPresets = false;
      }
    },
    async savePreset(input: ScorePostProcessPresetInput) {
      const preset = await window.neuromark.scorePostProcess.savePreset(input);
      await this.loadPresets();
      return preset;
    },
    async deletePreset(presetId: string) {
      await window.neuromark.scorePostProcess.deletePreset(presetId);
      await this.loadPresets();
    },
    async loadProjectSnapshot(projectId: string) {
      const snapshot =
        await window.neuromark.scorePostProcess.getProjectSnapshot(projectId);
      this.projectSnapshots = {
        ...this.projectSnapshots,
        [projectId]: snapshot,
      };
      return snapshot;
    },
    async loadAiScriptSnapshot(projectId: string) {
      this.ensureAiSubscription();
      const snapshot =
        await window.neuromark.scorePostProcess.getAiScriptSnapshot(projectId);
      this.aiSnapshots = {
        ...this.aiSnapshots,
        [projectId]: snapshot,
      };
      return snapshot;
    },
    async execute(
      projectId: string,
      input: ExecuteScorePostProcessInput,
    ): Promise<ScorePostProcessExecutionResult> {
      const result = await window.neuromark.scorePostProcess.execute(
        projectId,
        input,
      );
      if (result.run) {
        this.projectSnapshots = {
          ...this.projectSnapshots,
          [projectId]: {
            projectId,
            latestRun: result.run,
          },
        };
      }
      return result;
    },
    async exportLatest(
      projectId: string,
      options?: ExportScorePostProcessOptions,
    ) {
      const outputPath = await window.neuromark.scorePostProcess.exportLatest(
        projectId,
        options,
      );
      await this.loadProjectSnapshot(projectId);
      return outputPath;
    },
    async startAiScriptGeneration(
      projectId: string,
      input: GenerateScorePostProcessAiScriptInput,
    ) {
      this.ensureAiSubscription();
      const snapshot =
        await window.neuromark.scorePostProcess.startAiScriptGeneration(
          projectId,
          input,
        );
      this.aiSnapshots = {
        ...this.aiSnapshots,
        [projectId]: snapshot,
      };
      return snapshot;
    },
  },
});
