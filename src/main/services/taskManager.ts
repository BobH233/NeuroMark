import { desc, eq, isNotNull, isNull } from 'drizzle-orm';
import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import type { BackgroundJob, JobKind, JobStatus, StartJobOptions } from '@preload/contracts';
import { getDatabase } from '@main/database/client';
import { tasksTable } from '@main/database/schema';
import { ProjectService } from './projectService';

type TaskListener = (tasks: BackgroundJob[]) => void;

function toJob(row: typeof tasksTable.$inferSelect): BackgroundJob {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    projectId: row.projectId,
    projectName: row.projectName,
    referenceAnswerVersion: row.referenceAnswerVersion ?? undefined,
    status: row.status as JobStatus,
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
  };
}

export function estimateEta(progress: number, speed: number): string | null {
  if (progress <= 0 || speed <= 0) {
    return null;
  }

  const remainingSeconds = (1 - progress) * speed;
  if (remainingSeconds <= 0) {
    return null;
  }

  return dayjs().add(Math.ceil(remainingSeconds), 'second').format('HH:mm:ss');
}

function getSecondsPerPaper(progress: number, elapsedSeconds: number, totalPaperCount: number): number {
  if (progress <= 0 || elapsedSeconds <= 0 || totalPaperCount <= 0) {
    return 0;
  }

  const completedPaperEquivalent = progress * totalPaperCount;
  if (completedPaperEquivalent <= 0) {
    return 0;
  }

  return Number((elapsedSeconds / completedPaperEquivalent).toFixed(2));
}

export class TaskManager {
  private listeners = new Set<TaskListener>();
  private timers = new Map<string, NodeJS.Timeout>();
  private scanControllers = new Map<string, AbortController>();
  private deletingProjects = new Set<string>();

  constructor(private readonly projects: ProjectService) {}

  async list(): Promise<BackgroundJob[]> {
    const db = getDatabase();
    return db
      .select()
      .from(tasksTable)
      .where(isNull(tasksTable.archivedAt))
      .orderBy(desc(tasksTable.updatedAt))
      .all()
      .map(toJob);
  }

  async listArchived(): Promise<BackgroundJob[]> {
    const db = getDatabase();
    return db
      .select()
      .from(tasksTable)
      .where(isNotNull(tasksTable.archivedAt))
      .orderBy(desc(tasksTable.archivedAt), desc(tasksTable.updatedAt))
      .all()
      .map(toJob);
  }

  onUpdated(handler: TaskListener): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async startScan(projectId: string, options?: StartJobOptions): Promise<BackgroundJob> {
    return this.startScanJob(projectId, options);
  }

  async startGrading(projectId: string, options?: StartJobOptions): Promise<BackgroundJob> {
    return this.startMockJob(projectId, 'grading', options);
  }

  async resumeGrading(projectId: string): Promise<BackgroundJob> {
    return this.startMockJob(projectId, 'grading', { skipCompleted: true });
  }

