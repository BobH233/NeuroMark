import { describe, expect, it } from 'vitest';
import { buildGradingSystemPrompt } from '../../src/main/prompts/grading/system';
import { buildGradingUserPrompt } from '../../src/main/prompts/grading/user';
import { GRADING_RUBRIC_SYSTEM_PROMPT } from '../../src/main/prompts/grading/rubric-system';
import { buildRubricCompilationUserPrompt } from '../../src/main/prompts/grading/rubric-user';
import type { CompiledRubric } from '../../src/main/services/gradingTypes';

const rubric: CompiledRubric = {
  paperTitle: '测试试卷',
  totalMaxScore: 5,
  questions: [
    {
      questionId: '1',
      questionTitle: '求导',
      maxScore: 5,
      answerSummary: '正确写出 $x^2$ 的导数为 $2x$。',
      scoringPoints: [
        {
          criterionId: '1',
          description: '写出 $\\frac{d}{dx}x^2=2x$。',
          maxScore: 5,
        },
      ],
    },
  ],
};

describe('grading prompt guards', () => {
  it('keeps latex preservation instructions in rubric prompts', () => {
    const rubricUserPrompt = buildRubricCompilationUserPrompt({
      projectName: '数学项目',
      referenceAnswerVersion: 2,
      referenceAnswerMarkdown: '已知 $x_1^2 + x_2^2$，求导。',
    });

    expect(GRADING_RUBRIC_SYSTEM_PROMPT).toContain('必须尽量保留原始写法');
    expect(GRADING_RUBRIC_SYSTEM_PROMPT).toContain('不得擅自删除、补全、改写公式中的上下标');
    expect(rubricUserPrompt).toContain('不得私自改掉上下标、括号、分式、符号');
  });

  it('tells grading prompts to prioritize the original reference standard over rubric summaries', () => {
    const gradingSystemPrompt = buildGradingSystemPrompt(false);
    const gradingUserPrompt = buildGradingUserPrompt({
      projectName: '数学项目',
      paperCode: 'paper-001',
      imageNames: ['page-1.png'],
      referenceAnswerVersion: 2,
      referenceAnswerMarkdown: '标准答案：$x_1^2 + x_2^2$。',
      rubric,
      drawRegions: false,
    });

    expect(gradingSystemPrompt).toContain('你必须更多参考【参考答案与评分标准开始】与【参考答案与评分标准结束】之间的原始标准内容');
    expect(gradingSystemPrompt).toContain('如果你在 `reasoning`、`overallComment`、`scoreBreakdown.evidence` 等 Markdown 文本中写到公式，也必须使用严格的 LaTeX 表达');
    expect(gradingUserPrompt).toContain('rubric 只提供固定评分单元、满分和采分点约束');
    expect(gradingUserPrompt).toContain('这里的内容是本次阅卷更主要的判分依据');
    expect(gradingUserPrompt).toContain('如果在 reasoning、overallComment、scoreBreakdown.evidence 等 Markdown 文本里写到公式，必须严格使用 LaTeX 原样表达');
  });
});
