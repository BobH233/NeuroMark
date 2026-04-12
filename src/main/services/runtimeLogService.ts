import { BrowserWindow } from 'electron';
import type { DebugLogEntry } from '@preload/contracts';

type WriteTarget = {
  write: (...args: any[]) => boolean;
};

const DEBUG_LOG_EVENT = 'app:debug-log';
const MAX_BUFFERED_LOG_LINES = 3000;

type BufferedDebugLogEntry = {
  entry: DebugLogEntry;
  lineCount: number;
};

function countLogLines(text: string): number {
  if (!text) {
    return 0;
  }

  let lineCount = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      lineCount += 1;
    }
  }

  return lineCount;
}

export class RuntimeLogService {
  private readonly entries: BufferedDebugLogEntry[] = [];
  private installed = false;
  private sequence = 0;
  private enabled = false;
  private totalLineCount = 0;

  install(): void {
    if (this.installed) {
      return;
    }

    this.installed = true;
    this.patchStream(process.stdout, 'stdout');
    this.patchStream(process.stderr, 'stderr');
  }

  getSnapshot(): DebugLogEntry[] {
    if (!this.enabled) {
      return [];
    }

    return this.entries.map(({ entry }) => entry);
  }

  enable(): void {
    this.enabled = true;
  }

  private patchStream(target: WriteTarget, stream: DebugLogEntry['stream']): void {
    const originalWrite = target.write.bind(target);

    target.write = ((chunk: unknown, ...args: unknown[]) => {
      const entry: DebugLogEntry = {
        id: `${Date.now()}-${this.sequence += 1}`,
        text: this.normalizeChunk(chunk),
        timestamp: new Date().toISOString(),
        stream,
      };

      if (this.enabled) {
        this.append(entry);
      }

      return originalWrite(chunk, ...args);
    }) as typeof target.write;
  }

  private append(entry: DebugLogEntry): void {
    if (!entry.text) {
      return;
    }

    const lineCount = countLogLines(entry.text);
    if (lineCount <= 0) {
      return;
    }

    this.entries.push({ entry, lineCount });
    this.totalLineCount += lineCount;

    while (this.totalLineCount > MAX_BUFFERED_LOG_LINES && this.entries.length) {
      const removed = this.entries.shift();
      this.totalLineCount -= removed?.lineCount ?? 0;
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(DEBUG_LOG_EVENT, entry);
      }
    }
  }

  private normalizeChunk(chunk: unknown): string {
    if (typeof chunk === 'string') {
      return chunk;
    }

    if (chunk instanceof Uint8Array) {
      return Buffer.from(chunk).toString('utf8');
    }

    if (Buffer.isBuffer(chunk)) {
      return chunk.toString('utf8');
    }

    return String(chunk ?? '');
  }
}
