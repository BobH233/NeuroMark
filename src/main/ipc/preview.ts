import { BrowserWindow, ipcMain } from 'electron';
import type { PreviewDisplayOptions, PreviewImageItem } from '@preload/contracts';
import type { ServiceBundle } from '@main/services/types';

export function registerPreviewIpc(services: ServiceBundle): void {
  ipcMain.handle(
    'preview:open',
    (
      _event,
      images: PreviewImageItem[],
      initialIndex?: number,
      title?: string,
      activeQuestionId?: string,
      displayOptions?: PreviewDisplayOptions,
    ) => services.app.openPreview(images, initialIndex, title, activeQuestionId, displayOptions),
  );
  ipcMain.handle('preview:set-active-question', (_event, token: string, activeQuestionId: string) =>
    services.app.setPreviewActiveQuestion(token, activeQuestionId),
  );
  ipcMain.handle(
    'preview:set-display-options',
    (_event, token: string | null, displayOptions: PreviewDisplayOptions) =>
      services.app.setPreviewDisplayOptions(token, displayOptions),
  );
  ipcMain.handle('preview:save-image', (event, source: string, suggestedName?: string) =>
    services.app.savePreviewImageForWindow(
      BrowserWindow.fromWebContents(event.sender),
      source,
      suggestedName,
    ),
  );
  ipcMain.handle('preview:copy-image', (_event, source: string) =>
    services.app.copyPreviewImage(source),
  );
}
