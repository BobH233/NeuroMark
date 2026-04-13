import path from 'node:path';
import vm from 'node:vm';
import fs from 'fs-extra';
import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type {
  ExecuteScorePostProcessInput,
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
import { ProjectService } from './projectService';

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

export class ScorePostProcessService {
  constructor(private readonly projects: ProjectService) {}

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
    const [project, results, papers, presets] = await Promise.all([
      this.projects.getProjectById(projectId),
      this.projects.listResults(projectId),
      this.projects.listProjectPapers(projectId),
      this.listPresets(),
    ]);
    const paperInputs = buildPaperData(results, papers);

    if (!paperInputs.length) {
      return {
        success: false,
        run: null,
        error: {
          phase: 'normalize',
          name: 'NoGradedPapersError',
          message: '当前项目还没有可用于分数后处理的已批阅答卷。',
          stack: '当前项目还没有可用于分数后处理的已批阅答卷。',
          lineNumber: null,
          columnNumber: null,
        },
      };
    }

    const preset = input.presetId
      ? (presets.find((item) => item.id === input.presetId) ?? null)
      : null;
    const logs: string[] = [];
    const collectedOutputs: ScriptOutputRow[] = [];
    const projectContext = deepFreeze(buildProjectContext(project));
    const frozenPapers = deepFreeze(
      paperInputs.map((paper) => ({
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
          collectedOutputs.push(
            ...(returnedValue.outputs as ScriptOutputRow[]),
          );
        } else if (returnedValue.outputs != null) {
          throw new Error('脚本返回的 outputs 必须是数组。');
        }
      }

      const normalizedResults = normalizeScriptOutputs(
        paperInputs,
        collectedOutputs,
      );
      const processedScores = normalizedResults.map(
        (item) => item.processedScore,
      );
      const originalScores = normalizedResults.map(
        (item) => item.originalScore,
      );
      const run: ScorePostProcessRunRecord = {
        id: `score-post-process-${nanoid(10)}`,
        projectId,
        scriptName: input.scriptName?.trim() || preset?.name || '临时脚本',
        presetId: preset?.id ?? null,
        presetName: preset?.name ?? null,
        presetSource: preset?.source ?? 'adhoc',
        scriptCode: input.scriptCode,
        createdAt: new Date().toISOString(),
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

      const latestRunPath = getLatestRunPath(project.rootPath);
      await fs.ensureDir(path.dirname(latestRunPath));
      await fs.writeJson(latestRunPath, buildStoredRunPayload(run), {
        spaces: 2,
      });

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
}
