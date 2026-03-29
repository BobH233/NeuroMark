import { desc, eq } from 'drizzle-orm';
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
    status: row.status as JobStatus,
    progress: row.progress,
    speed: row.speed,
    eta: row.eta,
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

  const remaining = (1 - progress) / speed;
  if (remaining <= 0) {
    return null;
  }

  return dayjs().add(Math.ceil(remaining * 60), 'second').format('HH:mm:ss');
}

export class TaskManager {
  private listeners = new Set<TaskListener>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly projects: ProjectService) {}

  async list(): Promise<BackgroundJob[]> {
    const db = getDatabase();
    return db
      .select()
      .from(tasksTable)
      .orderBy(desc(tasksTable.updatedAt))
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
    return this.startMockJob(projectId, 'scan', options);
  }

  async startGrading(projectId: string, options?: StartJobOptions): Promise<BackgroundJob> {
    return this.startMockJob(projectId, 'grading', options);
  }

  async resumeGrading(projectId: string): Promise<BackgroundJob> {
    return this.startMockJob(projectId, 'grading', { skipCompleted: true });
  }

  async cancel(jobId: string): Promise<void> {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(jobId);
    }
    const db = getDatabase();
    db.update(tasksTable)
      .set({
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
        summary: '任务已取消',
      })
      .where(eq(tasksTable.id, jobId))
      .run();
    await this.projects.recomputeStats(
      db.select().from(tasksTable).where(eq(tasksTable.id, jobId)).get()?.projectId ?? '',
    ).catch(() => undefined);
    await this.emit();
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
    db.insert(tasksTable)
      .values({
        id: jobId,
        projectId,
        projectName: project.name,
        kind,
        status: 'running',
        progress: 0,
        speed: baseSpeed,
        eta: estimateEta(0.01, baseSpeed),
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
      const speed = Number((baseSpeed + Math.random() * 0.05).toFixed(3));
      const currentPaper = papers[Math.min(papers.length - 1, tick % Math.max(1, papers.length))];
      const summary = kind === 'scan'
        ? `正在识别纸张边界与扫描效果，已完成 ${(nextProgress * 100).toFixed(0)}%`
        : `正在根据评分细则批阅答卷，已完成 ${(nextProgress * 100).toFixed(0)}%`;

      db.update(tasksTable)
        .set({
          progress: nextProgress,
          speed,
          eta: estimateEta(nextProgress, speed),
          currentPaperLabel: currentPaper?.paperCode ?? current.currentPaperLabel,
          summary,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasksTable.id, jobId))
        .run();

      if (nextProgress >= 1) {
        clearInterval(timer);
        this.timers.delete(jobId);
        if (kind === 'scan') {
          await this.projects.completeMockScan(projectId);
        } else if (kind === 'grading') {
          await this.projects.completeMockGrading(projectId, options?.skipCompleted ?? true);
        }
        db.update(tasksTable)
          .set({
            status: 'completed',
            progress: 1,
            eta: null,
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

  private async emit(): Promise<void> {
    const tasks = await this.list();
    for (const listener of this.listeners) {
      listener(tasks);
    }
  }
}

