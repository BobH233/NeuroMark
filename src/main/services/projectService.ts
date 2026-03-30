import path from 'node:path';
import fs from 'fs-extra';
import { desc, eq } from 'drizzle-orm';
import type {
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
} from '@preload/contracts';
import { getDatabase } from '@main/database/client';
import { projectsTable, tasksTable } from '@main/database/schema';
import { processDocumentImage } from './documentScanService';

const PAGE_SUFFIX_PATTERN = /^(?<base>.+)_(?<page>[1-9]\d?)$/;
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

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
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
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      settings: project.settings,
    },
    { spaces: 2 },
  );
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
  modelResult: ModelResult;
  finalResult: FinalResult;
} | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  if (candidate.modelResult && candidate.finalResult) {
    return {
      modelResult: candidate.modelResult as ModelResult,
      finalResult: candidate.finalResult as FinalResult,
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
      })),
      totalScore: Number(totalScore),
      overallComment: String(overallComment),
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
      modelResult,
      finalResult: {
        ...modelResult,
      },
    };
  }

  return null;
}

function getFileNameWithoutExtension(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
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

function buildGroupedImportMap(filePaths: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const filePath of filePaths) {
    const stem = getFileNameWithoutExtension(filePath);
    const matched = stem.match(PAGE_SUFFIX_PATTERN);
    const paperCode = matched?.groups?.base ?? stem;
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

  async listProjects(): Promise<ProjectMeta[]> {
    const db = getDatabase();
    return db
      .select()
      .from(projectsTable)
      .orderBy(desc(projectsTable.updatedAt))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        rootPath: row.rootPath,
        stats: parseJson<ProjectStats>(row.statsJson),
        settings: parseJson<ProjectSettings>(row.settingsJson),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
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

    return {
      id: row.id,
      name: row.name,
      rootPath: row.rootPath,
      stats: parseJson<ProjectStats>(row.statsJson),
      settings: parseJson<ProjectSettings>(row.settingsJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async createProject(input: CreateProjectInput): Promise<ProjectMeta> {
    const db = getDatabase();
    const now = new Date().toISOString();
    const projectId = input.name.trim() ? `${Date.now()}-${toSafeFolderName(input.name)}` : `${Date.now()}`;
    const targetRootPath = path.join(input.basePath, toSafeFolderName(input.name));
    const settings: ProjectSettings = {
      gradingConcurrency: input.gradingConcurrency ?? DEFAULT_PROJECT_SETTINGS.gradingConcurrency,
      drawRegions: input.drawRegions ?? DEFAULT_PROJECT_SETTINGS.drawRegions,
      defaultImageDetail:
        input.defaultImageDetail ?? DEFAULT_PROJECT_SETTINGS.defaultImageDetail,
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
      name: input.name.trim(),
      rootPath: targetRootPath,
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
        statsJson: JSON.stringify(project.stats),
        settingsJson: JSON.stringify(project.settings),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })
      .run();

    await writeProjectManifest(project);
    return this.recomputeStats(project.id);
  }

  async updateProjectSettings(
    projectId: string,
    settings: ProjectSettings,
  ): Promise<ProjectMeta> {
    const db = getDatabase();
    const current = await this.getProjectById(projectId);
    const updatedAt = new Date().toISOString();

    db.update(projectsTable)
      .set({
        settingsJson: JSON.stringify(settings),
        updatedAt,
      })
      .where(eq(projectsTable.id, projectId))
      .run();

    const updated: ProjectMeta = {
      ...current,
      settings,
      updatedAt,
    };
    await writeProjectManifest(updated);
    return updated;
  }

  async getProjectDetail(projectId: string): Promise<ProjectDetail> {
    const project = await this.recomputeStats(projectId);
    const structure = getProjectStructure(project.rootPath);
    const referenceAnswerMarkdown = (await fs.pathExists(structure.referenceAnswerPath))
      ? await fs.readFile(structure.referenceAnswerPath, 'utf-8')
      : '# 尚未上传参考答案';

    const originals = await this.listProjectPapers(projectId);
    const results = await this.listResults(projectId);
    const scans = originals.filter((item) => item.originalPages.some((page) => page.scannedPath));
    const db = getDatabase();
    const recentJobs = db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.projectId, projectId))
      .orderBy(desc(tasksTable.updatedAt))
      .limit(6)
      .all()
      .map((row) => ({
        id: row.id,
        kind: row.kind as 'scan' | 'grading' | 'answer-generation',
        projectId: row.projectId,
        projectName: row.projectName,
        status: row.status as any,
        progress: row.progress,
        speed: row.speed,
        eta: row.eta,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        abortable: row.abortable,
        currentPaperLabel: row.currentPaperLabel ?? undefined,
        summary: row.summary,
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
    const results = await this.listResults(projectId);
    const gradedPaperIds = new Set(results.map((item) => item.paperId));
    const papers: PaperRecord[] = [];

    for (const paperCode of paperCodes) {
      const originalPaths = await listSortedFiles(path.join(structure.originalsDir, paperCode));
      if (originalPaths.length === 0) {
        continue;
      }

      const pages: PaperPage[] = [];
      for (const [index, originalPath] of originalPaths.entries()) {
        const assets = getPaperPageAssetPaths(project.rootPath, paperCode, originalPath);
        const corners =
          (await fs.pathExists(assets.cornersPath))
            ? ((await fs.readJson(assets.cornersPath)) as { corners?: PaperPage['corners'] }).corners
            : undefined;

        pages.push({
          pageIndex: index,
          originalPath,
          scannedPath: (await fs.pathExists(assets.scannedPath)) ? assets.scannedPath : undefined,
          debugPreviewPath:
            (await fs.pathExists(assets.debugPreviewPath)) ? assets.debugPreviewPath : undefined,
          corners,
        });
      }

      papers.push({
        id: paperCode,
        projectId,
        paperCode,
        pageCount: pages.length,
        originalPages: pages,
        scanStatus: inferScanStatus(pages),
        gradingStatus: gradedPaperIds.has(paperCode) ? 'completed' : 'pending',
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
        if (!normalized) {
          continue;
        }

        const paperId = getFileNameWithoutExtension(filePath);
        const stat = await fs.stat(filePath);
        records.push({
          id: filePath,
          projectId,
          paperId,
          filePath,
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

  async getResult(projectId: string, paperId: string): Promise<ResultRecord | null> {
    const results = await this.listResults(projectId);
    return results.find((item) => item.paperId === paperId) ?? null;
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

    const filePath = path.join(structure.resultsDir, `${paperId}.json`);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeJson(
      filePath,
      {
        modelResult: current.modelResult,
        finalResult,
      },
      { spaces: 2 },
    );

    await this.recomputeStats(projectId);
    return (await this.getResult(projectId, paperId))!;
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
      (item) => item.finalResult.manualTotalScore ?? item.finalResult.totalScore,
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
      .where(eq(tasksTable.projectId, projectId))
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
          },
        ],
        totalScore: score,
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
          modelResult,
          finalResult,
        },
        { spaces: 2 },
      );
    }

    await this.recomputeStats(projectId);
  }
}
