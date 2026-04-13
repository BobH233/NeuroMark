export const SCORE_POST_PROCESS_AI_SCRIPT_JSON_CONTRACT = `
返回 JSON 对象时，字段必须严格匹配以下结构：
{
  "scriptName": "string，适合直接填入脚本名称输入框",
  "summary": "string，简要概括这段脚本会如何处理分数",
  "assumptions": ["string，用于列出需要教师确认或你主动采用的假设"],
  "scriptCode": "string，直接放进现有分数后处理执行器里的同步脚本正文"
}

额外约束：
- 只返回一个 JSON 对象，不要返回额外字段。
- \`assumptions\` 必须始终返回数组，没有内容时返回空数组 []。
- \`scriptCode\` 必须是普通 JSON 字符串，不要再包裹 Markdown 代码块。
- \`scriptCode\` 必须是“脚本正文”，不是 \`function main() {}\`、不是箭头函数、不是 IIFE、不是模块。
`.trim();
