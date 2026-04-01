import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type {
  GlobalLlmSettings,
  LlmReasoningEffort,
  SaveGlobalLlmSettingsInput,
  TestLlmConnectionPayload,
  TestLlmConnectionResult,
} from '@preload/contracts';
import { getDatabase } from '@main/database/client';
import { settingsTable } from '@main/database/schema';
import { logLlmProgress, logLlmRequest, logLlmResult } from './llmRequestLogger';
import {
  compactErrorMessage,
  extractReasoningText,
  extractStreamingDeltaText,
  formatStreamPreview,
  isStreamingFallbackCandidate,
  readAssistantText,
} from './llmStreamUtils';

const SETTINGS_ID = 1;
const DEFAULT_REASONING_EFFORT: LlmReasoningEffort = 'medium';
const DEFAULT_ANSWER_GENERATION_TEMPERATURE = 0.2;
const DEFAULT_GRADING_TEMPERATURE = 0;

function normalizeReasoningEffort(value: string | null | undefined): LlmReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high'
    ? value
    : DEFAULT_REASONING_EFFORT;
}

function normalizeTemperature(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(2, Math.max(0, Number(value.toFixed(2))));
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
        apiKey: '',
        timeoutMs: 180000,
        reasoningEffort: DEFAULT_REASONING_EFFORT,
        answerGenerationTemperature: DEFAULT_ANSWER_GENERATION_TEMPERATURE,
        gradingTemperature: DEFAULT_GRADING_TEMPERATURE,
      };
    }

    return {
      baseUrl: current.baseUrl,
      model: current.model,
      apiKey: current.apiKeyEncrypted,
      timeoutMs: current.timeoutMs,
      reasoningEffort: normalizeReasoningEffort(current.reasoningEffort),
      answerGenerationTemperature: normalizeTemperature(
        current.answerGenerationTemperature,
        DEFAULT_ANSWER_GENERATION_TEMPERATURE,
      ),
      gradingTemperature: normalizeTemperature(
        current.gradingTemperature,
        DEFAULT_GRADING_TEMPERATURE,
      ),
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
        reasoningEffort: input.reasoningEffort,
        answerGenerationTemperature: normalizeTemperature(
          input.answerGenerationTemperature,
          DEFAULT_ANSWER_GENERATION_TEMPERATURE,
        ),
        gradingTemperature: normalizeTemperature(
          input.gradingTemperature,
          DEFAULT_GRADING_TEMPERATURE,
        ),
        storageMode: 'plainText',
      })
      .onConflictDoUpdate({
        target: settingsTable.id,
        set: {
          baseUrl: input.baseUrl.trim(),
          model: input.model.trim(),
          apiKeyEncrypted: apiKey,
          timeoutMs: input.timeoutMs,
          reasoningEffort: input.reasoningEffort,
          answerGenerationTemperature: normalizeTemperature(
            input.answerGenerationTemperature,
            DEFAULT_ANSWER_GENERATION_TEMPERATURE,
          ),
          gradingTemperature: normalizeTemperature(
            input.gradingTemperature,
            DEFAULT_GRADING_TEMPERATURE,
          ),
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
    const requestPayload = {
      model: payload.model,
      messages: [{ role: 'user' as const, content: '请回复“ok”。' }],
      max_tokens: 8,
      temperature: 0,
      reasoning_effort: payload.reasoningEffort,
    };

    try {
      logLlmRequest('settings-test', {
        client: {
          baseURL: payload.baseUrl,
          model: payload.model,
        timeoutMs: payload.timeoutMs,
        apiKey: payload.apiKey,
        reasoningEffort: payload.reasoningEffort,
        answerGenerationTemperature: payload.answerGenerationTemperature,
        gradingTemperature: payload.gradingTemperature,
      },
      payload: requestPayload,
      });

      const client = new OpenAI({
        apiKey: payload.apiKey,
        baseURL: payload.baseUrl,
        timeout: payload.timeoutMs,
      });
      const response = await this.collectConnectionTestResponse({
        client,
        requestPayload,
        startedAtMs: startedAt,
      });

      logLlmResult('settings-test', {
        status: 'success',
        detail: {
          latencyMs: Date.now() - startedAt,
          mode: response.mode,
          responseText: response.rawText,
          reasoningTextLength: response.reasoningText.length,
        },
      });

      return {
        success: true,
        message: '连接测试成功，后端可用。',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      logLlmResult('settings-test', {
        status: 'error',
        detail: {
          latencyMs: Date.now() - startedAt,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          message,
        },
      });
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

  private async collectConnectionTestResponse(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    startedAtMs: number;
  }): Promise<{
    rawText: string;
    reasoningText: string;
    mode: 'stream' | 'non-stream';
  }> {
    try {
      logLlmProgress('settings-test', {
        mode: 'stream',
        status: 'start',
      });
      return await this.collectStreamingConnectionTestResponse(input);
    } catch (error) {
      if (!isStreamingFallbackCandidate(error)) {
        throw error;
      }

      logLlmProgress('settings-test', {
        mode: 'stream',
        status: 'fallback',
        reason: compactErrorMessage(error),
      });
      return this.collectNonStreamingConnectionTestResponse(input);
    }
  }

  private async collectStreamingConnectionTestResponse(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    startedAtMs: number;
  }): Promise<{
    rawText: string;
    reasoningText: string;
    mode: 'stream';
  }> {
    const stream = await input.client.chat.completions.create({
      ...input.requestPayload,
      stream: true,
    });

    let rawText = '';
    let reasoningText = '';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      rawText += extractStreamingDeltaText(delta?.content);
      reasoningText += extractReasoningText(delta);
    }

    logLlmProgress('settings-test', {
      mode: 'stream',
      status: 'done',
      elapsedMs: Date.now() - input.startedAtMs,
      textChars: rawText.length,
      reasoningChars: reasoningText.length,
      textPreview: formatStreamPreview(rawText),
      reasoningPreview: formatStreamPreview(reasoningText),
    });

    return {
      rawText,
      reasoningText,
      mode: 'stream',
    };
  }

  private async collectNonStreamingConnectionTestResponse(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    startedAtMs: number;
  }): Promise<{
    rawText: string;
    reasoningText: string;
    mode: 'non-stream';
  }> {
    const response = await input.client.chat.completions.create(input.requestPayload);
    const rawText = readAssistantText(response);
    const reasoningText = extractReasoningText(response.choices[0]?.message);

    logLlmProgress('settings-test', {
      mode: 'non-stream',
      status: 'done',
      elapsedMs: Date.now() - input.startedAtMs,
      textChars: rawText.length,
      reasoningChars: reasoningText.length,
      textPreview: formatStreamPreview(rawText),
      reasoningPreview: formatStreamPreview(reasoningText),
    });

    return {
      rawText,
      reasoningText,
      mode: 'non-stream',
    };
  }

  async validateGenerationSettings(): Promise<
    | {
        ok: true;
        settings: GlobalLlmSettings;
      }
    | {
        ok: false;
        message: string;
      }
  > {
    const settings = await this.getSettings();

    if (!settings.baseUrl.trim()) {
      return {
        ok: false,
        message: '还没有配置模型 Base URL，请先到设置页补全后端地址。',
      };
    }

    if (!settings.model.trim()) {
      return {
        ok: false,
        message: '还没有配置模型名称，请先到设置页选择或填写模型。',
      };
    }

    if (!settings.apiKey.trim()) {
      return {
        ok: false,
        message: '还没有配置 API Key，请先到设置页保存可用的模型密钥。',
      };
    }

    if (!Number.isFinite(settings.timeoutMs) || settings.timeoutMs < 5000) {
      return {
        ok: false,
        message: '请求超时时间配置无效，请先到设置页检查超时参数。',
      };
    }

    if (!['low', 'medium', 'high'].includes(settings.reasoningEffort)) {
      return {
        ok: false,
        message: '模型思考强度配置无效，请先到设置页重新保存一次。',
      };
    }

    if (
      !Number.isFinite(settings.answerGenerationTemperature) ||
      settings.answerGenerationTemperature < 0 ||
      settings.answerGenerationTemperature > 2
    ) {
      return {
        ok: false,
        message: '参考答案生成温度配置无效，请先到设置页检查参数。',
      };
    }

    if (
      !Number.isFinite(settings.gradingTemperature) ||
      settings.gradingTemperature < 0 ||
      settings.gradingTemperature > 2
    ) {
      return {
        ok: false,
        message: '批阅温度配置无效，请先到设置页检查参数。',
      };
    }

    return {
      ok: true,
      settings,
    };
  }
}
