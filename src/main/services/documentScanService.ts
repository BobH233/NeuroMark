import path from 'node:path';
import fs from 'fs-extra';
import sharp from 'sharp';
import type { CornerPoint } from '@preload/contracts';

interface Rectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ConnectedRegion extends Rectangle {
  area: number;
}

export interface ScanDocumentResult {
  scannedPath: string;
  debugPreviewPath: string;
  cornersPath: string;
  corners: CornerPoint[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeOtsuThreshold(pixels: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0);
  for (const pixel of pixels) {
    histogram[pixel] += 1;
  }

  const total = pixels.length;
  let sum = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    sum += index * histogram[index];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 170;

  for (let index = 0; index < histogram.length; index += 1) {
    weightBackground += histogram[index];
    if (weightBackground === 0) {
      continue;
    }

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) {
      break;
    }

    sumBackground += index * histogram[index];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance =
      weightBackground *
      weightForeground *
      (meanBackground - meanForeground) *
      (meanBackground - meanForeground);

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = index;
    }
  }

  return clamp(Math.round(threshold), 150, 235);
}

function findLargestBrightRegion(
  pixels: Uint8Array,
  width: number,
  height: number,
  threshold: number,
): ConnectedRegion | null {
  const visited = new Uint8Array(width * height);
  const minArea = Math.floor(width * height * 0.12);
  let best: ConnectedRegion | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < pixels.length; index += 1) {
    if (visited[index] === 1 || pixels[index] < threshold) {
      continue;
    }

    const queue = [index];
    visited[index] = 1;
    let pointer = 0;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (pointer < queue.length) {
      const current = queue[pointer];
      pointer += 1;

      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [
        current - 1,
        current + 1,
        current - width,
        current + width,
      ];

      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= pixels.length || visited[neighbor] === 1) {
          continue;
        }

        const nx = neighbor % width;
        const ny = Math.floor(neighbor / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) {
          continue;
        }

        if (pixels[neighbor] >= threshold) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }

    if (area < minArea) {
      continue;
    }

    const regionWidth = maxX - minX + 1;
    const regionHeight = maxY - minY + 1;
    const bboxArea = regionWidth * regionHeight;
    const fillRatio = area / Math.max(1, bboxArea);
    const aspectRatio =
      Math.max(regionWidth, regionHeight) / Math.max(1, Math.min(regionWidth, regionHeight));
    const coverage = area / Math.max(1, width * height);
    const score =
      area * fillRatio -
      Math.abs(aspectRatio - 1.4142) * 240 -
      Math.abs(coverage - 0.55) * 1800;

    if (!best || score > bestScore) {
      best = {
        left: minX,
        top: minY,
        width: regionWidth,
        height: regionHeight,
        area,
      };
      bestScore = score;
    }
  }

  return best;
}

function expandRect(
  rect: Rectangle,
  width: number,
  height: number,
  paddingRatio = 0.018,
): Rectangle {
  const paddingX = Math.round(width * paddingRatio);
  const paddingY = Math.round(height * paddingRatio);
  const left = clamp(rect.left - paddingX, 0, width - 1);
  const top = clamp(rect.top - paddingY, 0, height - 1);
  const right = clamp(rect.left + rect.width + paddingX, left + 1, width);
  const bottom = clamp(rect.top + rect.height + paddingY, top + 1, height);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function createCorners(bounds: Rectangle): CornerPoint[] {
  return [
    { x: bounds.left, y: bounds.top },
    { x: bounds.left + bounds.width, y: bounds.top },
    { x: bounds.left + bounds.width, y: bounds.top + bounds.height },
    { x: bounds.left, y: bounds.top + bounds.height },
  ];
}

function createDebugOverlaySvg(
  width: number,
  height: number,
  bounds: Rectangle,
): string {
  const corners = createCorners(bounds);
  const radius = Math.max(7, Math.round(Math.min(width, height) * 0.01));
  const fontSize = Math.max(20, Math.round(Math.min(width, height) * 0.025));

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${bounds.left}" y="${bounds.top}" width="${bounds.width}" height="${bounds.height}" fill="none" stroke="#1da38a" stroke-width="8" rx="12" />
      ${corners
        .map(
          (point, index) => `
            <circle cx="${point.x}" cy="${point.y}" r="${radius}" fill="#ff5e5e" />
            <text x="${point.x + radius + 8}" y="${point.y - radius}" fill="#11453b" font-size="${fontSize}" font-family="PingFang SC, Microsoft YaHei, sans-serif">${index + 1}</text>
          `,
        )
        .join('')}
    </svg>
  `.trim();
}

async function detectDocumentBounds(inputPath: string): Promise<{
  sourceWidth: number;
  sourceHeight: number;
  bounds: Rectangle;
}> {
  const preview = sharp(inputPath).rotate().grayscale().normalise();
  const { data, info } = await preview
    .resize({ height: 1400, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sourceMetadata = await sharp(inputPath).rotate().metadata();
  const sourceWidth = sourceMetadata.width ?? info.width;
  const sourceHeight = sourceMetadata.height ?? info.height;
  const pixels = Uint8Array.from(data);
  const threshold = Math.max(168, computeOtsuThreshold(pixels));
  const region = findLargestBrightRegion(pixels, info.width, info.height, threshold);

  if (!region) {
    return {
      sourceWidth,
      sourceHeight,
      bounds: {
        left: 0,
        top: 0,
        width: sourceWidth,
        height: sourceHeight,
      },
    };
  }

  const expanded = expandRect(region, info.width, info.height);
  const scaleX = sourceWidth / info.width;
  const scaleY = sourceHeight / info.height;

  return {
    sourceWidth,
    sourceHeight,
    bounds: {
      left: clamp(Math.round(expanded.left * scaleX), 0, Math.max(0, sourceWidth - 1)),
      top: clamp(Math.round(expanded.top * scaleY), 0, Math.max(0, sourceHeight - 1)),
      width: clamp(Math.round(expanded.width * scaleX), 1, sourceWidth),
      height: clamp(Math.round(expanded.height * scaleY), 1, sourceHeight),
    },
  };
}

export async function processDocumentImage(
  inputPath: string,
  scannedPath: string,
  debugPreviewPath: string,
  cornersPath: string,
): Promise<ScanDocumentResult> {
  const { sourceWidth, sourceHeight, bounds } = await detectDocumentBounds(inputPath);
  const safeBounds = {
    left: clamp(bounds.left, 0, Math.max(0, sourceWidth - 1)),
    top: clamp(bounds.top, 0, Math.max(0, sourceHeight - 1)),
    width: clamp(bounds.width, 1, sourceWidth - bounds.left),
    height: clamp(bounds.height, 1, sourceHeight - bounds.top),
  };
  const corners = createCorners(safeBounds);

  await fs.ensureDir(path.dirname(scannedPath));
  await fs.ensureDir(path.dirname(debugPreviewPath));
  await fs.ensureDir(path.dirname(cornersPath));

  await sharp(inputPath)
    .rotate()
    .extract(safeBounds)
    .flatten({ background: '#ffffff' })
    .grayscale()
    .normalise()
    .sharpen({ sigma: 1.2 })
    .threshold(182)
    .png()
    .toFile(scannedPath);

  const overlay = createDebugOverlaySvg(sourceWidth, sourceHeight, safeBounds);
  await sharp(inputPath)
    .rotate()
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toFile(debugPreviewPath);

  await fs.writeJson(
    cornersPath,
    {
      corners,
      bounds: safeBounds,
      sourceWidth,
      sourceHeight,
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
