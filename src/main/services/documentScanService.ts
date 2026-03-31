import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import { app } from 'electron';
import type { CornerPoint } from '@preload/contracts';

const require = createRequire(import.meta.url);

interface NativeScanResult {
  sourceWidth: number;
  sourceHeight: number;
  scannedWidth: number;
  scannedHeight: number;
  scannedOutputPath: string;
  overlayOutputPath: string;
  corners: Array<{ x: number; y: number }>;
  debugOutputPaths: string[];
}

interface NativeScannerInstance {
  scanDocument: (options: {
    inputPath: string;
    scannedOutputPath: string;
    overlayOutputPath?: string;
    debugOutputPrefix?: string;
    writeDebugImages?: boolean;
    applyPostProcess?: boolean;
  }) => Promise<NativeScanResult>;
}

interface NativeScanModule {
  createScanner: (options: { modelPath: string }) => NativeScannerInstance;
}

export interface ScanDocumentResult {
  scannedPath: string;
  debugPreviewPath: string;
  cornersPath: string;
  corners: CornerPoint[];
}

interface ProcessDocumentImageOptions {
  writeDebugArtifacts?: boolean;
  applyPostProcess?: boolean;
}

let scannerPromise: Promise<NativeScannerInstance> | null = null;

function getPlatformArtifactDir(): string {
  return `${process.platform}-${process.arch}`;
}

function getProjectRoot(): string {
  let currentDir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (fs.pathExistsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return app.getAppPath();
    }

    currentDir = parentDir;
  }
}

function resolveNativeAddonPath(): string {
  const artifactDir = getPlatformArtifactDir();
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'native', artifactDir, 'scancpp_node.node');
  }

  return path.join(getProjectRoot(), 'build', 'native', artifactDir, 'scancpp_node.node');
}

function resolveModelPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'models', 'u2netp.onnx');
  }

  return path.join(getProjectRoot(), 'src-native', 'scancpp', 'models', 'u2netp.onnx');
}

function toCornerPoints(corners: Array<{ x: number; y: number }>): CornerPoint[] {
  return corners.map((point) => ({
    x: Math.round(point.x),
    y: Math.round(point.y),
  }));
}

function createBoundsFromCorners(corners: CornerPoint[]) {
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);

  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

async function getScanner(): Promise<NativeScannerInstance> {
  if (!scannerPromise) {
    scannerPromise = (async () => {
      const addonPath = resolveNativeAddonPath();
      const modelPath = resolveModelPath();

      if (!(await fs.pathExists(addonPath))) {
        throw new Error(
          `未找到扫描原生模块：${addonPath}。请先执行 npm run build:native。`,
        );
      }

      if (!(await fs.pathExists(modelPath))) {
        throw new Error(`未找到扫描模型文件：${modelPath}`);
      }

      const addon = require(addonPath) as NativeScanModule;
      return addon.createScanner({ modelPath });
    })().catch((error) => {
      scannerPromise = null;
      throw error;
    });
  }

  return scannerPromise;
}

function shouldWriteDebugArtifacts(options?: ProcessDocumentImageOptions): boolean {
  if (typeof options?.writeDebugArtifacts === 'boolean') {
    return options.writeDebugArtifacts;
  }

  return process.env.NEUROMARK_SCANCPP_DEBUG === '1';
}

export async function processDocumentImage(
  inputPath: string,
  scannedPath: string,
  debugPreviewPath: string,
  cornersPath: string,
  options?: ProcessDocumentImageOptions,
): Promise<ScanDocumentResult> {
  const scanner = await getScanner();
  const writeDebugArtifacts = shouldWriteDebugArtifacts(options);
  const debugOutputPrefix = writeDebugArtifacts
    ? path.join(
        path.dirname(cornersPath),
        `${path.basename(cornersPath, path.extname(cornersPath))}_native`,
      )
    : undefined;

  await fs.ensureDir(path.dirname(scannedPath));
  await fs.ensureDir(path.dirname(debugPreviewPath));
  await fs.ensureDir(path.dirname(cornersPath));

  const nativeResult = await scanner.scanDocument({
    inputPath,
    scannedOutputPath: scannedPath,
    overlayOutputPath: debugPreviewPath,
    debugOutputPrefix,
    writeDebugImages: writeDebugArtifacts,
    applyPostProcess: options?.applyPostProcess ?? true,
  });

  const corners = toCornerPoints(nativeResult.corners);

  await fs.writeJson(
    cornersPath,
    {
      scanner: 'scancpp-native',
      model: path.basename(resolveModelPath()),
      corners,
      bounds: createBoundsFromCorners(corners),
      sourceWidth: nativeResult.sourceWidth,
      sourceHeight: nativeResult.sourceHeight,
      scannedWidth: nativeResult.scannedWidth,
      scannedHeight: nativeResult.scannedHeight,
      applyPostProcess: options?.applyPostProcess ?? true,
      debugOutputPaths: nativeResult.debugOutputPaths,
      generatedAt: new Date().toISOString(),
    },
    { spaces: 2 },
  );

  return {
    scannedPath,
    debugPreviewPath,
    cornersPath,
    corners,
  };
}
