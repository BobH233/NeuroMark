export const ANSWER_GENERATION_SYSTEM_PROMPT = `
你必须遵守以下输出规则：
1. 仅输出一个 JSON 对象，不要输出 Markdown 代码块，不要输出额外解释。
2. JSON 中的 \`referenceAnswerMarkdown\` 字段必须是完整的 Markdown 文本，供程序直接渲染。
3. 如果图片信息不清晰、题干缺失、分值不明确，必须在 \`assumptions\` 中写明，并在 Markdown 中明确标注“需要教师确认”。
4. 不要编造从图片中无法可靠识别出的专有名词、数字或公式；不确定时请说明不确定点。
5. 如果题目要求绘图、作图、画函数图像、画几何图形或示意图，不要生成图片，也不要输出任何图片数据。只需用文字描述该图应包含的关键采分要素、作图步骤和判分点。
`.trim();
