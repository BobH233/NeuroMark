import path from 'node:path';
import vm from 'node:vm';
import fs from 'fs-extra';
import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { z } from 'zod';
import type {
  GenerateScorePostProcessAiScriptInput,
  ExecuteScorePostProcessInput,
  ScorePostProcessAiScriptResult,
  ScorePostProcessAiScriptSnapshot,
  ScorePostProcessExecutionResult,
  ScorePostProcessPaperData,
  ScorePostProcessPaperResult,
  ScorePostProcessPreset,
  ScorePostProcessPresetInput,
  ScorePostProcessProjectContext,
  ScorePostProcessProjectSnapshot,
  ScorePostProcessRunRecord,
  ScorePostProcessScriptError,
} from '@preload/contracts';
import { getDatabase } from '@main/database/client';
import { scorePostProcessPresetsTable } from '@main/database/schema';
import { SCORE_POST_PROCESS_AI_SCRIPT_JSON_CONTRACT } from '@main/prompts/score-post-process-ai/schema';
import { SCORE_POST_PROCESS_AI_SCRIPT_SYSTEM_PROMPT } from '@main/prompts/score-post-process-ai/system';
import { buildScorePostProcessAiScriptUserPrompt } from '@main/prompts/score-post-process-ai/user';
import {
  shouldWriteLlmJsonDebugArtifact,
  writeLlmJsonDebugArtifact,
} from './llmJsonDebug';
import { LlmUsageService, normalizeLlmUsage } from './llmUsageService';
import { logLlmRequest, logLlmResult } from './llmRequestLogger';
import {
  compactErrorMessage,
  extractReasoningText,
  extractStreamingDeltaText,
  isStreamingFallbackCandidate,
  readAssistantText,
} from './llmStreamUtils';
import { ProjectService } from './projectService';
import { SettingsService } from './settingsService';

type BuiltinPresetDefinition = Omit<
  ScorePostProcessPreset,
  'readonly' | 'source' | 'createdAt' | 'updatedAt'
>;

type ScriptOutputRow = {
  paperId: string;
  processedScore?: unknown;
  gradeLabel?: unknown;
  note?: unknown;
  metadata?: unknown;
};

type ScriptReturnValue =
  | ScriptOutputRow[]
  | {
      outputs?: unknown;
      summary?: unknown;
    }
  | null
  | undefined;

const LATEST_RUN_FILE_NAME = 'latest.json';
const SCRIPT_FILE_NAME = '<score-post-process-script>';
const EXECUTION_TIMEOUT_MS = 1500;
const AI_SCRIPT_STREAM_FLUSH_INTERVAL_MS = 800;
const AI_SCRIPT_RESPONSE_SCHEMA = z
  .object({
    scriptName: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    assumptions: z.array(z.string()),
    scriptCode: z.string().trim().min(1),
  })
  .strict();

type ScorePostProcessAiScriptListener = (
  snapshot: ScorePostProcessAiScriptSnapshot,
) => void;

