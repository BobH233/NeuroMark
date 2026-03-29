import path from 'node:path';
import fs from 'fs-extra';
import { and, desc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
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
import {
  paperRecordsTable,
  projectsTable,
  resultRecordsTable,
  tasksTable,
} from '@main/database/schema';
import { ensureMockPaperSvg } from './mockAssets';

const PAGE_SUFFIX_PATTERN = /^(?<base>.+)_(?<page>[1-9]\d?)$/;

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

function basenameWithoutExt(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function groupImagesByPaperCode(filePaths: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const filePath of filePaths) {
    const stem = basenameWithoutExt(filePath);
    const matched = stem.match(PAGE_SUFFIX_PATTERN);
    const groupKey = matched?.groups?.base ?? stem;
    const existing = groups.get(groupKey) ?? [];
    existing.push(filePath);
    groups.set(groupKey, existing);
  }

  for (const [key, values] of groups.entries()) {
    values.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
    groups.set(key, values);
  }

  return groups;
}

function createMockModelResult(paperCode: string, score: number): ModelResult {
  return {
    studentInfo: {
      className: '06212401',
      studentId: `112024${paperCode.slice(-4).padStart(4, '0')}`,
      name: `学生 ${paperCode.slice(-2).toUpperCase()}`,
    },
    questionScores: [
      {
        questionId: '1',
        questionTitle: '电路分析基础',
        maxScore: 15,
        score: Math.max(8, score - 9),
        reasoning:
          '### 学生答案\n- 已完成主要作图与推导。\n\n### 正确答案\n- 应给出完整分析链路。\n\n### 得分依据\n- 本题重点检查交流通路、微变等效电路和关键公式书写，例如：$A_u = -\\frac{\\beta(R_C \\parallel R_L)}{r_{be}}$。\n\n### 问题与建议\n- 建议补充过程分析与扣分依据说明。',
        issues: ['存在 1 处过程描述不完整'],
      },
      {
        questionId: '2',
        questionTitle: '两端口网络计算',
        maxScore: 10,
        score: Math.min(10, score - Math.max(8, score - 9)),
        reasoning:
          '### 学生答案\n- 计算过程完整。\n\n### 正确答案\n- 输入输出分压和总增益推导正确。\n\n### 得分依据\n- 本题按输入分压、输出分压和总增益三个部分分别评分。\n\n### 问题与建议\n- 建议复核最终结果的量级。',
        issues: [],
      },
    ],
    totalScore: score,
    overallComment:
      '## 总体完成情况\n该答卷整体完成情况较好，主要题目均已作答。\n\n## 主要错误与正确答案\n- 请重点核对过程分、关键公式和最终结论是否一致。\n\n## 建议补充的知识点\n- 建议复习交流通路分析、微变等效模型和带载增益计算。',
    questionRegions: [
      {
        questionId: '1',
        pageIndex: 0,
        x: 0.12,
        y: 0.2,
        width: 0.5,
        height: 0.2,
      },
      {
        questionId: '2',
        pageIndex: 0,
        x: 0.18,
        y: 0.54,
        width: 0.56,
        height: 0.18,
      },
    ],
  };
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

export class ProjectService {
  async ensureSeedData(userDataPath: string): Promise<void> {
    const db = getDatabase();
    const projectCount = db
      .select({ count: sql<number>`count(*)` })
      .from(projectsTable)
      .get();

    if ((projectCount?.count ?? 0) > 0) {
      return;
    }

    const rootPath = path.join(userDataPath, 'demo-projects', '模拟电路第一次作业');
    const project = await this.createProject({
      name: '模拟电路第一次作业',
      basePath: path.join(userDataPath, 'demo-projects'),
      drawRegions: true,
      gradingConcurrency: 2,
      defaultImageDetail: 'high',
    });

    const structure = getProjectStructure(rootPath);
    await fs.writeFile(
      structure.referenceAnswerPath,
      '# 模拟电路章节测试参考答案\n\n## 第1题\n- 写出交流通路、微变等效电路以及关键公式。\n\n## 第2题\n- 写出输入回路分压、输出回路分压与总增益。\n',
      'utf-8',
    );

    const mockPapers = [
      { code: 'NM-001', score: 22, accent: '#0f766e' },
      { code: 'NM-002', score: 18, accent: '#0f8b8d' },
      { code: 'NM-003', score: 25, accent: '#1d9c8f' },
    ];

    for (const [index, paper] of mockPapers.entries()) {
      const originalPath = path.join(
        structure.originalsDir,
        paper.code,
        `${paper.code}_1.svg`,
      );
      const scannedPath = path.join(
        structure.scannedDir,
        paper.code,
        `${paper.code}_1.svg`,
      );
      const debugPath = path.join(
        structure.scanDebugDir,
        paper.code,
        'boundary-preview.svg',
      );
      await ensureMockPaperSvg(
        originalPath,
        `${project.name} - 原始答卷`,
        `${paper.code} · 第 1 页`,
        paper.accent,
      );
      await ensureMockPaperSvg(
        scannedPath,
        `${project.name} - 扫描件`,
        `${paper.code} · 第 1 页`,
        '#245f73',
      );
      await ensureMockPaperSvg(
        debugPath,
        `${project.name} - 边界识别`,
        `${paper.code} · 角点可视化`,
        '#d97706',
      );

      const now = new Date().toISOString();
      const paperId = nanoid();
      const pages: PaperPage[] = [
        {
          pageIndex: 0,
          originalPath,
          scannedPath,
          debugPreviewPath: debugPath,
          corners: [
            { x: 0.08, y: 0.05 },
            { x: 0.93, y: 0.05 },
            { x: 0.93, y: 0.95 },
            { x: 0.08, y: 0.95 },
          ],
        },
      ];

      db.insert(paperRecordsTable)
        .values({
          id: paperId,
          projectId: project.id,
          paperCode: paper.code,
          pageCount: 1,
          originalPagesJson: JSON.stringify(pages),
          scanStatus: 'completed',
          gradingStatus: 'completed',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const modelResult = createMockModelResult(paper.code, paper.score);
      const finalResult: FinalResult = {
        ...modelResult,
      };

      const resultPath = path.join(structure.resultsDir, `${paper.code}.json`);
      await fs.writeJson(
        resultPath,
        {
          modelResult,
          finalResult,
        },
        { spaces: 2 },
      );

      db.insert(resultRecordsTable)
        .values({
          id: nanoid(),
          projectId: project.id,
          paperId,
          filePath: resultPath,
          modelResultJson: JSON.stringify(modelResult),
          finalResultJson: JSON.stringify(finalResult),
          updatedAt: now,
        })
        .run();

      if (index === 0) {
        await fs.writeJson(
          path.join(structure.exportsDir, 'batch-results-demo.json'),
          [{ paperCode: paper.code, totalScore: paper.score }],
          { spaces: 2 },
        );
      }
    }

    await this.recomputeStats(project.id);
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
    const projectId = nanoid();
    const targetRootPath = path.join(input.basePath, toSafeFolderName(input.name));
    const settings: ProjectSettings = {
      gradingConcurrency: input.gradingConcurrency ?? DEFAULT_PROJECT_SETTINGS.gradingConcurrency,
      drawRegions: input.drawRegions ?? DEFAULT_PROJECT_SETTINGS.drawRegions,
      defaultImageDetail:
        input.defaultImageDetail ?? DEFAULT_PROJECT_SETTINGS.defaultImageDetail,
    };
    const stats = createEmptyStats();

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
      stats,
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
    return project;
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
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    const referenceAnswerMarkdown = (await fs.pathExists(structure.referenceAnswerPath))
      ? await fs.readFile(structure.referenceAnswerPath, 'utf-8')
      : '# 尚未上传参考答案';

    const originals = await this.listProjectPapers(projectId);
    const results = await this.listResults(projectId);
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
      scans: originals,
      results,
      recentJobs,
    };
  }

  async listProjectPapers(projectId: string): Promise<PaperRecord[]> {
    const db = getDatabase();
    return db
      .select()
      .from(paperRecordsTable)
      .where(eq(paperRecordsTable.projectId, projectId))
      .orderBy(desc(paperRecordsTable.updatedAt))
      .all()
      .map((row) => ({
        id: row.id,
        projectId: row.projectId,
        paperCode: row.paperCode,
        pageCount: row.pageCount,
        originalPages: parseJson<PaperPage[]>(row.originalPagesJson),
        scanStatus: row.scanStatus as any,
        gradingStatus: row.gradingStatus as any,
      }));
  }

  async importOriginalImages(projectId: string, filePaths: string[]) {
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    const groups = groupImagesByPaperCode(filePaths);
    const db = getDatabase();

    let addedPaperCount = 0;
    let addedPageCount = 0;

    for (const [paperCode, pages] of groups.entries()) {
      const paperId = nanoid();
      const storedPages: PaperPage[] = [];
      for (const [pageIndex, sourcePath] of pages.entries()) {
        const targetPath = path.join(
          structure.originalsDir,
          paperCode,
          path.basename(sourcePath),
        );
        await fs.ensureDir(path.dirname(targetPath));
        await fs.copy(sourcePath, targetPath);
        storedPages.push({
          pageIndex,
          originalPath: targetPath,
        });
        addedPageCount += 1;
      }

      const now = new Date().toISOString();
      db.insert(paperRecordsTable)
        .values({
          id: paperId,
          projectId,
          paperCode,
          pageCount: storedPages.length,
          originalPagesJson: JSON.stringify(storedPages),
          scanStatus: 'pending',
          gradingStatus: 'pending',
          createdAt: now,
          updatedAt: now,
        })
        .run();
      addedPaperCount += 1;
    }

    await this.recomputeStats(projectId);
    return {
      projectId,
      addedPaperCount,
      addedPageCount,
    };
  }

  async listResults(projectId: string): Promise<ResultRecord[]> {
    const db = getDatabase();
    return db
      .select()
      .from(resultRecordsTable)
      .where(eq(resultRecordsTable.projectId, projectId))
      .orderBy(desc(resultRecordsTable.updatedAt))
      .all()
      .map((row) => ({
        id: row.id,
        projectId: row.projectId,
        paperId: row.paperId,
        filePath: row.filePath,
        modelResult: parseJson<ModelResult>(row.modelResultJson),
        finalResult: parseJson<FinalResult>(row.finalResultJson),
        updatedAt: row.updatedAt,
      }));
  }

  async getResult(projectId: string, paperId: string): Promise<ResultRecord | null> {
    const db = getDatabase();
    const row = db
      .select()
      .from(resultRecordsTable)
      .where(
        and(
          eq(resultRecordsTable.projectId, projectId),
          eq(resultRecordsTable.paperId, paperId),
        ),
      )
      .get();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      projectId: row.projectId,
      paperId: row.paperId,
      filePath: row.filePath,
      modelResult: parseJson<ModelResult>(row.modelResultJson),
      finalResult: parseJson<FinalResult>(row.finalResultJson),
      updatedAt: row.updatedAt,
    };
  }

  async saveFinalResult(
    projectId: string,
    paperId: string,
    finalResult: FinalResult,
  ): Promise<ResultRecord> {
    const current = await this.getResult(projectId, paperId);
    if (!current) {
      throw new Error('未找到待保存的评分结果。');
    }

    const updatedAt = new Date().toISOString();
    const db = getDatabase();
    db.update(resultRecordsTable)
      .set({
        finalResultJson: JSON.stringify(finalResult),
        updatedAt,
      })
      .where(eq(resultRecordsTable.id, current.id))
      .run();

    await fs.writeJson(
      current.filePath,
      {
        modelResult: current.modelResult,
        finalResult,
      },
      { spaces: 2 },
    );

    await this.recomputeStats(projectId);
    return {
      ...current,
      finalResult,
      updatedAt,
    };
  }

  async exportResults(projectId: string, targetPath?: string): Promise<string> {
    const project = await this.getProjectById(projectId);
    const results = await this.listResults(projectId);
    const structure = getProjectStructure(project.rootPath);
    const outputPath =
      targetPath ?? path.join(structure.exportsDir, `${toSafeFolderName(project.name)}-results.json`);

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
            (scoreList.reduce((sum, value) => sum + value, 0) / scoreList.length).toFixed(2),
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
      lastTaskSummary: latestJob?.summary ?? project.stats.lastTaskSummary,
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
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    const db = getDatabase();
    const papers = await this.listProjectPapers(projectId);

    for (const paper of papers) {
      const updatedPages = await Promise.all(
        paper.originalPages.map(async (page, pageIndex) => {
          if (page.scannedPath && page.debugPreviewPath) {
            return page;
          }

          const scannedPath = path.join(
            structure.scannedDir,
            paper.paperCode,
            `${paper.paperCode}_${pageIndex + 1}.svg`,
          );
          const debugPreviewPath = path.join(
            structure.scanDebugDir,
            paper.paperCode,
            `boundary-preview-${pageIndex + 1}.svg`,
          );
          await ensureMockPaperSvg(
            scannedPath,
            `${project.name} - 扫描答卷`,
            `${paper.paperCode} · 第 ${pageIndex + 1} 页`,
            '#256b7f',
          );
          await ensureMockPaperSvg(
            debugPreviewPath,
            `${project.name} - 边界标注`,
            `${paper.paperCode} · 第 ${pageIndex + 1} 页`,
            '#c2410c',
          );
          return {
            ...page,
            scannedPath,
            debugPreviewPath,
            corners: [
              { x: 0.08, y: 0.06 },
              { x: 0.92, y: 0.06 },
              { x: 0.92, y: 0.94 },
              { x: 0.08, y: 0.94 },
            ],
          };
        }),
      );

      db.update(paperRecordsTable)
        .set({
          originalPagesJson: JSON.stringify(updatedPages),
          scanStatus: 'completed',
          updatedAt: new Date().toISOString(),
        })
        .where(eq(paperRecordsTable.id, paper.id))
        .run();
    }

    await this.recomputeStats(projectId);
  }

  async completeMockGrading(projectId: string, skipCompleted = true): Promise<void> {
    const project = await this.getProjectById(projectId);
    const structure = getProjectStructure(project.rootPath);
    const db = getDatabase();
    const papers = await this.listProjectPapers(projectId);

    for (const [index, paper] of papers.entries()) {
      const existing = await this.getResult(projectId, paper.id);
      if (existing && skipCompleted) {
        continue;
      }

      const score = 16 + ((index * 3) % 10);
      const modelResult = createMockModelResult(paper.paperCode, score);
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
      const now = new Date().toISOString();

      if (existing) {
        db.update(resultRecordsTable)
          .set({
            modelResultJson: JSON.stringify(modelResult),
            finalResultJson: JSON.stringify(finalResult),
            updatedAt: now,
          })
          .where(eq(resultRecordsTable.id, existing.id))
          .run();
      } else {
        db.insert(resultRecordsTable)
          .values({
            id: nanoid(),
            projectId,
            paperId: paper.id,
            filePath,
            modelResultJson: JSON.stringify(modelResult),
            finalResultJson: JSON.stringify(finalResult),
            updatedAt: now,
          })
          .run();
      }

      db.update(paperRecordsTable)
        .set({
          gradingStatus: 'completed',
          updatedAt: now,
        })
        .where(eq(paperRecordsTable.id, paper.id))
        .run();
    }

    await this.recomputeStats(projectId);
  }
}
