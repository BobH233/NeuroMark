function maskSecret(secret: string): string {
  if (!secret) {
    return '';
  }

  if (secret.length <= 8) {
    return `${secret.slice(0, 2)}***${secret.slice(-2)}`;
  }

  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) {
      const prefix = value.slice(0, 64);
      return `${prefix}... [data-url length=${value.length}]`;
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, itemValue]) => {
        if (key.toLowerCase().includes('apikey')) {
          return [key, maskSecret(String(itemValue ?? ''))];
        }
        return [key, sanitizeValue(itemValue)];
      }),
    );
  }

  return value;
}

function stringifyForTerminal(value: unknown): string {
  return JSON.stringify(sanitizeValue(value), null, 2);
}

export function logLlmRequest(
  label: string,
  input: {
    client: {
      baseURL: string;
      model: string;
      timeoutMs: number;
      apiKey: string;
      reasoningEffort?: string;
      answerGenerationTemperature?: number;
      gradingTemperature?: number;
    };
    payload: unknown;
  },
): void {
  console.info(`[llm:${label}] client\n${stringifyForTerminal({
    ...input.client,
    apiKey: maskSecret(input.client.apiKey),
  })}`);
  console.info(`[llm:${label}] payload\n${stringifyForTerminal(input.payload)}`);
}

export function logLlmProgress(
  label: string,
  detail: unknown,
): void {
  console.info(`[llm:${label}] progress\n${stringifyForTerminal(detail)}`);
}

export function logLlmResult(
  label: string,
  input: {
    status: 'success' | 'error';
    detail: unknown;
  },
): void {
  const method = input.status === 'success' ? console.info : console.error;
  method(`[llm:${label}] ${input.status}\n${stringifyForTerminal(input.detail)}`);
}
