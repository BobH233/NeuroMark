import { ipcMain } from 'electron';
import { z } from 'zod';
import type { CreateProjectInput, ProjectSettings } from '@preload/contracts';
import type { ServiceBundle } from '@main/services/types';

const createProjectSchema = z.object({
  name: z.string().min(1),
  basePath: z.string().min(1),
  gradingConcurrency: z.number().int().min(1).optional(),
  drawRegions: z.boolean().optional(),
  defaultImageDetail: z.enum(['low', 'high', 'auto']).optional(),
});

const projectSettingsSchema = z.object({
  gradingConcurrency: z.number().int().min(1),
  drawRegions: z.boolean(),
  defaultImageDetail: z.enum(['low', 'high', 'auto']),
});

const referenceAnswerSchema = z.string().trim().min(1);

export function registerProjectIpc(services: ServiceBundle): void {
  ipcMain.handle('projects:list', () => services.projects.listProjects());
  ipcMain.handle('projects:get-detail', (_event, projectId: string) =>
    services.projects.getProjectDetail(projectId),
  );
  ipcMain.handle('projects:delete', (_event, projectId: string) =>
    services.tasks.deleteProject(projectId),
  );
  ipcMain.handle('projects:create', (_event, payload: CreateProjectInput) =>
    services.projects.createProject(createProjectSchema.parse(payload)),
  );
  ipcMain.handle(
    'projects:import-original-images',
    (_event, projectId: string, filePaths: string[]) =>
      services.projects.importOriginalImages(projectId, filePaths),
  );
  ipcMain.handle(
    'projects:update-settings',
    (_event, projectId: string, settings: ProjectSettings) =>
      services.projects.updateProjectSettings(
        projectId,
        projectSettingsSchema.parse(settings),
      ),
  );
  ipcMain.handle(
    'projects:update-reference-answer',
    (_event, projectId: string, markdown: string) =>
      services.projects.updateReferenceAnswer(
        projectId,
        referenceAnswerSchema.parse(markdown),
      ),
  );
}