type ScriptExecutionInput = {
  projectId: string;
  projectContext: ScorePostProcessProjectContext;
  paperInputs: ScorePostProcessPaperData[];
  scriptName?: string;
  scriptCode: string;
  preset?: Pick<ScorePostProcessPreset, 'id' | 'name' | 'source'> | null;
  runId?: string;
  createdAt?: string;
};
const BUILTIN_PRESETS: BuiltinPresetDefinition[] = [
  {
    id: 'builtin-normalize-60-100',
    name: '线性归一化到 60-100',
    description:
      '把当前项目所有已批阅分数按线性比例映射到 60-100 区间，常用于统一拉伸成绩分布。',
    code: `const originalScores = papers.map((paper) => paper.totalScore);
const normalizedScores = utils.normalizeToRange(originalScores, 60, 100);

return papers.map((paper, index) => ({
  paperId: paper.paperId,
  processedScore: utils.round(normalizedScores[index], 1),
  gradeLabel: normalizedScores[index] >= 90 ? 'A' : normalizedScores[index] >= 80 ? 'B' : normalizedScores[index] >= 70 ? 'C' : 'D',
  note: '按全班成绩线性归一化到 60-100 区间。',
  metadata: {
    originalScore: paper.totalScore,
    normalizedFromRange: [utils.min(originalScores), utils.max(originalScores)],
  },
}));`,
  },
  {
    id: 'builtin-borderline-pass',
    name: '捞人到及格线',
    description:
      '把 55-60 分附近的边缘成绩温和提升到 60 分，其余成绩保持不变，适合“捞人”场景。',
    code: `return papers.map((paper) => {
  const score = paper.totalScore;
  const shouldLift = score >= 55 && score < 60;

  return {
    paperId: paper.paperId,
    processedScore: shouldLift ? 60 : score,
    gradeLabel: shouldLift ? 'Pass' : null,
    note: shouldLift ? '边缘成绩上调到及格线。' : '保持原始成绩不变。',
    metadata: {
      lifted: shouldLift,
      originalScore: score,
    },
  };
});`,
  },
  {
    id: 'builtin-zscore-band',
    name: '标准分档位',
    description:
      '保留原始分数，同时给每份答卷补充标准分、班级百分位和档位标签，适合做教学分析。',
    code: `const scoreList = papers.map((paper) => paper.totalScore);

return {
  summary: {
    averageScore: utils.round(utils.average(scoreList), 2),
    medianScore: utils.round(utils.quantile(scoreList, 0.5), 2),
  },
  outputs: papers.map((paper) => {
    const z = utils.zScore(paper.totalScore, scoreList);
    const percentile = utils.percentile(scoreList, paper.totalScore);
    const band = z >= 1 ? '拔尖' : z >= 0 ? '稳定' : z >= -1 ? '待提升' : '重点关注';

    return {
      paperId: paper.paperId,
      processedScore: paper.totalScore,
      gradeLabel: band,
      note: '保留原始分数，附加统计档位。',
      metadata: {
        zScore: utils.round(z, 3),
        percentile: utils.round(percentile, 1),
        band,
      },
    };
  }),
};`,
  },
  {
    id: 'builtin-scale-and-cap',
    name: '统一加权后封顶',
    description:
      '给全体学生乘固定系数并加奖励分，最后封顶，适合卷面偏难时做整体补偿。',
    code: `const factor = 1.05;
const bonus = 3;
const ceiling = 100;

return papers.map((paper) => {
  const processedScore = utils.clamp(utils.round(paper.totalScore * factor + bonus, 1), 0, ceiling);

  return {
    paperId: paper.paperId,
    processedScore,
    note: \`按 totalScore * \${factor} + \${bonus} 计算，并封顶到 \${ceiling} 分。\`,
    metadata: {
      factor,
      bonus,
      ceiling,
      originalScore: paper.totalScore,
    },
  };
});`,
  },
];

function toBuiltinPreset(
  definition: BuiltinPresetDefinition,
): ScorePostProcessPreset {
  return {
    ...definition,
    source: 'builtin',
    readonly: true,
    createdAt: null,
    updatedAt: null,
  };
}

function getProjectScorePostProcessDir(rootPath: string): string {
  return path.join(rootPath, 'score-post-process');
}

function getLatestRunPath(rootPath: string): string {
  return path.join(
    getProjectScorePostProcessDir(rootPath),
    LATEST_RUN_FILE_NAME,
  );
}

