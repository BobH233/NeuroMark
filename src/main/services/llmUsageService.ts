import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type {
  LlmPricingSettings,
  LlmUsageBreakdownItem,
  LlmUsageRecordPage,
  LlmUsageRecord,
  LlmUsageSource,
  LlmUsageSummary,
} from '@preload/contracts';
import { getDatabase } from '@main/database/client';
import { llmUsageRecordsTable, settingsTable } from '@main/database/schema';

const SETTINGS_ID = 1;
const DEFAULT_RECORD_PAGE_SIZE = 20;

const DEFAULT_PRICING: LlmPricingSettings = {
  currency: 'CNY',
  inputPerMillion: 2,
  outputPerMillion: 12,
  cacheReadPerMillion: 0.2,
  cacheWritePerMillion: 0,
  reasoningPerMillion: 0,
};

export interface NormalizedLlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

function asSafeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function asSafeMoney(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Number(value.toFixed(6));
}

function normalizePricing(input: Partial<LlmPricingSettings> | null | undefined): LlmPricingSettings {
  return {
    currency: DEFAULT_PRICING.currency,
    inputPerMillion: Number(input?.inputPerMillion ?? DEFAULT_PRICING.inputPerMillion),
    outputPerMillion: Number(input?.outputPerMillion ?? DEFAULT_PRICING.outputPerMillion),
    cacheReadPerMillion: Number(input?.cacheReadPerMillion ?? DEFAULT_PRICING.cacheReadPerMillion),
    cacheWritePerMillion: Number(input?.cacheWritePerMillion ?? DEFAULT_PRICING.cacheWritePerMillion),
    reasoningPerMillion: Number(input?.reasoningPerMillion ?? DEFAULT_PRICING.reasoningPerMillion),
  };
}

function getSourceLabel(source: LlmUsageSource): string {
  switch (source) {
    case 'answer-generation':
      return '参考答案生成';
    case 'grading-paper':
      return '答卷批阅';
    case 'grading-rubric':
      return '评分标准整理';
    case 'settings-test':
      return '连接测试';
    case 'smart-name-match':
      return '智能核名';
    default:
      return source;
  }
}

export function normalizeLlmUsage(rawUsage: unknown): NormalizedLlmUsage | null {
  if (!rawUsage || typeof rawUsage !== 'object') {
    return null;
  }

  const usage = rawUsage as Record<string, any>;
  const promptDetails = usage.prompt_tokens_details ?? usage.input_tokens_details ?? {};
  const completionDetails = usage.completion_tokens_details ?? usage.output_tokens_details ?? {};

  const inputTokens = asSafeInteger(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = asSafeInteger(usage.completion_tokens ?? usage.output_tokens);
  const cacheReadTokens = asSafeInteger(
    promptDetails.cached_tokens
      ?? promptDetails.cache_read_input_tokens
      ?? promptDetails.cache_read_tokens,
  );
  const cacheWriteTokens = asSafeInteger(
    promptDetails.cache_creation_tokens
      ?? promptDetails.cache_write_input_tokens
      ?? promptDetails.cache_write_tokens,
  );
  const reasoningTokens = asSafeInteger(
    completionDetails.reasoning_tokens
      ?? completionDetails.reasoning_output_tokens,
  );
  const totalTokens = asSafeInteger(
    usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens,
  );

  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens: totalTokens || inputTokens + outputTokens,
  };
}

