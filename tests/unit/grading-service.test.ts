import { describe, expect, it, vi } from 'vitest';
import {
  canReuseCompiledRubric,
  getReferenceAnswerFingerprint,
  validateModelResult,
} from '../../src/main/services/gradingService';
import type { CompiledRubric } from '../../src/main/services/gradingTypes';

describe('canReuseCompiledRubric', () => {
  it('reuses rubric only when version and reference answer fingerprint both match', () => {
    const referenceAnswerMarkdown = '# 参考答案\n\n1. 正确答案';
    const fingerprint = getReferenceAnswerFingerprint(referenceAnswerMarkdown);

    expect(
      canReuseCompiledRubric(
        {
          referenceAnswerVersion: 4,
          referenceAnswerFingerprint: fingerprint,
        },
        {
          referenceAnswerVersion: 4,
          referenceAnswerMarkdown,
        },
      ),
    ).toBe(true);
  });

  it('forces regeneration when stored fingerprint is missing or outdated', () => {
    const referenceAnswerMarkdown = '# 参考答案\n\n1. 正确答案';

    expect(
      canReuseCompiledRubric(
        {
          referenceAnswerVersion: 4,
        },
        {
          referenceAnswerVersion: 4,
          referenceAnswerMarkdown,
        },
      ),
    ).toBe(false);

    expect(
      canReuseCompiledRubric(
        {
          referenceAnswerVersion: 4,
          referenceAnswerFingerprint: getReferenceAnswerFingerprint('# 旧答案'),
        },
        {
          referenceAnswerVersion: 4,
          referenceAnswerMarkdown,
        },
      ),
    ).toBe(false);
  });
});

describe('validateModelResult', () => {
  const rubric: CompiledRubric = {
    paperTitle: '模拟试卷',
    totalMaxScore: 3,
    questions: [
      {
        questionId: '1-1',
        questionTitle: '第一题',
        maxScore: 2,
        answerSummary: '略',
        scoringPoints: [
          {
            criterionId: '1-1-1',
            description: '采分点 1',
            maxScore: 1,
          },
          {
            criterionId: '1-1-2',
            description: '采分点 2',
            maxScore: 1,
          },
        ],
      },
      {
        questionId: '2',
        questionTitle: '第二题',
        maxScore: 1,
        answerSummary: '略',
        scoringPoints: [
          {
            criterionId: '2-1',
            description: '采分点 3',
            maxScore: 1,
          },
        ],
      },
    ],
  };

  it('prefers score breakdown totals over mismatched question and total scores', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = validateModelResult(
      {
        studentInfo: {
          className: '1班',
          studentId: '1001',
          name: '张三',
        },
        questionScores: [
          {
            questionId: '1-1',
            questionTitle: '第一题',
            maxScore: 2,
            score: 2,
            reasoning: 'reasoning',
            issues: [],
            scoreBreakdown: [
              {
                criterionId: '1-1-1',
                criterion: '采分点 1',
                maxScore: 1,
                score: 1,
                verdict: 'earned',
                evidence: '命中',
              },
              {
                criterionId: '1-1-2',
                criterion: '采分点 2',
                maxScore: 1,
                score: 0,
                verdict: 'missed',
                evidence: '未命中',
              },
            ],
          },
          {
            questionId: '2',
            questionTitle: '第二题',
            maxScore: 1,
            score: 1,
            reasoning: 'reasoning',
            issues: [],
            scoreBreakdown: [
              {
                criterionId: '2-1',
                criterion: '采分点 3',
                maxScore: 1,
                score: 1,
                verdict: 'earned',
                evidence: '命中',
              },
            ],
          },
        ],
        totalScore: 3,
        overallComment: '总体评价',
        overallAdvice: {
          summary: '总结',
          strengths: [],
          priorityKnowledgePoints: [],
          attentionPoints: [],
          encouragement: '继续努力',
        },
      },
      rubric,
      false,
    );

    expect(result.questionScores.map((question) => question.score)).toEqual([1, 1]);
    expect(result.totalScore).toBe(2);
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });
});
