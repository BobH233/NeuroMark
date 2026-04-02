import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type {
  NameMatchStatus,
  ResultRecord,
  SmartNameMatchDecision,
  SmartNameMatchDuplicateGroup,
  SmartNameMatchSnapshot,
  SmartNameMatchSuggestion,
  StudentInfo,
} from '@preload/contracts';
import { SMART_NAME_MATCH_SYSTEM_PROMPT } from '@main/prompts/smart-name-match/system';
import { buildSmartNameMatchUserPrompt } from '@main/prompts/smart-name-match/user';
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

type SmartNameMatchListener = (snapshot: SmartNameMatchSnapshot) => void;

const FENCED_JSON_PATTERN = /```(?:json)?\s*(\{[\s\S]*\})\s*```/i;
const STUDENT_INFO_FIELDS = ['className', 'studentId', 'name'] as const;

interface RawSuggestion {
  paperId?: unknown;
  paperCode?: unknown;
  decision?: unknown;
  confidence?: unknown;
  matchedRosterLine?: unknown;
  currentStudentInfo?: unknown;
  suggestedStudentInfo?: unknown;
  changedFields?: unknown;
  reason?: unknown;
  uncertaintyNotes?: unknown;
}

interface RawDuplicateGroup {
  paperIds?: unknown;
  paperCodes?: unknown;
  confidence?: unknown;
  reason?: unknown;
  evidence?: unknown;
}

function createEmptySnapshot(projectId: string): SmartNameMatchSnapshot {
  return {
    projectId,
    status: 'idle',
    rosterText: '',
    stage: null,
    reasoningText: '',
    previewText: '',
    errorMessage: null,
    result: null,
    updatedAt: new Date().toISOString(),
  };
}

function cloneSnapshot(snapshot: SmartNameMatchSnapshot): SmartNameMatchSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as SmartNameMatchSnapshot;
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

  return value.map((item, index) => asString(item, `${field}[${index}]`));
}

function normalizeDecision(value: unknown, field: string): SmartNameMatchDecision {
  if (
    value === 'certain_update' ||
    value === 'certain_keep' ||
    value === 'uncertain' ||
    value === 'no_match'
  ) {
    return value;
  }

  throw new Error(`${field} 非法。`);
}

function normalizeStudentInfo(
  value: unknown,
  field: string,
): StudentInfo | null {
  if (value == null) {
    return null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} 必须是对象或 null。`);
  }

  const candidate = value as Record<string, unknown>;
  return {
    className: typeof candidate.className === 'string' ? candidate.className.trim() : '',
    studentId: typeof candidate.studentId === 'string' ? candidate.studentId.trim() : '',
    name: typeof candidate.name === 'string' ? candidate.name.trim() : '',
  };
}

function normalizeChangedFields(value: unknown, field: string): Array<keyof StudentInfo> {
  if (!Array.isArray(value)) {
    throw new Error(`${field} 必须是数组。`);
  }

  return value
    .map((item, index) => asString(item, `${field}[${index}]`))
    .filter((item): item is keyof StudentInfo =>
      STUDENT_INFO_FIELDS.includes(item as keyof StudentInfo),
    );
}

function normalizeConfidence(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} 必须是数字。`);
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function buildSummary(suggestions: SmartNameMatchSuggestion[]) {
  return {
    totalPapers: suggestions.length,
    certainUpdateCount: suggestions.filter((item) => item.decision === 'certain_update').length,
    certainKeepCount: suggestions.filter((item) => item.decision === 'certain_keep').length,
    uncertainCount: suggestions.filter((item) => item.decision === 'uncertain').length,
    noMatchCount: suggestions.filter((item) => item.decision === 'no_match').length,
    duplicateGroupCount: 0,
  };
}

function mergeStudentInfo(
  base: StudentInfo,
  next: StudentInfo | null,
  changedFields: Array<keyof StudentInfo>,
): StudentInfo {
  if (!next) {
    return base;
  }

  const merged = { ...base };
  for (const field of changedFields) {
    merged[field] = next[field];
  }
  return merged;
}

export class SmartNameMatchService {
  private listeners = new Set<SmartNameMatchListener>();

  private snapshots = new Map<string, SmartNameMatchSnapshot>();

