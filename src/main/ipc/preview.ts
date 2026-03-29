import { ipcMain } from 'electron';
import type { PreviewImageItem } from '@preload/contracts';
import type { ServiceBundle } from '@main/services/types';

export function registerPreviewIpc(services: ServiceBundle): void {
  ipcMain.handle(
    'preview:open',
    (_event, images: PreviewImageItem[], initialIndex?: number, title?: string) =>
      services.app.openPreview(images, initialIndex, title),
  );
}

