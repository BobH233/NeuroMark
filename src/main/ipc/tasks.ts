import { BrowserWindow, ipcMain } from 'electron';
import type { ServiceBundle } from '@main/services/types';

export function registerTasksIpc(services: ServiceBundle): void {
  ipcMain.handle('tasks:list', () => services.tasks.list());
  ipcMain.handle('tasks:list-archived', () => services.tasks.listArchived());
  ipcMain.handle('tasks:archive-visible', () => services.tasks.archiveVisible());
  services.tasks.onUpdated((tasks) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('tasks:updated', tasks);
    }
  });
}