  constructor(
    private readonly projects: ProjectService,
    private readonly settings: SettingsService,
  ) {}

  onUpdated(listener: SmartNameMatchListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(projectId: string): SmartNameMatchSnapshot {
    return cloneSnapshot(this.snapshots.get(projectId) ?? createEmptySnapshot(projectId));
  }

  async start(projectId: string, rosterText: string): Promise<SmartNameMatchSnapshot> {
    const trimmedRosterText = rosterText.trim();
    if (!trimmedRosterText) {
      throw new Error('请先输入班级名册内容。');
    }

    const current = this.snapshots.get(projectId);
    if (current?.status === 'running') {
      throw new Error('智能核名正在进行中，请等待当前任务完成。');
    }

    const nextSnapshot: SmartNameMatchSnapshot = {
      projectId,
      status: 'running',
      rosterText: trimmedRosterText,
      stage: '正在整理名册与已批阅答卷',
      reasoningText: '',
      previewText: '',
      errorMessage: null,
      result: null,
      updatedAt: new Date().toISOString(),
    };
    this.setSnapshot(nextSnapshot);

    void this.run(projectId, trimmedRosterText);
    return cloneSnapshot(nextSnapshot);
  }

  async applyCertainSuggestions(projectId: string): Promise<string[]> {
    const snapshot = this.snapshots.get(projectId);
    if (!snapshot || snapshot.status !== 'completed' || !snapshot.result) {
      throw new Error('当前还没有可应用的智能核名结果。');
    }

    const applicable = snapshot.result.suggestions.filter(
      (item) => item.decision === 'certain_update' || item.decision === 'certain_keep',
    );
    if (applicable.length === 0) {
      throw new Error('当前没有 100% 确定的核名方案可应用。');
    }

    const updatedPaperIds: string[] = [];

    for (const suggestion of applicable) {
      const current = await this.projects.getResult(projectId, suggestion.paperId);
      if (!current?.finalResult) {
        continue;
      }

      const nextResult = JSON.parse(JSON.stringify(current.finalResult)) as NonNullable<
        ResultRecord['finalResult']
      >;
      nextResult.studentInfo = mergeStudentInfo(
        nextResult.studentInfo,
        suggestion.suggestedStudentInfo,
        suggestion.changedFields,
      );

      await this.projects.saveFinalResult(projectId, suggestion.paperId, nextResult, {
        nameMatchStatus: 'verified',
        nameMatchSource: 'smart-name-llm',
        nameMatchUpdatedAt: new Date().toISOString(),
      });
      updatedPaperIds.push(suggestion.paperId);
    }

    const nextSnapshot = cloneSnapshot(snapshot);
    nextSnapshot.stage = `已应用 ${updatedPaperIds.length} 份 100% 确定的核名结果`;
    nextSnapshot.updatedAt = new Date().toISOString();
    this.setSnapshot(nextSnapshot);

    return updatedPaperIds;
  }

  private async run(projectId: string, rosterText: string): Promise<void> {
    try {
      const settings = await this.settings.getSettings();
      if (!settings.apiKey.trim()) {
        throw new Error('尚未配置 LLM API Key，请先到设置页完成配置。');
      }

      const detail = await this.projects.getProjectDetail(projectId);
      const results = detail.results.filter(
        (
          item,
        ): item is ResultRecord & {
          finalResult: NonNullable<ResultRecord['finalResult']>;
          modelResult: NonNullable<ResultRecord['modelResult']>;
        } => Boolean(item.finalResult && item.modelResult),
      );

      if (results.length === 0) {
        throw new Error('当前项目还没有已批阅完成的答卷。');
      }

      this.patchSnapshot(projectId, {
        stage: `正在向模型提交 ${results.length} 份答卷的核名请求`,
      });

      const requestPayload: ChatCompletionCreateParamsNonStreaming = {
        model: settings.model,
        temperature: settings.gradingTemperature,
        reasoning_effort: settings.reasoningEffort,
        messages: [
          {
            role: 'system',
            content: SMART_NAME_MATCH_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: buildSmartNameMatchUserPrompt({
              rosterText,
              results,
            }),
          },
        ],
      };

      logLlmRequest(`smart-name-match:${projectId}`, {
        client: {
          baseURL: settings.baseUrl,
          model: settings.model,
          timeoutMs: settings.timeoutMs,
        },
        apiKey: settings.apiKey,
        reasoningEffort: settings.reasoningEffort,
        gradingTemperature: settings.gradingTemperature,
        payload: requestPayload,
      });

      const client = new OpenAI({
        apiKey: settings.apiKey,
        baseURL: settings.baseUrl,
        timeout: settings.timeoutMs,
      });

      const rawText = await this.collectModelResponseText({
        client,
        requestPayload,
        projectId,
      });
      const parsed = this.parseSuggestions(rawText, results);

      this.patchSnapshot(projectId, {
        status: 'completed',
        stage: `已生成 ${parsed.summary.certainUpdateCount + parsed.summary.certainKeepCount} 条确定建议，等待确认`,
        errorMessage: null,
        result: parsed,
      });

      logLlmResult(`smart-name-match:${projectId}`, {
        status: 'success',
        detail: {
          suggestionCount: parsed.suggestions.length,
          summary: parsed.summary,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.patchSnapshot(projectId, {
        status: 'failed',
        stage: '智能核名失败',
        errorMessage: message,
      });
      logLlmResult(`smart-name-match:${projectId}`, {
        status: 'error',
        detail: {
          message,
        },
      });
    }
  }

  private async collectModelResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    projectId: string;
  }): Promise<string> {
    try {
      return await this.collectStreamingResponseText(input);
    } catch (error) {
      if (!isStreamingFallbackCandidate(error)) {
        throw error;
      }

      this.patchSnapshot(input.projectId, {
        stage: `流式模式不可用，已切换为普通请求：${compactErrorMessage(error)}`,
      });
      return this.collectNonStreamingResponseText(input);
    }
  }

  private async collectStreamingResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    projectId: string;
  }): Promise<string> {
    const stream = await input.client.chat.completions.create({
      ...input.requestPayload,
      stream: true,
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
        this.patchSnapshot(input.projectId, {
          stage: rawText.trim().length > 0 ? '正在接收模型输出草稿' : '模型正在推理',
          previewText: rawText,
          reasoningText,
        });
      }
    }

    this.patchSnapshot(input.projectId, {
      previewText: rawText,
      reasoningText,
    });

    return rawText;
  }

