import { describe, expect, it } from 'vitest';
import type { FinalResult } from '../../src/preload/contracts';
import { computeDisplayedTotal } from '../../src/renderer/src/utils/result';

const baseResult: FinalResult = {
  studentInfo: {
    className: '06212401',
    studentId: '1120241001',
    name: '测试学生',
  },
  questionScores: [
    {
      questionId: '1',
      questionTitle: '第一题',
      maxScore: 10,
      score: 6,
      reasoning: 'A',
      issues: [],
    },
    {
      questionId: '2',
      questionTitle: '第二题',
      maxScore: 15,
      score: 12,
      reasoning: 'B',
      issues: [],
    },
  ],
  totalScore: 18,
  overallComment: 'OK',
};

describe('computeDisplayedTotal', () => {
  it('returns manual total when it exists', () => {
    expect(
      computeDisplayedTotal({
        ...baseResult,
        manualTotalScore: 20,
      }),
    ).toBe(20);
  });

  it('falls back to sum of question scores when no manual total exists', () => {
    expect(computeDisplayedTotal(baseResult)).toBe(18);
  });
});

