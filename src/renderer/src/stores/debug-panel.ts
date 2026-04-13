import { defineStore } from 'pinia';
import type { DebugLogEntry } from '@preload/contracts';

const CLICK_WINDOW_MS = 1800;
const REQUIRED_LOGO_CLICKS = 5;
const MAX_BUFFERED_LOG_LINES = 3000;
const MAX_RENDER_LOG_LINES = 1000;
let initializePromise: Promise<void> | null = null;

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

function takeLastLines(text: string, maxLines: number): string {
  if (!text || maxLines <= 0) {
    return '';
  }

  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  return lines.slice(-maxLines).join('\n');
}

function getTailEntries(entries: DebugLogEntry[], maxLines: number): DebugLogEntry[] {
  if (!entries.length || maxLines <= 0) {
    return [];
  }

  const selected: DebugLogEntry[] = [];
  let remainingLines = maxLines;

  for (let index = entries.length - 1; index >= 0 && remainingLines > 0; index -= 1) {
    const entry = entries[index];
    const lineCount = countLogLines(entry.text);
    if (lineCount <= 0) {
      continue;
    }

    if (lineCount <= remainingLines) {
      selected.push(entry);
      remainingLines -= lineCount;
      continue;
    }

    selected.push({
      ...entry,
      text: takeLastLines(entry.text, remainingLines),
    });
    remainingLines = 0;
  }

  return selected.reverse();
}

export const useDebugPanelStore = defineStore('debug-panel', {
  state: () => ({
    enabled: import.meta.env.DEV,
    initialized: false,
    entries: [] as DebugLogEntry[],
    logoClickCount: 0,
    lastLogoClickAt: 0,
  }),
  getters: {
    renderedEntries(state) {
      return getTailEntries(state.entries, MAX_RENDER_LOG_LINES);
    },
    output(): string {
      return this.renderedEntries.map((entry) => entry.text).join('');
    },
    formattedOutput(): string {
      return this.renderedEntries
        .map((entry) => {
          const date = new Date(entry.timestamp);
          const timeLabel = Number.isNaN(date.getTime())
            ? entry.timestamp
            : date.toLocaleTimeString('zh-CN', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3,
              });

          return `[${timeLabel}][${entry.stream}] ${entry.text}`;
        })
        .join('');
    },
  },
  actions: {
    hydrate() {
      this.enabled = import.meta.env.DEV;
    },
    async syncEnabledStateToMain() {
      if (!this.enabled) {
        return;
      }

      await window.neuromark.app.enableDebugPanel();
    },
    async initialize() {
      if (this.initialized) {
        return;
      }

      if (!initializePromise) {
        initializePromise = (async () => {
          try {
            this.hydrate();
            await this.syncEnabledStateToMain();
            this.entries = await window.neuromark.app.getDebugLogs();
            this.trimEntries();
            window.neuromark.app.onDebugLog((entry) => {
              this.entries.push(entry);
              this.trimEntries();
            });
            this.initialized = true;
          } catch (error) {
            initializePromise = null;
            throw error;
          }
        })();
      }

      await initializePromise;
    },
    registerLogoClick(): boolean {
      if (this.enabled) {
        return false;
      }

      const now = Date.now();
      this.logoClickCount =
        now - this.lastLogoClickAt <= CLICK_WINDOW_MS ? this.logoClickCount + 1 : 1;
      this.lastLogoClickAt = now;

      if (this.logoClickCount < REQUIRED_LOGO_CLICKS) {
        return false;
      }

      this.enabled = true;
      this.logoClickCount = 0;
      void this.syncEnabledStateToMain();
      return true;
    },
    trimEntries() {
      let totalLines = 0;
      for (let index = this.entries.length - 1; index >= 0; index -= 1) {
        totalLines += countLogLines(this.entries[index].text);
        if (totalLines > MAX_BUFFERED_LOG_LINES) {
          this.entries.splice(0, index + 1);
          break;
        }
      }
    },
  },
});
