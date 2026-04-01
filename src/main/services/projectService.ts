import path from 'node:path';
import fs from 'fs-extra';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type {
  CreateProjectValidationResult,
  CreateProjectInput,
  FinalResult,
  ModelResult,
  PaperPage,
  PaperRecord,
  ProjectDetail,
  ProjectMeta,
  ProjectSettings,
  ProjectStats,
  ResultRecord,
  ProjectRubricDebug,
} from '@preload/contracts';
import { getDatabase } from '@main/database/client';
import {
  paperRecordsTable,
  projectsTable,
  resultRecordsTable,
  tasksTable,
} from '@main/database/schema';
import { processDocumentImage } from './documentScanService';

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.bmp',
  '.tif',
  '.tiff',
  '.webp',
  '.svg',
]);

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  gradingConcurrency: 1,
  drawRegions: false,
  defaultImageDetail: 'high',
  enableScanPostProcess: true,
};

function createEmptyStats(): ProjectStats {
  return {
    importedPaperCount: 0,
    scannedPaperCount: 0,
    gradedPaperCount: 0,
    averageScore: 0,
    pageCount: 0,
    lastTaskSummary: '尚未启动任务',
  };
}

function toSafeFolderName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-');
}

function normalizeProjectName(name: string): string {
  return name.trim();
}