  async createJob(input: {
    kind: JobKind;
    projectId: string;
    projectName: string;
    referenceAnswerVersion?: number;
    status?: JobStatus;
    progress?: number;
    speed?: number;
    eta?: string | null;
    abortable?: boolean;
    currentPaperLabel?: string;
    summary: string;
  }): Promise<BackgroundJob> {
    const db = getDatabase();
    const now = new Date().toISOString();
    const jobId = nanoid();
    const initialStatus = input.status ?? 'queued';
    const startedAt = initialStatus === 'running' ? now : null;
    const finishedAt = this.isTerminalStatus(initialStatus) ? now : null;

    db.insert(tasksTable)
      .values({
        id: jobId,
        projectId: input.projectId,
        projectName: input.projectName,
        kind: input.kind,
        referenceAnswerVersion: input.referenceAnswerVersion ?? null,
        status: initialStatus,
        progress:
          input.progress ?? (this.isTerminalStatus(initialStatus) ? 1 : 0),
        speed: input.speed ?? 0,
        eta: input.eta ?? null,
        startedAt,
        finishedAt,
        archivedAt: null,
        abortable: input.abortable ?? false,
        currentPaperLabel: input.currentPaperLabel ?? null,
        summary: input.summary,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    await this.emit();
    const row = db.select().from(tasksTable).where(eq(tasksTable.id, jobId)).get();
    return toJob(row!);
  }

  async updateJob(
    jobId: string,
    patch: Partial<
      Pick<
        BackgroundJob,
        | 'status'
        | 'progress'
        | 'speed'
        | 'eta'
        | 'abortable'
        | 'currentPaperLabel'
        | 'summary'
        | 'startedAt'
        | 'finishedAt'
      >
    >,
  ): Promise<BackgroundJob> {
    const db = getDatabase();
    const current = db.select().from(tasksTable).where(eq(tasksTable.id, jobId)).get();

    if (!current) {
      throw new Error('未找到对应的后台任务。');
    }

    const now = new Date().toISOString();
    const nextStatus = patch.status ?? (current.status as JobStatus);
    const nextProgress =
      patch.progress ??
      (this.isTerminalStatus(nextStatus) ? 1 : current.progress);
    const nextStartedAt =
      patch.startedAt !== undefined
        ? patch.startedAt
        : current.startedAt ?? (nextStatus === 'running' ? now : null);
    const nextFinishedAt =
      patch.finishedAt !== undefined
        ? patch.finishedAt
        : this.isTerminalStatus(nextStatus)
          ? current.finishedAt ?? now
          : null;

    db.update(tasksTable)
      .set({
        status: nextStatus,
        progress: nextProgress,
        speed: patch.speed ?? current.speed,
        eta: patch.eta === undefined ? current.eta : patch.eta,
        startedAt: nextStartedAt,
        finishedAt: nextFinishedAt,
        archivedAt: current.archivedAt,
        abortable: patch.abortable ?? current.abortable,
        currentPaperLabel:
          patch.currentPaperLabel === undefined
            ? current.currentPaperLabel
            : patch.currentPaperLabel,
        summary: patch.summary ?? current.summary,
        updatedAt: now,
      })
      .where(eq(tasksTable.id, jobId))
      .run();

    await this.emit();
    const updated = db.select().from(tasksTable).where(eq(tasksTable.id, jobId)).get();
    return toJob(updated!);
  }

  async archiveVisible(): Promise<void> {
    const db = getDatabase();
    const now = new Date().toISOString();

    db.update(tasksTable)
      .set({
        archivedAt: now,
        updatedAt: now,
      })
      .where(isNull(tasksTable.archivedAt))
      .run();

    await this.emit();
  }

  async cancel(jobId: string): Promise<void> {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(jobId);
    }
    const controller = this.scanControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.scanControllers.delete(jobId);
    }
    const db = getDatabase();
    const current = db.select().from(tasksTable).where(eq(tasksTable.id, jobId)).get();
    if (!current) {
      return;
    }
    const now = new Date().toISOString();
    db.update(tasksTable)
      .set({
        status: 'cancelled',
        progress: 1,
        eta: null,
        finishedAt: current.finishedAt ?? now,
        updatedAt: now,
        summary: '任务已取消',
      })
      .where(eq(tasksTable.id, jobId))
      .run();
    await this.projects.recomputeStats(
      current.projectId,
    ).catch(() => undefined);
    await this.emit();
  }

  async deleteProject(projectId: string): Promise<void> {
    const db = getDatabase();
    this.deletingProjects.add(projectId);

    try {
      const jobs = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.projectId, projectId))
        .all();

      for (const job of jobs) {
        const timer = this.timers.get(job.id);
        if (timer) {
          clearInterval(timer);
          this.timers.delete(job.id);
        }

        const controller = this.scanControllers.get(job.id);
        if (controller) {
          controller.abort();
          this.scanControllers.delete(job.id);
        }
      }

      await this.projects.deleteProject(projectId);

      db.delete(tasksTable)
        .where(eq(tasksTable.projectId, projectId))
        .run();

