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
        apiKey: '',
        timeoutMs: 180000,
      };
    }

    return {
      baseUrl: current.baseUrl,
      model: current.model,
      apiKey: current.apiKeyEncrypted,
      timeoutMs: current.timeoutMs,
    };
  }

  async saveSettings(input: SaveGlobalLlmSettingsInput): Promise<GlobalLlmSettings> {
    const db = getDatabase();
    const existing = db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.id, SETTINGS_ID))
      .get();

    const apiKey = input.apiKey?.trim() || existing?.apiKeyEncrypted || '';

    db
      .insert(settingsTable)
      .values({
        id: SETTINGS_ID,
        baseUrl: input.baseUrl.trim(),
        model: input.model.trim(),
        apiKeyEncrypted: apiKey,
        timeoutMs: input.timeoutMs,
        storageMode: 'plainText',
      })
      .onConflictDoUpdate({
        target: settingsTable.id,
        set: {
          baseUrl: input.baseUrl.trim(),
          model: input.model.trim(),
          apiKeyEncrypted: apiKey,
          timeoutMs: input.timeoutMs,
          storageMode: 'plainText',
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
    return current?.apiKeyEncrypted ?? '';
  }
}
