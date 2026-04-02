import { defineStore } from 'pinia';
import type { DebugLogEntry } from '@preload/contracts';

const ENABLED_STORAGE_KEY = 'neuromark.debug-panel-enabled';
const CLICK_WINDOW_MS = 1800;
const REQUIRED_LOGO_CLICKS = 5;
const MAX_RENDER_ENTRIES = 1500;
let initializePromise: Promise<void> | null = null;

export const useDebugPanelStore = defineStore('debug-panel', {
  state: () => ({
    enabled: import.meta.env.DEV,
    initialized: false,
    entries: [] as DebugLogEntry[],
    logoClickCount: 0,
    lastLogoClickAt: 0,
  }),
  getters: {
    output(state) {
      return state.entries.map((entry) => entry.text).join('');
    },
    formattedOutput(state) {
      return state.entries
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
      if (import.meta.env.DEV) {
        this.enabled = true;
        return;
      }

      this.enabled = localStorage.getItem(ENABLED_STORAGE_KEY) === 'true';
    },
    async initialize() {
      if (this.initialized) {
        return;
      }

      if (!initializePromise) {
        initializePromise = (async () => {
          try {
            this.hydrate();
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
      localStorage.setItem(ENABLED_STORAGE_KEY, 'true');
      this.logoClickCount = 0;
      return true;
    },
    trimEntries() {
      if (this.entries.length > MAX_RENDER_ENTRIES) {
        this.entries.splice(0, this.entries.length - MAX_RENDER_ENTRIES);
      }
    },
  },
});
