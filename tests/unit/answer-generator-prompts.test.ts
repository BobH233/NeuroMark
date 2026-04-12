import { describe, expect, it } from 'vitest';
import { ANSWER_GENERATION_SYSTEM_PROMPT } from '../../src/main/prompts/answer-generator/system';
import { buildAnswerGenerationUserPrompt } from '../../src/main/prompts/answer-generator/user';

describe('answer generation prompt guards', () => {
  it('emphasizes strict JSON escaping requirements', () => {
    const userPrompt = buildAnswerGenerationUserPrompt({
      title: '数学卷',
      promptText: '尽量保留原题公式。',
      imageCount: 2,
    });

    expect(ANSWER_GENERATION_SYSTEM_PROMPT).toContain('可被 `JSON.parse` 直接解析');
    expect(ANSWER_GENERATION_SYSTEM_PROMPT).toContain('所有反斜杠都必须按 JSON 规则转义');
    expect(ANSWER_GENERATION_SYSTEM_PROMPT).toContain('`\\\\frac`');
    expect(ANSWER_GENERATION_SYSTEM_PROMPT).toContain('非法 JSON 转义');
    expect(userPrompt).toContain('必须保证整个输出是可被 JSON.parse 直接解析的合法 JSON');
    expect(userPrompt).toContain('JSON 字符串里的反斜杠必须双写');
  });
});
