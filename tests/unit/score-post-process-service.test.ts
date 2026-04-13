import { describe, expect, it } from 'vitest';
import type { ScorePostProcessPaperData } from '@preload/contracts';
import {
  createScriptError,
  normalizeScriptOutputs,
  normalizeToRange,
} from '@main/services/scorePostProcessService';

function createPaper(
  overrides: Partial<ScorePostProcessPaperData>,
): ScorePostProcessPaperData {
  return {
    paperId: 'paper-1',
    paperCode: 'paper-1',
    originalScore: 72,
    totalScore: 72,
    modelScore: 70,
    manualScore: 72,
    studentInfo: {
      className: '一班',
      studentId: '001',
      name: '张三',
    },
    questionScores: [],
    nameMatchStatus: 'verified',
    referenceAnswerVersion: 1,
    updatedAt: '2026-04-13T00:00:00.000Z',
    pageCount: 2,
    scanStatus: 'completed',
    gradingStatus: 'completed',
    ...overrides,
  };
}

describe('scorePostProcessService helpers', () => {
  it('normalizes a score list into the target range', () => {
    expect(normalizeToRange([50, 75, 100], 60, 100)).toEqual([60, 80, 100]);
  });

  it('falls back to original score when script does not output a paper', () => {
    const rows = normalizeScriptOutputs(
      [
        createPaper({
          paperId: 'paper-1',
          paperCode: '卷一',
          originalScore: 72,
        }),
        createPaper({
          paperId: 'paper-2',
          paperCode: '卷二',
          originalScore: 88,
        }),
      ],
      [
        {
          paperId: 'paper-1',
          processedScore: 90,
          gradeLabel: 'A',
          metadata: {
            boosted: true,
          },
        },
      ],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        paperId: 'paper-1',
        processedScore: 90,
        scoreDelta: 18,
        applied: true,
        gradeLabel: 'A',
      }),
      expect.objectContaining({
        paperId: 'paper-2',
        processedScore: 88,
        scoreDelta: 0,
        applied: false,
        gradeLabel: null,
      }),
    ]);
  });

  it('maps vm stack locations back to script line numbers', () => {
    const runtimeError = new Error('boom');
    runtimeError.stack = 'Error: boom\n    at <score-post-process-script>:5:9';
    const error = createScriptError('runtime', runtimeError);

    expect(error.lineNumber).toBe(3);
    expect(error.columnNumber).toBe(9);
  });
});
