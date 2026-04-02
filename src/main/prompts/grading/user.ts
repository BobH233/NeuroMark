import type { CompiledRubric } from '@main/services/gradingTypes';
import { buildGradingJsonSchema } from './schema';

export function buildGradingUserPrompt(input: {
  projectName: string;
  paperCode: string;
  imageNames: string[];
  referenceAnswerVersion: number;
  referenceAnswerMarkdown: string;
  rubric: CompiledRubric;
  drawRegions: boolean;
}): string {
  const imageLines = input.imageNames.map((name) => `- ${name}`).join('\n');
  const questionLines = input.rubric.questions
    .map(
      (question, index) =>
        `${index + 1}. ${question.questionId} | ${question.questionTitle} | 满分 ${question.maxScore}`,
    )
    .join('\n');

  const regionHint = input.drawRegions
    ? '请在 questionRegions 中尽量给出每个已识别题目的边界框；如果某题无法可靠定位，可以省略该题的区域。'
    : '不要返回 questionRegions。';
  const gradingSchema = buildGradingJsonSchema(input.rubric, input.drawRegions);

  return `
你现在要批阅项目「${input.projectName}」中的答卷「${input.paperCode}」。

这是一份可能包含多页的同一张试卷，你必须综合所有页面统一评分，不得拆成多份答卷。

本次输入图片：
${imageLines}

本次固定评分单元如下，你必须严格按这个顺序、这个粒度输出 questionScores：
${questionLines}

输出要求：
1. studentInfo 中的班级、学号、姓名如果无法辨认，填空字符串。
2. questionScores 必须和固定评分单元一一对应，顺序完全一致。
3. 每个小题的 reasoning 建议至少包含这些小节：
   - ### 学生答案
   - ### 标准答案
   - ### 采分点判定
   - ### 扣分原因
   - ### 改进建议
4. 每个小题的 scoreBreakdown 必须逐条对应 rubric 中该题的 scoringPoints。
5. overallAdvice 是整张试卷级别的建议，必须综合所有题目表现来写，不能只是复制 overallComment。
6. overallAdvice.summary 用 1 到 2 句话总结当前学习状态。
7. overallAdvice.strengths 列出该学生本次试卷表现较好的方面，可以为空数组。
8. overallAdvice.priorityKnowledgePoints 列出最需要优先补强的知识点，按优先级排序，可以为空数组。
9. overallAdvice.attentionPoints 列出答题习惯、审题、书写、步骤表达等需要注意的问题，可以为空数组。
10. overallAdvice.encouragement 必须给出一句面向学生的鼓励或提醒，语气自然、克制。
11. ${regionHint}
12. 顶层字段名必须严格使用：studentInfo、questionScores、totalScore、overallComment、overallAdvice${input.drawRegions ? '、questionRegions' : ''}。
13. studentInfo 的字段名必须严格使用：className、studentId、name。
14. 每个 questionScores 项的字段名必须严格使用：questionId、questionTitle、maxScore、score、reasoning、issues、scoreBreakdown。
15. 每个 scoreBreakdown 项的字段名必须严格使用：criterionId、criterion、maxScore、score、verdict、evidence。
16. overallAdvice 的字段名必须严格使用：summary、strengths、priorityKnowledgePoints、attentionPoints、encouragement。
17. 不要返回任何未在 schema 中出现的别名字段，不要自行改写字段名。
18. 如果在 reasoning、overallComment、scoreBreakdown.evidence、scoreBreakdown.criterion 等 Markdown 文本里写到公式，必须严格使用 LaTeX 原样表达，不得私自改掉上下标、分式、根号、括号层级、希腊字母或省略关键公式片段。
19. 只要出现任何数学表达，都必须带数学定界符 $：行内公式使用 $...$，独立成段的公式使用 $$...$$。
20. 这里的“数学表达”包括但不限于：\\frac{2}{3}、\\approx、\\parallel、R_L、x^2、A_u、r_{be}、希腊字母公式、带上下标或分式的表达。以上内容即使只是在一句中文里出现一个符号，也必须写成带 $ 的形式，例如 $\\frac{2}{3}$、$\\approx -60.61$、$R_L$、$A_u$。
21. 裸写 \\frac{2}{3}、-\\frac{1000}{11}、\\approx -60.61、R_L、A_u 都是格式错误。输出前你必须自检：reasoning、overallComment、scoreBreakdown.evidence、scoreBreakdown.criterion 中不得出现未被 $...$ 或 $$...$$ 包裹的数学表达。
22. 输出必须严格符合下面这份 JSON Schema：

${JSON.stringify(gradingSchema, null, 2)}

下面是本次阅卷必须严格遵守的 rubric JSON。注意：rubric 只提供固定评分单元、满分和采分点约束；具体判分时，你必须更多参考后面的原始“参考答案与评分标准”正文：
${JSON.stringify(input.rubric, null, 2)}

下面是老师维护的参考答案原文。这里的内容是本次阅卷更主要的判分依据，尤其当 rubric 中的概括与原文细节相比更简略时，必须以这里的标准内容为准：
【参考答案与评分标准开始】
${input.referenceAnswerMarkdown}
【参考答案与评分标准结束】

本次参考答案版本：v${input.referenceAnswerVersion}
`.trim();
}
