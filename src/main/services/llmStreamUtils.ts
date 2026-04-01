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
