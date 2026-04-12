import { defineStore } from 'pinia';

type TokenSource = 'preview' | 'reasoning';

export interface TokenVisualizerBurst {
  id: string;
  text: string;
  source: TokenSource;
  createdAt: number;
}

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

export const useTokenVisualizerStore = defineStore('token-visualizer', {
  state: () => ({
    enabled: false,
    lastTextByStreamKey: {} as Record<string, string>,
    pendingBursts: [] as TokenVisualizerBurst[],
    burstSequence: 0,
  }),
  getters: {
    isReady() {
      return true;
    },
  },
  actions: {
    setEnabled(nextValue: boolean) {
      this.enabled = nextValue;
    },
    toggle() {
      this.enabled = !this.enabled;
    },
    syncText(streamKey: string, source: TokenSource, nextText: string | null | undefined) {
      const normalizedStreamKey = streamKey.trim();
      if (!normalizedStreamKey) {
        return;
      }

      const normalizedText = nextText ?? '';
      const cacheKey = `${normalizedStreamKey}:${source}`;
      const lastText = this.lastTextByStreamKey[cacheKey] ?? '';
      const commonPrefixLength = getCommonPrefixLength(lastText, normalizedText);
      const appended = normalizedText.slice(commonPrefixLength);

      this.lastTextByStreamKey[cacheKey] = normalizedText;

      if (!this.enabled || !appended.trim()) {
        return;
      }

      const tokens = splitIntoTokens(appended);
      const now = Date.now();
      for (const token of tokens) {
        this.burstSequence += 1;
        this.pendingBursts.push({
          id: `${now}-${this.burstSequence}`,
          text: token,
          source,
          createdAt: now,
        });
      }
    },
    drainPending(limit = 12) {
      if (limit <= 0 || this.pendingBursts.length === 0) {
        return [] as TokenVisualizerBurst[];
      }
      return this.pendingBursts.splice(0, limit);
    },
    trimPending(limit = 0) {
      if (limit < 0) {
        return;
      }
      if (this.pendingBursts.length <= limit) {
        return;
      }
      const overflow = this.pendingBursts.length - limit;
      this.pendingBursts.splice(0, overflow);
    },
    getPendingCount() {
      return this.pendingBursts.length;
    },
    resetScene() {
      this.pendingBursts = [];
    },
  },
});
