import { defineStore } from 'pinia';

type TokenSource = 'preview' | 'reasoning';

export interface TokenVisualizerBurst {
  id: string;
  text: string;
  source: TokenSource;
  createdAt: number;
}

interface PendingSyncItem {
  streamKey: string;
  source: TokenSource;
  text: string;
}

const lastTextByStreamKey: Record<string, string> = {};
const pendingBursts: TokenVisualizerBurst[] = [];
const queuedSyncs = new Map<string, PendingSyncItem>();
const MAX_SYNC_BATCH_SIZE = 4;
const FLUSH_DELAY_MS = 16;

let burstSequence = 0;
let visualizerEnabled = false;
let flushTimer: number | null = null;

function splitIntoTokens(value: string): string[] {
  const normalized = value
    .replace(/[{}[\]":,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return [];
  }

  const chineseTokens = normalized.match(/[\u4e00-\u9fff]{1,8}/g) ?? [];
  const englishTokens = normalized
    .match(/[A-Za-z][A-Za-z0-9_-]*/g)
    ?.filter((token) => token.length >= 3)
    ?? [];
  const numberTokens = normalized.match(/\d+(?:\.\d+)?/g) ?? [];

  if (chineseTokens.length > 0) {
    return [...chineseTokens, ...numberTokens, ...englishTokens].slice(0, 24);
  }

  return [...englishTokens, ...numberTokens].slice(0, 24);
}

function getCommonPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function clearFlushTimer() {
  if (flushTimer === null) {
    return;
  }

  window.clearTimeout(flushTimer);
  flushTimer = null;
}

function scheduleSyncFlush() {
  if (flushTimer !== null) {
    return;
  }

  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushQueuedSyncs();
  }, FLUSH_DELAY_MS);
}

function flushQueuedSyncs() {
  if (queuedSyncs.size === 0) {
    return;
  }

  let processedCount = 0;
  for (const [queueKey, item] of queuedSyncs) {
    queuedSyncs.delete(queueKey);
    processedCount += 1;

    const cacheKey = `${item.streamKey}:${item.source}`;
    const lastText = lastTextByStreamKey[cacheKey] ?? '';
    const nextText = item.text;
    const appended = nextText.startsWith(lastText)
      ? nextText.slice(lastText.length)
      : nextText.slice(getCommonPrefixLength(lastText, nextText));

    lastTextByStreamKey[cacheKey] = nextText;

    if (!visualizerEnabled || !appended.trim()) {
      if (processedCount >= MAX_SYNC_BATCH_SIZE) {
        break;
      }
      continue;
    }

    const tokens = splitIntoTokens(appended);
    const now = Date.now();
    for (const token of tokens) {
      burstSequence += 1;
      pendingBursts.push({
        id: `${now}-${burstSequence}`,
        text: token,
        source: item.source,
        createdAt: now,
      });
    }

    if (processedCount >= MAX_SYNC_BATCH_SIZE) {
      break;
    }
  }

  if (queuedSyncs.size > 0) {
    scheduleSyncFlush();
  }
}

export const useTokenVisualizerStore = defineStore('token-visualizer', {
  state: () => ({
    enabled: false,
  }),
  getters: {
    isReady() {
      return true;
    },
  },
  actions: {
    setEnabled(nextValue: boolean) {
      this.enabled = nextValue;
      visualizerEnabled = nextValue;
    },
    toggle() {
      this.enabled = !this.enabled;
      visualizerEnabled = this.enabled;
    },
    syncText(streamKey: string, source: TokenSource, nextText: string | null | undefined) {
      const normalizedStreamKey = streamKey.trim();
      if (!normalizedStreamKey) {
        return;
      }

      const normalizedText = nextText ?? '';
      const queueKey = `${normalizedStreamKey}:${source}`;
      queuedSyncs.set(queueKey, {
        streamKey: normalizedStreamKey,
        source,
        text: normalizedText,
      });
      scheduleSyncFlush();
    },
    drainPending(limit = 12) {
      if (limit <= 0 || pendingBursts.length === 0) {
        return [] as TokenVisualizerBurst[];
      }
      return pendingBursts.splice(0, limit);
    },
    trimPending(limit = 0) {
      if (limit < 0) {
        return;
      }
      if (pendingBursts.length <= limit) {
        return;
      }
      const overflow = pendingBursts.length - limit;
      pendingBursts.splice(0, overflow);
    },
    getPendingCount() {
      return pendingBursts.length;
    },
    resetScene() {
      clearFlushTimer();
      queuedSyncs.clear();
      pendingBursts.length = 0;
    },
  },
});
