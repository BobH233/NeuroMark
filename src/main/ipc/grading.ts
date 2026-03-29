import { ipcMain } from 'electron';
import type { FinalResult } from '@preload/contracts';
import type { ServiceBundle } from '@main/services/types';

export function registerGradingIpc(services: ServiceBundle): void {
  ipcMain.handle('grading:start', (_event, projectId: string, options?: { skipCompleted?: boolean }) =>
    services.tasks.startGrading(projectId, options),
  );
  ipcMain.handle('grading:cancel', (_event, jobId: string) => services.tasks.cancel(jobId));
  ipcMain.handle('grading:resume', (_event, projectId: string) =>
    services.tasks.resumeGrading(projectId),
  );
  ipcMain.handle('results:list', (_event, projectId: string) =>
    services.projects.listResults(projectId),
  );
  ipcMain.handle('results:get', (_event, projectId: string, paperId: string) =>
    services.projects.getResult(projectId, paperId),
  );
  ipcMain.handle(
    'results:save-final',
    (_event, projectId: string, paperId: string, finalResult: FinalResult) =>
      services.projects.saveFinalResult(projectId, paperId, finalResult),
  );
  ipcMain.handle('results:export-json', (_event, projectId: string, targetPath?: string) =>
    services.projects.exportResults(projectId, targetPath),
  );
}

