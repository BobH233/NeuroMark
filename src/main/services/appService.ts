import { dialog, shell, type BrowserWindow, type OpenDialogOptions } from 'electron';
import { nanoid } from 'nanoid';
import type { PreviewImageItem, PreviewSession } from '@preload/contracts';

export class AppService {
  private readonly previewSessions = new Map<string, PreviewSession>();

  constructor(
    private readonly getParentWindow: () => BrowserWindow | null,
    private readonly openPreviewWindow: (token: string) => Promise<void>,
  ) {}

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
  ): Promise<void> {
    const token = nanoid();
    this.previewSessions.set(token, {
      token,
      title,
      initialIndex,
      images,
    });
    await this.openPreviewWindow(token);
  }

  async getPreviewSession(token: string): Promise<PreviewSession | null> {
    return this.previewSessions.get(token) ?? null;
  }
}
