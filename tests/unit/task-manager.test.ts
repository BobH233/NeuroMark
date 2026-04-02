import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rows, fakeDb } = vi.hoisted(() => {
  const rows: any[] = [];
  const fakeDb = {
    select: () => ({
      from() {
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      all() {
        return [...rows];
      },
      get() {
        return rows.at(-1);
      },
    }),
    insert: () => ({
      values(value: any) {
        return {
          run() {
            rows.push(value);
          },
        };
      },
    }),
  };

  return { rows, fakeDb };
});

vi.mock('@main/database/client', () => ({
  getDatabase: () => fakeDb,
}));

import { TaskManager, shouldGradePaper } from '../../src/main/services/taskManager';

describe('TaskManager.startGrading', () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it('marks the job completed immediately when all papers are already graded', async () => {
    const projects = {
      resetProcessingResults: vi.fn().mockResolvedValue(undefined),
      listProjectPapers: vi.fn().mockResolvedValue([
        {
          paperCode: 'A-001',
          scanStatus: 'completed',
          gradingStatus: 'completed',
          gradingReferenceAnswerVersion: 2,
        },
      ]),
    } as any;
    const gradingService = {
      prepareProjectGrading: vi.fn().mockResolvedValue({
        project: {
          name: '示例项目',
          referenceAnswerVersion: 2,
        },
      }),
    } as any;

    const manager = new TaskManager(projects, gradingService);
    const job = await manager.startGrading('project-1', { skipCompleted: true });

    expect(job.status).toBe('completed');
    expect(job.progress).toBe(1);
    expect(job.finishedAt).toBeTruthy();
    expect(job.abortable).toBe(false);
    expect(job.currentPaperLabel).toBe('全部完成');
    expect(job.summary).toBe('没有需要批阅的新答卷');
  });
});

describe('shouldGradePaper', () => {
  it('requeues completed papers when their reference answer version is outdated', () => {
    expect(
      shouldGradePaper(
        {
          scanStatus: 'completed',
          gradingStatus: 'completed',
          gradingReferenceAnswerVersion: 2,
        },
        3,
        true,
      ),
    ).toBe(true);
  });

  it('skips already graded papers when their reference answer version is current', () => {
    expect(
      shouldGradePaper(
        {
          scanStatus: 'completed',
          gradingStatus: 'completed',
          gradingReferenceAnswerVersion: 3,
        },
        3,
        true,
      ),
    ).toBe(false);
  });
});
