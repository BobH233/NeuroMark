import { safeStorage } from 'electron';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import type {
  GlobalLlmSettings,
  SaveGlobalLlmSettingsInput,
  TestLlmConnectionPayload,
  TestLlmConnectionResult,
} from '@preload/contracts';
import { getDatabase } from '@main/database/client';
import { settingsTable } from '@main/database/schema';

const SETTINGS_ID = 1;

function toMaskedSecret(secret: string): string {
  if (!secret) {
    return '';
  }

  if (secret.length <= 8) {
    return `${secret.slice(0, 2)}***${secret.slice(-2)}`;
  }

  return `${secret.slice(0, 4)}********${secret.slice(-4)}`;
}

function encodeSecret(secret: string): { value: string; mode: 'safeStorage' | 'plainText' } {
  if (secret && safeStorage.isEncryptionAvailable()) {
    return {
      value: safeStorage.encryptString(secret).toString('base64'),
      mode: 'safeStorage',
    };
  }

  return {
    value: secret,
    mode: 'plainText',
  };
}

function decodeSecret(value: string, mode: string): string {
  if (!value) {
    return '';
  }

  if (mode === 'safeStorage' && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  }

  return value;
}

export class SettingsService {
  async getSettings(): Promise<GlobalLlmSettings> {
    const db = getDatabase();
    const current = db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.id, SETTINGS_ID))
      .get();

    if (!current) {
      return {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        apiKeyMasked: '',
        apiKeyStored: false,
        timeoutMs: 180000,
        storageMode: safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'plainText',
      };
    }

    const decoded = decodeSecret(current.apiKeyEncrypted, current.storageMode);
    return {
      baseUrl: current.baseUrl,
      model: current.model,
      apiKeyMasked: toMaskedSecret(decoded),
      apiKeyStored: Boolean(decoded),
      timeoutMs: current.timeoutMs,
      storageMode: current.storageMode as 'safeStorage' | 'plainText',
    };
  }

  async saveSettings(input: SaveGlobalLlmSettingsInput): Promise<GlobalLlmSettings> {
    const db = getDatabase();
    const existing = db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.id, SETTINGS_ID))
      .get();

    const apiKey = input.apiKey?.trim() || decodeSecret(existing?.apiKeyEncrypted ?? '', existing?.storageMode ?? '');
    const encoded = encodeSecret(apiKey);

    db
      .insert(settingsTable)
      .values({
        id: SETTINGS_ID,
        baseUrl: input.baseUrl.trim(),
        model: input.model.trim(),
        apiKeyEncrypted: encoded.value,
        timeoutMs: input.timeoutMs,
        storageMode: encoded.mode,
      })
      .onConflictDoUpdate({
        target: settingsTable.id,
        set: {
          baseUrl: input.baseUrl.trim(),
          model: input.model.trim(),
          apiKeyEncrypted: encoded.value,
          timeoutMs: input.timeoutMs,
          storageMode: encoded.mode,
        },
      })
      .run();

    return this.getSettings();
  }

  async testConnection(
    payload: TestLlmConnectionPayload,
  ): Promise<TestLlmConnectionResult> {
    const startedAt = Date.now();
    try {
      const client = new OpenAI({
        apiKey: payload.apiKey,
        baseURL: payload.baseUrl,
        timeout: payload.timeoutMs,
      });
      await client.chat.completions.create({
        model: payload.model,
        messages: [{ role: 'user', content: '请回复“ok”。' }],
        max_tokens: 8,
        temperature: 0,
      });

      return {
        success: true,
        message: '连接测试成功，后端可用。',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      return {
        success: false,
        message: `连接测试失败：${message}`,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  async getRawSecret(): Promise<string> {
    const db = getDatabase();
    const current = db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.id, SETTINGS_ID))
      .get();
    return decodeSecret(current?.apiKeyEncrypted ?? '', current?.storageMode ?? '');
  }
}

