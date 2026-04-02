import type { App } from 'electron';
import type { BrowserWindow } from 'electron';
import type { NeuromarkApi } from '@preload/contracts';
import type { AppService } from './appService';
import type { AnswerGeneratorService } from './answerGeneratorService';
import type { ProjectService } from './projectService';
import type { RuntimeLogService } from './runtimeLogService';
import type { SettingsService } from './settingsService';
import type { SmartNameMatchService } from './smartNameMatchService';
import type { TaskManager } from './taskManager';

export interface ServiceBundle {
  app: AppService;
  projects: ProjectService;
  settings: SettingsService;
  answerGenerator: AnswerGeneratorService;
  smartNameMatch: SmartNameMatchService;
  tasks: TaskManager;
  runtimeLogs: RuntimeLogService;
}

export interface WindowRefs {
  getMainWindow: () => BrowserWindow | null;
}

export interface RuntimeContext {
  app: App;
}

export type IpcApi = NeuromarkApi;
