import { ipcMain } from 'electron';
import { z } from 'zod';
import type {
  ExecuteScorePostProcessInput,
  ExportScorePostProcessOptions,
  ScorePostProcessPresetInput,
} from '@preload/contracts';
import type { ServiceBundle } from '@main/services/types';

const presetSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1),
  description: z.string().trim(),
  code: z.string().trim().min(1),
});

const executionSchema = z.object({
  scriptName: z.string().trim().min(1).max(120).optional(),
  presetId: z.string().trim().min(1).nullable().optional(),
  scriptCode: z.string().trim().min(1),
});

const exportSchema = z.object({
  targetDirectory: z.string().trim().min(1).optional(),
});

export function registerScorePostProcessIpc(services: ServiceBundle): void {
  ipcMain.handle('score-post-process:list-presets', () =>
    services.scorePostProcess.listPresets(),
  );
  ipcMain.handle(
    'score-post-process:save-preset',
    (_event, payload: ScorePostProcessPresetInput) =>
      services.scorePostProcess.savePreset(presetSchema.parse(payload)),
  );
  ipcMain.handle(
    'score-post-process:delete-preset',
    (_event, presetId: string) =>
      services.scorePostProcess.deletePreset(presetId),
  );
  ipcMain.handle(
    'score-post-process:get-project-snapshot',
    (_event, projectId: string) =>
      services.scorePostProcess.getProjectSnapshot(projectId),
  );
  ipcMain.handle(
    'score-post-process:execute',
    (_event, projectId: string, payload: ExecuteScorePostProcessInput) =>
      services.scorePostProcess.execute(
        projectId,
        executionSchema.parse(payload),
      ),
  );
  ipcMain.handle(
    'score-post-process:export-latest',
    (_event, projectId: string, payload?: ExportScorePostProcessOptions) =>
      services.scorePostProcess.exportLatest(
        projectId,
        payload ? exportSchema.parse(payload) : undefined,
      ),
  );
}