  private async collectNonStreamingResponseText(input: {
    client: OpenAI;
    requestPayload: ChatCompletionCreateParamsNonStreaming;
    projectId: string;
  }): Promise<string> {
    const response = await input.client.chat.completions.create(input.requestPayload);
    const rawText = readAssistantText(response);
    const reasoningText = extractReasoningText(response.choices[0]?.message);

    this.patchSnapshot(input.projectId, {
      previewText: rawText,
      reasoningText,
      stage: '模型已返回完整结果，正在解析',
    });

    return rawText;
  }

  private parseSuggestions(
    rawText: string,
    results: Array<
      ResultRecord & {
        finalResult: NonNullable<ResultRecord['finalResult']>;
        modelResult: NonNullable<ResultRecord['modelResult']>;
      }
    >,
  ) {
    const parsed = parseJsonObject(rawText);
    const rawSuggestions = parsed.suggestions;
    if (!Array.isArray(rawSuggestions)) {
      throw new Error('模型返回缺少 suggestions 数组。');
    }

    const resultMap = new Map(results.map((item) => [item.paperId, item]));
    const suggestions: SmartNameMatchSuggestion[] = rawSuggestions.map((item, index) => {
      const candidate = item as RawSuggestion;
      const paperId = asString(candidate.paperId, `suggestions[${index}].paperId`);
      const result = resultMap.get(paperId);
      if (!result) {
        throw new Error(`模型返回了未知 paperId：${paperId}`);
      }

      const decision = normalizeDecision(
        candidate.decision,
        `suggestions[${index}].decision`,
      );
      const confidence = normalizeConfidence(
        candidate.confidence,
        `suggestions[${index}].confidence`,
      );
      const currentStudentInfo =
        normalizeStudentInfo(
          candidate.currentStudentInfo,
          `suggestions[${index}].currentStudentInfo`,
        ) ?? result.finalResult.studentInfo;
      const suggestedStudentInfo = normalizeStudentInfo(
        candidate.suggestedStudentInfo,
        `suggestions[${index}].suggestedStudentInfo`,
      );
      const changedFields = normalizeChangedFields(
        candidate.changedFields,
        `suggestions[${index}].changedFields`,
      );
      const matchedRosterLine =
        typeof candidate.matchedRosterLine === 'string'
          ? candidate.matchedRosterLine.trim()
          : null;
      const reason = asString(candidate.reason, `suggestions[${index}].reason`);
      const uncertaintyNotes = Array.isArray(candidate.uncertaintyNotes)
        ? asStringArray(candidate.uncertaintyNotes, `suggestions[${index}].uncertaintyNotes`)
        : [];

      if ((decision === 'certain_update' || decision === 'certain_keep') && confidence !== 1) {
        throw new Error(`${paperId} 被标记为确定修改，但 confidence 不是 1。`);
      }

      if (decision === 'certain_keep' && changedFields.length > 0) {
        throw new Error(`${paperId} 被标记为 certain_keep 时 changedFields 必须为空。`);
      }

      return {
        paperId,
        paperCode: asString(candidate.paperCode, `suggestions[${index}].paperCode`) || result.paperId,
        currentStudentInfo,
        suggestedStudentInfo,
        decision,
        confidence,
        changedFields,
        matchedRosterLine,
        reason,
        uncertaintyNotes,
      };
    });

    const suggestionMap = new Map(suggestions.map((item) => [item.paperId, item]));
    const completedSuggestions = results.map((item) => {
      return (
        suggestionMap.get(item.paperId) ?? {
          paperId: item.paperId,
          paperCode: item.paperId,
          currentStudentInfo: item.finalResult.studentInfo,
          suggestedStudentInfo: null,
          decision: 'no_match' as const,
          confidence: 0,
          changedFields: [],
          matchedRosterLine: null,
          reason: '模型没有返回该答卷的核名结论。',
          uncertaintyNotes: ['返回结果缺失，需要人工确认。'],
        }
      );
    });

    const duplicateGroups = this.parseDuplicateGroups(parsed.duplicateGroups, results);
    const summary = buildSummary(completedSuggestions);
    summary.duplicateGroupCount = duplicateGroups.length;

    return {
      summary,
      suggestions: completedSuggestions,
      duplicateGroups,
    };
  }

