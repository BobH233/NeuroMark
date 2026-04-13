interface BuildAnswerGenerationUserPromptInput {
  title: string;
  promptText: string;
  imageCount: number;
}

export function buildAnswerGenerationUserPrompt(
  input: BuildAnswerGenerationUserPromptInput,
): string {
  return `
下面是本次参考答案生成任务的信息：

任务标题：
${input.title}

教师补充要求：
${input.promptText}

题目图片数量：
${input.imageCount} 张

请结合题目图片和教师补充要求，生成适用于教师阅卷的参考答案与评分规则。
如果题目存在多问，请在 Markdown 中按小题分节组织内容。
如果题目图片中包含分值、题号、限制条件，请尽量保留并结构化表达。
必须保证整个输出是可被 JSON.parse 直接解析的合法 JSON，尤其是 referenceAnswerMarkdown 里的 Markdown、LaTeX、引号、换行和反斜杠都要按 JSON 规则正确转义。
如果要在 JSON 字符串中写出 LaTeX 命令，JSON 字符串里的反斜杠必须双写，例如 \\frac 要写成 \\\\frac，\\mathrm 要写成 \\\\mathrm，\\, 要写成 \\\\,。
`.trim();
}