function buildExportFileName(
  projectName: string,
  run: ScorePostProcessRunRecord,
): string {
  const safeProjectName = projectName
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-');
  const safeRunName = run.scriptName
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-');
  return `${safeProjectName || 'project'}-${safeRunName || 'score-post-process'}-${run.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
}

function roundScore(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function min(values: number[]): number {
  return values.length ? Math.min(...values) : 0;
}

function max(values: number[]): number {
  return values.length ? Math.max(...values) : 0;
}

function quantile(values: number[], q: number): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = clamp(q, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower] ?? 0;
  }
  const ratio = position - lower;
  return (sorted[lower] ?? 0) * (1 - ratio) + (sorted[upper] ?? 0) * ratio;
}

export function normalizeToRange(
  values: number[],
  targetMin: number,
  targetMax: number,
): number[] {
  if (values.length === 0) {
    return [];
  }

  const currentMin = min(values);
  const currentMax = max(values);
  if (Math.abs(currentMax - currentMin) < 0.000001) {
    const midpoint = (targetMin + targetMax) / 2;
    return values.map(() => midpoint);
  }

  return values.map(
    (value) =>
      targetMin +
      ((value - currentMin) / (currentMax - currentMin)) *
        (targetMax - targetMin),
  );
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function zScore(value: number, population: number[]): number {
  const deviation = standardDeviation(population);
  if (deviation < 0.000001) {
    return 0;
  }
  return (value - average(population)) / deviation;
}

function percentile(values: number[], score: number): number {
  if (values.length === 0) {
    return 0;
  }
  const count = values.filter((value) => value <= score).length;
  return (count / values.length) * 100;
}

function variance(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = average(values);
  return average(values.map((value) => (value - mean) ** 2));
}

function sanitizeJsonRecord(
  value: unknown,
  depth = 0,
): Record<string, unknown> {
  if (
    depth > 8 ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = sanitizeJsonValue(entry, depth + 1);
  }
  return result;
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return '[MaxDepth]';
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    return sanitizeJsonRecord(value, depth + 1);
  }
  return String(value);
}

export function createScriptError(
  phase: ScorePostProcessScriptError['phase'],
  error: unknown,
): ScorePostProcessScriptError {
  const errorObject =
    error instanceof Error ? error : new Error(String(error ?? '未知错误'));
  const stack = errorObject.stack ?? errorObject.message;
  const matched = stack.match(
    new RegExp(
      `${SCRIPT_FILE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:([0-9]+):([0-9]+)`,
    ),
  );

  return {
    phase,
    name: errorObject.name || 'Error',
    message: errorObject.message || '脚本执行失败。',
    stack,
    lineNumber: matched ? Math.max(Number(matched[1]) - 2, 1) : null,
    columnNumber: matched ? Number(matched[2]) : null,
  };
}

function buildProjectContext(
  project: Awaited<ReturnType<ProjectService['getProjectById']>>,
): ScorePostProcessProjectContext {
  return {
    id: project.id,
    name: project.name,
    rootPath: project.rootPath,
    referenceAnswerVersion: project.referenceAnswerVersion,
    stats: project.stats,
    settings: project.settings,
  };
}

function buildPaperData(
  results: Awaited<ReturnType<ProjectService['listResults']>>,
  papers: Awaited<ReturnType<ProjectService['listProjectPapers']>>,
): ScorePostProcessPaperData[] {
  const paperMap = new Map(papers.map((paper) => [paper.id, paper]));

  return results
    .filter(
      (
        result,
      ): result is typeof result & {
        finalResult: NonNullable<(typeof result)['finalResult']>;
        modelResult: NonNullable<(typeof result)['modelResult']>;
      } => Boolean(result.finalResult && result.modelResult),
    )
    .map((result) => {
      const paper = paperMap.get(result.paperId);
      const originalScore =
        typeof result.finalResult.manualTotalScore === 'number'
          ? result.finalResult.manualTotalScore
          : result.finalResult.totalScore;

      return {
        paperId: result.paperId,
        paperCode: paper?.paperCode ?? result.paperId,
        originalScore,
        totalScore: originalScore,
        modelScore:
          result.modelResult?.totalScore ?? result.finalResult.totalScore,
        manualScore:
          typeof result.finalResult.manualTotalScore === 'number'
            ? result.finalResult.manualTotalScore
            : null,
        studentInfo: result.finalResult.studentInfo,
        questionScores: result.finalResult.questionScores.map((question) => ({
          questionId: question.questionId,
          questionTitle: question.questionTitle,
          score: question.score,
          maxScore: question.maxScore,
        })),
        nameMatchStatus: result.nameMatchStatus,
        referenceAnswerVersion: result.referenceAnswerVersion,
        updatedAt: result.updatedAt,
        pageCount: paper?.pageCount ?? 0,
        scanStatus: paper?.scanStatus ?? 'pending',
        gradingStatus: paper?.gradingStatus ?? 'completed',
      };
    })
    .sort((left, right) =>
      left.paperCode.localeCompare(right.paperCode, 'zh-Hans-CN'),
    );
}

export function normalizeScriptOutputs(
  paperInputs: ScorePostProcessPaperData[],
  outputRows: ScriptOutputRow[],
): ScorePostProcessPaperResult[] {
  const outputMap = new Map<string, ScriptOutputRow>();

  for (const row of outputRows) {
    if (!row || typeof row !== 'object') {
      throw new Error('脚本输出必须是对象数组。');
    }
    if (typeof row.paperId !== 'string' || !row.paperId.trim()) {
      throw new Error('每条脚本输出都必须包含合法的 paperId。');
    }
    if (!paperInputs.some((paper) => paper.paperId === row.paperId)) {
      throw new Error(`脚本输出引用了未知试卷：${row.paperId}`);
    }
    if (outputMap.has(row.paperId)) {
      throw new Error(`脚本为试卷 ${row.paperId} 输出了重复结果。`);
    }
    outputMap.set(row.paperId, row);
  }

  return paperInputs.map((paper) => {
    const row = outputMap.get(paper.paperId);
    const nextScore =
      typeof row?.processedScore === 'number' &&
      Number.isFinite(row.processedScore)
        ? roundScore(row.processedScore)
        : paper.originalScore;

    return {
      paperId: paper.paperId,
      paperCode: paper.paperCode,
      studentInfo: paper.studentInfo,
      originalScore: roundScore(paper.originalScore),
      processedScore: nextScore,
      scoreDelta: roundScore(nextScore - paper.originalScore),
      applied: Boolean(row),
      gradeLabel:
        typeof row?.gradeLabel === 'string' && row.gradeLabel.trim()
          ? row.gradeLabel.trim()
          : null,
      note:
        typeof row?.note === 'string' && row.note.trim()
          ? row.note.trim()
          : null,
      metadata:
        row &&
        row.metadata &&
        typeof row.metadata === 'object' &&
        !Array.isArray(row.metadata)
          ? sanitizeJsonRecord(row.metadata)
          : {},
    };
  });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }

  return value;
}

function buildScriptUtilities() {
  return deepFreeze({
    clamp,
    round: roundScore,
    sum,
    average,
    min,
    max,
    quantile,
    percentile,
    zScore,
    normalizeToRange,
  });
}

function buildStoredRunPayload(run: ScorePostProcessRunRecord) {
  return {
    ...run,
  };
}

function createNoGradedPapersError(): ScorePostProcessScriptError {
  return {
    phase: 'normalize',
    name: 'NoGradedPapersError',
    message: '当前项目还没有可用于分数后处理的已批阅答卷。',
    stack: '当前项目还没有可用于分数后处理的已批阅答卷。',
    lineNumber: null,
    columnNumber: null,
  };
}

function createEmptyAiScriptSnapshot(
  projectId: string,
): ScorePostProcessAiScriptSnapshot {
  return {
    projectId,
    status: 'idle',
    stage: null,
    reasoningText: '',
    previewText: '',
    errorMessage: null,
    result: null,
    updatedAt: new Date().toISOString(),
  };
}

function cloneAiScriptSnapshot(
  snapshot: ScorePostProcessAiScriptSnapshot,
): ScorePostProcessAiScriptSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ScorePostProcessAiScriptSnapshot;
}

export function findFirstJsonObject(rawText: string): string {
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

export function parseScorePostProcessAiScriptModelResponse(
  rawText: string,
): ScorePostProcessAiScriptResult {
  const jsonText = findFirstJsonObject(rawText);
  const parsed = JSON.parse(jsonText) as unknown;
  return AI_SCRIPT_RESPONSE_SCHEMA.parse(parsed);
}

function buildProgramPromptText(): string {
  return `${SCORE_POST_PROCESS_AI_SCRIPT_SYSTEM_PROMPT}\n\n${SCORE_POST_PROCESS_AI_SCRIPT_JSON_CONTRACT}`;
}

function formatScriptValidationError(error: ScorePostProcessScriptError): string {
  const position =
    error.lineNumber != null
      ? `（第 ${error.lineNumber} 行，第 ${error.columnNumber ?? 1} 列）`
      : '';
  return `${error.phase} 阶段失败${position}：${error.message}`;
}

export function executeScorePostProcessScript(
  input: ScriptExecutionInput,
): ScorePostProcessExecutionResult {
  if (!input.paperInputs.length) {
    return {
      success: false,
      run: null,
      error: createNoGradedPapersError(),
    };
  }

  const logs: string[] = [];
  const collectedOutputs: ScriptOutputRow[] = [];
  const projectContext = deepFreeze({
    ...input.projectContext,
    stats: { ...input.projectContext.stats },
    settings: { ...input.projectContext.settings },
  });
  const frozenPapers = deepFreeze(
    input.paperInputs.map((paper) => ({
      ...paper,
      studentInfo: { ...paper.studentInfo },
      questionScores: paper.questionScores.map((question) => ({
        ...question,
      })),
    })),
  );
  const utils = buildScriptUtilities();
  const output = (row: ScriptOutputRow) => {
    collectedOutputs.push(row);
  };
  const outputMany = (rows: ScriptOutputRow[]) => {
    if (!Array.isArray(rows)) {
      throw new Error('outputMany 需要传入数组。');
    }
    collectedOutputs.push(...rows);
  };
  const log = (...args: unknown[]) => {
    logs.push(
      args
        .map((arg) =>
          typeof arg === 'string'
            ? arg
            : JSON.stringify(sanitizeJsonValue(arg)),
        )
        .join(' '),
    );
  };
  const context = vm.createContext({
    project: projectContext,
    papers: frozenPapers,
    utils,
    output,
    outputMany,
    log,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    console: {
      log,
      info: log,
      warn: log,
      error: log,
    },
  });

  let returnedValue: ScriptReturnValue;
  try {
    const script = new vm.Script(
      `"use strict";\n(function () {\n${input.scriptCode}\n})()`,
      {
        filename: SCRIPT_FILE_NAME,
      },
    );
    returnedValue = script.runInContext(context, {
      timeout: EXECUTION_TIMEOUT_MS,
    }) as ScriptReturnValue;
  } catch (error) {
    return {
      success: false,
      run: null,
      error: createScriptError(
        error instanceof SyntaxError ? 'compile' : 'runtime',
        error,
      ),
    };
  }

  try {
    if (Array.isArray(returnedValue)) {
      collectedOutputs.push(...returnedValue);
    } else if (returnedValue && typeof returnedValue === 'object') {
      if (Array.isArray(returnedValue.outputs)) {
        collectedOutputs.push(...(returnedValue.outputs as ScriptOutputRow[]));
      } else if (returnedValue.outputs != null) {
        throw new Error('脚本返回的 outputs 必须是数组。');
      }
    }

    const normalizedResults = normalizeScriptOutputs(
      input.paperInputs,
      collectedOutputs,
    );
    const processedScores = normalizedResults.map((item) => item.processedScore);
    const originalScores = normalizedResults.map((item) => item.originalScore);
    const run: ScorePostProcessRunRecord = {
      id: input.runId ?? `score-post-process-${nanoid(10)}`,
      projectId: input.projectId,
      scriptName: input.scriptName?.trim() || input.preset?.name || '临时脚本',
      presetId: input.preset?.id ?? null,
      presetName: input.preset?.name ?? null,
      presetSource: input.preset?.source ?? 'adhoc',
      scriptCode: input.scriptCode,
      createdAt: input.createdAt ?? new Date().toISOString(),
      summary: {
        paperCount: normalizedResults.length,
        appliedCount: normalizedResults.filter((item) => item.applied).length,
        averageOriginalScore: roundScore(average(originalScores)),
        averageProcessedScore: roundScore(average(processedScores)),
        minProcessedScore: roundScore(min(processedScores)),
        maxProcessedScore: roundScore(max(processedScores)),
      },
      scriptSummary:
        returnedValue &&
        typeof returnedValue === 'object' &&
        !Array.isArray(returnedValue) &&
        returnedValue.summary &&
        typeof returnedValue.summary === 'object' &&
        !Array.isArray(returnedValue.summary)
          ? sanitizeJsonRecord(returnedValue.summary)
          : null,
      results: normalizedResults,
      logs,
      exportPath: null,
    };

    return {
      success: true,
      run,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      run: null,
      error: createScriptError('normalize', error),
    };
  }
}

export class ScorePostProcessService {
  private aiScriptListeners = new Set<ScorePostProcessAiScriptListener>();

  private aiSnapshots = new Map<string, ScorePostProcessAiScriptSnapshot>();

  constructor(
    private readonly projects: ProjectService,
    private readonly settings: SettingsService,
    private readonly llmUsage: LlmUsageService,
  ) {}

  onAiScriptUpdated(handler: ScorePostProcessAiScriptListener): () => void {
    this.aiScriptListeners.add(handler);
    return () => {
      this.aiScriptListeners.delete(handler);
    };
  }

  getAiScriptSnapshot(projectId: string): ScorePostProcessAiScriptSnapshot {
    return cloneAiScriptSnapshot(
      this.aiSnapshots.get(projectId) ?? createEmptyAiScriptSnapshot(projectId),
    );
  }

  async listPresets(): Promise<ScorePostProcessPreset[]> {
    const db = getDatabase();
    const customPresets = db
      .select()
      .from(scorePostProcessPresetsTable)
      .orderBy(desc(scorePostProcessPresetsTable.updatedAt))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        code: row.code,
        source: 'custom' as const,
        readonly: false,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

    return [...BUILTIN_PRESETS.map(toBuiltinPreset), ...customPresets];
  }

  async savePreset(
    input: ScorePostProcessPresetInput,
  ): Promise<ScorePostProcessPreset> {
    const trimmedId = input.id?.trim();
    if (
      trimmedId &&
      BUILTIN_PRESETS.some((preset) => preset.id === trimmedId)
    ) {
      throw new Error('系统内置脚本预设不能直接修改，请先复制为自定义预设。');
    }

    const now = new Date().toISOString();
    const presetId = trimmedId || `score-preset-${nanoid(10)}`;
    const db = getDatabase();
    const existing = db
      .select()
      .from(scorePostProcessPresetsTable)
      .where(eq(scorePostProcessPresetsTable.id, presetId))
      .get();

    db.insert(scorePostProcessPresetsTable)
      .values({
        id: presetId,
        name: input.name.trim(),
        description: input.description.trim(),
        code: input.code,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: scorePostProcessPresetsTable.id,
        set: {
          name: input.name.trim(),
          description: input.description.trim(),
          code: input.code,
          updatedAt: now,
        },
      })
      .run();

    return {
      id: presetId,
      name: input.name.trim(),
      description: input.description.trim(),
      code: input.code,
      source: 'custom',
      readonly: false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }

  async deletePreset(presetId: string): Promise<void> {
    if (BUILTIN_PRESETS.some((preset) => preset.id === presetId)) {
      throw new Error('系统内置脚本预设不能删除。');
    }

    const db = getDatabase();
    db.delete(scorePostProcessPresetsTable)
      .where(eq(scorePostProcessPresetsTable.id, presetId))
      .run();
  }

  async getProjectSnapshot(
    projectId: string,
  ): Promise<ScorePostProcessProjectSnapshot> {
    const project = await this.projects.getProjectById(projectId);
    const latestRunPath = getLatestRunPath(project.rootPath);

    if (!(await fs.pathExists(latestRunPath))) {
      return {
        projectId,
        latestRun: null,
      };
    }

    try {
      const payload = await fs.readJson(latestRunPath);
      return {
        projectId,
        latestRun: payload as ScorePostProcessRunRecord,
      };
    } catch {
      return {
        projectId,
        latestRun: null,
      };
    }
  }

  async execute(
    projectId: string,
    input: ExecuteScorePostProcessInput,
  ): Promise<ScorePostProcessExecutionResult> {
    return this.executeInternal(projectId, input, { persist: true });
  }

  async startAiScriptGeneration(
    projectId: string,
    input: GenerateScorePostProcessAiScriptInput,
  ): Promise<ScorePostProcessAiScriptSnapshot> {
    const instruction = input.instruction.trim();
    if (!instruction) {
      throw new Error('请先输入你希望 AI 处理分数的意图。');
    }

    const current = this.aiSnapshots.get(projectId);
    if (current?.status === 'running') {
      throw new Error('AI 脚本正在生成中，请等待当前请求完成。');
    }

    const snapshot: ScorePostProcessAiScriptSnapshot = {
      projectId,
      status: 'running',
      stage: '正在整理项目与答卷上下文',
      reasoningText: '',
      previewText: '',
      errorMessage: null,
      result: null,
      updatedAt: new Date().toISOString(),
    };
    this.setAiSnapshot(snapshot);

    void this.runAiScriptGeneration(projectId, instruction);
    return cloneAiScriptSnapshot(snapshot);
  }

  async exportLatest(
    projectId: string,
    options?: {
      targetDirectory?: string;
    },
  ): Promise<string> {
    const project = await this.projects.getProjectById(projectId);
    const snapshot = await this.getProjectSnapshot(projectId);
    const latestRun = snapshot.latestRun;

    if (!latestRun) {
      throw new Error('当前还没有可导出的分数后处理结果。');
    }

    const targetDirectory =
      options?.targetDirectory?.trim() ||
      path.join(project.rootPath, 'exports');
    const outputPath = path.join(
      targetDirectory,
      buildExportFileName(project.name, latestRun),
    );
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeJson(
      outputPath,
      {
        exportFormat: 'neuromark-score-post-process',
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        project: buildProjectContext(project),
        run: latestRun,
      },
      { spaces: 2 },
    );

    const latestRunPath = getLatestRunPath(project.rootPath);
    await fs.writeJson(
      latestRunPath,
      {
        ...latestRun,
        exportPath: outputPath,
      },
      { spaces: 2 },
    );

    return outputPath;
  }

  private async executeInternal(
    projectId: string,
    input: ExecuteScorePostProcessInput,
    options: {
      persist: boolean;
    },
  ): Promise<ScorePostProcessExecutionResult> {
    const context = await this.loadExecutionContext(projectId);
    const preset = input.presetId
      ? (context.presets.find((item) => item.id === input.presetId) ?? null)
      : null;
    const result = executeScorePostProcessScript({
      projectId,
      projectContext: context.projectContext,
      paperInputs: context.paperInputs,
      scriptName: input.scriptName,
      scriptCode: input.scriptCode,
      preset,
    });

    if (!options.persist || !result.success || !result.run) {
      return result;
    }

    const latestRunPath = getLatestRunPath(context.project.rootPath);
    await fs.ensureDir(path.dirname(latestRunPath));
    await fs.writeJson(latestRunPath, buildStoredRunPayload(result.run), {
      spaces: 2,
    });
    return result;
  }

  private async loadExecutionContext(projectId: string) {
    const [project, results, papers, presets] = await Promise.all([
      this.projects.getProjectById(projectId),
      this.projects.listResults(projectId),
      this.projects.listProjectPapers(projectId),
      this.listPresets(),
    ]);
    const paperInputs = buildPaperData(results, papers);

    return {
      project,
      projectContext: buildProjectContext(project),
      paperInputs,
      presets,
    };
  }

  private async runAiScriptGeneration(
    projectId: string,
    instruction: string,
  ): Promise<void> {
    try {
      const settingsCheck = await this.settings.validateGenerationSettings();
      if (!settingsCheck.ok) {
        throw new Error(settingsCheck.message);
      }

      const context = await this.loadExecutionContext(projectId);
      if (!context.paperInputs.length) {
        throw new Error(createNoGradedPapersError().message);
      }

      const client = new OpenAI({
        apiKey: settingsCheck.settings.apiKey,
        baseURL: settingsCheck.settings.baseUrl,
        timeout: settingsCheck.settings.timeoutMs,
      });

      const firstCandidate = await this.requestAiScriptCandidate({
        client,
        settings: settingsCheck.settings,
        projectId,
        attempt: 1,
        instruction,
        context,
      });

      this.patchAiSnapshot(projectId, {
        stage: '正在校验第 1 次生成的脚本',
      });

      const firstValidation = this.validateAiScriptCandidate(
        projectId,
        context,
        firstCandidate,
      );
      if (firstValidation.success) {
        this.patchAiSnapshot(projectId, {
          status: 'completed',
          stage: '脚本生成完成，已通过执行前校验',
          errorMessage: null,
          result: firstCandidate,
        });
        return;
      }

      this.patchAiSnapshot(projectId, {
        stage: '首轮脚本未通过校验，正在自动修复',
      });

      const secondCandidate = await this.requestAiScriptCandidate({
        client,
        settings: settingsCheck.settings,
        projectId,
        attempt: 2,
        instruction,
        context,
        repairError: firstValidation.error,
        previousScriptName: firstCandidate.scriptName,
        previousScriptCode: firstCandidate.scriptCode,
      });

      this.patchAiSnapshot(projectId, {
        stage: '正在校验修复后的脚本',
      });

      const secondValidation = this.validateAiScriptCandidate(
        projectId,
        context,
        secondCandidate,
      );
      if (!secondValidation.success) {
        throw new Error(
          `AI 生成的脚本未能通过校验：${formatScriptValidationError(
            secondValidation.error,
          )}`,
        );
      }

      this.patchAiSnapshot(projectId, {
        status: 'completed',
        stage: '脚本生成完成，已通过执行前校验',
        errorMessage: null,
        result: secondCandidate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.patchAiSnapshot(projectId, {
        status: 'failed',
        stage: 'AI 脚本生成失败',
        errorMessage: message,
      });
    }
  }

  private async requestAiScriptCandidate(input: {
    client: OpenAI;
    settings: ChatCompletionCreateParamsNonStreaming['model'] extends string
      ? {
          model: string;
          gradingTemperature: number;
          reasoningEffort: 'low' | 'medium' | 'high';
        }
      : never;
    projectId: string;
    attempt: number;
    instruction: string;
    context: Awaited<ReturnType<ScorePostProcessService['loadExecutionContext']>>;
    repairError?: ScorePostProcessScriptError | null;
    previousScriptName?: string;
    previousScriptCode?: string;
  }): Promise<ScorePostProcessAiScriptResult> {
      const scoreList = input.context.paperInputs.map((paper) => paper.totalScore);
      const label = `score-post-process-ai-script:${input.projectId}:attempt-${input.attempt}`;
      this.patchAiSnapshot(input.projectId, {
        stage:
          input.attempt === 1
            ? '正在请求模型'
            : '正在请求模型修复脚本',
      });
      const requestPayload: ChatCompletionCreateParamsNonStreaming = {
        model: input.settings.model,
        temperature: input.settings.gradingTemperature,
      reasoning_effort: input.settings.reasoningEffort,
      messages: [
        {
          role: 'system',
          content: buildProgramPromptText(),
        },
        {
          role: 'user',
          content: buildScorePostProcessAiScriptUserPrompt({
            instruction: input.instruction,
            project: input.context.projectContext,
            scoreStats: {
              paperCount: input.context.paperInputs.length,
              minScore: roundScore(min(scoreList), 2),
              maxScore: roundScore(max(scoreList), 2),
              averageScore: roundScore(average(scoreList), 2),
              medianScore: roundScore(quantile(scoreList, 0.5), 2),
              variance: roundScore(variance(scoreList), 4),
              standardDeviation: roundScore(standardDeviation(scoreList), 4),
              q1: roundScore(quantile(scoreList, 0.25), 2),
              q3: roundScore(quantile(scoreList, 0.75), 2),
              p10: roundScore(quantile(scoreList, 0.1), 2),
              p90: roundScore(quantile(scoreList, 0.9), 2),
            },
            repairError: input.repairError,
            previousScriptName: input.previousScriptName,
            previousScriptCode: input.previousScriptCode,
          }),
        },
      ],
    };

    logLlmRequest(label, {
      client: {
        baseURL: input.client.baseURL,
        model: input.settings.model,
        timeoutMs: input.client.timeout,
        apiKey: input.client.apiKey,
        reasoningEffort: input.settings.reasoningEffort,
        gradingTemperature: input.settings.gradingTemperature,
      },
      payload: requestPayload,
    });

    let rawText = '';
    try {
      const response = await this.collectModelResponseText({
        client: input.client,
        requestPayload,
        projectId: input.projectId,
      });
      rawText = response.rawText;
      const parsed = parseScorePostProcessAiScriptModelResponse(rawText);
      logLlmResult(label, {
        status: 'success',
        detail: {
          mode: response.mode,
          scriptName: parsed.scriptName,
          assumptionsCount: parsed.assumptions.length,
          responseTextLength: rawText.length,
        },
      });
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const debugDumpPath =
        rawText && shouldWriteLlmJsonDebugArtifact(error)
          ? await writeLlmJsonDebugArtifact({
              scope: 'score-post-process-ai-script',
              identifier: `${input.projectId}-attempt-${input.attempt}`,
              rawOutput: rawText,
              errorMessage: message,
            })
          : null;
      logLlmResult(label, {
        status: 'error',
        detail: {
          message,
          debugDumpPath,
        },
      });
      throw error;
    }
  }

  private validateAiScriptCandidate(
    projectId: string,
    context: Awaited<ReturnType<ScorePostProcessService['loadExecutionContext']>>,
    candidate: ScorePostProcessAiScriptResult,
  ):
    | {
        success: true;
      }
    | {
        success: false;
        error: ScorePostProcessScriptError;
      } {
    const result = executeScorePostProcessScript({
      projectId,
      projectContext: context.projectContext,
      paperInputs: context.paperInputs,
      scriptName: candidate.scriptName,
      scriptCode: candidate.scriptCode,
      preset: null,
    });

    if (result.success) {
      return { success: true };
    }

    return {
      success: false,
      error: result.error ?? createNoGradedPapersError(),
    };
  }

  private async collectModelResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    projectId: string;
  }): Promise<{
    rawText: string;
    mode: 'stream' | 'non-stream';
  }> {
    try {
      this.patchAiSnapshot(input.projectId, {
        stage: '正在请求模型',
      });
      return await this.collectStreamingResponseText(input);
    } catch (error) {
      if (!isStreamingFallbackCandidate(error)) {
        throw error;
      }

      this.patchAiSnapshot(input.projectId, {
        stage: `正在请求模型（已切换为普通请求）：${compactErrorMessage(error)}`,
      });
      return this.collectNonStreamingResponseText(input);
    }
  }

  private async collectStreamingResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    projectId: string;
  }): Promise<{
    rawText: string;
    mode: 'stream';
  }> {
    const stream = await input.client.chat.completions.create({
      ...input.requestPayload,
      stream: true,
      stream_options: {
        include_usage: true,
      },
    });

    let rawText = '';
    let reasoningText = '';
    let usage = null;
    let lastFlushedLength = 0;
    let lastReasoningFlushedLength = 0;
    let lastFlushAt = 0;

    for await (const chunk of stream) {
      usage = normalizeLlmUsage(chunk.usage) ?? usage;
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
        now - lastFlushAt >= AI_SCRIPT_STREAM_FLUSH_INTERVAL_MS;

      if (shouldFlush) {
        lastFlushedLength = rawText.length;
        lastReasoningFlushedLength = reasoningText.length;
        lastFlushAt = now;
        this.patchAiSnapshot(input.projectId, {
          stage: rawText.trim().length > 0 ? '正在接收模型输出草稿' : '模型正在推理',
          previewText: rawText,
          reasoningText,
        });
      }
    }

    this.patchAiSnapshot(input.projectId, {
      previewText: rawText,
      reasoningText,
    });

    await this.llmUsage.recordUsage({
      source: 'score-postprocess-ai-script',
      label: 'AI脚本生成',
      model: input.requestPayload.model,
      usage,
    });

    return {
      rawText,
      mode: 'stream',
    };
  }

  private async collectNonStreamingResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    projectId: string;
  }): Promise<{
    rawText: string;
    mode: 'non-stream';
  }> {
    const response = await input.client.chat.completions.create(
      input.requestPayload,
    );
    const rawText = readAssistantText(response);
    const reasoningText = extractReasoningText(response.choices[0]?.message);
    const usage = normalizeLlmUsage(response.usage);

    this.patchAiSnapshot(input.projectId, {
      previewText: rawText,
      reasoningText,
      stage: '模型已返回完整结果，正在解析',
    });

    await this.llmUsage.recordUsage({
      source: 'score-postprocess-ai-script',
      label: 'AI脚本生成',
      model: input.requestPayload.model,
      usage,
    });

    return {
      rawText,
      mode: 'non-stream',
    };
  }

  private setAiSnapshot(snapshot: ScorePostProcessAiScriptSnapshot): void {
    this.aiSnapshots.set(snapshot.projectId, cloneAiScriptSnapshot(snapshot));
    const payload = cloneAiScriptSnapshot(snapshot);
    for (const listener of this.aiScriptListeners) {
      listener(payload);
    }
  }

  private patchAiSnapshot(
    projectId: string,
    patch: Partial<ScorePostProcessAiScriptSnapshot>,
  ): void {
    const current =
      this.aiSnapshots.get(projectId) ?? createEmptyAiScriptSnapshot(projectId);
    this.setAiSnapshot({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }
}
