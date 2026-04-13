import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamingInactivityTimeoutError,
  readStreamChunkWithInactivityTimeout,
} from '../../src/main/services/llmStreamUtils';

describe('createStreamingInactivityTimeoutError', () => {
  it('describes startup timeout before the first chunk arrives', () => {
    expect(
      createStreamingInactivityTimeoutError(5000, false).message,
    ).toContain('启动超时');
  });

  it('describes interruption timeout after chunks have already arrived', () => {
    expect(
      createStreamingInactivityTimeoutError(5000, true).message,
    ).toContain('中断超时');
  });
});

describe('readStreamChunkWithInactivityTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects when the first stream chunk does not arrive within the timeout window', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const iterator: AsyncIterator<string> = {
      next: vi.fn(
        () =>
          new Promise<IteratorResult<string>>((resolve) => {
            setTimeout(() => {
              resolve({ value: 'late', done: false });
            }, 100);
          }),
      ),
    };

    const pending = readStreamChunkWithInactivityTimeout(iterator, {
      timeoutMs: 50,
      createTimeoutError: () => createStreamingInactivityTimeoutError(50, false),
      onTimeout,
    });
    const rejection = expect(pending).rejects.toThrow('启动超时');

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('rejects when a later stream chunk stalls for too long', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const iterator: AsyncIterator<string> = {
      next: vi.fn(
        () =>
          new Promise<IteratorResult<string>>((resolve) => {
            callCount += 1;
            setTimeout(() => {
              resolve({
                value: callCount === 1 ? 'first' : 'second',
                done: false,
              });
            }, callCount === 1 ? 10 : 100);
          }),
      ),
    };

    const firstChunk = readStreamChunkWithInactivityTimeout(iterator, {
      timeoutMs: 50,
      createTimeoutError: () => createStreamingInactivityTimeoutError(50, false),
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(firstChunk).resolves.toEqual({ value: 'first', done: false });

    const stalledChunk = readStreamChunkWithInactivityTimeout(iterator, {
      timeoutMs: 50,
      createTimeoutError: () => createStreamingInactivityTimeoutError(50, true),
    });
    const rejection = expect(stalledChunk).rejects.toThrow('中断超时');
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
  });
});
