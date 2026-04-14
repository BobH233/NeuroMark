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

function getDebugDir(): string {
  return path.join(app.getPath('userData'), 'llm-json-debug');
}

function buildDebugFilePath(scope: string, identifier?: string, suffix?: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const segments = [timestamp, sanitizeSegment(scope)];
  if (identifier) {
    segments.push(sanitizeSegment(identifier));
  }
  if (suffix) {
    segments.push(sanitizeSegment(suffix));
  }
  return path.join(getDebugDir(), `${segments.join('__')}.txt`);
}

export async function writeLlmDebugTextArtifact(input: {
  scope: string;
  identifier?: string;
  suffix?: string;
  text: string;
}): Promise<string | null> {
  if (!isLlmJsonDebugEnabled() || !input.text.trim()) {
    return null;
  }

  const debugDir = getDebugDir();
  const filePath = buildDebugFilePath(input.scope, input.identifier, input.suffix);
  await fs.ensureDir(debugDir);
  await fs.writeFile(filePath, input.text, 'utf8');
  return filePath;
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

  const debugDir = getDebugDir();
  const filePath = buildDebugFilePath(input.scope, input.identifier);

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
