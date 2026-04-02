import { copyFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import {
  app,
  clipboard,
  dialog,
  nativeImage,
  shell,
  type BrowserWindow,
  type OpenDialogOptions,
} from 'electron';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import type { PreviewImageItem, PreviewSession } from '@preload/contracts';

export class AppService {
  private readonly previewSessions = new Map<string, PreviewSession>();
  private readonly previewWindows = new Map<string, BrowserWindow>();

  constructor(
    private readonly getParentWindow: () => BrowserWindow | null,
    private readonly openPreviewWindow: (token: string) => Promise<BrowserWindow>,
  ) {}

  getDefaultProjectBasePath(): string {
    return join(app.getPath('documents'), 'NeuroMark Projects');
  }

  async selectDirectory(): Promise<string | null> {
    const options: OpenDialogOptions = {
      title: '选择项目保存目录',
      properties: ['openDirectory', 'createDirectory'],
    };
    const parent = this.getParentWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  async selectImages(): Promise<string[]> {
    const options: OpenDialogOptions = {
      title: '选择试卷图片',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '图片',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'svg'],
        },
      ],
    };
    const parent = this.getParentWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);

    return result.canceled ? [] : result.filePaths;
  }

  async openPath(targetPath: string): Promise<void> {
    await shell.openPath(targetPath);
  }

  async openPreview(
    images: PreviewImageItem[],
    initialIndex = 0,
    title = '图片预览',
    activeQuestionId = '',
  ): Promise<string> {
    const token = nanoid();
    this.previewSessions.set(token, {
      token,
      title,
      initialIndex,
      images,
      activeQuestionId,
    });
    const previewWindow = await this.openPreviewWindow(token);
    this.previewWindows.set(token, previewWindow);
    previewWindow.on('closed', () => {
      this.previewWindows.delete(token);
      this.previewSessions.delete(token);
    });
    return token;
  }

  async getPreviewSession(token: string): Promise<PreviewSession | null> {
    return this.previewSessions.get(token) ?? null;
  }

  async setPreviewActiveQuestion(token: string | null, activeQuestionId: string): Promise<void> {
    const targetTokens = token ? [token] : [...this.previewSessions.keys()];

    for (const targetToken of targetTokens) {
      const session = this.previewSessions.get(targetToken);
      if (!session) {
        continue;
      }

      session.activeQuestionId = activeQuestionId;
      const previewWindow = this.previewWindows.get(targetToken);
      if (!previewWindow || previewWindow.isDestroyed()) {
        continue;
      }

      previewWindow.webContents.send('preview:active-question-changed', {
        token: targetToken,
        activeQuestionId,
      });
    }
  }

  async savePreviewImage(source: string, suggestedName?: string): Promise<string | null> {
    return this.savePreviewImageForWindow(this.getParentWindow(), source, suggestedName);
  }

  async copyPreviewImage(source: string): Promise<void> {
    const image = await resolvePreviewImageSource(source);
    const clipboardBuffer =
      image.kind === 'file'
        ? await sharp(image.path).rotate().png().toBuffer()
        : await sharp(image.buffer).rotate().png().toBuffer();
    const clipboardImage = nativeImage.createFromBuffer(clipboardBuffer);

    if (clipboardImage.isEmpty()) {
      throw new Error('当前图片暂时无法复制到剪贴板。');
    }

    clipboard.writeImage(clipboardImage);
  }

  async savePreviewImageForWindow(
    parentWindow: BrowserWindow | null,
    source: string,
    suggestedName?: string,
  ): Promise<string | null> {
    const image = await resolvePreviewImageSource(source);
    const defaultFileName = buildSuggestedFileName(image, suggestedName);
    const options = {
      title: '保存图片到本地',
      defaultPath: defaultFileName,
      filters: [
        { name: '图片', extensions: [image.extension] },
        { name: '所有文件', extensions: ['*'] },
      ],
    };
    const result = parentWindow
      ? await dialog.showSaveDialog(parentWindow, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return null;
    }

    if (image.kind === 'file') {
      await copyFile(image.path, result.filePath);
    } else {
      await writeFile(result.filePath, image.buffer);
    }

    return result.filePath;
  }
}

type ResolvedPreviewImage =
  | {
      kind: 'file';
      extension: string;
      path: string;
    }
  | {
      kind: 'buffer';
      buffer: Buffer;
      extension: string;
    };

async function resolvePreviewImageSource(source: string): Promise<ResolvedPreviewImage> {
  if (source.startsWith('data:image/')) {
    return decodeDataImage(source);
  }

  if (source.startsWith('http://') || source.startsWith('https://')) {
    return fetchRemoteImage(source);
  }

  const localPath = resolveLocalImagePath(source);
  return {
    kind: 'file',
    path: localPath,
    extension: normalizeExtension(extname(localPath)),
  };
}

function resolveLocalImagePath(source: string): string {
  if (source.startsWith('local-file://')) {
    const fileUrl = new URL(source);
    const filePath = fileUrl.searchParams.get('path');
    if (!filePath) {
      throw new Error('图片路径无效，无法保存到本地。');
    }
    return decodeURIComponent(filePath);
  }

  if (source.startsWith('file://')) {
    return decodeURIComponent(new URL(source).pathname);
  }

  return source;
}

function decodeDataImage(source: string): ResolvedPreviewImage {
  const matched = source.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!matched) {
    throw new Error('当前图片格式不受支持，暂时无法保存。');
  }

  const [, mimeSubtype, base64] = matched;
  return {
    kind: 'buffer',
    buffer: Buffer.from(base64, 'base64'),
    extension: extensionFromMimeSubtype(mimeSubtype),
  };
}

async function fetchRemoteImage(source: string): Promise<ResolvedPreviewImage> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`下载图片失败（${response.status} ${response.statusText}）。`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const buffer = Buffer.from(await response.arrayBuffer());
  const extension =
    extensionFromContentType(contentType) || normalizeExtension(extname(new URL(source).pathname));

  return {
    kind: 'buffer',
    buffer,
    extension,
  };
}

function buildSuggestedFileName(image: ResolvedPreviewImage, suggestedName?: string): string {
  if (image.kind === 'file') {
    const originalFileName = sanitizeFileName(basename(image.path));
    if (originalFileName) {
      return ensureExtension(originalFileName, image.extension);
    }
  }

  const normalizedName = sanitizeFileName((suggestedName || '').trim());
  if (normalizedName) {
    return ensureExtension(normalizedName, image.extension);
  }

  return `image.${image.extension}`;
}

function sanitizeFileName(name: string): string {
  return Array.from(name)
    .map((char) => {
      const code = char.charCodeAt(0);
      if (code <= 31 || '<>:"/\\|?*'.includes(char)) {
        return ' ';
      }
      return char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureExtension(fileName: string, extension: string): string {
  return extname(fileName) ? fileName : `${fileName}.${extension}`;
}

function normalizeExtension(extension: string): string {
  const normalized = extension.replace(/^\./, '').trim().toLowerCase();
  return normalized || 'png';
}

function extensionFromMimeSubtype(mimeSubtype: string): string {
  const normalized = mimeSubtype.toLowerCase();
  if (normalized === 'jpeg') {
    return 'jpg';
  }
  if (normalized === 'svg+xml') {
    return 'svg';
  }
  return normalizeExtension(normalized);
}

function extensionFromContentType(contentType: string): string | null {
  const matched = contentType.match(/^image\/([a-zA-Z0-9.+-]+)/i);
  if (!matched) {
    return null;
  }
  return extensionFromMimeSubtype(matched[1]);
}
