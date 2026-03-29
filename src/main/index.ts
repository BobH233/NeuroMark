import { app, BrowserWindow, nativeTheme } from 'electron';
import { registerIpcHandlers } from './ipc';
import { createMainWindow } from './windows/mainWindow';
import { createPreviewWindow } from './windows/previewWindow';
import { AppService } from './services/appService';
import { AnswerGeneratorService } from './services/answerGeneratorService';
import { ProjectService } from './services/projectService';
import { SettingsService } from './services/settingsService';
import { TaskManager } from './services/taskManager';

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  const projects = new ProjectService();
  const settings = new SettingsService();
  const answerGenerator = new AnswerGeneratorService();
  const tasks = new TaskManager(projects);
  const appService = new AppService(
    () => mainWindow,
    async (token) => {
      await createPreviewWindow(token);
    },
  );

  await projects.ensureSeedData(app.getPath('userData'));
  await answerGenerator.ensureSeedDraft();

  registerIpcHandlers({
    app: appService,
    projects,
    settings,
    answerGenerator,
    tasks,
  });

  mainWindow = await createMainWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.setName('NeuroMark');
app.setAppUserModelId('cn.bit-helper.neuromark');

nativeTheme.themeSource = 'light';

app.whenReady().then(bootstrap);

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = await createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

