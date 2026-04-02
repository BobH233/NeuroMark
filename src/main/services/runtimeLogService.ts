import { BrowserWindow } from 'electron';
import type { DebugLogEntry } from '@preload/contracts';

type WriteTarget = {
  write: (...args: any[]) => boolean;
};

const DEBUG_LOG_EVENT = 'app:debug-log';

export class RuntimeLogService {
  private readonly entries: DebugLogEntry[] = [];
  private readonly maxEntries = 1500;
  private installed = false;
  private sequence = 0;

  install(): void {
    if (this.installed) {
      return;
    }

    this.installed = true;
    this.patchStream(process.stdout, 'stdout');
    this.patchStream(process.stderr, 'stderr');
  }

  getSnapshot(): DebugLogEntry[] {
    return [...this.entries];
  }

  getEventChannel(): string {
    return DEBUG_LOG_EVENT;
  }

  private patchStream(target: WriteTarget, stream: DebugLogEntry['stream']): void {
    const originalWrite = target.write.bind(target);

    target.write = ((chunk: unknown, ...args: unknown[]) => {
      this.append({
        id: `${Date.now()}-${this.sequence += 1}`,
        text: this.normalizeChunk(chunk),
        timestamp: new Date().toISOString(),
        stream,
      });

      return originalWrite(chunk, ...args);
    }) as typeof target.write;
  }

  private append(entry: DebugLogEntry): void {
    if (!entry.text) {
      return;
    }

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
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
