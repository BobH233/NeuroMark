import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import sharp from 'sharp';
import { buildGradingJsonSchema } from '@main/prompts/grading/schema';
import { buildGradingSystemPrompt } from '@main/prompts/grading/system';
import { buildGradingUserPrompt } from '@main/prompts/grading/user';
import { GRADING_RUBRIC_SYSTEM_PROMPT } from '@main/prompts/grading/rubric-system';
import { buildRubricCompilationUserPrompt } from '@main/prompts/grading/rubric-user';
import type {
  FinalResult,
  ModelResult,
  OverallAdvice,
  PaperRecord,
  QuestionRegion,
  QuestionScore,
  ScoreBreakdownItem,
} from '@preload/contracts';
import { logLlmProgress, logLlmRequest, logLlmResult } from './llmRequestLogger';
import {
  compactErrorMessage,
  extractReasoningText,
  extractStreamingDeltaText,
  formatStreamPreview,
  isStreamingFallbackCandidate,
  readAssistantText,
  shortenText,
} from './llmStreamUtils';
import { ProjectService } from './projectService';
import { SettingsService } from './settingsService';
import type {
  CompiledRubric,
  GradingServiceSettings,
} from './gradingTypes';

const FENCED_JSON_PATTERN = /```(?:json)?\s*(\{[\s\S]*\})\s*```/i;

function ensureAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('批阅任务已取消');
  }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseJsonObject(rawOutput: string): Record<string, unknown> {
  let candidate = rawOutput.trim();
  const fenced = candidate.match(FENCED_JSON_PATTERN);
  if (fenced?.[1]) {
    candidate = fenced[1].trim();
  }

  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const extracted = extractFirstJsonObject(candidate);
    if (extracted) {
      const parsed = JSON.parse(extracted);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }
  }

  throw new Error('模型返回的内容不是合法 JSON 对象。');
}

function buildAttemptFailureMessage(error: Error, rawOutput: string): string {
  const base = `ERROR: ${error.message}`;
  if (!rawOutput.trim()) {
    return base;
  }

  if (
    error.message.includes('JSON') ||
    error.message.includes('questionScores') ||
    error.message.includes('studentInfo') ||
    error.message.includes('overallAdvice') ||
    error.message.includes('questionRegions')
  ) {
    return `${base}\n原始输出预览：${shortenText(rawOutput, 320)}`;
  }

  return base;
}

export function getReferenceAnswerFingerprint(markdown: string): string {
  return createHash('sha256').update(markdown.trim()).digest('hex');
}

