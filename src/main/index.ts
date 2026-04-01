import { Menu, app, BrowserWindow, nativeTheme, net, protocol } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerIpcHandlers } from './ipc';
import { createMainWindow } from './windows/mainWindow';
import { createPreviewWindow } from './windows/previewWindow';
import { AppService } from './services/appService';
import { AnswerGeneratorService } from './services/answerGeneratorService';
import { ProjectService } from './services/projectService';
import { SettingsService } from './services/settingsService';
import { TaskManager } from './services/taskManager';

let mainWindow: BrowserWindow | null = null;
let answerGeneratorService: AnswerGeneratorService | null = null;
const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.gif',
  '.tif',
  '.tiff',
  '.svg',
]);

function registerLocalFileProtocol(): void {
  protocol.handle('local-file', (request) => {
    const targetPath = new URL(request.url).searchParams.get('path');

    if (!targetPath) {
      return new Response('Missing path', { status: 400 });
    }

    const extension = path.extname(targetPath).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
      return new Response('Unsupported file type', { status: 403 });
    }

    return net.fetch(pathToFileURL(targetPath).toString());
  });
}

function createMinimalMacosMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      role: 'editMenu',
    },
    {
      role: 'windowMenu',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ];

  return Menu.buildFromTemplate(template);
}

function resolveAppIconPath(): string | null {
  const candidatePaths = [
    path.join(app.getAppPath(), 'build/icons/512x512.png'),
    path.join(process.cwd(), 'build/icons/512x512.png'),
  ];

  return candidatePaths.find((candidatePath) => existsSync(candidatePath)) ?? null;
}

function applyPlatformChrome(): void {
  const iconPath = resolveAppIconPath();

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(createMinimalMacosMenu());

    if (iconPath) {
      app.dock?.setIcon(iconPath);
    }

    return;
  }

  Menu.setApplicationMenu(null);
}

async function bootstrap(): Promise<void> {
  const projects = new ProjectService();
  const settings = new SettingsService();
  const tasks = new TaskManager(projects);
  const answerGenerator = new AnswerGeneratorService(settings, tasks);
  answerGeneratorService = answerGenerator;
  const appService = new AppService(
    () => mainWindow,
    async (token) => {
      await createPreviewWindow(token);
    },
  );

  await projects.ensureSeedData();
  await answerGenerator.recoverInterruptedGenerations();

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

app.whenReady().then(async () => {
  applyPlatformChrome();
  registerLocalFileProtocol();
  await bootstrap();
});

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

app.on('before-quit', () => {
  void answerGeneratorService?.interruptRunningGenerations();
});
