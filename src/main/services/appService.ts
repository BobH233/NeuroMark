import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  shell,
  type PrintToPDFOptions,
  type OpenDialogOptions,
} from 'electron';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import type {
  BackgroundJob,
  ExportAllResultPdfsOptions,
  ExportAllResultPdfsProgress,
  ExportAllResultPdfsResult,
  FinalResult,
  PaperRecord,
  PreviewDisplayOptions,
  PreviewImageItem,
  PreviewSession,
  ResultRecord,
} from '@preload/contracts';
import { estimateEta } from './taskManager';
import type { TaskManager } from './taskManager';
import type { ProjectService } from './projectService';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PREVIEW_DISPLAY_OPTIONS: PreviewDisplayOptions = {
  showQuestionTags: true,
  showQuestionBoxes: true,
  showQuestionScores: false,
};
const RESULT_PDF_EXPORT_CONCURRENCY = 4;
const RESULT_PDF_PRINT_READY_TIMEOUT_MS = 60_000;

interface ResultPdfPrintWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  cleanup: () => void;
}

type ResultPdfExportTask = {
  paperId: string;
  paperCode: string;
  baseFileName: string;
};

export class AppService {
  private readonly previewSessions = new Map<string, PreviewSession>();
  private readonly previewWindows = new Map<string, BrowserWindow>();
  private readonly resultPdfExportControllers = new Map<
    string,
    AbortController
  >();
  private readonly resultPdfPrintWaiters = new Map<
    string,
    ResultPdfPrintWaiter
  >();

  constructor(
    private readonly getParentWindow: () => BrowserWindow | null,
    private readonly openPreviewWindow: (
      token: string,
    ) => Promise<BrowserWindow>,
  ) {}

  getDefaultProjectBasePath(): string {
    return join(app.getPath('documents'), 'NeuroMark Projects');
  }

  setMainWindowTitle(title: string): void {
    const parentWindow = this.getParentWindow();
    if (!parentWindow || parentWindow.isDestroyed()) {
      return;
    }

    const normalizedTitle = title.trim() || app.getName();
    parentWindow.setTitle(normalizedTitle);
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
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  async selectExportDirectory(): Promise<string | null> {
    const options: OpenDialogOptions = {
      title: '选择导出目录',
      properties: ['openDirectory', 'createDirectory'],
    };
    const parent = this.getParentWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  async selectImages(): Promise<string[]> {
    const options: OpenDialogOptions = {
      title: '选择试卷图片或 PDF',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '图片与 PDF',
          extensions: [
            'png',
            'jpg',
            'jpeg',
            'webp',
            'bmp',
            'tif',
            'tiff',
            'svg',
            'pdf',
          ],
        },
      ],
    };
    const parent = this.getParentWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);

