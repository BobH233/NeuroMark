import fs from 'node:fs/promises';
import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import sharp from 'sharp';
import { z } from 'zod';
import type {
  AnswerDraftInput,
  AnswerDraftRecord,
  AnswerGeneratorSnapshot,
  AnswerSourceImage,
  DraftGenerationStatus,
  GlobalLlmSettings,
  PromptPreset,
  PromptPresetInput,
} from '@preload/contracts';
import { ANSWER_GENERATION_JSON_CONTRACT } from '@main/prompts/answer-generator/schema';
import { ANSWER_GENERATION_SYSTEM_PROMPT } from '@main/prompts/answer-generator/system';
import { buildAnswerGenerationUserPrompt } from '@main/prompts/answer-generator/user';
import { getDatabase } from '@main/database/client';
import { answerDraftsTable, promptPresetsTable, tasksTable } from '@main/database/schema';
import { logLlmRequest, logLlmResult } from './llmRequestLogger';
import {
  readAssistantText,
  extractReasoningText,
  extractStreamingDeltaText,
  isStreamingFallbackCandidate,
} from './llmStreamUtils';
import { SettingsService } from './settingsService';
import { TaskManager } from './taskManager';

type AnswerGeneratorListener = (snapshot: AnswerGeneratorSnapshot) => void;

const answerGenerationResponseSchema = z
  .object({
    summary: z.string().trim().min(1),
    assumptions: z.array(z.string()),
    referenceAnswerMarkdown: z.string().trim().min(1),
  })
  .strict();

function toPromptPresetRecord(item: typeof promptPresetsTable.$inferSelect): PromptPreset {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    prompt: item.prompt,
  };
}

function extractSourceImages(sourceImagesJson: string): AnswerSourceImage[] {
  const parsed = JSON.parse(sourceImagesJson) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((item, index) => {
    if (typeof item === 'string') {
      return {
        src: item,
        name: `picture${index + 1}`,
      };
    }

    if (item && typeof item === 'object') {
      const candidate = item as Record<string, unknown>;
      const src = String(candidate.src ?? '');
      const name = String(candidate.name ?? `picture${index + 1}`);
      return {
        src,
        name,
      };
    }

    return {
      src: '',
      name: `picture${index + 1}`,
    };
  }).filter((item) => item.src.trim().length > 0);
}

function extractGenerationLogs(generationLogsJson: string): string[] {
  return JSON.parse(generationLogsJson) as string[];
}

function createGenerationLog(message: string): string {
  return `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`;
}

function resolvePromptText(
  row: typeof answerDraftsTable.$inferSelect,
  presets: PromptPreset[],
): string {
  return row.promptText.trim().length > 0
    ? row.promptText
    : (presets.find((preset) => preset.id === row.promptPreset)?.prompt ?? '');
}

