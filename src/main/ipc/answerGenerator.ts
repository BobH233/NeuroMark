import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import type { ServiceBundle } from '@main/services/types';

const draftSchema = z.object({
  title: z.string().min(1),
  promptPreset: z.string(),
  promptText: z.string().min(1),
  sourceImages: z.array(
    z.object({
      src: z.string().min(1),
      name: z.string().min(1),
    }),
  ),
});

const presetSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string(),
  prompt: z.string().min(1),
});

export function registerAnswerGeneratorIpc(services: ServiceBundle): void {
  ipcMain.handle('answer-generator:get-state', () => services.answerGenerator.getState());
  ipcMain.handle('answer-generator:list-drafts', () => services.answerGenerator.listDrafts());
  ipcMain.handle('answer-generator:list-presets', () =>
    services.answerGenerator.listPromptPresets(),
  );
  ipcMain.handle('answer-generator:save-preset', (_event, payload) =>
    services.answerGenerator.savePromptPreset(presetSchema.parse(payload)),
  );
  ipcMain.handle('answer-generator:delete-preset', (_event, presetId: string) =>
    services.answerGenerator.deletePromptPreset(presetId),
  );
  ipcMain.handle('answer-generator:create-draft', (_event, payload) =>
    services.answerGenerator.createDraft(draftSchema.parse(payload)),
  );
  ipcMain.handle('answer-generator:start-generation', (_event, draftId: string) =>
    services.answerGenerator.startGeneration(draftId),
  );
  ipcMain.handle('answer-generator:update-draft', (_event, draftId: string, markdown: string) =>
    services.answerGenerator.updateDraft(draftId, markdown),
  );
  ipcMain.handle('answer-generator:delete-draft', (_event, draftId: string) =>
    services.answerGenerator.deleteDraft(draftId),
  );

  services.answerGenerator.onUpdated((snapshot) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('answer-generator:updated', snapshot);
    }
  });
}
