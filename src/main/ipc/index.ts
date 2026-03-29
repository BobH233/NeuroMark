import type { ServiceBundle } from '@main/services/types';
import { registerAnswerGeneratorIpc } from './answerGenerator';
import { registerAppIpc } from './app';
import { registerGradingIpc } from './grading';
import { registerPreviewIpc } from './preview';
import { registerProjectIpc } from './projects';
import { registerScanIpc } from './scan';
import { registerSettingsIpc } from './settings';
import { registerTasksIpc } from './tasks';

export function registerIpcHandlers(services: ServiceBundle): void {
  registerAppIpc(services);
  registerProjectIpc(services);
  registerScanIpc(services);
  registerGradingIpc(services);
  registerSettingsIpc(services);
  registerAnswerGeneratorIpc(services);
  registerTasksIpc(services);
  registerPreviewIpc(services);
}

