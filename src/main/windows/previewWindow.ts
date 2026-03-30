import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createPreviewWindow(token: string): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    show: false,
    width: 1320,
    height: 880,
    minWidth: 1000,
    minHeight: 720,
    title: 'NeuroMark 图片预览',
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  const hash = `#/preview/${token}`;
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash}`);
  } else {
    await window.loadFile(path.join(__dirname, '../../dist/index.html'), { hash });
  }

  return window;
}
