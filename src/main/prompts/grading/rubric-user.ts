import { GRADING_RUBRIC_JSON_SCHEMA } from './rubric-schema';
import { MATH_MARKDOWN_RENDERING_RULES } from '../shared/mathMarkdownRules';

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
12. 数学与 Markdown 渲染必须严格遵守下面这组统一规则：
${MATH_MARKDOWN_RENDERING_RULES}
13. 例如：不要输出“$U_{CQ1}\\approx **6.06\\mathrm{V}**$”这种写法；如果需要在公式里强调，必须改成“$U_{CQ1}\\approx \\mathbf{6.06}\\,\\mathrm{V}$”、“$\\boldsymbol{A_d\\approx -226}$”等合法 LaTeX 写法。
14. 输出前你必须自检：answerSummary、scoringPoints.description 中不得出现未被 $...$ 或 $$...$$ 包裹的数学表达。
15. 输出必须是可被 JSON.parse 直接解析的合法 JSON。JSON 字符串里的反斜杠必须双写；如果要输出 LaTeX，如 \\frac、\\mathrm、\\alpha、\\,，在 JSON 里必须分别写成 \\\\frac、\\\\mathrm、\\\\alpha、\\\\,。
16. 绝对禁止出现非法 JSON 转义，例如 \\,、\\m、\\l 这种单反斜杠写法；双引号和换行也必须按 JSON 规则正确转义。
17. 输出前必须自检：在保证数学公式原样保留的同时，整个输出仍然必须是合法 JSON。
18. 输出必须严格符合下面这份 JSON Schema：

${JSON.stringify(GRADING_RUBRIC_JSON_SCHEMA, null, 2)}

【参考答案与评分标准开始】
${input.referenceAnswerMarkdown}
【参考答案与评分标准结束】
`.trim();
}
