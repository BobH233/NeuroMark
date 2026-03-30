import { ipcMain } from 'electron';
import { z } from 'zod';
import type { ServiceBundle } from '@main/services/types';

const draftSchema = z.object({
  title: z.string().min(1),
  promptPreset: z.string().min(1),
  promptText: z.string().min(1),
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
  ipcMain.handle('answer-generator:delete-draft', (_event, draftId: string) =>
    services.answerGenerator.deleteDraft(draftId),
  );
}
