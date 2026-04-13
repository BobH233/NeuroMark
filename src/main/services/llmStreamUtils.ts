export const STREAM_PREVIEW_LIMIT = 200;

export function shortenText(value: string, maxLength = 2400): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n... [truncated ${value.length - maxLength} chars]`;
}

export function extractCompletionText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String(part.text ?? '');
        }
        return '';
      })
      .join('\n');
  }

  return '';
}

export function extractStreamingDeltaText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String(part.text ?? '');
        }
        return '';
      })
      .join('');
  }

  return '';
}

export function extractReasoningText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => extractReasoningText(item)).join('');
  }

  if (!value || typeof value !== 'object') {
    return '';
  }

  const candidate = value as Record<string, unknown>;
  const directKeys = [
    'reasoning',
    'reasoning_content',
    'reasoningContent',
    'thinking',
    'thinking_content',
    'thinkingContent',
  ];

  for (const key of directKeys) {
    const text = extractReasoningText(candidate[key]);
    if (text) {
      return text;
    }
  }

  if ('text' in candidate && typeof candidate.text === 'string') {
    return candidate.text;
  }

  if ('content' in candidate) {
    return extractReasoningText(candidate.content);
  }

  return '';
}

export function readAssistantText(response: any): string {
  const message = response.choices[0]?.message;
  if (!message) {
    throw new Error('模型没有返回可用消息。');
  }

  const extracted = extractCompletionText(message.content).trim();
  if (extracted) {
    return extracted;
  }

  throw new Error('模型返回内容为空。');
}

export function formatStreamPreview(text: string, limit = STREAM_PREVIEW_LIMIT): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '(empty)';
  }

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(-limit)}...`;
}

export function createStreamingInactivityTimeoutError(
  timeoutMs: number,
  hasReceivedStreamChunk: boolean,
): Error {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return new Error(
    hasReceivedStreamChunk
      ? `流式响应中断超时，连续 ${timeoutSeconds} 秒未收到新的增量消息。`
      : `流式响应启动超时，${timeoutSeconds} 秒内未收到任何增量消息。`,
  );
}

export async function readStreamChunkWithInactivityTimeout<T>(
  iterator: AsyncIterator<T>,
  input: {
    timeoutMs: number;
    createTimeoutError: () => Error;
    onTimeout?: (error: Error) => void;
  },
): Promise<IteratorResult<T>> {
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      const error = input.createTimeoutError();
      input.onTimeout?.(error);
      reject(error);
    }, input.timeoutMs);

    iterator.next().then(
      (result) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function isStreamingFallbackCandidate(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('stream') ||
    message.includes('sse') ||
    message.includes('not supported') ||
    message.includes('unexpected') ||
    message.includes('invalid')
  );
}

export function compactErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/\s+/g, ' ').trim();
  }
  return '未知错误';
}
