import { ipcMain } from 'electron';
import type { ServiceBundle } from '@main/services/types';

export function registerScanIpc(services: ServiceBundle): void {
  ipcMain.handle('scan:start', (_event, projectId: string, options?: { skipCompleted?: boolean }) =>
    services.tasks.startScan(projectId, options),
  );
  ipcMain.handle('scan:cancel', (_event, jobId: string) => services.tasks.cancel(jobId));
  ipcMain.handle('scan:list', (_event, projectId: string) =>
    services.projects.listProjectPapers(projectId),
  );
}

