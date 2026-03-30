export const ANSWER_GENERATION_JSON_CONTRACT = `
返回 JSON 对象时，字段必须严格匹配以下结构：
{
  "summary": "string，简要概括本次生成结果",
  "assumptions": ["string，用于列出不确定点或需要教师确认的信息"],
  "referenceAnswerMarkdown": "string，完整 Markdown 文本"
}

额外约束：
- 不要返回额外字段。
- \`assumptions\` 必须始终返回数组，没有内容时返回空数组 []。
- \`referenceAnswerMarkdown\` 必须是普通 JSON 字符串，不要再包裹三引号或代码块。
`.trim();
