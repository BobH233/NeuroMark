import { describe, expect, it } from 'vitest';
import type { FinalResult } from '../../src/preload/contracts';
import { computeDisplayedTotal } from '../../src/renderer/src/utils/result';

const baseResult: FinalResult = {
  studentInfo: {
    className: 'D4C9',
    studentId: '6918203745',
    name: '许清和',
  },
  questionScores: [
    {
      questionId: '1',
      questionTitle: '第一题',
      maxScore: 10,
      score: 6,
      reasoning: 'A',
      issues: [],
      scoreBreakdown: [],
    },
    {
      questionId: '2',
      questionTitle: '第二题',
      maxScore: 15,
      score: 12,
      reasoning: 'B',
      issues: [],
      scoreBreakdown: [],
    },
  ],
  totalScore: 18,
  overallAdvice: {
    summary: '基础尚可，但需要继续巩固关键考点。',
    strengths: ['计算结果基本稳定'],
    priorityKnowledgePoints: ['等效变换', '步骤表达'],
    attentionPoints: ['避免只写结论不写分析'],
    encouragement: '保持练习，先把核心知识点吃透。',
  },
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
