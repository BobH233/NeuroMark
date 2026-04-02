import { ipcMain } from 'electron';
import { z } from 'zod';
import type { ServiceBundle } from '@main/services/types';

const reasoningEffortSchema = z.enum(['low', 'medium', 'high']);

const settingsSchema = z.object({
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  timeoutMs: z.number().int().min(5000).max(600000),
  reasoningEffort: reasoningEffortSchema,
  answerGenerationTemperature: z.number().min(0).max(2),
  gradingTemperature: z.number().min(0).max(2),
});

export function registerSettingsIpc(services: ServiceBundle): void {
  ipcMain.handle('settings:get', () => services.settings.getSettings());
  ipcMain.handle('settings:save', (_event, payload) =>
    services.settings.saveSettings(settingsSchema.parse(payload)),
  );
  ipcMain.handle('settings:test', (_event, payload) =>
    services.settings.testConnection(settingsSchema.extend({ apiKey: z.string().min(1) }).parse(payload)),
  );
}
