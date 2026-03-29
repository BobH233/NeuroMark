import { ipcMain } from 'electron';
import { z } from 'zod';
import type { ServiceBundle } from '@main/services/types';

const draftSchema = z.object({
  promptPreset: z.string().min(1),
  sourceImages: z.array(z.string()),
});

export function registerAnswerGeneratorIpc(services: ServiceBundle): void {
  ipcMain.handle('answer-generator:list-drafts', () => services.answerGenerator.listDrafts());
  ipcMain.handle('answer-generator:list-presets', () =>
    services.answerGenerator.listPromptPresets(),
  );
  ipcMain.handle('answer-generator:create-draft', (_event, payload) =>
    services.answerGenerator.createDraft(draftSchema.parse(payload)),
  );
  ipcMain.handle('answer-generator:update-draft', (_event, draftId: string, markdown: string) =>
    services.answerGenerator.updateDraft(draftId, markdown),
  );
}

