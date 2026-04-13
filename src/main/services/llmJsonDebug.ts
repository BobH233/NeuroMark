import path from 'node:path';
import fs from 'fs-extra';
import { app } from 'electron';

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'unknown';
}

export function isLlmJsonDebugEnabled(): boolean {
  return !app.isPackaged || process.env.NEUROMARK_DEBUG_JSON === '1';
}

export async function writeLlmJsonDebugArtifact(input: {
  scope: string;
  identifier?: string;
  rawOutput: string;
  errorMessage: string;
}): Promise<string | null> {
  if (!isLlmJsonDebugEnabled() || !input.rawOutput.trim()) {
    return null;
  }

  const debugDir = path.join(app.getPath('userData'), 'llm-json-debug');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const segments = [timestamp, sanitizeSegment(input.scope)];
  if (input.identifier) {
    segments.push(sanitizeSegment(input.identifier));
  }
  const filePath = path.join(debugDir, `${segments.join('__')}.txt`);

  await fs.ensureDir(debugDir);
  await fs.writeFile(
    filePath,
    [
      `timestamp=${new Date().toISOString()}`,
      `scope=${input.scope}`,
      `identifier=${input.identifier ?? ''}`,
      `error=${input.errorMessage}`,
      '',
      input.rawOutput,
    ].join('\n'),
    'utf8',
  );

  return filePath;
}

export function shouldWriteLlmJsonDebugArtifact(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error instanceof SyntaxError ||
    error.message.includes('JSON') ||
    error.message.includes('合法 JSON') ||
    error.message.includes('解析')
  );
}