function getProjectTargetRootPath(basePath: string, projectName: string): string {
  return path.join(basePath, toSafeFolderName(projectName));
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function normalizeProjectSettings(
  settings?: Partial<ProjectSettings> | null,
): ProjectSettings {
  return {
    gradingConcurrency:
      settings?.gradingConcurrency ?? DEFAULT_PROJECT_SETTINGS.gradingConcurrency,
    drawRegions: settings?.drawRegions ?? DEFAULT_PROJECT_SETTINGS.drawRegions,
    defaultImageDetail:
      settings?.defaultImageDetail ?? DEFAULT_PROJECT_SETTINGS.defaultImageDetail,
    enableScanPostProcess:
      settings?.enableScanPostProcess ?? DEFAULT_PROJECT_SETTINGS.enableScanPostProcess,
  };
}

function getProjectStructure(rootPath: string) {
  return {
    rootPath,
    originalsDir: path.join(rootPath, 'originals'),
    scannedDir: path.join(rootPath, 'scanned'),
    scanDebugDir: path.join(rootPath, 'scan-debug'),
    referenceDir: path.join(rootPath, 'reference-answer'),
    resultsDir: path.join(rootPath, 'results'),
    exportsDir: path.join(rootPath, 'exports'),
    projectJsonPath: path.join(rootPath, 'project.json'),
    referenceAnswerPath: path.join(
      rootPath,
      'reference-answer',
      'answer_and_score_rule.md',
    ),
  };
}

async function getFileVersion(filePath: string): Promise<number | undefined> {
  if (!(await fs.pathExists(filePath))) {
    return undefined;
  }

  const stats = await fs.stat(filePath);
  return Math.trunc(stats.mtimeMs);
}

async function ensureProjectDirectories(rootPath: string): Promise<void> {
  const structure = getProjectStructure(rootPath);
  await Promise.all([
    fs.ensureDir(structure.originalsDir),
    fs.ensureDir(structure.scannedDir),
    fs.ensureDir(structure.scanDebugDir),
    fs.ensureDir(structure.referenceDir),
    fs.ensureDir(structure.resultsDir),
    fs.ensureDir(structure.exportsDir),
  ]);
}

async function writeProjectManifest(project: ProjectMeta): Promise<void> {
  const structure = getProjectStructure(project.rootPath);
  await fs.writeJson(
    structure.projectJsonPath,
    {
      id: project.id,
      name: project.name,
      referenceAnswerVersion: project.referenceAnswerVersion,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      settings: project.settings,
    },
    { spaces: 2 },
  );
}

function toProjectMeta(
  row: typeof projectsTable.$inferSelect,
): ProjectMeta {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.rootPath,
    referenceAnswerVersion: row.referenceAnswerVersion ?? 1,
    stats: parseJson<ProjectStats>(row.statsJson),
    settings: normalizeProjectSettings(parseJson<Partial<ProjectSettings>>(row.settingsJson)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isSupportedImage(filePath: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function listSortedFiles(targetDir: string): Promise<string[]> {
  if (!(await fs.pathExists(targetDir))) {
    return [];
  }

  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(targetDir, entry.name))
    .filter(isSupportedImage)
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

async function listSortedSubDirectories(targetDir: string): Promise<string[]> {
  if (!(await fs.pathExists(targetDir))) {
    return [];
  }

  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

function normalizeResultPayload(payload: unknown): {
  status: ResultRecord['status'];
  errorMessage?: string | null;
  modelResult: ModelResult;
  finalResult: FinalResult;
  referenceAnswerVersion: number;
} | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const status =
    candidate.status === 'processing' || candidate.status === 'failed' || candidate.status === 'completed'
      ? candidate.status
      : 'completed';
  const errorMessage =
    typeof candidate.errorMessage === 'string' ? candidate.errorMessage : null;
  if (candidate.modelResult && candidate.finalResult) {
    const referenceAnswerVersion =
      typeof candidate.referenceAnswerVersion === 'number' &&
      Number.isFinite(candidate.referenceAnswerVersion) &&
      candidate.referenceAnswerVersion > 0
        ? Math.trunc(candidate.referenceAnswerVersion)
        : 1;
    return {
      status,
      errorMessage,
      modelResult: candidate.modelResult as ModelResult,
      finalResult: candidate.finalResult as FinalResult,
      referenceAnswerVersion,
    };
  }

  if (candidate.studentInfo || candidate.student_info) {
    const legacy = candidate as Record<string, any>;
    const studentInfo = legacy.studentInfo ?? legacy.student_info;
    const questionScores = legacy.questionScores ?? legacy.question_scores ?? [];
    const totalScore = legacy.totalScore ?? legacy.total_score ?? 0;
    const overallComment = legacy.overallComment ?? legacy.overall_comment ?? '';
    const questionRegions = legacy.questionRegions ?? legacy.question_regions;

    const modelResult: ModelResult = {
      studentInfo: {
        className: studentInfo.className ?? studentInfo.class_name ?? '',
        studentId: studentInfo.studentId ?? studentInfo.student_id ?? '',
        name: studentInfo.name ?? '',
      },
      questionScores: questionScores.map((item: Record<string, any>) => ({
        questionId: item.questionId ?? item.question_id ?? '',
        questionTitle: item.questionTitle ?? item.question_title ?? '',
        maxScore: Number(item.maxScore ?? item.max_score ?? 0),
        score: Number(item.score ?? 0),
        reasoning: String(item.reasoning ?? ''),
        issues: Array.isArray(item.issues) ? item.issues.map((issue) => String(issue)) : [],
        scoreBreakdown: Array.isArray(item.scoreBreakdown)
          ? item.scoreBreakdown.map((point: Record<string, any>) => ({
              criterionId: String(point.criterionId ?? ''),
              criterion: String(point.criterion ?? ''),
              maxScore: Number(point.maxScore ?? 0),
              score: Number(point.score ?? 0),
              verdict:
                point.verdict === 'earned' ||
                point.verdict === 'partial' ||
                point.verdict === 'missed' ||
                point.verdict === 'unclear'
                  ? point.verdict
                  : 'partial',
              evidence: String(point.evidence ?? ''),
            }))
          : [],
      })),
      totalScore: Number(totalScore),
      overallComment: String(overallComment),
      overallAdvice: {
        summary: String(legacy.overallAdvice?.summary ?? legacy.overall_advice?.summary ?? ''),
        strengths: Array.isArray(legacy.overallAdvice?.strengths ?? legacy.overall_advice?.strengths)
          ? (legacy.overallAdvice?.strengths ?? legacy.overall_advice?.strengths).map((item: unknown) => String(item))
          : [],
        priorityKnowledgePoints: Array.isArray(
          legacy.overallAdvice?.priorityKnowledgePoints ?? legacy.overall_advice?.priority_knowledge_points,
        )
          ? (
              legacy.overallAdvice?.priorityKnowledgePoints ??
              legacy.overall_advice?.priority_knowledge_points
            ).map((item: unknown) => String(item))
          : [],
        attentionPoints: Array.isArray(
          legacy.overallAdvice?.attentionPoints ?? legacy.overall_advice?.attention_points,
        )
          ? (legacy.overallAdvice?.attentionPoints ?? legacy.overall_advice?.attention_points).map((item: unknown) =>
              String(item),
            )
          : [],
        encouragement: String(
          legacy.overallAdvice?.encouragement ?? legacy.overall_advice?.encouragement ?? '',
        ),
      },
      questionRegions: Array.isArray(questionRegions)
        ? questionRegions.map((item: Record<string, any>) => ({
            questionId: item.questionId ?? item.question_id ?? '',
            pageIndex: Number(item.pageIndex ?? item.page_index ?? 0),
            x: Number(item.x ?? 0),
            y: Number(item.y ?? 0),
            width: Number(item.width ?? 0),
            height: Number(item.height ?? 0),
          }))
        : undefined,
    };

    return {
      status: 'completed',
      errorMessage: null,
      modelResult,
      finalResult: {
        ...modelResult,
      },
      referenceAnswerVersion: 1,
    };
  }

  return null;
}

function getFileNameWithoutExtension(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function getResultFilePath(rootPath: string, paperId: string): string {
  return path.join(getProjectStructure(rootPath).resultsDir, `${paperId}.json`);
}

interface PaperGradingSnapshot {
  status: PaperRecord['gradingStatus'];
  referenceAnswerVersion?: number;
  updatedAt?: string;
  errorMessage?: string | null;
}

function getPaperPageAssetPaths(
  rootPath: string,
  paperCode: string,
  originalPath: string,
) {
  const structure = getProjectStructure(rootPath);
  const baseName = getFileNameWithoutExtension(originalPath);
  return {
    scannedPath: path.join(structure.scannedDir, paperCode, `${baseName}.png`),
    debugPreviewPath: path.join(structure.scanDebugDir, paperCode, `${baseName}_debug.jpg`),
    cornersPath: path.join(structure.scanDebugDir, paperCode, `${baseName}.json`),
  };
}

function extractPaperCode(stem: string): string {
  const patterns = [
    /^(?<base>.+?)[\s_-]+(?<page>[1-9]\d{0,2})$/i,
    /^(?<base>.+?)[\s_-]+p(?:age)?[\s_-]*(?<page>[1-9]\d{0,2})$/i,
    /^(?<base>.+?)第(?<page>[1-9]\d{0,2})[页面张]?$/i,
  ];

  for (const pattern of patterns) {
    const matched = stem.match(pattern);
    const base = matched?.groups?.base?.trim().replace(/[\s_-]+$/, '');
    if (base) {
      return base;
    }
  }

  return stem.trim();
}

function buildGroupedImportMap(filePaths: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const filePath of filePaths) {
    const stem = getFileNameWithoutExtension(filePath);
    const paperCode = extractPaperCode(stem);
    const list = groups.get(paperCode) ?? [];
    list.push(filePath);
    groups.set(paperCode, list);
  }

  for (const [paperCode, files] of groups.entries()) {
    files.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
    groups.set(paperCode, files);
  }

  return groups;
}

function inferScanStatus(pages: PaperPage[]): PaperRecord['scanStatus'] {
  if (pages.length === 0) {
    return 'pending';
  }
  const completedCount = pages.filter((page) => page.scannedPath).length;
  if (completedCount === 0) {
    return 'pending';
  }
  if (completedCount === pages.length) {
    return 'completed';
  }
  return 'processing';
}

export class ProjectService {
  async ensureSeedData(): Promise<void> {
    return;
  }

  async getReferenceAnswerMarkdown(projectId: string): Promise<string> {
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    if (!(await fs.pathExists(structure.referenceAnswerPath))) {
      return '';
    }
    return fs.readFile(structure.referenceAnswerPath, 'utf-8');
  }

  async getProjectRubricDebug(projectId: string): Promise<ProjectRubricDebug> {
    const project = await this.getProjectById(projectId);
    const rubricPath = path.join(
      project.rootPath,
      'reference-answer',
      `rubric-v${project.referenceAnswerVersion}.json`,
    );
    const exists = await fs.pathExists(rubricPath);

    if (!exists) {
      return {
        projectId,
        referenceAnswerVersion: project.referenceAnswerVersion,
        rubricPath,
        exists: false,
        updatedAt: null,
        rubricJson: '',
        rubricData: null,
      };
    }

    const [rubricJson, stat] = await Promise.all([
      fs.readFile(rubricPath, 'utf-8'),
      fs.stat(rubricPath),
    ]);

    try {
      return {
        projectId,
        referenceAnswerVersion: project.referenceAnswerVersion,
        rubricPath,
        exists: true,
        updatedAt: stat.mtime.toISOString(),
        rubricJson,
        rubricData: JSON.parse(rubricJson) as unknown,
      };
    } catch {
      return {
        projectId,
        referenceAnswerVersion: project.referenceAnswerVersion,
        rubricPath,
        exists: true,
        updatedAt: stat.mtime.toISOString(),
        rubricJson,
        rubricData: null,
      };
    }
  }

  async listProjects(): Promise<ProjectMeta[]> {
    const db = getDatabase();
    return db
      .select()
      .from(projectsTable)
      .orderBy(desc(projectsTable.createdAt))
      .all()
      .map(toProjectMeta);
  }

  async getProjectById(projectId: string): Promise<ProjectMeta> {
    const db = getDatabase();
    const row = db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .get();

    if (!row) {
      throw new Error('未找到项目。');
    }

    return toProjectMeta(row);
  }

  async validateCreateProject(
    input: Pick<CreateProjectInput, 'name' | 'basePath'>,
  ): Promise<CreateProjectValidationResult> {
    const projectName = normalizeProjectName(input.name);
    const basePath = input.basePath.trim();
    const targetRootPath = getProjectTargetRootPath(basePath, projectName);
    const hasProjectManifest = await fs.pathExists(path.join(targetRootPath, 'project.json'));

    return {
      available: !hasProjectManifest,
      message: hasProjectManifest ? '该目录下已经存在同名项目。' : null,
      targetRootPath,
    };
  }

  async createProject(input: CreateProjectInput): Promise<ProjectMeta> {
    const db = getDatabase();
    const now = new Date().toISOString();
    const projectName = normalizeProjectName(input.name);
    const targetRootPath = getProjectTargetRootPath(input.basePath, projectName);
    const projectId = projectName ? `${Date.now()}-${toSafeFolderName(projectName)}` : `${Date.now()}`;
    const settings: ProjectSettings = {
      ...normalizeProjectSettings(input),
    };

    if (await fs.pathExists(path.join(targetRootPath, 'project.json'))) {
      throw new Error('该目录下已经存在同名项目。');
    }

    await ensureProjectDirectories(targetRootPath);
    const structure = getProjectStructure(targetRootPath);
    if (!(await fs.pathExists(structure.referenceAnswerPath))) {
      await fs.writeFile(
        structure.referenceAnswerPath,
        '# 请在此填写参考答案与评分标准\n',
        'utf-8',
      );
    }

    const project: ProjectMeta = {
      id: projectId,
      name: projectName,
      rootPath: targetRootPath,
      referenceAnswerVersion: 1,
      createdAt: now,
      updatedAt: now,
      stats: createEmptyStats(),
      settings,
    };

    db.insert(projectsTable)
      .values({
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        referenceAnswerVersion: project.referenceAnswerVersion,
        statsJson: JSON.stringify(project.stats),
        settingsJson: JSON.stringify(project.settings),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })
      .run();

    await writeProjectManifest(project);
    return this.recomputeStats(project.id);
  }

  async updateProjectName(projectId: string, name: string): Promise<ProjectMeta> {
    const db = getDatabase();
    const current = await this.getProjectById(projectId);
    const nextName = normalizeProjectName(name);

    if (current.name === nextName) {
      return current;
    }

    const updatedAt = new Date().toISOString();
    db.update(projectsTable)
      .set({
        name: nextName,
        updatedAt,
      })
      .where(eq(projectsTable.id, projectId))
      .run();
    db.update(tasksTable)
      .set({
        projectName: nextName,
        updatedAt,
      })
      .where(eq(tasksTable.projectId, projectId))
      .run();

    const updated: ProjectMeta = {
      ...current,
      name: nextName,
      updatedAt,
    };
    await writeProjectManifest(updated);
    return updated;
  }

  async updateProjectSettings(
    projectId: string,
    settings: ProjectSettings,
  ): Promise<ProjectMeta> {
    const db = getDatabase();
    const current = await this.getProjectById(projectId);
    const updatedAt = new Date().toISOString();
    const normalizedSettings = normalizeProjectSettings(settings);

    db.update(projectsTable)
      .set({
        settingsJson: JSON.stringify(normalizedSettings),
        updatedAt,
      })
      .where(eq(projectsTable.id, projectId))
      .run();

    const updated: ProjectMeta = {
      ...current,
      settings: normalizedSettings,
      updatedAt,
    };
    await writeProjectManifest(updated);
    return updated;
  }

  async updateReferenceAnswer(
    projectId: string,
    markdown: string,
  ): Promise<ProjectMeta> {
    const db = getDatabase();
    const current = await this.getProjectById(projectId);
    const structure = getProjectStructure(current.rootPath);
    const nextMarkdown = markdown.trim();
    const currentMarkdown = (await fs.pathExists(structure.referenceAnswerPath))
      ? (await fs.readFile(structure.referenceAnswerPath, 'utf-8')).trim()
      : '';

    if (currentMarkdown === nextMarkdown) {
      return current;
    }

    await fs.writeFile(structure.referenceAnswerPath, `${nextMarkdown}\n`, 'utf-8');

    const updatedAt = new Date().toISOString();
    const referenceAnswerVersion = current.referenceAnswerVersion + 1;
    db.update(projectsTable)
      .set({
        referenceAnswerVersion,
        updatedAt,
      })
      .where(eq(projectsTable.id, projectId))
      .run();

    const updated: ProjectMeta = {
      ...current,
      referenceAnswerVersion,
      updatedAt,
    };
    await writeProjectManifest(updated);
    return updated;
  }

  async deleteProject(projectId: string): Promise<void> {
    const db = getDatabase();
    const project = await this.getProjectById(projectId);

    await fs.remove(project.rootPath);

    db.delete(resultRecordsTable)
      .where(eq(resultRecordsTable.projectId, projectId))
      .run();
    db.delete(paperRecordsTable)
      .where(eq(paperRecordsTable.projectId, projectId))
      .run();
    db.delete(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .run();
  }

  async removePaper(projectId: string, paperId: string): Promise<ProjectDetail> {
    const db = getDatabase();
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    const papers = await this.listProjectPapers(projectId);
    const targetPaper = papers.find((paper) => paper.id === paperId || paper.paperCode === paperId);

    if (!targetPaper) {
      throw new Error('未找到要移除的试卷。');
    }

    const activeTask = db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.projectId, projectId),
          isNull(tasksTable.archivedAt),
        ),
      )
      .all()
      .find((task) => ['queued', 'running', 'paused'].includes(task.status));

    if (activeTask) {
      throw new Error('当前项目还有进行中的后台任务，请先停止或等待任务完成后再移除试卷。');
    }

    await Promise.all([
      fs.remove(path.join(structure.originalsDir, targetPaper.paperCode)),
      fs.remove(path.join(structure.scannedDir, targetPaper.paperCode)),
      fs.remove(path.join(structure.scanDebugDir, targetPaper.paperCode)),
      fs.remove(path.join(structure.resultsDir, `${targetPaper.paperCode}.json`)),
    ]);

    db.delete(resultRecordsTable)
      .where(and(eq(resultRecordsTable.projectId, projectId), eq(resultRecordsTable.paperId, targetPaper.paperCode)))
      .run();
    db.delete(paperRecordsTable)
      .where(and(eq(paperRecordsTable.projectId, projectId), eq(paperRecordsTable.paperCode, targetPaper.paperCode)))
      .run();

    return this.getProjectDetail(projectId);
  }

  async getProjectDetail(projectId: string): Promise<ProjectDetail> {
    const project = await this.recomputeStats(projectId);
    const referenceAnswerMarkdown =
      (await this.getReferenceAnswerMarkdown(projectId)) || '# 尚未上传参考答案';

    const originals = await this.listProjectPapers(projectId);
    const results = await this.listResults(projectId);
    const scans = originals.filter((item) => item.originalPages.some((page) => page.scannedPath));
    const db = getDatabase();
    const recentJobs = db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.projectId, projectId), isNull(tasksTable.archivedAt)))
      .orderBy(desc(tasksTable.updatedAt))
      .limit(6)
      .all()
      .map((row) => ({
        id: row.id,
        kind: row.kind as 'scan' | 'grading' | 'answer-generation',
        projectId: row.projectId,
        projectName: row.projectName,
        referenceAnswerVersion: row.referenceAnswerVersion ?? undefined,
        status: row.status as any,
        progress: row.progress,
        speed: row.speed,
        eta: row.eta,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        archivedAt: row.archivedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        abortable: row.abortable,
        currentPaperLabel: row.currentPaperLabel ?? undefined,
        summary: row.summary,
        runtimeLogs: (() => {
          try {
            const parsed = JSON.parse(row.runtimeLogsJson ?? '[]') as unknown;
            return Array.isArray(parsed) ? parsed.map((item) => String(item ?? '')) : [];
          } catch {
            return [];
          }
        })(),
      }));

    return {
      project,
      referenceAnswerMarkdown,
      originals,
      scans,
      results,
      recentJobs,
    };
  }

  async listProjectPapers(projectId: string): Promise<PaperRecord[]> {
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    const paperCodes = await listSortedSubDirectories(structure.originalsDir);
    const papers: PaperRecord[] = [];

    for (const paperCode of paperCodes) {
      const originalPaths = await listSortedFiles(path.join(structure.originalsDir, paperCode));
      if (originalPaths.length === 0) {
        continue;
      }

      const pages: PaperPage[] = [];
      for (const [index, originalPath] of originalPaths.entries()) {
        const assets = getPaperPageAssetPaths(project.rootPath, paperCode, originalPath);
        const [originalVersion, scannedVersion, debugPreviewVersion] = await Promise.all([
          getFileVersion(originalPath),
          getFileVersion(assets.scannedPath),
          getFileVersion(assets.debugPreviewPath),
        ]);
        const corners =
          (await fs.pathExists(assets.cornersPath))
            ? ((await fs.readJson(assets.cornersPath)) as { corners?: PaperPage['corners'] }).corners
            : undefined;

        pages.push({
          pageIndex: index,
          originalPath,
          originalVersion,
          scannedPath: scannedVersion ? assets.scannedPath : undefined,
          scannedVersion,
          debugPreviewPath: debugPreviewVersion ? assets.debugPreviewPath : undefined,
          debugPreviewVersion,
          corners,
        });
      }

      const gradingSnapshot = await this.getPaperGradingSnapshot(projectId, paperCode);
      papers.push({
        id: paperCode,
        projectId,
        paperCode,
        pageCount: pages.length,
        originalPages: pages,
        scanStatus: inferScanStatus(pages),
        gradingStatus: gradingSnapshot.status,
        gradingReferenceAnswerVersion: gradingSnapshot.referenceAnswerVersion,
        gradingUpdatedAt: gradingSnapshot.updatedAt,
        gradingError: gradingSnapshot.errorMessage ?? null,
      });
    }

    return papers;
  }

  async scanProjectDocuments(
    projectId: string,
    options?: {
      skipCompleted?: boolean;
      signal?: AbortSignal;
      onProgress?: (payload: {
        completedPageCount: number;
        processedPageCount: number;
        skippedPageCount: number;
        totalPageCount: number;
        currentPaperLabel: string;
      }) => Promise<void> | void;
    },
  ): Promise<{
    totalPageCount: number;
    processedPageCount: number;
    skippedPageCount: number;
  }> {
    const project = await this.getProjectById(projectId);
    const papers = await this.listProjectPapers(projectId);
    const skipCompleted = options?.skipCompleted ?? true;
    const pagesToHandle = papers.flatMap((paper) =>
      paper.originalPages
        .filter((page) => !(skipCompleted && page.scannedPath && page.debugPreviewPath))
        .map((page) => ({
          paperCode: paper.paperCode,
          page,
        })),
    );

    let processedPageCount = 0;
    let skippedPageCount = 0;
    const totalPageCount = pagesToHandle.length;

    for (const item of pagesToHandle) {
      if (options?.signal?.aborted) {
        throw new Error('扫描任务已取消');
      }

      const assets = getPaperPageAssetPaths(project.rootPath, item.paperCode, item.page.originalPath);
      if (
        skipCompleted &&
        (await fs.pathExists(assets.scannedPath)) &&
        (await fs.pathExists(assets.debugPreviewPath))
      ) {
        skippedPageCount += 1;
      } else {
        await processDocumentImage(
          item.page.originalPath,
          assets.scannedPath,
          assets.debugPreviewPath,
          assets.cornersPath,
          {
            applyPostProcess: project.settings.enableScanPostProcess,
          },
        );
        processedPageCount += 1;
      }

      await options?.onProgress?.({
        completedPageCount: processedPageCount + skippedPageCount,
        processedPageCount,
        skippedPageCount,
        totalPageCount,
        currentPaperLabel: item.paperCode,
      });
    }

    await this.recomputeStats(projectId);
    return {
      totalPageCount,
      processedPageCount,
      skippedPageCount,
    };
  }

  async importOriginalImages(projectId: string, filePaths: string[]) {
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    const grouped = buildGroupedImportMap(filePaths);
    let addedPaperCount = 0;
    let addedPageCount = 0;

    for (const [paperCode, sourceFiles] of grouped.entries()) {
      const paperDir = path.join(structure.originalsDir, paperCode);
      await fs.ensureDir(paperDir);
      const existingPaths = await listSortedFiles(paperDir);
      const wasEmpty = existingPaths.length === 0;
      let nextPageIndex = existingPaths.length;

      for (const sourcePath of sourceFiles) {
        nextPageIndex += 1;
        const extension = path.extname(sourcePath).toLowerCase() || '.jpg';
        const targetPath = path.join(
          paperDir,
          `${paperCode}_${String(nextPageIndex).padStart(2, '0')}${extension}`,
        );
        await fs.copy(sourcePath, targetPath, { overwrite: false, errorOnExist: false });
        addedPageCount += 1;
      }

      if (wasEmpty) {
        addedPaperCount += 1;
      }
    }

    await this.recomputeStats(projectId);
    return {
      projectId,
      addedPaperCount,
      addedPageCount,
    };
  }

  async listResults(projectId: string): Promise<ResultRecord[]> {
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    if (!(await fs.pathExists(structure.resultsDir))) {
      return [];
    }

    const entries = await fs.readdir(structure.resultsDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => path.join(structure.resultsDir, entry.name))
      .sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));

    const records: ResultRecord[] = [];
    for (const filePath of files) {
      try {
        const payload = await fs.readJson(filePath);
        const normalized = normalizeResultPayload(payload);
        if (!normalized || normalized.status !== 'completed') {
          continue;
        }

        const paperId = getFileNameWithoutExtension(filePath);
        const stat = await fs.stat(filePath);
        records.push({
          id: filePath,
          projectId,
          paperId,
          filePath,
          status: normalized.status,
          errorMessage: normalized.errorMessage ?? null,
          referenceAnswerVersion: normalized.referenceAnswerVersion,
          modelResult: normalized.modelResult,
          finalResult: normalized.finalResult,
          updatedAt: stat.mtime.toISOString(),
        });
      } catch {
        continue;
      }
    }

    return records;
  }

  async getPaperGradingSnapshot(projectId: string, paperId: string): Promise<PaperGradingSnapshot> {
    const project = await this.getProjectById(projectId);
    const filePath = getResultFilePath(project.rootPath, paperId);
    if (!(await fs.pathExists(filePath))) {
      return {
        status: 'pending',
      };
    }

    try {
      const payload = (await fs.readJson(filePath)) as Record<string, unknown>;
      const stat = await fs.stat(filePath);
      if (payload.status === 'failed' || payload.status === 'processing' || payload.status === 'completed') {
        return {
          status: payload.status,
          referenceAnswerVersion:
            typeof payload.referenceAnswerVersion === 'number'
              ? Math.trunc(payload.referenceAnswerVersion)
              : undefined,
          updatedAt:
            typeof payload.updatedAt === 'string' && payload.updatedAt
              ? payload.updatedAt
              : stat.mtime.toISOString(),
          errorMessage:
            typeof payload.errorMessage === 'string' ? payload.errorMessage : null,
        };
      }

      const normalized = normalizeResultPayload(payload);
      if (normalized) {
        return {
          status: normalized.status,
          referenceAnswerVersion: normalized.referenceAnswerVersion,
          updatedAt: stat.mtime.toISOString(),
          errorMessage: normalized.errorMessage ?? null,
        };
      }
    } catch {
      return {
        status: 'failed',
        errorMessage: '结果文件损坏，无法读取。',
      };
    }

    return {
      status: 'pending',
    };
  }

  async getResult(projectId: string, paperId: string): Promise<ResultRecord | null> {
    const results = await this.listResults(projectId);
    return results.find((item) => item.paperId === paperId) ?? null;
  }

  async writeProcessingResult(
    projectId: string,
    paperId: string,
    referenceAnswerVersion: number,
  ): Promise<void> {
    const project = await this.getProjectById(projectId);
    const filePath = getResultFilePath(project.rootPath, paperId);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeJson(
      filePath,
      {
        status: 'processing',
        errorMessage: null,
        referenceAnswerVersion,
        updatedAt: new Date().toISOString(),
      },
      { spaces: 2 },
    );
  }

  async writeFailedResult(
    projectId: string,
    paperId: string,
    referenceAnswerVersion: number,
    errorMessage: string,
  ): Promise<void> {
    const project = await this.getProjectById(projectId);
    const filePath = getResultFilePath(project.rootPath, paperId);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeJson(
      filePath,
      {
        status: 'failed',
        errorMessage,
        referenceAnswerVersion,
        updatedAt: new Date().toISOString(),
      },
      { spaces: 2 },
    );
  }

  async saveComputedResult(
    projectId: string,
    paperId: string,
    payload: {
      referenceAnswerVersion: number;
      modelResult: ModelResult;
      finalResult: FinalResult;
    },
  ): Promise<ResultRecord> {
    const project = await this.getProjectById(projectId);
    const filePath = getResultFilePath(project.rootPath, paperId);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeJson(
      filePath,
      {
        status: 'completed',
        errorMessage: null,
        referenceAnswerVersion: payload.referenceAnswerVersion,
        modelResult: payload.modelResult,
        finalResult: payload.finalResult,
        updatedAt: new Date().toISOString(),
      },
      { spaces: 2 },
    );

    await this.recomputeStats(projectId);
    return (await this.getResult(projectId, paperId))!;
  }

  async clearProcessingResult(projectId: string, paperId: string): Promise<void> {
    const project = await this.getProjectById(projectId);
    const filePath = getResultFilePath(project.rootPath, paperId);
    if (!(await fs.pathExists(filePath))) {
      return;
    }

    try {
      const payload = (await fs.readJson(filePath)) as Record<string, unknown>;
      if (payload.status === 'processing') {
        await fs.remove(filePath);
      }
    } catch {
      await fs.remove(filePath);
    }
  }

  async resetProcessingResults(projectId: string): Promise<void> {
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    if (!(await fs.pathExists(structure.resultsDir))) {
      return;
    }

    const entries = await fs.readdir(structure.resultsDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map(async (entry) => {
          const filePath = path.join(structure.resultsDir, entry.name);
          try {
            const payload = (await fs.readJson(filePath)) as Record<string, unknown>;
            if (payload.status === 'processing') {
              await fs.remove(filePath);
            }
          } catch {
            return;
          }
        }),
    );
  }

  async saveFinalResult(
    projectId: string,
    paperId: string,
    finalResult: FinalResult,
  ): Promise<ResultRecord> {
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    const current = await this.getResult(projectId, paperId);
    if (!current) {
      throw new Error('未找到待保存的评分结果。');
    }
    if (!current.modelResult) {
      throw new Error('当前结果缺少模型原始评分数据，无法保存人工修订。');
    }

    const filePath = path.join(structure.resultsDir, `${paperId}.json`);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeJson(
      filePath,
      {
        status: 'completed',
        errorMessage: null,
        referenceAnswerVersion: current.referenceAnswerVersion,
        modelResult: current.modelResult,
        finalResult,
        updatedAt: new Date().toISOString(),
      },
      { spaces: 2 },
    );

    await this.recomputeStats(projectId);
    return (await this.getResult(projectId, paperId))!;
  }

  async deleteResult(projectId: string, paperId: string): Promise<void> {
    const db = getDatabase();
    const project = await this.getProjectById(projectId);
    const current = await this.getResult(projectId, paperId);

    if (!current) {
      throw new Error('未找到要删除的批阅结果。');
    }

    const activeGradingTask = db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.projectId, projectId),
          eq(tasksTable.kind, 'grading'),
          isNull(tasksTable.archivedAt),
        ),
      )
      .all()
      .find((task) => ['queued', 'running', 'paused'].includes(task.status));

    if (activeGradingTask) {
      throw new Error('当前项目还有进行中的批阅任务，请先停止或等待任务完成后再删除批阅数据。');
    }

    const filePath = getResultFilePath(project.rootPath, paperId);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }

    db.delete(resultRecordsTable)
      .where(and(eq(resultRecordsTable.projectId, projectId), eq(resultRecordsTable.paperId, paperId)))
      .run();

    await this.recomputeStats(projectId);
  }

  async exportResults(projectId: string, targetPath?: string): Promise<string> {
    const project = await this.getProjectById(projectId);
    const results = await this.listResults(projectId);
    const structure = getProjectStructure(project.rootPath);
    const outputPath =
      targetPath ??
      path.join(structure.exportsDir, `${toSafeFolderName(project.name)}-results.json`);

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeJson(
      outputPath,
      results.map((item) => ({
        paperId: item.paperId,
        referenceAnswerVersion: item.referenceAnswerVersion,
        finalResult: item.finalResult,
      })),
      { spaces: 2 },
    );
    return outputPath;
  }

  async recomputeStats(projectId: string): Promise<ProjectMeta> {
    const db = getDatabase();
    const project = await this.getProjectById(projectId);
    const papers = await this.listProjectPapers(projectId);
    const results = await this.listResults(projectId);
    const scoreList = results.map(
      (item) => item.finalResult!.manualTotalScore ?? item.finalResult!.totalScore,
    );
    const averageScore =
      scoreList.length > 0
        ? Number(
            (
              scoreList.reduce((sum, value) => sum + value, 0) / scoreList.length
            ).toFixed(2),
          )
        : 0;
    const latestJob = db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.projectId, projectId), isNull(tasksTable.archivedAt)))
      .orderBy(desc(tasksTable.updatedAt))
      .limit(1)
      .get();

    const stats: ProjectStats = {
      importedPaperCount: papers.length,
      scannedPaperCount: papers.filter((item) => item.scanStatus === 'completed').length,
      gradedPaperCount: papers.filter((item) => item.gradingStatus === 'completed').length,
      averageScore,
      pageCount: papers.reduce((sum, item) => sum + item.pageCount, 0),
      lastTaskSummary: latestJob?.summary ?? '尚未启动任务',
    };

    const updatedAt = new Date().toISOString();
    db.update(projectsTable)
      .set({
        statsJson: JSON.stringify(stats),
        updatedAt,
      })
      .where(eq(projectsTable.id, projectId))
      .run();

    const updated: ProjectMeta = {
      ...project,
      stats,
      updatedAt,
    };
    await writeProjectManifest(updated);
    return updated;
  }

  async completeMockScan(projectId: string): Promise<void> {
    await this.scanProjectDocuments(projectId, { skipCompleted: false });
  }

  async completeMockGrading(projectId: string, skipCompleted = true): Promise<void> {
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    const papers = await this.listProjectPapers(projectId);

    for (const [index, paper] of papers.entries()) {
      const existing = await this.getResult(projectId, paper.id);
      if (existing && skipCompleted) {
        continue;
      }

      const score = 16 + ((index * 3) % 10);
      const modelResult: ModelResult = {
        studentInfo: {
          className: '',
          studentId: '',
          name: '',
        },
        questionScores: [
          {
            questionId: '1',
            questionTitle: '待接入真实批阅',
            maxScore: 25,
            score,
            reasoning:
              '### 说明\n当前阶段已接入真实项目文件读写，但批阅引擎尚未替换为真实 LLM 调用。\n',
            issues: [],
            scoreBreakdown: [
              {
                criterionId: '1',
                criterion: '占位采分点',
                maxScore: 25,
                score,
                verdict: score >= 20 ? 'earned' : 'partial',
                evidence: '占位结果',
              },
            ],
          },
        ],
        totalScore: score,
        overallAdvice: {
          summary: '当前为占位批阅结果，尚未生成真实的整卷建议。',
          strengths: ['项目文件读写链路正常'],
          priorityKnowledgePoints: ['等待接入真实 LLM 阅卷建议'],
          attentionPoints: ['当前建议为占位内容，不应作为教学依据'],
          encouragement: '真实批阅接入后，这里会展示面向学生的总体建议。',
        },
        overallComment:
          '## 说明\n当前结果由占位批阅任务生成。下一阶段会替换为真实批阅输出。',
      };
      const finalResult: FinalResult = {
        ...modelResult,
      };
      const filePath = path.join(structure.resultsDir, `${paper.paperCode}.json`);
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeJson(
        filePath,
        {
          status: 'completed',
          errorMessage: null,
          referenceAnswerVersion: project.referenceAnswerVersion,
          modelResult,
          finalResult,
          updatedAt: new Date().toISOString(),
        },
        { spaces: 2 },
      );
    }

    await this.recomputeStats(projectId);
  }
}
