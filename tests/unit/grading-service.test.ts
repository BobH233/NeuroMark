import { describe, expect, it } from 'vitest';
import {
  canReuseCompiledRubric,
  getReferenceAnswerFingerprint,
} from '../../src/main/services/gradingService';

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
