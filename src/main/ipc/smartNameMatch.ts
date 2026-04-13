import { BrowserWindow, ipcMain } from 'electron';
import type { StartSmartNameMatchOptions } from '@preload/contracts';
import type { ServiceBundle } from '@main/services/types';

export function registerSmartNameMatchIpc(services: ServiceBundle): void {
  ipcMain.handle('results:get-smart-name-match-snapshot', (_event, projectId: string) =>
    services.smartNameMatch.getSnapshot(projectId),
  );
  ipcMain.handle(
    'results:start-smart-name-match',
    (_event, projectId: string, rosterText: string, options?: StartSmartNameMatchOptions) =>
      services.smartNameMatch.start(projectId, rosterText, options),
  );
  ipcMain.handle('results:apply-smart-name-match', (_event, projectId: string) =>
    services.smartNameMatch.applyCertainSuggestions(projectId),
  );

  services.smartNameMatch.onUpdated((snapshot) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('results:smart-name-match-updated', snapshot);
    }
  });
}
