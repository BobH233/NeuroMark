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
12. 在 answerSummary 和 scoringPoints.description 中，只要出现任何数学表达，都必须带数学定界符 $：行内公式使用 $...$，独立成段的公式使用 $$...$$。
13. 这里的“数学表达”包括但不限于：\\frac{2}{3}、\\approx、\\parallel、R_L、x^2、A_u、r_{be}、带上下标的字母、希腊字母公式、单独出现的关键变量名或符号。以上内容即使只是在一句中文里出现一个符号，也必须写成带 $ 的形式。
14. 裸写 \\frac{2}{3}、-\\frac{1000}{11}、\\approx -60.61、R_L、A_u 都是格式错误。输出前你必须自检：answerSummary、scoringPoints.description 中不得出现未被 $...$ 或 $$...$$ 包裹的数学表达。
15. 输出必须严格符合下面这份 JSON Schema：

${JSON.stringify(GRADING_RUBRIC_JSON_SCHEMA, null, 2)}

【参考答案与评分标准开始】
${input.referenceAnswerMarkdown}
【参考答案与评分标准结束】
`.trim();
}