  private parseDuplicateGroups(
    value: unknown,
    results: Array<
      ResultRecord & {
        finalResult: NonNullable<ResultRecord['finalResult']>;
        modelResult: NonNullable<ResultRecord['modelResult']>;
      }
    >,
  ): SmartNameMatchDuplicateGroup[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const validPaperIds = new Set(results.map((item) => item.paperId));
    return value
      .map((item, index) => {
        const candidate = item as RawDuplicateGroup;
        const paperIds = asStringArray(candidate.paperIds, `duplicateGroups[${index}].paperIds`)
          .filter((paperId) => validPaperIds.has(paperId));
        const paperCodes = Array.isArray(candidate.paperCodes)
          ? asStringArray(candidate.paperCodes, `duplicateGroups[${index}].paperCodes`)
          : paperIds;
        if (paperIds.length < 2) {
          return null;
        }

        return {
          paperIds,
          paperCodes: paperCodes.length === paperIds.length ? paperCodes : paperIds,
          confidence: normalizeConfidence(
            candidate.confidence,
            `duplicateGroups[${index}].confidence`,
          ),
          reason: asString(candidate.reason, `duplicateGroups[${index}].reason`),
          evidence: Array.isArray(candidate.evidence)
            ? asStringArray(candidate.evidence, `duplicateGroups[${index}].evidence`)
            : [],
        };
      })
      .filter((item): item is SmartNameMatchDuplicateGroup => Boolean(item));
  }

  private setSnapshot(snapshot: SmartNameMatchSnapshot): void {
    this.snapshots.set(snapshot.projectId, cloneSnapshot(snapshot));
    const payload = cloneSnapshot(snapshot);
    for (const listener of this.listeners) {
      listener(payload);
    }
  }

  private patchSnapshot(
    projectId: string,
    patch: Partial<SmartNameMatchSnapshot>,
  ): void {
    const current = this.snapshots.get(projectId) ?? createEmptySnapshot(projectId);
    this.setSnapshot({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }
}