function toDraftRecord(
  row: typeof answerDraftsTable.$inferSelect,
  presets: PromptPreset[],
): AnswerDraftRecord {
  return {
    id: row.id,
    title: row.title,
    promptPreset: row.promptPreset,
    promptText: resolvePromptText(row, presets),
    sourceImages: extractSourceImages(row.sourceImagesJson),
    markdown: row.markdown,
    generationStatus: row.generationStatus as DraftGenerationStatus,
    generationError: row.generationError ?? null,
    generationTaskId: row.generationTaskId ?? null,
    generationStage: row.generationStage ?? null,
    generationLogs: extractGenerationLogs(row.generationLogsJson),
    generationReasoningText: row.generationReasoningText,
    generationPreviewText: row.generationPreviewText,
    lastGenerationStartedAt: row.lastGenerationStartedAt ?? null,
    lastGenerationCompletedAt: row.lastGenerationCompletedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildPendingMarkdown(): string {
  return [
    '# 正在生成参考答案',
    '',
    '后端已经开始请求大模型，请稍候。',
    '',
    '- 当前阶段：准备题目图片与提示词',
    '- 结果返回后会自动显示在这里',
  ].join('\n');
}

function buildFailedMarkdown(message: string): string {
  return [
    '# 生成失败',
    '',
    message,
    '',
    '- 你可以检查后端配置、模型可用性或题目图片后重新生成',
    '- 如果是超时，请尝试缩小图片体积、降低思考强度或更换更稳定的模型',
  ].join('\n');
}

function extractImageBufferFromDataUrl(source: string): Buffer {
  const matched = source.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!matched) {
    throw new Error('粘贴图片数据格式无效，无法发送给模型。');
  }

  return Buffer.from(matched[1], 'base64');
}

async function normalizeImageToJpegBuffer(source: string): Promise<Buffer> {
  const inputBuffer = source.startsWith('data:image/')
    ? extractImageBufferFromDataUrl(source)
    : await fs.readFile(source);

  return sharp(inputBuffer, { animated: false, density: 192 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({
      width: 2200,
      height: 2200,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 82,
      mozjpeg: true,
    })
    .toBuffer();
}

async function toModelImageUrl(source: string): Promise<string> {
  const jpegBuffer = await normalizeImageToJpegBuffer(source);
  const base64 = jpegBuffer.toString('base64');
  return `data:image/jpeg;base64,${base64}`;
}

function findFirstJsonObject(rawText: string): string {
  const trimmed = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  throw new Error('模型返回中未找到合法 JSON 对象。');
}

function parseModelResponse(rawText: string) {
  const jsonText = findFirstJsonObject(rawText);
  const parsed = JSON.parse(jsonText) as unknown;
  return answerGenerationResponseSchema.parse(parsed);
}

function buildProgramPromptText(): string {
  return `${ANSWER_GENERATION_SYSTEM_PROMPT}\n\n${ANSWER_GENERATION_JSON_CONTRACT}`;
}

export class AnswerGeneratorService {
  private listeners = new Set<AnswerGeneratorListener>();
  private runningDrafts = new Set<string>();

  constructor(
    private readonly settings: SettingsService,
    private readonly tasks: TaskManager,
  ) {}

  async getState(): Promise<AnswerGeneratorSnapshot> {
    const [drafts, presets] = await Promise.all([this.listDrafts(), this.listPromptPresets()]);
    return {
      drafts,
      presets,
      programPromptText: buildProgramPromptText(),
    };
  }

  async recoverInterruptedGenerations(): Promise<void> {
    const db = getDatabase();
    const interruptedAt = new Date().toISOString();
    const interruptedMessage = '应用在参考答案生成过程中退出，本次任务已中断，请重新生成。';

    const staleDrafts = db
      .select()
      .from(answerDraftsTable)
      .all()
      .filter((item) => ['queued', 'running'].includes(item.generationStatus));

    for (const draft of staleDrafts) {
      const logs = [...extractGenerationLogs(draft.generationLogsJson)];
      logs.push(createGenerationLog('检测到上次应用退出，任务已标记为中断'));

      db.update(answerDraftsTable)
        .set({
          generationStatus: 'failed',
          generationError: interruptedMessage,
          generationStage: '任务已中断',
          generationLogsJson: JSON.stringify(logs.slice(-60)),
          lastGenerationCompletedAt: interruptedAt,
          updatedAt: interruptedAt,
        })
        .where(eq(answerDraftsTable.id, draft.id))
        .run();
    }

    const staleTasks = db
      .select()
      .from(tasksTable)
      .all()
      .filter(
        (item) =>
          item.kind === 'answer-generation' && ['queued', 'running'].includes(item.status),
      );

    for (const task of staleTasks) {
      db.update(tasksTable)
        .set({
          status: 'cancelled',
          eta: null,
          summary: '应用已退出，参考答案生成任务已中断',
          updatedAt: interruptedAt,
        })
        .where(eq(tasksTable.id, task.id))
        .run();
    }
  }

  async interruptRunningGenerations(): Promise<void> {
    const db = getDatabase();
    const interruptedAt = new Date().toISOString();

    const runningDrafts = db
      .select()
      .from(answerDraftsTable)
      .all()
      .filter((item) => ['queued', 'running'].includes(item.generationStatus));

    for (const draft of runningDrafts) {
      const logs = [...extractGenerationLogs(draft.generationLogsJson)];
      logs.push(createGenerationLog('应用正在退出，任务已标记为中断'));

      db.update(answerDraftsTable)
        .set({
          generationStatus: 'failed',
          generationError: '应用已退出，参考答案生成任务已中断，请重新生成。',
          generationStage: '任务已中断',
          generationLogsJson: JSON.stringify(logs.slice(-60)),
          lastGenerationCompletedAt: interruptedAt,
          updatedAt: interruptedAt,
        })
        .where(eq(answerDraftsTable.id, draft.id))
        .run();
    }

    const runningTasks = db
      .select()
      .from(tasksTable)
      .all()
      .filter(
        (item) =>
          item.kind === 'answer-generation' && ['queued', 'running'].includes(item.status),
      );

    for (const task of runningTasks) {
      db.update(tasksTable)
        .set({
          status: 'cancelled',
          eta: null,
          summary: '应用已退出，参考答案生成任务已中断',
          updatedAt: interruptedAt,
        })
        .where(eq(tasksTable.id, task.id))
        .run();
    }
  }

  onUpdated(handler: AnswerGeneratorListener): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async listPromptPresets(): Promise<PromptPreset[]> {
    const db = getDatabase();
    return db
      .select()
      .from(promptPresetsTable)
      .orderBy(desc(promptPresetsTable.updatedAt))
      .all()
      .map(toPromptPresetRecord);
  }

  async savePromptPreset(input: PromptPresetInput): Promise<PromptPreset> {
    const db = getDatabase();
    const now = new Date().toISOString();
    const id = input.id?.trim() || nanoid();

    db.insert(promptPresetsTable)
      .values({
        id,
        name: input.name.trim(),
        description: input.description.trim(),
        prompt: input.prompt.trim(),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: promptPresetsTable.id,
        set: {
          name: input.name.trim(),
          description: input.description.trim(),
          prompt: input.prompt.trim(),
          updatedAt: now,
        },
      })
      .run();

    const saved = db.select().from(promptPresetsTable).where(eq(promptPresetsTable.id, id)).get();
    if (!saved) {
      throw new Error('模板保存失败。');
    }

    await this.emit();
    return toPromptPresetRecord(saved);
  }

  async deletePromptPreset(presetId: string): Promise<void> {
    const db = getDatabase();
    db.delete(promptPresetsTable).where(eq(promptPresetsTable.id, presetId)).run();
    await this.emit();
  }

  async listDrafts(): Promise<AnswerDraftRecord[]> {
    const db = getDatabase();
    const presets = await this.listPromptPresets();
    return db
      .select()
      .from(answerDraftsTable)
      .orderBy(desc(answerDraftsTable.createdAt))
      .all()
      .map((item) => toDraftRecord(item, presets));
  }

  async ensureSeedDraft(): Promise<void> {
    const existing = await this.listDrafts();
    if (existing.length > 0) {
      return;
    }

    const presets = await this.listPromptPresets();
    const firstPreset = presets[0];

    await this.createDraft({
      title: `参考答案草稿 ${new Date().toLocaleString('zh-CN')}`,
      promptPreset: firstPreset?.id ?? '',
      promptText: firstPreset?.prompt ?? '',
      sourceImages: [],
    });
  }

  async createDraft(input: AnswerDraftInput): Promise<AnswerDraftRecord> {
    const db = getDatabase();
    const now = new Date().toISOString();
    const presets = await this.listPromptPresets();
    const selectedPreset = presets.find((item) => item.id === input.promptPreset);
    const fallbackPrompt = selectedPreset?.prompt ?? '';
    const title = input.title.trim() || `参考答案草稿 ${new Date().toLocaleString('zh-CN')}`;
    const promptText = input.promptText.trim() || fallbackPrompt;
    const draftId = nanoid();

    db.insert(answerDraftsTable)
      .values({
        id: draftId,
        title,
        promptPreset: selectedPreset?.id ?? '',
        promptText,
        sourceImagesJson: JSON.stringify(input.sourceImages),
        markdown: buildPendingMarkdown(),
        generationStatus: 'idle',
        generationError: null,
        generationTaskId: null,
        generationStage: null,
        generationLogsJson: JSON.stringify([]),
        generationReasoningText: '',
        generationPreviewText: '',
        lastGenerationStartedAt: null,
        lastGenerationCompletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    await this.emit();
    return this.startGeneration(draftId);
  }

  async startGeneration(draftId: string): Promise<AnswerDraftRecord> {
    const db = getDatabase();
    const existing = db
      .select()
      .from(answerDraftsTable)
      .where(eq(answerDraftsTable.id, draftId))
      .get();

    if (!existing) {
      throw new Error('未找到对应的参考答案草稿。');
    }

    if (this.runningDrafts.has(draftId)) {
      const presets = await this.listPromptPresets();
      return toDraftRecord(existing, presets);
    }

    if (extractSourceImages(existing.sourceImagesJson).length === 0) {
      const failedDraft = await this.markDraftFailed(
        draftId,
        '当前草稿还没有题目图片，无法生成参考答案。',
      );
      return failedDraft;
    }

    const settingsCheck = await this.settings.validateGenerationSettings();
    if (!settingsCheck.ok) {
      const failedDraft = await this.markDraftFailed(draftId, settingsCheck.message);
      return failedDraft;
    }

    const job = await this.tasks.createJob({
      kind: 'answer-generation',
      projectId: draftId,
      projectName: '参考答案生成',
      status: 'queued',
      abortable: false,
      currentPaperLabel: existing.title,
      summary: '等待向大模型提交参考答案生成请求',
    });

    const startedAt = new Date().toISOString();
    db.update(answerDraftsTable)
      .set({
        generationStatus: 'queued',
        generationError: null,
        generationTaskId: job.id,
        generationStage: '已创建后台任务，等待开始生成',
        generationLogsJson: JSON.stringify([
          createGenerationLog('已创建后台任务'),
          createGenerationLog(
            `准备调用模型，baseUrl=${settingsCheck.settings.baseUrl}，model=${settingsCheck.settings.model}`,
          ),
        ]),
        generationReasoningText: '',
        generationPreviewText: '',
        lastGenerationStartedAt: startedAt,
        lastGenerationCompletedAt: null,
        updatedAt: startedAt,
      })
      .where(eq(answerDraftsTable.id, draftId))
      .run();

    const presets = await this.listPromptPresets();
    const draft = db.select().from(answerDraftsTable).where(eq(answerDraftsTable.id, draftId)).get();
    const result = toDraftRecord(draft!, presets);
    await this.emit();

    this.runningDrafts.add(draftId);
    void this.runGeneration(result, job.id, settingsCheck.settings);
    return result;
  }

  async updateDraft(draftId: string, markdown: string): Promise<AnswerDraftRecord> {
    const db = getDatabase();
    const existing = db
      .select()
      .from(answerDraftsTable)
      .where(eq(answerDraftsTable.id, draftId))
      .get();

    if (!existing) {
      throw new Error('未找到对应的参考答案草稿。');
    }

    const presets = await this.listPromptPresets();
    const updatedAt = new Date().toISOString();
    db.update(answerDraftsTable)
      .set({
        markdown,
        updatedAt,
      })
      .where(eq(answerDraftsTable.id, draftId))
      .run();

    const updated = db.select().from(answerDraftsTable).where(eq(answerDraftsTable.id, draftId)).get();
    await this.emit();
    return toDraftRecord(updated!, presets);
  }

  async deleteDraft(draftId: string): Promise<void> {
    const db = getDatabase();
    const existing = db
      .select()
      .from(answerDraftsTable)
      .where(eq(answerDraftsTable.id, draftId))
      .get();

    if (!existing) {
      return;
    }

    db.delete(answerDraftsTable).where(eq(answerDraftsTable.id, draftId)).run();
    this.runningDrafts.delete(draftId);

    if (existing.generationTaskId) {
      await this.tasks.updateJob(existing.generationTaskId, {
        status: 'cancelled',
        eta: null,
        summary: '草稿已删除，后台结果将丢弃',
      }).catch(() => undefined);
    }

    await this.emit();
  }

  private async runGeneration(
    draft: AnswerDraftRecord,
    taskId: string,
    settings: GlobalLlmSettings,
  ): Promise<void> {
    const startedAtMs = Date.now();
    const timeoutSeconds = Math.max(1, Math.round(settings.timeoutMs / 1000));
    const requestAbortController = new AbortController();
    let hardTimedOut = false;
    const hardTimeoutTimer = setTimeout(() => {
      hardTimedOut = true;
      requestAbortController.abort();
    }, settings.timeoutMs);
    let waitingHeartbeat: NodeJS.Timeout | null = null;

    try {
      await this.tasks.updateJob(taskId, {
        status: 'running',
        progress: 0.2,
        currentPaperLabel: draft.title,
        summary: '正在读取题目图片并向大模型提交请求',
      });

      await this.appendDraftLog(draft.id, '开始读取题目图片并整理请求参数', {
        generationStatus: 'running',
        generationError: null,
        generationStage: '正在整理题目图片与提示词',
      });

      const imageUrls = await Promise.all(
        draft.sourceImages.map((image) => toModelImageUrl(image.src)),
      );
      await this.appendDraftLog(
        draft.id,
        `题目图片已完成编码，共 ${imageUrls.length} 张，准备发起模型请求`,
        {
          generationStage: '题目图片已处理完毕，准备请求模型',
        },
      );
      await this.tasks.updateJob(taskId, {
        progress: 0.45,
        summary: '大模型请求已发出，正在等待返回结果',
      });

      const client = new OpenAI({
        apiKey: settings.apiKey,
        baseURL: settings.baseUrl,
        timeout: settings.timeoutMs,
      });

      const requestPayload = {
        model: settings.model,
        temperature: settings.answerGenerationTemperature,
        max_tokens: 9000,
        reasoning_effort: settings.reasoningEffort,
        messages: [
          {
            role: 'system' as const,
            content: buildProgramPromptText(),
          },
          {
            role: 'user' as const,
            content: [
              {
                type: 'text' as const,
                text: buildAnswerGenerationUserPrompt({
                  title: draft.title,
                  promptText: draft.promptText,
                  imageCount: imageUrls.length,
                }),
              },
              ...imageUrls.map((url) => ({
                type: 'image_url' as const,
                image_url: {
                  url,
                  detail: 'high' as const,
                },
              })),
            ],
          },
        ],
      } satisfies ChatCompletionCreateParamsNonStreaming;

      await this.appendDraftLog(
        draft.id,
        `已发起模型请求，等待返回。超时阈值 ${Math.round(settings.timeoutMs / 1000)} 秒`,
        {
          generationStage: '已发起模型请求，等待返回',
        },
      );

      logLlmRequest(`answer-generation:${draft.id}`, {
        client: {
          baseURL: settings.baseUrl,
          model: settings.model,
          timeoutMs: settings.timeoutMs,
          apiKey: settings.apiKey,
          reasoningEffort: settings.reasoningEffort,
        },
        payload: requestPayload,
      });

      waitingHeartbeat = setInterval(() => {
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000));
        void this.updateWaitingHeartbeat(draft.id, taskId, elapsedSeconds, timeoutSeconds);
      }, 10000);

      const rawText = await this.collectModelResponseText({
        client,
        requestPayload,
        draftId: draft.id,
        taskId,
        startedAtMs,
        signal: requestAbortController.signal,
      });

      if (waitingHeartbeat) {
        clearInterval(waitingHeartbeat);
        waitingHeartbeat = null;
      }

      await this.tasks.updateJob(taskId, {
        progress: 0.8,
        summary: '模型已返回，正在解析结构化结果',
      });
      await this.appendDraftLog(draft.id, '模型已返回响应，开始解析 JSON', {
        generationStage: '模型已返回，正在解析 JSON',
      });

      if (!rawText.trim()) {
        throw new Error('模型返回为空，未生成可解析的内容。');
      }

      const parsed = parseModelResponse(rawText);
      if (!(await this.hasDraft(draft.id))) {
        await this.markDeletedTask(taskId);
        console.info(`[answer-generator] draft=${draft.id} deleted before write-back`);
        return;
      }

      const completedAt = new Date().toISOString();
      const currentReasoningText = this.getCurrentReasoningText(draft.id);
      const db = getDatabase();
      db.update(answerDraftsTable)
        .set({
          markdown: parsed.referenceAnswerMarkdown.trim(),
          generationStatus: 'completed',
          generationError: null,
          generationStage: '生成完成',
          generationLogsJson: JSON.stringify([
            ...this.getExistingLogs(draft.id),
            createGenerationLog('结构化解析完成，参考答案已写入草稿'),
          ].slice(-60)),
          generationReasoningText: currentReasoningText,
          generationPreviewText: rawText,
          lastGenerationCompletedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(answerDraftsTable.id, draft.id))
        .run();

      await this.tasks.updateJob(taskId, {
        status: 'completed',
        progress: 1,
        eta: null,
        summary: parsed.summary,
      });
      console.info(`[answer-generator] draft=${draft.id} completed`);
    } catch (error) {
      if (waitingHeartbeat) {
        clearInterval(waitingHeartbeat);
        waitingHeartbeat = null;
      }

      if (!(await this.hasDraft(draft.id))) {
        await this.markDeletedTask(taskId);
        console.info(`[answer-generator] draft=${draft.id} deleted while request was in flight`);
        return;
      }

      const message = hardTimedOut
        ? `请求超时（已超过 ${timeoutSeconds} 秒），已中止本次生成。`
        : this.toGenerationErrorMessage(error);
      const failedAt = new Date().toISOString();
      const db = getDatabase();

      logLlmResult(`answer-generation:${draft.id}`, {
        status: 'error',
        detail: {
          elapsedMs: Date.now() - startedAtMs,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          message,
          rawError: error instanceof Error ? error.message : String(error),
        },
      });

      db.update(answerDraftsTable)
        .set({
          generationStatus: 'failed',
          generationError: message,
          generationStage: '生成失败',
          markdown: buildFailedMarkdown(message),
          generationLogsJson: JSON.stringify([
            ...this.getExistingLogs(draft.id),
            createGenerationLog(`生成失败：${message}`),
          ].slice(-60)),
          lastGenerationCompletedAt: failedAt,
          updatedAt: failedAt,
        })
        .where(eq(answerDraftsTable.id, draft.id))
        .run();

      await this.tasks.updateJob(taskId, {
        status: 'failed',
        eta: null,
        summary: message,
      });
      console.error(`[answer-generator] draft=${draft.id} failed`, error);
    } finally {
      clearTimeout(hardTimeoutTimer);
      if (waitingHeartbeat) {
        clearInterval(waitingHeartbeat);
      }
      this.runningDrafts.delete(draft.id);
      await this.emit();
    }
  }

  private async markDraftFailed(
    draftId: string,
    message: string,
  ): Promise<AnswerDraftRecord> {
    const db = getDatabase();
    const failedAt = new Date().toISOString();
    db.update(answerDraftsTable)
      .set({
        generationStatus: 'failed',
        generationError: message,
        generationTaskId: null,
        generationStage: '生成失败',
        markdown: buildFailedMarkdown(message),
        generationLogsJson: JSON.stringify([
          ...this.getExistingLogs(draftId),
          createGenerationLog(`生成前校验失败：${message}`),
        ].slice(-60)),
        generationReasoningText: '',
        generationPreviewText: '',
        lastGenerationCompletedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(answerDraftsTable.id, draftId))
      .run();

    const presets = await this.listPromptPresets();
    const updated = db.select().from(answerDraftsTable).where(eq(answerDraftsTable.id, draftId)).get();
    await this.emit();
    return toDraftRecord(updated!, presets);
  }

  private toGenerationErrorMessage(error: unknown): string {
    if (error instanceof z.ZodError) {
      return `模型返回内容不符合约定格式：${error.issues[0]?.message ?? '缺少必要字段。'}`;
    }

    if (error instanceof SyntaxError) {
      return '模型返回内容不是合法 JSON，无法完成解析。';
    }

    if (error instanceof Error) {
      return error.message;
    }

    return '参考答案生成失败，请稍后重试。';
  }

  private getExistingLogs(draftId: string): string[] {
    const db = getDatabase();
    const current = db
      .select()
      .from(answerDraftsTable)
      .where(eq(answerDraftsTable.id, draftId))
      .get();

    if (!current) {
      return [];
    }

    return extractGenerationLogs(current.generationLogsJson);
  }

  private async appendDraftLog(
    draftId: string,
    message: string,
    patch?: Partial<
      Pick<
        AnswerDraftRecord,
        'generationStatus' | 'generationError' | 'generationTaskId' | 'generationStage'
      >
    >,
  ): Promise<void> {
    const db = getDatabase();
    const current = db
      .select()
      .from(answerDraftsTable)
      .where(eq(answerDraftsTable.id, draftId))
      .get();

    if (!current) {
      return;
    }

    const logs = [...extractGenerationLogs(current.generationLogsJson), createGenerationLog(message)].slice(
      -60,
    );
    const updatedAt = new Date().toISOString();

    db.update(answerDraftsTable)
      .set({
        generationStatus: patch?.generationStatus ?? current.generationStatus,
        generationError:
          patch?.generationError === undefined ? current.generationError : patch.generationError,
        generationTaskId:
          patch?.generationTaskId === undefined
            ? current.generationTaskId
            : patch.generationTaskId,
        generationStage:
          patch?.generationStage === undefined ? current.generationStage : patch.generationStage,
        generationLogsJson: JSON.stringify(logs),
        updatedAt,
      })
      .where(eq(answerDraftsTable.id, draftId))
      .run();

    await this.emit();
  }

  private async updateWaitingHeartbeat(
    draftId: string,
    taskId: string,
    elapsedSeconds: number,
    timeoutSeconds: number,
  ): Promise<void> {
    const waitingText = `已发起模型请求，已等待 ${elapsedSeconds} / ${timeoutSeconds} 秒`;
    const db = getDatabase();
    const current = db
      .select()
      .from(answerDraftsTable)
      .where(eq(answerDraftsTable.id, draftId))
      .get();

    if (!current) {
      await this.markDeletedTask(taskId);
      return;
    }

    if (current.generationStatus !== 'running') {
      return;
    }

    db.update(answerDraftsTable)
      .set({
        generationStage: waitingText,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(answerDraftsTable.id, draftId))
      .run();

    await this.tasks.updateJob(taskId, {
      progress: 0.45,
      summary: waitingText,
    });
    await this.emit();
  }

  private async collectModelResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    draftId: string;
    taskId: string;
    startedAtMs: number;
    signal: AbortSignal;
  }): Promise<string> {
    try {
      await this.appendDraftLog(input.draftId, '尝试以流式模式接收模型输出', {
        generationStage: '已发起模型请求，等待流式输出',
      });
      return await this.collectStreamingResponseText(input);
    } catch (error) {
      if (!isStreamingFallbackCandidate(error)) {
        throw error;
      }

      await this.appendDraftLog(
        input.draftId,
        `流式模式不可用，已回退为普通请求：${this.toGenerationErrorMessage(error)}`,
        {
          generationStage: '流式不可用，回退为普通请求',
        },
      );
      return this.collectNonStreamingResponseText(input);
    }
  }

  private async collectStreamingResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    draftId: string;
    taskId: string;
    startedAtMs: number;
    signal: AbortSignal;
  }): Promise<string> {
    const stream = await input.client.chat.completions.create({
      ...input.requestPayload,
      stream: true,
    }, {
      signal: input.signal,
    });

    let rawText = '';
    let reasoningText = '';
    let lastFlushedLength = 0;
    let lastReasoningFlushedLength = 0;
    let lastFlushAt = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const chunkText = extractStreamingDeltaText(delta?.content);
      const chunkReasoningText = extractReasoningText(delta);
      if (chunkText) {
        rawText += chunkText;
      }
      if (chunkReasoningText) {
        reasoningText += chunkReasoningText;
      }
      if (!chunkText && !chunkReasoningText) {
        continue;
      }
      const now = Date.now();
      const shouldFlush =
        rawText.length - lastFlushedLength >= 80 ||
        reasoningText.length - lastReasoningFlushedLength >= 120 ||
        now - lastFlushAt >= 800;

      if (shouldFlush) {
        lastFlushedLength = rawText.length;
        lastReasoningFlushedLength = reasoningText.length;
        lastFlushAt = now;
        await this.flushStreamingPreview(input.draftId, input.taskId, {
          rawText,
          reasoningText,
        });
      }
    }

    await this.flushStreamingPreview(input.draftId, input.taskId, {
      rawText,
      reasoningText,
    });

    logLlmResult(`answer-generation:${input.draftId}`, {
      status: 'success',
      detail: {
        elapsedMs: Date.now() - input.startedAtMs,
        mode: 'stream',
        reasoningTextLength: reasoningText.length,
        responseTextLength: rawText.length,
        preview: rawText.slice(0, 400),
      },
    });

    return rawText;
  }

  private async collectNonStreamingResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    draftId: string;
    taskId: string;
    startedAtMs: number;
    signal: AbortSignal;
  }): Promise<string> {
    const completion = await input.client.chat.completions.create(input.requestPayload, {
      signal: input.signal,
    });
    const rawText = readAssistantText(completion);
    const reasoningText = extractReasoningText(completion.choices[0]?.message);

    await this.flushStreamingPreview(input.draftId, input.taskId, {
      rawText,
      reasoningText,
    });

    logLlmResult(`answer-generation:${input.draftId}`, {
      status: 'success',
      detail: {
        elapsedMs: Date.now() - input.startedAtMs,
        mode: 'non-stream',
        reasoningTextLength: reasoningText.length,
        response: completion,
      },
    });

    return rawText;
  }

  private async flushStreamingPreview(
    draftId: string,
    taskId: string,
    preview: {
      rawText: string;
      reasoningText: string;
    },
  ): Promise<void> {
    const db = getDatabase();
    const current = db
      .select()
      .from(answerDraftsTable)
      .where(eq(answerDraftsTable.id, draftId))
      .get();

    if (!current || current.generationStatus !== 'running') {
      if (!current) {
        await this.markDeletedTask(taskId);
      }
      return;
    }

    const hasReasoning = preview.reasoningText.trim().length > 0;
    const hasOutput = preview.rawText.trim().length > 0;
    const stage = hasOutput
      ? `正在流式接收正式输出，已接收 ${preview.rawText.length} 字`
      : hasReasoning
        ? `模型正在思考，已接收 ${preview.reasoningText.length} 字推理内容`
        : '已发起模型请求，等待首个流式片段';

    db.update(answerDraftsTable)
      .set({
        generationStage: stage,
        generationReasoningText: preview.reasoningText,
        generationPreviewText: preview.rawText,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(answerDraftsTable.id, draftId))
      .run();

    await this.tasks.updateJob(taskId, {
      progress: Math.min(
        0.78,
        Math.max(
          0.5,
          0.5 + (preview.rawText.length + preview.reasoningText.length * 0.35) / 12000,
        ),
      ),
      summary: stage,
    }).catch(() => undefined);

    await this.emit();
  }

  private getCurrentReasoningText(draftId: string): string {
    const db = getDatabase();
    const current = db
      .select({ generationReasoningText: answerDraftsTable.generationReasoningText })
      .from(answerDraftsTable)
      .where(eq(answerDraftsTable.id, draftId))
      .get();

    return current?.generationReasoningText ?? '';
  }

  private async hasDraft(draftId: string): Promise<boolean> {
    const db = getDatabase();
    const current = db
      .select({ id: answerDraftsTable.id })
      .from(answerDraftsTable)
      .where(eq(answerDraftsTable.id, draftId))
      .get();

    return Boolean(current);
  }

  private async markDeletedTask(taskId: string): Promise<void> {
    await this.tasks.updateJob(taskId, {
      status: 'cancelled',
      eta: null,
      summary: '草稿已删除，后台结果将丢弃',
    }).catch(() => undefined);
  }

  private async emit(): Promise<void> {
    const snapshot = await this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