      await this.emit();
    } finally {
      this.deletingProjects.delete(projectId);
    }
  }

  private async startScanJob(
    projectId: string,
    options?: StartJobOptions,
  ): Promise<BackgroundJob> {
    const project = await this.projects.getProjectById(projectId);
    const papers = await this.projects.listProjectPapers(projectId);
    const pendingPaperCount = papers.filter((paper) =>
      paper.originalPages.some(
        (page) => !(options?.skipCompleted ?? true) || !page.scannedPath || !page.debugPreviewPath,
      ),
    ).length;
    const db = getDatabase();
    const now = new Date().toISOString();
    const jobId = nanoid();
    const controller = new AbortController();

    db.insert(tasksTable)
      .values({
        id: jobId,
        projectId,
        projectName: project.name,
        kind: 'scan',
        referenceAnswerVersion: null,
        status: 'running',
        progress: 0,
        speed: 0,
        eta: null,
        startedAt: now,
        finishedAt: null,
        archivedAt: null,
        abortable: true,
        currentPaperLabel: papers[0]?.paperCode ?? '准备中',
        summary: '正在批量扫描识别答卷',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    this.scanControllers.set(jobId, controller);
    await this.emit();
    void this.runScanJob(jobId, projectId, controller, Math.max(pendingPaperCount, 0), options);

    const row = db.select().from(tasksTable).where(eq(tasksTable.id, jobId)).get();
    return toJob(row!);
  }

  private async startMockJob(
    projectId: string,
    kind: JobKind,
    options?: StartJobOptions,
  ): Promise<BackgroundJob> {
    const project = await this.projects.getProjectById(projectId);
    const papers = await this.projects.listProjectPapers(projectId);
    const db = getDatabase();
    const now = new Date().toISOString();
    const jobId = nanoid();
    const baseSpeed = kind === 'scan' ? 0.12 : 0.08;
    const totalPaperCount = Math.max(papers.length, 0);
    const startedAtMs = Date.now();
    db.insert(tasksTable)
      .values({
        id: jobId,
        projectId,
        projectName: project.name,
        kind,
        referenceAnswerVersion: kind === 'grading' ? project.referenceAnswerVersion : null,
        status: 'running',
        progress: 0,
        speed: 0,
        eta: null,
        startedAt: now,
        finishedAt: null,
        archivedAt: null,
        abortable: true,
        currentPaperLabel: papers[0]?.paperCode ?? '准备中',
        summary: kind === 'scan' ? '正在批量扫描识别答卷' : '正在批量批阅扫描答卷',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    await this.emit();

    let tick = 0;
    const timer = setInterval(async () => {
      if (this.deletingProjects.has(projectId)) {
        clearInterval(timer);
        this.timers.delete(jobId);
        return;
      }

      tick += 1;
      const current = db.select().from(tasksTable).where(eq(tasksTable.id, jobId)).get();
      if (!current || current.status !== 'running') {
        clearInterval(timer);
        this.timers.delete(jobId);
        return;
      }

      const nextProgress = Math.min(
        1,
        Number((current.progress + 0.09 + Math.random() * 0.11).toFixed(3)),
      );
      const elapsedSeconds = Math.max((Date.now() - startedAtMs) / 1000, 1);
      const speed = getSecondsPerPaper(nextProgress, elapsedSeconds, totalPaperCount);
      const currentPaper = papers[Math.min(papers.length - 1, tick % Math.max(1, papers.length))];
      const summary = kind === 'scan'
        ? `正在识别纸张边界与扫描效果，已完成 ${(nextProgress * 100).toFixed(0)}%`
        : `正在根据评分细则批阅答卷，已完成 ${(nextProgress * 100).toFixed(0)}%`;

      db.update(tasksTable)
        .set({
          progress: nextProgress,
          speed,
          eta: estimateEta(nextProgress, speed * totalPaperCount),
          currentPaperLabel: currentPaper?.paperCode ?? current.currentPaperLabel,
          summary,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasksTable.id, jobId))
        .run();

      if (nextProgress >= 1) {
        clearInterval(timer);
        this.timers.delete(jobId);
        if (this.deletingProjects.has(projectId)) {
          return;
        }
        if (kind === 'scan') {
          await this.projects.completeMockScan(projectId);
        } else if (kind === 'grading') {
          await this.projects.completeMockGrading(projectId, options?.skipCompleted ?? true);
        }
        db.update(tasksTable)
          .set({
            status: 'completed',
            progress: 1,
            speed: getSecondsPerPaper(1, Math.max((Date.now() - startedAtMs) / 1000, 1), totalPaperCount),
            eta: null,
            finishedAt: new Date().toISOString(),
            summary: kind === 'scan' ? '扫描任务已完成' : '批阅任务已完成',
            updatedAt: new Date().toISOString(),
          })
          .where(eq(tasksTable.id, jobId))
          .run();
      }

      await this.emit();
    }, 1200);

    this.timers.set(jobId, timer);
    const row = db.select().from(tasksTable).where(eq(tasksTable.id, jobId)).get();
    return toJob(row!);
  }

  private async runScanJob(
    jobId: string,
    projectId: string,
    controller: AbortController,
    totalPaperCount: number,
    options?: StartJobOptions,
  ): Promise<void> {
    const db = getDatabase();
    const startedAt = Date.now();

    try {
      const result = await this.projects.scanProjectDocuments(projectId, {
        skipCompleted: options?.skipCompleted ?? true,
        signal: controller.signal,
        onProgress: async ({ completedPageCount, totalPageCount, currentPaperLabel }) => {
          const progress =
            totalPageCount > 0
              ? Number((completedPageCount / totalPageCount).toFixed(3))
              : 1;
          const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 1);
          const speed = getSecondsPerPaper(progress, elapsedSeconds, totalPaperCount);

          db.update(tasksTable)
            .set({
              progress,
              speed,
              eta: estimateEta(progress, speed * totalPaperCount),
              currentPaperLabel,
              summary: `正在识别纸张边界与扫描效果，已完成 ${completedPageCount}/${Math.max(totalPageCount, 1)} 页`,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(tasksTable.id, jobId))
            .run();

          await this.emit();
        },
      });

      if (controller.signal.aborted) {
        return;
      }

      if (this.deletingProjects.has(projectId)) {
        return;
      }

      db.update(tasksTable)
        .set({
          status: 'completed',
          progress: 1,
          speed: getSecondsPerPaper(
            1,
            Math.max((Date.now() - startedAt) / 1000, 1),
            totalPaperCount,
          ),
          eta: null,
          finishedAt: new Date().toISOString(),
          summary:
            result.totalPageCount > 0
              ? `扫描任务已完成，共处理 ${result.processedPageCount} 页`
              : '没有需要扫描的新答卷',
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasksTable.id, jobId))
        .run();
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      db.update(tasksTable)
        .set({
          status: 'failed',
          progress: 1,
          eta: null,
          finishedAt: new Date().toISOString(),
          summary: error instanceof Error ? error.message : '扫描任务执行失败',
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasksTable.id, jobId))
        .run();
    } finally {
      this.scanControllers.delete(jobId);
      await this.emit();
    }
  }

  private async emit(): Promise<void> {
    const tasks = await this.list();
    for (const listener of this.listeners) {
      listener(tasks);
    }
  }

  private isTerminalStatus(status: JobStatus): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  }
}