export function canReuseCompiledRubric(
  payload: Record<string, unknown>,
  input: {
    referenceAnswerVersion: number;
    referenceAnswerMarkdown: string;
  },
): boolean {
  const storedVersion =
    typeof payload.referenceAnswerVersion === 'number' &&
    Number.isFinite(payload.referenceAnswerVersion) &&
    payload.referenceAnswerVersion > 0
      ? Math.trunc(payload.referenceAnswerVersion)
      : null;
  const storedFingerprint =
    typeof payload.referenceAnswerFingerprint === 'string'
      ? payload.referenceAnswerFingerprint.trim()
      : '';

  if (storedVersion !== input.referenceAnswerVersion || !storedFingerprint) {
    return false;
  }

  return storedFingerprint === getReferenceAnswerFingerprint(input.referenceAnswerMarkdown);
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} 必须是数字。`);
  }
  return Number(value.toFixed(2));
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} 必须是字符串。`);
  }
  return value.trim();
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} 必须是字符串数组。`);
  }
  return value.map((item, index) => asString(item, `${field}[${index}]`)).filter(Boolean);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateCompiledRubric(
  payload: Record<string, unknown>,
  fallbackPaperTitle: string,
): CompiledRubric {
  const paperTitle =
    readOptionalString(payload.paperTitle) ??
    readOptionalString(payload.title) ??
    fallbackPaperTitle;
  const totalMaxScore = asNumber(payload.totalMaxScore, 'totalMaxScore');
  const rawQuestions = payload.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error('questions 必须是非空数组。');
  }

  const seenQuestionIds = new Set<string>();
  const questions = rawQuestions.map((item, index) => {
    const question = asObject(item, `questions[${index}]`);
    const questionId = asString(question.questionId, `questions[${index}].questionId`);
    if (seenQuestionIds.has(questionId)) {
      throw new Error(`rubric 中存在重复题号：${questionId}`);
    }
    seenQuestionIds.add(questionId);

    const questionTitle = asString(question.questionTitle, `questions[${index}].questionTitle`);
    const maxScore = asNumber(question.maxScore, `questions[${index}].maxScore`);
    const answerSummary = asString(question.answerSummary, `questions[${index}].answerSummary`);
    const rawScoringPoints = question.scoringPoints;
    if (!Array.isArray(rawScoringPoints) || rawScoringPoints.length === 0) {
      throw new Error(`${questionId} 的 scoringPoints 不能为空。`);
    }

    const seenCriterionIds = new Set<string>();
    const scoringPoints = rawScoringPoints.map((point, pointIndex) => {
      const criterion = asObject(point, `${questionId}.scoringPoints[${pointIndex}]`);
      const criterionId = asString(
        criterion.criterionId ?? criterion.pointId,
        `${questionId}.scoringPoints[${pointIndex}].criterionId`,
      );
      if (seenCriterionIds.has(criterionId)) {
        throw new Error(`${questionId} 存在重复采分点编号：${criterionId}`);
      }
      seenCriterionIds.add(criterionId);
      return {
        criterionId,
        description: asString(
          criterion.description ?? criterion.pointDescription,
          `${questionId}.scoringPoints[${pointIndex}].description`,
        ),
        maxScore: asNumber(
          criterion.maxScore,
          `${questionId}.scoringPoints[${pointIndex}].maxScore`,
        ),
      };
    });

    const scoringPointTotal = Number(
      scoringPoints.reduce((sum, point) => sum + point.maxScore, 0).toFixed(2),
    );
    if (Math.abs(scoringPointTotal - maxScore) > 0.01) {
      throw new Error(`${questionId} 的采分点分值之和必须等于题目满分。`);
    }

    return {
      questionId,
      questionTitle,
      maxScore,
      answerSummary,
      scoringPoints,
    };
  });

  const calculatedTotal = Number(questions.reduce((sum, item) => sum + item.maxScore, 0).toFixed(2));
  if (Math.abs(calculatedTotal - totalMaxScore) > 0.01) {
    throw new Error('rubric.totalMaxScore 必须等于所有小题满分之和。');
  }

  return {
    paperTitle,
    totalMaxScore,
    questions,
  };
}

function validateScoreBreakdown(
  value: unknown,
  question: CompiledRubric['questions'][number],
): ScoreBreakdownItem[] {
  if (!Array.isArray(value) || value.length !== question.scoringPoints.length) {
    throw new Error(`${question.questionId}.scoreBreakdown 数量必须与 rubric 采分点完全一致。`);
  }

  const breakdown = value.map((item, index) => {
    const point = question.scoringPoints[index];
    const parsed = asObject(item, `${question.questionId}.scoreBreakdown[${index}]`);
    const criterionId = asString(
      parsed.criterionId,
      `${question.questionId}.scoreBreakdown[${index}].criterionId`,
    );
    if (criterionId !== point.criterionId) {
      throw new Error(`${question.questionId} 的第 ${index + 1} 个采分点编号不匹配。`);
    }

    const criterion = asString(
      parsed.criterion,
      `${question.questionId}.scoreBreakdown[${index}].criterion`,
    );
    if (criterion !== point.description) {
      throw new Error(`${question.questionId} 的第 ${index + 1} 个采分点描述不匹配。`);
    }

    const maxScore = asNumber(
      parsed.maxScore,
      `${question.questionId}.scoreBreakdown[${index}].maxScore`,
    );
    if (Math.abs(maxScore - point.maxScore) > 0.01) {
      throw new Error(`${question.questionId} 的第 ${index + 1} 个采分点满分不匹配。`);
    }

    const score = asNumber(parsed.score, `${question.questionId}.scoreBreakdown[${index}].score`);
    if (score < 0 || score > maxScore) {
      throw new Error(`${question.questionId} 的采分点得分超出范围。`);
    }

    const verdict = asString(
      parsed.verdict,
      `${question.questionId}.scoreBreakdown[${index}].verdict`,
    ) as ScoreBreakdownItem['verdict'];
    if (!['earned', 'partial', 'missed', 'unclear'].includes(verdict)) {
      throw new Error(`${question.questionId} 的采分点 verdict 非法。`);
    }

    return {
      criterionId,
      criterion,
      maxScore,
      score,
      verdict,
      evidence: asString(
        parsed.evidence,
        `${question.questionId}.scoreBreakdown[${index}].evidence`,
      ),
    };
  });

  return breakdown;
}

function resolveQuestionScore(
  rawScore: number,
  scoreBreakdown: ScoreBreakdownItem[],
  question: CompiledRubric['questions'][number],
): number {
  const breakdownScore = Number(scoreBreakdown.reduce((sum, point) => sum + point.score, 0).toFixed(2));
  if (Math.abs(rawScore - breakdownScore) > 0.01) {
    console.warn(
      `[grading] corrected question score for ${question.questionId}: raw=${rawScore}, breakdown=${breakdownScore}`,
    );
  }
  return breakdownScore;
}

function resolveTotalScore(rawTotalScore: number, questionScores: QuestionScore[]): number {
  const computedTotal = Number(questionScores.reduce((sum, question) => sum + question.score, 0).toFixed(2));
  if (Math.abs(rawTotalScore - computedTotal) > 0.01) {
    console.warn(
      `[grading] corrected total score: raw=${rawTotalScore}, computed=${computedTotal}`,
    );
  }
  return computedTotal;
}

export function validateModelResult(
  payload: Record<string, unknown>,
  rubric: CompiledRubric,
  drawRegions: boolean,
): ModelResult {
  const studentInfo = asObject(payload.studentInfo, 'studentInfo');
  const rawQuestionScores = payload.questionScores;
  if (!Array.isArray(rawQuestionScores) || rawQuestionScores.length !== rubric.questions.length) {
    throw new Error('questionScores 数量必须与固定 rubric 完全一致。');
  }

  const questionScores: QuestionScore[] = rawQuestionScores.map((item, index) => {
    const rawQuestion = asObject(item, `questionScores[${index}]`);
    const rubricQuestion = rubric.questions[index];
    const questionId = asString(rawQuestion.questionId, `questionScores[${index}].questionId`);
    if (questionId !== rubricQuestion.questionId) {
      throw new Error(`第 ${index + 1} 个题号必须是 ${rubricQuestion.questionId}。`);
    }

    const questionTitle = asString(
      rawQuestion.questionTitle,
      `questionScores[${index}].questionTitle`,
    );
    if (questionTitle !== rubricQuestion.questionTitle) {
      throw new Error(`${questionId} 的题目名称必须与 rubric 一致。`);
    }

    const maxScore = asNumber(rawQuestion.maxScore, `questionScores[${index}].maxScore`);
    if (Math.abs(maxScore - rubricQuestion.maxScore) > 0.01) {
      throw new Error(`${questionId} 的满分必须与 rubric 一致。`);
    }

    const rawScore = asNumber(rawQuestion.score, `questionScores[${index}].score`);
    const scoreBreakdown = validateScoreBreakdown(rawQuestion.scoreBreakdown, rubricQuestion);
    const score = resolveQuestionScore(rawScore, scoreBreakdown, rubricQuestion);

    return {
      questionId,
      questionTitle,
      maxScore,
      score,
      reasoning: asString(rawQuestion.reasoning, `questionScores[${index}].reasoning`),
      issues: asStringArray(rawQuestion.issues, `questionScores[${index}].issues`),
      scoreBreakdown,
    };
  });

  const rawTotalScore = asNumber(payload.totalScore, 'totalScore');
  const totalScore = resolveTotalScore(rawTotalScore, questionScores);

  const overallAdvice = asObject(payload.overallAdvice, 'overallAdvice');

  let questionRegions: QuestionRegion[] | undefined;
  if (drawRegions) {
    const rawRegions = payload.questionRegions;
    if (!Array.isArray(rawRegions)) {
      throw new Error('启用绘制批阅区域时必须返回 questionRegions 数组。');
    }
    questionRegions = rawRegions.map((item, index) => {
      const region = asObject(item, `questionRegions[${index}]`);
      const questionId = asString(region.questionId, `questionRegions[${index}].questionId`);
      if (!rubric.questions.some((question) => question.questionId === questionId)) {
        throw new Error(`questionRegions[${index}].questionId 不在 rubric 中。`);
      }
      const pageIndex = asNumber(region.pageIndex, `questionRegions[${index}].pageIndex`);
      const x = asNumber(region.x, `questionRegions[${index}].x`);
      const y = asNumber(region.y, `questionRegions[${index}].y`);
      const width = asNumber(region.width, `questionRegions[${index}].width`);
      const height = asNumber(region.height, `questionRegions[${index}].height`);
      for (const [field, value] of Object.entries({ x, y, width, height })) {
        if (value < 0 || value > 1) {
          throw new Error(`questionRegions[${index}].${field} 必须在 0 到 1 之间。`);
        }
      }
      return {
        questionId,
        pageIndex: Math.trunc(pageIndex),
        x,
        y,
        width,
        height,
      };
    });
  }

  return {
    studentInfo: {
      className: asString(studentInfo.className, 'studentInfo.className'),
      studentId: asString(studentInfo.studentId, 'studentInfo.studentId'),
      name: asString(studentInfo.name, 'studentInfo.name'),
    },
    questionScores,
    totalScore,
    overallComment: asString(payload.overallComment, 'overallComment'),
    overallAdvice: {
      summary: asString(overallAdvice.summary, 'overallAdvice.summary'),
      strengths: asStringArray(overallAdvice.strengths, 'overallAdvice.strengths'),
      priorityKnowledgePoints: asStringArray(
        overallAdvice.priorityKnowledgePoints,
        'overallAdvice.priorityKnowledgePoints',
      ),
      attentionPoints: asStringArray(
        overallAdvice.attentionPoints,
        'overallAdvice.attentionPoints',
      ),
      encouragement: asString(overallAdvice.encouragement, 'overallAdvice.encouragement'),
    } satisfies OverallAdvice,
    questionRegions,
  };
}

async function encodeImageAsDataUrl(imagePath: string): Promise<string> {
  const image = sharp(imagePath, { limitInputPixels: false }).rotate();
  const metadata = await image.metadata();
  const longestSide = Math.max(metadata.width ?? 0, metadata.height ?? 0);
  const resized =
    longestSide > 1800 ? image.resize({ width: 1800, height: 1800, fit: 'inside' }) : image;
  const buffer = await resized.jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

export class GradingService {
  constructor(
    private readonly projects: ProjectService,
    private readonly settingsService: SettingsService,
  ) {}

  async getRuntimeSettings(imageDetail: GradingServiceSettings['imageDetail']) {
    const validated = await this.settingsService.validateGenerationSettings();
    if (!validated.ok) {
      throw new Error(validated.message);
    }

    return {
      ...validated.settings,
      imageDetail,
      gradingTemperature: validated.settings.gradingTemperature,
    } satisfies GradingServiceSettings;
  }

  async getCompiledRubric(input: {
    projectId: string;
    projectName: string;
    projectRootPath: string;
    referenceAnswerVersion: number;
    referenceAnswerMarkdown: string;
    settings: GradingServiceSettings;
    signal?: AbortSignal;
    onLog?: (message: string) => void | Promise<void>;
  }): Promise<CompiledRubric> {
    const rubricPath = path.join(
      input.projectRootPath,
      'reference-answer',
      `rubric-v${input.referenceAnswerVersion}.json`,
    );
    const referenceAnswerFingerprint = getReferenceAnswerFingerprint(input.referenceAnswerMarkdown);

    if (await fs.pathExists(rubricPath)) {
      const existing = parseJsonObject(await fs.readFile(rubricPath, 'utf-8'));
      if (
        canReuseCompiledRubric(existing, {
          referenceAnswerVersion: input.referenceAnswerVersion,
          referenceAnswerMarkdown: input.referenceAnswerMarkdown,
        })
      ) {
        await input.onLog?.('检测到可复用的 rubric 缓存，跳过重新生成');
        return validateCompiledRubric(existing, input.projectName);
      }
    }

    ensureAbort(input.signal);
    const client = new OpenAI({
      apiKey: input.settings.apiKey,
      baseURL: input.settings.baseUrl,
      timeout: input.settings.timeoutMs,
    });
    const requestPayload = {
      model: input.settings.model,
      temperature: input.settings.gradingTemperature,
      reasoning_effort: input.settings.reasoningEffort,
      messages: [
        {
          role: 'system' as const,
          content: GRADING_RUBRIC_SYSTEM_PROMPT,
        },
        {
          role: 'user' as const,
          content: buildRubricCompilationUserPrompt({
            projectName: input.projectName,
            referenceAnswerVersion: input.referenceAnswerVersion,
            referenceAnswerMarkdown: input.referenceAnswerMarkdown,
          }),
        },
      ],
    };

    logLlmRequest('grading-rubric', {
      client: {
        baseURL: input.settings.baseUrl,
        model: input.settings.model,
        timeoutMs: input.settings.timeoutMs,
        apiKey: input.settings.apiKey,
        reasoningEffort: input.settings.reasoningEffort,
      },
      payload: requestPayload,
    });

    const startedAt = Date.now();
    let rawOutput = '';
    let parsedCandidate: Record<string, unknown> | null = null;
    let reasoningText = '';
    let mode: 'stream' | 'non-stream' = 'stream';
    try {
      await input.onLog?.('已发起 rubric 编译请求，准备接收流式输出');
      const response = await this.collectRubricResponseText({
        client,
        requestPayload,
        signal: input.signal,
        startedAtMs: startedAt,
        onLog: input.onLog,
      });
      ensureAbort(input.signal);
      rawOutput = response.rawText;
      reasoningText = response.reasoningText;
      mode = response.mode;
      parsedCandidate = parseJsonObject(rawOutput);
      const parsed = validateCompiledRubric(parsedCandidate, input.projectName);
      await fs.writeJson(
        rubricPath,
        {
          ...parsed,
          referenceAnswerVersion: input.referenceAnswerVersion,
          referenceAnswerFingerprint,
        },
        { spaces: 2 },
      );
      logLlmResult('grading-rubric', {
        status: 'success',
        detail: {
          latencyMs: Date.now() - startedAt,
          mode,
          rubricPath,
          questionCount: parsed.questions.length,
          reasoningTextLength: reasoningText.length,
          rawOutput: shortenText(rawOutput),
        },
      });
      return parsed;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      logLlmResult('grading-rubric', {
        status: 'error',
        detail: {
          latencyMs: Date.now() - startedAt,
          message: errorMessage,
          rawOutput: rawOutput ? shortenText(rawOutput) : '(empty)',
          parsedCandidate,
        },
      });
      throw new Error(
        `${errorMessage}\n模型原始返回：\n${rawOutput ? shortenText(rawOutput, 1200) : '(empty)'}`,
      );
    }
  }

  async gradePaper(input: {
    projectName: string;
    paper: PaperRecord;
    referenceAnswerVersion: number;
    referenceAnswerMarkdown: string;
    rubric: CompiledRubric;
    drawRegions: boolean;
    settings: GradingServiceSettings;
    signal?: AbortSignal;
    onLog?: (message: string) => void | Promise<void>;
  }): Promise<{
    modelResult: ModelResult;
    finalResult: FinalResult;
  }> {
    const scannedPages = input.paper.originalPages
      .map((page) => page.scannedPath)
      .filter((page): page is string => Boolean(page));
    if (scannedPages.length === 0) {
      throw new Error('该答卷还没有可用于批阅的扫描页。');
    }

    ensureAbort(input.signal);
    const imagePayloads = await Promise.all(scannedPages.map((imagePath) => encodeImageAsDataUrl(imagePath)));
    ensureAbort(input.signal);

    const requestPayload = {
      model: input.settings.model,
      temperature: input.settings.gradingTemperature,
      reasoning_effort: input.settings.reasoningEffort,
      messages: [
        {
          role: 'system' as const,
          content: buildGradingSystemPrompt(input.drawRegions),
        },
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: buildGradingUserPrompt({
                projectName: input.projectName,
                paperCode: input.paper.paperCode,
                imageNames: scannedPages.map((imagePath) => path.basename(imagePath)),
                referenceAnswerVersion: input.referenceAnswerVersion,
                referenceAnswerMarkdown: input.referenceAnswerMarkdown,
                rubric: input.rubric,
                drawRegions: input.drawRegions,
              }),
            },
            ...imagePayloads.map((imageUrl) => ({
              type: 'image_url' as const,
              image_url: {
                url: imageUrl,
                detail: input.settings.imageDetail,
              },
            })),
          ],
        },
      ],
    };

    logLlmRequest(`grading-paper:${input.paper.paperCode}`, {
      client: {
        baseURL: input.settings.baseUrl,
        model: input.settings.model,
        timeoutMs: input.settings.timeoutMs,
        apiKey: input.settings.apiKey,
        reasoningEffort: input.settings.reasoningEffort,
      },
      payload: requestPayload,
    });

    const startedAt = Date.now();
    const client = new OpenAI({
      apiKey: input.settings.apiKey,
      baseURL: input.settings.baseUrl,
      timeout: input.settings.timeoutMs,
    });
    const attempts = 3;
    let lastError: Error | null = null;
    let lastRawOutput = '';
    let lastParsedCandidate: Record<string, unknown> | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      ensureAbort(input.signal);
      try {
        lastRawOutput = await this.collectPaperResponseText({
          client,
          requestPayload,
          signal: input.signal,
          paperCode: input.paper.paperCode,
          startedAtMs: startedAt,
          attempt,
          onLog: input.onLog,
        });
        lastParsedCandidate = parseJsonObject(lastRawOutput);
        const modelResult = validateModelResult(lastParsedCandidate, input.rubric, input.drawRegions);
        logLlmResult(`grading-paper:${input.paper.paperCode}`, {
          status: 'success',
          detail: {
            latencyMs: Date.now() - startedAt,
            attempt,
            totalScore: modelResult.totalScore,
            rawOutput: shortenText(lastRawOutput),
          },
        });
        return {
          modelResult,
          finalResult: {
            ...modelResult,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('未知批阅错误');
        await input.onLog?.(`第 ${attempt} 次尝试失败：${buildAttemptFailureMessage(lastError, lastRawOutput)}`);
        if (attempt >= attempts || /已取消/.test(lastError.message)) {
          break;
        }
        await input.onLog?.(`准备开始第 ${attempt + 1} 次重试`);
      }
    }

    logLlmResult(`grading-paper:${input.paper.paperCode}`, {
      status: 'error',
      detail: {
        latencyMs: Date.now() - startedAt,
        message: lastError?.message ?? '未知批阅错误',
        rawOutput: lastRawOutput ? shortenText(lastRawOutput) : '(empty)',
        parsedCandidate: lastParsedCandidate,
      },
    });
    throw lastError ?? new Error('批阅失败');
  }

  private async collectPaperResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    signal?: AbortSignal;
    paperCode: string;
    startedAtMs: number;
    attempt: number;
    onLog?: (message: string) => void | Promise<void>;
  }): Promise<string> {
    try {
      logLlmProgress(`grading-paper:${input.paperCode}`, {
        attempt: input.attempt,
        mode: 'stream',
        status: 'start',
      });
      await input.onLog?.(`第 ${input.attempt} 次尝试，准备以流式模式接收批阅结果`);
      return await this.collectStreamingPaperResponseText(input);
    } catch (error) {
      if (!isStreamingFallbackCandidate(error)) {
        throw error;
      }

      logLlmProgress(`grading-paper:${input.paperCode}`, {
        attempt: input.attempt,
        mode: 'stream',
        status: 'fallback',
        reason: compactErrorMessage(error),
      });
      await input.onLog?.(`流式模式不可用，已回退普通请求：${compactErrorMessage(error)}`);
      return this.collectNonStreamingPaperResponseText(input);
    }
  }

  private async collectStreamingPaperResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    signal?: AbortSignal;
    paperCode: string;
    startedAtMs: number;
    attempt: number;
    onLog?: (message: string) => void | Promise<void>;
  }): Promise<string> {
    const stream = await input.client.chat.completions.create(
      {
        ...input.requestPayload,
        stream: true,
      },
      {
        signal: input.signal,
      },
    );

    let rawText = '';
    let reasoningText = '';
    let lastFlushedLength = 0;
    let lastReasoningFlushedLength = 0;
    let lastFlushAt = 0;

    for await (const chunk of stream) {
      ensureAbort(input.signal);
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
        rawText.length - lastFlushedLength >= 120 ||
        reasoningText.length - lastReasoningFlushedLength >= 160 ||
        now - lastFlushAt >= 1000;

      if (shouldFlush) {
        lastFlushedLength = rawText.length;
        lastReasoningFlushedLength = reasoningText.length;
        lastFlushAt = now;
        await this.logPaperStreamProgress(input.paperCode, {
          attempt: input.attempt,
          rawText,
          reasoningText,
          elapsedMs: now - input.startedAtMs,
          onLog: input.onLog,
        });
      }
    }

    await this.logPaperStreamProgress(input.paperCode, {
      attempt: input.attempt,
      rawText,
      reasoningText,
      elapsedMs: Date.now() - input.startedAtMs,
      done: true,
      onLog: input.onLog,
    });

    return rawText;
  }

  private async collectNonStreamingPaperResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    signal?: AbortSignal;
    paperCode: string;
    startedAtMs: number;
    attempt: number;
    onLog?: (message: string) => void | Promise<void>;
  }): Promise<string> {
    const response = await input.client.chat.completions.create(input.requestPayload, {
      signal: input.signal,
    });
    ensureAbort(input.signal);
    const rawText = readAssistantText(response);
    const reasoningText = extractReasoningText(response.choices[0]?.message);
    await this.logPaperStreamProgress(input.paperCode, {
      attempt: input.attempt,
      rawText,
      reasoningText,
      elapsedMs: Date.now() - input.startedAtMs,
      done: true,
      mode: 'non-stream',
      onLog: input.onLog,
    });
    return rawText;
  }

  private async logPaperStreamProgress(
    paperCode: string,
    input: {
      attempt: number;
      rawText: string;
      reasoningText: string;
      elapsedMs: number;
      done?: boolean;
      mode?: 'stream' | 'non-stream';
      onLog?: (message: string) => void | Promise<void>;
    },
  ): Promise<void> {
    const rawPreview = formatStreamPreview(input.rawText);
    const reasoningPreview = formatStreamPreview(input.reasoningText);
    const status = input.done ? 'done' : 'progress';
    const mode = input.mode ?? 'stream';
    logLlmProgress(`grading-paper:${paperCode}`, {
      attempt: input.attempt,
      mode,
      status,
      elapsedMs: input.elapsedMs,
      textChars: input.rawText.length,
      reasoningChars: input.reasoningText.length,
      textPreview: rawPreview,
      reasoningPreview,
    });
    if (input.onLog) {
      if (status === 'done') {
        await input.onLog(
          mode === 'non-stream'
            ? `已通过普通请求接收完整响应，正式输出 ${input.rawText.length} 字，推理 ${input.reasoningText.length} 字`
            : `流式接收完成，正式输出 ${input.rawText.length} 字，推理 ${input.reasoningText.length} 字`,
        );
      } else if (input.rawText.trim().length > 0) {
        await input.onLog(`正在接收结构化批阅结果，已接收 ${input.rawText.length} 字`);
      } else if (input.reasoningText.trim().length > 0) {
        await input.onLog(`模型正在思考，已接收 ${input.reasoningText.length} 字推理内容`);
      }
    }
  }

  private async collectRubricResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    signal?: AbortSignal;
    startedAtMs: number;
    onLog?: (message: string) => void | Promise<void>;
  }): Promise<{
    rawText: string;
    reasoningText: string;
    mode: 'stream' | 'non-stream';
  }> {
    try {
      logLlmProgress('grading-rubric', {
        mode: 'stream',
        status: 'start',
      });
      return await this.collectStreamingRubricResponseText(input);
    } catch (error) {
      if (!isStreamingFallbackCandidate(error)) {
        throw error;
      }

      logLlmProgress('grading-rubric', {
        mode: 'stream',
        status: 'fallback',
        reason: compactErrorMessage(error),
      });
      await input.onLog?.(`rubric 流式模式不可用，已回退普通请求：${compactErrorMessage(error)}`);
      return this.collectNonStreamingRubricResponseText(input);
    }
  }

  private async collectStreamingRubricResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    signal?: AbortSignal;
    startedAtMs: number;
    onLog?: (message: string) => void | Promise<void>;
  }): Promise<{
    rawText: string;
    reasoningText: string;
    mode: 'stream';
  }> {
    const stream = await input.client.chat.completions.create(
      {
        ...input.requestPayload,
        stream: true,
      },
      {
        signal: input.signal,
      },
    );

    let rawText = '';
    let reasoningText = '';
    let lastFlushedLength = 0;
    let lastReasoningFlushedLength = 0;
    let lastFlushAt = 0;

    for await (const chunk of stream) {
      ensureAbort(input.signal);
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
        now - lastFlushAt >= 1000;

      if (shouldFlush) {
        lastFlushedLength = rawText.length;
        lastReasoningFlushedLength = reasoningText.length;
        lastFlushAt = now;
        await this.logRubricStreamProgress({
          rawText,
          reasoningText,
          elapsedMs: now - input.startedAtMs,
          onLog: input.onLog,
        });
      }
    }

    await this.logRubricStreamProgress({
      rawText,
      reasoningText,
      elapsedMs: Date.now() - input.startedAtMs,
      done: true,
      onLog: input.onLog,
    });

    return {
      rawText,
      reasoningText,
      mode: 'stream',
    };
  }

  private async collectNonStreamingRubricResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    signal?: AbortSignal;
    startedAtMs: number;
    onLog?: (message: string) => void | Promise<void>;
  }): Promise<{
    rawText: string;
    reasoningText: string;
    mode: 'non-stream';
  }> {
    const response = await input.client.chat.completions.create(input.requestPayload, {
      signal: input.signal,
    });
    ensureAbort(input.signal);
    const rawText = readAssistantText(response);
    const reasoningText = extractReasoningText(response.choices[0]?.message);
    await this.logRubricStreamProgress({
      rawText,
      reasoningText,
      elapsedMs: Date.now() - input.startedAtMs,
      done: true,
      mode: 'non-stream',
      onLog: input.onLog,
    });
    return {
      rawText,
      reasoningText,
      mode: 'non-stream',
    };
  }

  private async logRubricStreamProgress(input: {
    rawText: string;
    reasoningText: string;
    elapsedMs: number;
    done?: boolean;
    mode?: 'stream' | 'non-stream';
    onLog?: (message: string) => void | Promise<void>;
  }): Promise<void> {
    const mode = input.mode ?? 'stream';
    const status = input.done ? 'done' : 'progress';
    logLlmProgress('grading-rubric', {
      mode,
      status,
      elapsedMs: input.elapsedMs,
      textChars: input.rawText.length,
      reasoningChars: input.reasoningText.length,
      textPreview: formatStreamPreview(input.rawText),
      reasoningPreview: formatStreamPreview(input.reasoningText),
    });

    if (!input.onLog) {
      return;
    }

    if (status === 'done') {
      await input.onLog(
        mode === 'non-stream'
          ? `rubric 普通请求已完成，正式输出 ${input.rawText.length} 字，推理 ${input.reasoningText.length} 字`
          : `rubric 流式接收完成，正式输出 ${input.rawText.length} 字，推理 ${input.reasoningText.length} 字`,
      );
      return;
    }

    if (input.rawText.trim().length > 0) {
      await input.onLog(`正在接收 rubric JSON，已接收 ${input.rawText.length} 字`);
      return;
    }

    if (input.reasoningText.trim().length > 0) {
      await input.onLog(`模型正在思考 rubric，已接收 ${input.reasoningText.length} 字推理内容`);
    }
  }

  async prepareProjectGrading(projectId: string) {
    const project = await this.projects.getProjectById(projectId);
    const referenceAnswerMarkdown = await this.projects.getReferenceAnswerMarkdown(projectId);
    const settings = await this.getRuntimeSettings(project.settings.defaultImageDetail);
    return {
      project,
      referenceAnswerMarkdown,
      settings,
    };
  }
}