    return result.canceled ? [] : result.filePaths;
  }

  async selectPaperImageDirectory(): Promise<string | null> {
    const options: OpenDialogOptions = {
      title: '选择试卷图片或 PDF 目录',
      properties: ['openDirectory'],
    };
    const parent = this.getParentWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);

    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  async selectJsonSavePath(defaultFileName: string): Promise<string | null> {
    const parent = this.getParentWindow();
    const result = parent
      ? await dialog.showSaveDialog(parent, {
          title: '导出 JSON 文件',
          defaultPath: defaultFileName,
          filters: [
            { name: 'JSON 文件', extensions: ['json'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        })
      : await dialog.showSaveDialog({
          title: '导出 JSON 文件',
          defaultPath: defaultFileName,
          filters: [
            { name: 'JSON 文件', extensions: ['json'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        });

    return result.canceled ? null : (result.filePath ?? null);
  }

  async selectPdfSavePath(defaultFileName: string): Promise<string | null> {
    const safeFileName = normalizePdfFileName(defaultFileName);
    const parent = this.getParentWindow();
    const result = parent
      ? await dialog.showSaveDialog(parent, {
          title: '导出 PDF 文件',
          defaultPath: safeFileName,
          filters: [
            { name: 'PDF 文件', extensions: ['pdf'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        })
      : await dialog.showSaveDialog({
          title: '导出 PDF 文件',
          defaultPath: safeFileName,
          filters: [
            { name: 'PDF 文件', extensions: ['pdf'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        });

    return result.canceled ? null : (result.filePath ?? null);
  }

  async selectExcelSavePath(defaultFileName: string): Promise<string | null> {
    const safeFileName = normalizeExcelFileName(defaultFileName);
    const parent = this.getParentWindow();
    const result = parent
      ? await dialog.showSaveDialog(parent, {
          title: '导出 Excel 文件',
          defaultPath: safeFileName,
          filters: [
            { name: 'Excel 文件', extensions: ['xlsx'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        })
      : await dialog.showSaveDialog({
          title: '导出 Excel 文件',
          defaultPath: safeFileName,
          filters: [
            { name: 'Excel 文件', extensions: ['xlsx'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        });

    return result.canceled ? null : (result.filePath ?? null);
  }

  async exportCurrentWindowToPdf(targetPath: string): Promise<string> {
    const parentWindow = this.getParentWindow();
    if (!parentWindow || parentWindow.isDestroyed()) {
      throw new Error('当前窗口不可用，无法导出 PDF。');
    }

    const normalizedTargetPath = normalizePdfFileName(targetPath);
    const pdfOptions: PrintToPDFOptions = {
      landscape: false,
      printBackground: true,
      preferCSSPageSize: true,
      margins: {
        marginType: 'default',
      },
      pageSize: 'A4',
    };

    const pdfBuffer = await parentWindow.webContents.printToPDF(pdfOptions);
    const directoryPath = dirname(normalizedTargetPath);

    if (directoryPath) {
      await mkdir(directoryPath, { recursive: true });
    }

    await writeFile(normalizedTargetPath, pdfBuffer);
    return normalizedTargetPath;
  }

  async exportAllResultPdfs(
    projects: ProjectService,
    projectId: string,
    options: ExportAllResultPdfsOptions,
    onProgress?: (progress: ExportAllResultPdfsProgress) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<ExportAllResultPdfsResult> {
    const outputDirectory = options.targetDirectory.trim();
    if (!outputDirectory) {
      throw new Error('PDF 导出目录不能为空。');
    }
    throwIfAborted(signal);

    const detail = await projects.getProjectDetail(projectId);
    const tasks = buildResultPdfExportTasks(detail.results, detail.originals);
    await mkdir(outputDirectory, { recursive: true });
    throwIfAborted(signal);

    const files: ExportAllResultPdfsResult['files'] = [];
    const failures: ExportAllResultPdfsResult['failures'] = [];
    const reservedPaths = new Set<string>();
    let nextTaskIndex = 0;
    let completed = 0;
    let failed = 0;

    const emitProgress = async (currentPaperCode: string | null) => {
      await onProgress?.({
        projectId,
        total: tasks.length,
        completed,
        failed,
        currentPaperCode,
      });
    };

    const takeTask = (): ResultPdfExportTask | null => {
      if (signal?.aborted) {
        return null;
      }
      const task = tasks[nextTaskIndex];
      nextTaskIndex += 1;
      return task ?? null;
    };

    const workerCount = Math.min(RESULT_PDF_EXPORT_CONCURRENCY, tasks.length);
    await emitProgress(null);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        const exportWindow = this.createResultPdfExportWindow();
        const abortHandler = () => {
          if (!exportWindow.isDestroyed()) {
            exportWindow.close();
          }
        };
        signal?.addEventListener('abort', abortHandler, { once: true });
        try {
          for (;;) {
            if (signal?.aborted) {
              return;
            }
            const task = takeTask();
            if (!task) {
              return;
            }

            throwIfAborted(signal);
            await emitProgress(task.paperCode);
            try {
              const targetPath = reserveUniquePdfPath(
                outputDirectory,
                task.baseFileName,
                reservedPaths,
              );
              await this.exportResultPdfTask(
                exportWindow,
                projectId,
                task.paperId,
                targetPath,
                signal,
              );
              files.push({
                paperId: task.paperId,
                paperCode: task.paperCode,
                path: targetPath,
              });
            } catch (error) {
              if (signal?.aborted) {
                return;
              }
              failed += 1;
              failures.push({
                paperId: task.paperId,
                paperCode: task.paperCode,
                errorMessage:
                  error instanceof Error ? error.message : '未知导出错误',
              });
            } finally {
              if (signal?.aborted) {
                return;
              }
              completed += 1;
              await emitProgress(task.paperCode);
            }
          }
        } finally {
          signal?.removeEventListener('abort', abortHandler);
          if (!exportWindow.isDestroyed()) {
            exportWindow.close();
          }
        }
      }),
    );

    await emitProgress(null);

    return {
      exportedCount: files.length,
      failedCount: failures.length,
      outputDirectory,
      files,
      failures,
    };
  }

  async startResultPdfExportJob(
    tasks: TaskManager,
    projects: ProjectService,
    projectId: string,
    options: ExportAllResultPdfsOptions,
  ): Promise<BackgroundJob> {
    const project = await projects.getProjectById(projectId);
    const activeTask = (await tasks.list()).find(
      (task) =>
        task.projectId === projectId &&
        task.kind === 'result-pdf-export' &&
        ['queued', 'running', 'paused'].includes(task.status),
    );
    if (activeTask) {
      throw new Error('当前项目已有进行中的 PDF 导出任务。');
    }

    const job = await tasks.createJob({
      kind: 'result-pdf-export',
      projectId,
      projectName: project.name,
      status: 'running',
      progress: 0,
      abortable: true,
      currentPaperLabel: '准备导出',
      summary: '正在准备批量导出批阅 PDF',
    });
    const controller = new AbortController();
    this.resultPdfExportControllers.set(job.id, controller);

    void this.runResultPdfExportJob(
      tasks,
      projects,
      job.id,
      projectId,
      options,
      controller,
    );
    return job;
  }

  cancelResultPdfExport(jobId: string): boolean {
    const controller = this.resultPdfExportControllers.get(jobId);
    if (!controller) {
      return false;
    }

    controller.abort();
    this.resultPdfExportControllers.delete(jobId);
    return true;
  }

  notifyResultPdfPrintReady(token: string): void {
    const waiter = this.resultPdfPrintWaiters.get(token);
    if (!waiter) {
      return;
    }

    clearTimeout(waiter.timer);
    waiter.cleanup();
    this.resultPdfPrintWaiters.delete(token);
    waiter.resolve();
  }

  notifyResultPdfPrintFailed(token: string, errorMessage: string): void {
    const waiter = this.resultPdfPrintWaiters.get(token);
    if (!waiter) {
      return;
    }

    clearTimeout(waiter.timer);
    waiter.cleanup();
    this.resultPdfPrintWaiters.delete(token);
    waiter.reject(new Error(errorMessage || '批阅结果打印页渲染失败。'));
  }

  async openPath(targetPath: string): Promise<void> {
    await shell.openPath(targetPath);
  }

  openDevTools(): void {
    const parentWindow = this.getParentWindow();
    if (!parentWindow || parentWindow.isDestroyed()) {
      return;
    }

    parentWindow.webContents.openDevTools({ mode: 'detach' });
  }

  async openPreview(
    images: PreviewImageItem[],
    initialIndex = 0,
    title = '图片预览',
    activeQuestionId = '',
    displayOptions: PreviewDisplayOptions = DEFAULT_PREVIEW_DISPLAY_OPTIONS,
  ): Promise<string> {
    const token = nanoid();
    this.previewSessions.set(token, {
      token,
      title,
      initialIndex,
      images,
      activeQuestionId,
      displayOptions: normalizePreviewDisplayOptions(displayOptions),
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

  private createResultPdfExportWindow(): BrowserWindow {
    const exportWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 1800,
      backgroundColor: '#ffffff',
      autoHideMenuBar: process.platform !== 'darwin',
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    if (process.platform !== 'darwin') {
      exportWindow.removeMenu();
      exportWindow.setMenuBarVisibility(false);
    }

    return exportWindow;
  }

  private async exportResultPdfTask(
    exportWindow: BrowserWindow,
    projectId: string,
    paperId: string,
    targetPath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const token = nanoid();
    const readyPromise = this.waitForResultPdfPrintReady(token, signal);
    void readyPromise.catch(() => undefined);
    try {
      await this.loadResultPdfPrintRoute(exportWindow, projectId, paperId, token);
      await readyPromise;
      throwIfAborted(signal);
      const pdfBuffer = await exportWindow.webContents.printToPDF(
        getDefaultPdfPrintOptions(),
      );
      throwIfAborted(signal);
      await writeFile(targetPath, pdfBuffer);
    } catch (error) {
      this.clearResultPdfPrintWaiter(token);
      throw error;
    }
  }

  private async loadResultPdfPrintRoute(
    exportWindow: BrowserWindow,
    projectId: string,
    paperId: string,
    token: string,
  ): Promise<void> {
    const hash = `#/print/projects/${encodeURIComponent(
      projectId,
    )}/results/${encodeURIComponent(paperId)}?token=${encodeURIComponent(
      token,
    )}`;

    if (process.env.ELECTRON_RENDERER_URL) {
      await exportWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}${hash}`);
      return;
    }

    await exportWindow.loadFile(join(__dirname, '../../dist/index.html'), {
      hash,
    });
  }

  private waitForResultPdfPrintReady(
    token: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }

      const timer = setTimeout(() => {
        this.resultPdfPrintWaiters.delete(token);
        reject(new Error('批阅结果打印页渲染超时。'));
      }, RESULT_PDF_PRINT_READY_TIMEOUT_MS);
      const abortHandler = () => {
        clearTimeout(timer);
        this.resultPdfPrintWaiters.delete(token);
        reject(createAbortError());
      };
      signal?.addEventListener('abort', abortHandler, { once: true });

      this.resultPdfPrintWaiters.set(token, {
        resolve,
        reject,
        timer,
        cleanup: () => {
          signal?.removeEventListener('abort', abortHandler);
        },
      });
    });
  }

  private clearResultPdfPrintWaiter(token: string): void {
    const waiter = this.resultPdfPrintWaiters.get(token);
    if (!waiter) {
      return;
    }

    clearTimeout(waiter.timer);
    waiter.cleanup();
    this.resultPdfPrintWaiters.delete(token);
  }

  private async runResultPdfExportJob(
    tasks: TaskManager,
    projects: ProjectService,
    jobId: string,
    projectId: string,
    options: ExportAllResultPdfsOptions,
    controller: AbortController,
  ): Promise<void> {
    const startedAt = Date.now();

    try {
      await tasks.appendJobLog(jobId, '开始批量导出批阅 PDF，最大并行窗口数 4', {
        summary: '正在准备批量导出批阅 PDF',
        currentPaperLabel: '准备导出',
      });

      const result = await this.exportAllResultPdfs(
        projects,
        projectId,
        options,
        async (progress) => {
          if (controller.signal.aborted) {
            return;
          }
          const ratio =
            progress.total > 0
              ? Number((progress.completed / progress.total).toFixed(3))
              : 1;
          const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 1);
          const speed =
            progress.completed > 0
              ? Number((elapsedSeconds / progress.completed).toFixed(2))
              : 0;

          await tasks.updateJob(jobId, {
            progress: ratio,
            speed,
            eta: estimateEta(ratio, speed * progress.total),
            currentPaperLabel: progress.currentPaperCode ?? '等待分发',
            summary:
              progress.total > 0
                ? `正在导出批阅 PDF，已完成 ${progress.completed}/${progress.total}，失败 ${progress.failed}`
                : '没有可导出的批阅 PDF',
          });
        },
        controller.signal,
      );
      if (controller.signal.aborted) {
        return;
      }

      for (const failure of result.failures) {
        await tasks.appendJobLog(
          jobId,
          `[${failure.paperCode}] 导出失败：${failure.errorMessage}`,
        );
      }

      await tasks.appendJobLog(jobId, `导出目录：${result.outputDirectory}`, {
        status: result.failedCount > 0 ? 'failed' : 'completed',
        progress: 1,
        eta: null,
        currentPaperLabel: result.failedCount > 0 ? '存在失败文件' : '全部完成',
        summary:
          result.failedCount > 0
            ? `批量 PDF 导出完成，成功 ${result.exportedCount} 份，失败 ${result.failedCount} 份`
            : `批量 PDF 导出完成，共 ${result.exportedCount} 份`,
        speed:
          result.exportedCount + result.failedCount > 0
            ? Number(
                (
                  Math.max((Date.now() - startedAt) / 1000, 1) /
                  (result.exportedCount + result.failedCount)
                ).toFixed(2),
              )
            : 0,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      await tasks.appendJobLog(jobId, '批量 PDF 导出任务失败', {
        status: 'failed',
        progress: 1,
        eta: null,
        currentPaperLabel: '导出失败',
        summary:
          error instanceof Error ? error.message : '批量 PDF 导出任务失败',
      });
    } finally {
      this.resultPdfExportControllers.delete(jobId);
    }
  }

  async setPreviewActiveQuestion(
    token: string | null,
    activeQuestionId: string,
  ): Promise<void> {
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

  async setPreviewDisplayOptions(
    token: string | null,
    displayOptions: PreviewDisplayOptions,
  ): Promise<void> {
    const targetTokens = token ? [token] : [...this.previewSessions.keys()];
    const normalizedDisplayOptions =
      normalizePreviewDisplayOptions(displayOptions);

    for (const targetToken of targetTokens) {
      const session = this.previewSessions.get(targetToken);
      if (!session) {
        continue;
      }

      session.displayOptions = normalizedDisplayOptions;
      const previewWindow = this.previewWindows.get(targetToken);
      if (!previewWindow || previewWindow.isDestroyed()) {
        continue;
      }

      previewWindow.webContents.send('preview:display-options-changed', {
        token: targetToken,
        displayOptions: normalizedDisplayOptions,
      });
    }
  }

  async savePreviewImage(
    source: string,
    suggestedName?: string,
  ): Promise<string | null> {
    return this.savePreviewImageForWindow(
      this.getParentWindow(),
      source,
      suggestedName,
    );
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

function normalizePdfFileName(targetPath: string): string {
  const trimmed = targetPath.trim();
  if (!trimmed) {
    throw new Error('PDF 保存路径不能为空。');
  }

  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

function getDefaultPdfPrintOptions(): PrintToPDFOptions {
  return {
    landscape: false,
    printBackground: true,
    preferCSSPageSize: true,
    margins: {
      marginType: 'default',
    },
    pageSize: 'A4',
  };
}

function buildResultPdfExportTasks(
  results: ResultRecord[],
  papers: PaperRecord[],
): ResultPdfExportTask[] {
  const paperMap = new Map(papers.map((paper) => [paper.id, paper]));
  const paperOrderMap = new Map(
    papers.map((paper, index) => [paper.id, index]),
  );

  return results
    .filter(
      (
        result,
      ): result is ResultRecord & {
        finalResult: FinalResult;
        modelResult: NonNullable<ResultRecord['modelResult']>;
      } => Boolean(result.finalResult && result.modelResult),
    )
    .sort((left, right) => {
      const leftOrder =
        paperOrderMap.get(left.paperId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder =
        paperOrderMap.get(right.paperId) ?? Number.MAX_SAFE_INTEGER;
      return (
        leftOrder - rightOrder ||
        left.paperId.localeCompare(right.paperId, 'zh-CN')
      );
    })
    .map((result) => {
      const paper = paperMap.get(result.paperId);
      const paperCode = paper?.paperCode ?? result.paperId;

      return {
        paperId: result.paperId,
        paperCode,
        baseFileName: buildResultPdfBaseFileName(result, paperCode),
      };
    });
}

function buildResultPdfBaseFileName(
  result: ResultRecord & { finalResult: FinalResult },
  paperCode: string,
): string {
  const studentInfo = result.finalResult.studentInfo;
  const verifiedParts =
    result.nameMatchStatus === 'verified'
      ? [studentInfo.name, studentInfo.studentId, studentInfo.className]
          .map((item) => sanitizeResultPdfFileNamePart(item))
          .filter(Boolean)
      : [];
  const fallback = sanitizeResultPdfFileNamePart(paperCode);

  return verifiedParts.join('_') || fallback || '批阅结果';
}

function sanitizeResultPdfFileNamePart(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function reserveUniquePdfPath(
  outputDirectory: string,
  baseFileName: string,
  reservedPaths: Set<string>,
): string {
  const safeBaseFileName =
    sanitizeResultPdfFileNamePart(baseFileName) || '批阅结果';
  let index = 1;

  for (;;) {
    const suffix = index === 1 ? '' : `-${index}`;
    const candidatePath = normalizePdfFileName(
      join(outputDirectory, `${safeBaseFileName}${suffix}.pdf`),
    );

    if (!reservedPaths.has(candidatePath) && !existsSync(candidatePath)) {
      reservedPaths.add(candidatePath);
      return candidatePath;
    }

    index += 1;
  }
}

function createAbortError(): Error {
  return new Error('PDF 导出任务已停止。');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function normalizeExcelFileName(targetPath: string): string {
  const trimmed = targetPath.trim();
  if (!trimmed) {
    throw new Error('Excel 保存路径不能为空。');
  }

  return trimmed.toLowerCase().endsWith('.xlsx') ? trimmed : `${trimmed}.xlsx`;
}

function normalizePreviewDisplayOptions(
  displayOptions?: PreviewDisplayOptions,
): PreviewDisplayOptions {
  return {
    showQuestionTags:
      displayOptions?.showQuestionTags ??
      DEFAULT_PREVIEW_DISPLAY_OPTIONS.showQuestionTags,
    showQuestionBoxes:
      displayOptions?.showQuestionBoxes ??
      DEFAULT_PREVIEW_DISPLAY_OPTIONS.showQuestionBoxes,
    showQuestionScores:
      displayOptions?.showQuestionScores ??
      DEFAULT_PREVIEW_DISPLAY_OPTIONS.showQuestionScores,
  };
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

async function resolvePreviewImageSource(
  source: string,
): Promise<ResolvedPreviewImage> {
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
    throw new Error(
      `下载图片失败（${response.status} ${response.statusText}）。`,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  const buffer = Buffer.from(await response.arrayBuffer());
  const extension =
    extensionFromContentType(contentType) ||
    normalizeExtension(extname(new URL(source).pathname));

  return {
    kind: 'buffer',
    buffer,
    extension,
  };
}

function buildSuggestedFileName(
  image: ResolvedPreviewImage,
  suggestedName?: string,
): string {
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
