import { ipcMain } from 'electron';
import type { ServiceBundle } from '@main/services/types';

export function registerAppIpc(services: ServiceBundle): void {
  ipcMain.handle('app:get-version', () => process.env.npm_package_version ?? '0.1.0');
  ipcMain.handle('app:select-directory', () => services.app.selectDirectory());
  ipcMain.handle('app:select-images', () => services.app.selectImages());
  ipcMain.handle('app:open-path', (_event, targetPath: string) => services.app.openPath(targetPath));
  ipcMain.handle('app:get-preview-session', (_event, token: string) =>
    services.app.getPreviewSession(token),
  );
}

