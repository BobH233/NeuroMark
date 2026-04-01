import { GRADING_RUBRIC_JSON_SCHEMA } from './rubric-schema';

export function buildRubricCompilationUserPrompt(input: {
  projectName: string;
  referenceAnswerVersion: number;
  referenceAnswerMarkdown: string;
}): string {
  return `
请为项目「${input.projectName}」的参考答案版本 v${input.referenceAnswerVersion} 编译 rubric。

输出约束：
1. questions 必须按老师原始题号顺序输出。
2. 如果存在大题与小题，必须输出到小题粒度。
3. totalMaxScore 必须严格等于所有 questions.maxScore 之和。
4. 每个 question 的 scoringPoints.maxScore 之和必须严格等于该 question.maxScore。
5. questionTitle 要简洁，不要复述整段题面。
6. answerSummary 要概括正确答案与关键采分要求，供后续阅卷提示词直接注入。
7. 顶层字段名必须严格使用：paperTitle、totalMaxScore、questions。
8. 每个 question 的字段名必须严格使用：questionId、questionTitle、maxScore、answerSummary、scoringPoints。
9. 每个 scoringPoints 项的字段名必须严格使用：criterionId、description、maxScore。
10. 不要使用 pointId、pointDescription、title、paper_name 等其他命名。
11. 如果老师原文里有 LaTeX 公式或数学表达，answerSummary 和 scoringPoints.description 中必须尽量保留原文公式，不得私自改掉上下标、括号、分式、符号或省略公式片段。
12. 输出必须严格符合下面这份 JSON Schema：

${JSON.stringify(GRADING_RUBRIC_JSON_SCHEMA, null, 2)}

【参考答案与评分标准开始】
${input.referenceAnswerMarkdown}
【参考答案与评分标准结束】
`.trim();
}