export function getEstimatedLlmCost(
  usage: Pick<
    LlmUsageRecord,
    | 'inputTokens'
    | 'outputTokens'
    | 'cacheReadTokens'
    | 'cacheWriteTokens'
    | 'reasoningTokens'
    | 'billableInputTokens'
    | 'billableOutputTokens'
  >,
  pricing: LlmPricingSettings,
): number {
  const estimatedCost =
    (usage.billableInputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.billableOutputTokens / 1_000_000) * pricing.outputPerMillion +
    (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion +
    (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion;

  return asSafeMoney(estimatedCost);
}

function toUsageRecord(
  row: typeof llmUsageRecordsTable.$inferSelect,
  pricing: LlmPricingSettings,
): LlmUsageRecord {
  const billableInputTokens = Math.max(0, row.inputTokens - row.cacheReadTokens);
  const billableOutputTokens = row.outputTokens;

  return {
    id: row.id,
    source: row.source as LlmUsageSource,
    label: row.label,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    reasoningTokens: row.reasoningTokens,
    billableInputTokens,
    billableOutputTokens,
    totalTokens: row.totalTokens,
    estimatedCost: getEstimatedLlmCost(
      {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        reasoningTokens: row.reasoningTokens,
        billableInputTokens,
        billableOutputTokens,
      },
      pricing,
    ),
    createdAt: row.createdAt,
  };
}

export class LlmUsageService {
  private normalizePage(page?: number): number {
    if (typeof page !== 'number' || !Number.isFinite(page) || page < 1) {
      return 1;
    }

    return Math.floor(page);
  }

  private normalizePageSize(pageSize?: number): number {
    if (typeof pageSize !== 'number' || !Number.isFinite(pageSize) || pageSize < 1) {
      return DEFAULT_RECORD_PAGE_SIZE;
    }

    return Math.min(100, Math.floor(pageSize));
  }

  async getPricing(): Promise<LlmPricingSettings> {
    const db = getDatabase();
    const current = db.select().from(settingsTable).where(eq(settingsTable.id, SETTINGS_ID)).get();

    if (!current) {
      return DEFAULT_PRICING;
    }

    return normalizePricing({
      currency: current.pricingCurrency,
      inputPerMillion: current.pricingInputPerMillion,
      outputPerMillion: current.pricingOutputPerMillion,
      cacheReadPerMillion: current.pricingCacheReadPerMillion,
      cacheWritePerMillion: current.pricingCacheWritePerMillion,
      reasoningPerMillion: current.pricingReasoningPerMillion,
    });
  }

  async savePricing(input: LlmPricingSettings): Promise<LlmPricingSettings> {
    const db = getDatabase();
    const pricing = normalizePricing(input);
    db
      .insert(settingsTable)
      .values({
        id: SETTINGS_ID,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        apiKeyEncrypted: '',
        timeoutMs: 180000,
        reasoningEffort: 'medium',
        answerGenerationTemperature: 0.2,
        gradingTemperature: 0,
        pricingInputPerMillion: pricing.inputPerMillion,
        pricingOutputPerMillion: pricing.outputPerMillion,
        pricingCacheReadPerMillion: pricing.cacheReadPerMillion,
        pricingCacheWritePerMillion: pricing.cacheWritePerMillion,
        pricingReasoningPerMillion: pricing.reasoningPerMillion,
        pricingCurrency: pricing.currency,
        storageMode: 'plainText',
      })
      .onConflictDoUpdate({
        target: settingsTable.id,
        set: {
          pricingInputPerMillion: pricing.inputPerMillion,
          pricingOutputPerMillion: pricing.outputPerMillion,
          pricingCacheReadPerMillion: pricing.cacheReadPerMillion,
          pricingCacheWritePerMillion: pricing.cacheWritePerMillion,
          pricingReasoningPerMillion: pricing.reasoningPerMillion,
          pricingCurrency: pricing.currency,
        },
      })
      .run();

    return this.getPricing();
  }

  async recordUsage(input: {
    source: LlmUsageSource;
    label?: string;
    model: string;
    usage: NormalizedLlmUsage | null;
  }): Promise<void> {
    if (!input.usage) {
      return;
    }

    const db = getDatabase();
    db.insert(llmUsageRecordsTable)
      .values({
        id: nanoid(),
        source: input.source,
        label: input.label?.trim() || getSourceLabel(input.source),
        model: input.model.trim(),
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        cacheReadTokens: input.usage.cacheReadTokens,
        cacheWriteTokens: input.usage.cacheWriteTokens,
        reasoningTokens: input.usage.reasoningTokens,
        totalTokens: input.usage.totalTokens,
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  async getSummary(): Promise<LlmUsageSummary> {
    const db = getDatabase();
    const pricing = await this.getPricing();
    const rows = db.select().from(llmUsageRecordsTable).orderBy(desc(llmUsageRecordsTable.createdAt)).all();
    const records = rows.map((row) => toUsageRecord(row, pricing));

    const initialSummary: LlmUsageSummary = {
      pricing,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      billableInputTokens: 0,
      billableOutputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      breakdown: [],
    };

    const breakdownMap = new Map<LlmUsageSource, LlmUsageBreakdownItem>();

    for (const record of records) {
      initialSummary.requestCount += 1;
      initialSummary.inputTokens += record.inputTokens;
      initialSummary.outputTokens += record.outputTokens;
      initialSummary.cacheReadTokens += record.cacheReadTokens;
      initialSummary.cacheWriteTokens += record.cacheWriteTokens;
      initialSummary.reasoningTokens += record.reasoningTokens;
      initialSummary.billableInputTokens += record.billableInputTokens;
      initialSummary.billableOutputTokens += record.billableOutputTokens;
      initialSummary.totalTokens += record.totalTokens;
      initialSummary.estimatedCost = asSafeMoney(initialSummary.estimatedCost + record.estimatedCost);

      const current = breakdownMap.get(record.source) ?? {
        source: record.source,
        label: getSourceLabel(record.source),
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
      };

      current.requestCount += 1;
      current.inputTokens += record.inputTokens;
      current.outputTokens += record.outputTokens;
      current.cacheReadTokens += record.cacheReadTokens;
      current.cacheWriteTokens += record.cacheWriteTokens;
      current.reasoningTokens += record.reasoningTokens;
      current.totalTokens += record.totalTokens;
      current.estimatedCost = asSafeMoney(current.estimatedCost + record.estimatedCost);
      breakdownMap.set(record.source, current);
    }

    initialSummary.breakdown = [...breakdownMap.values()].sort((left, right) => right.estimatedCost - left.estimatedCost);
    return initialSummary;
  }

  async getRecordPage(page?: number, pageSize?: number): Promise<LlmUsageRecordPage> {
    const db = getDatabase();
    const pricing = await this.getPricing();
    const normalizedPage = this.normalizePage(page);
    const normalizedPageSize = this.normalizePageSize(pageSize);
    const offset = (normalizedPage - 1) * normalizedPageSize;

    const rows = db
      .select()
      .from(llmUsageRecordsTable)
      .orderBy(desc(llmUsageRecordsTable.createdAt))
      .limit(normalizedPageSize)
      .offset(offset)
      .all();

    const total = db.select().from(llmUsageRecordsTable).all().length;

    return {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total,
      records: rows.map((row) => toUsageRecord(row, pricing)),
    };
  }
}
