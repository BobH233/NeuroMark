export const SMART_NAME_MATCH_JSON_CONTRACT = `
{
  "summary": "一句话总结本次核名结论",
  "suggestions": [
    {
      "paperId": "与输入中的 paperId 完全一致",
      "paperCode": "与输入中的 paperCode 完全一致",
      "decision": "certain_update | certain_keep | uncertain | no_match",
      "confidence": 0 到 1 之间的小数，只有 1 才能表示 100% 确定,
      "matchedRosterLine": "命中的名册原始行，无法确定时填 null",
      "currentStudentInfo": {
        "className": "当前识别班级",
        "studentId": "当前识别学号",
        "name": "当前识别姓名"
      },
      "suggestedStudentInfo": {
        "className": "建议改成的班级",
        "studentId": "建议改成的学号",
        "name": "建议改成的姓名"
      },
      "changedFields": ["className", "studentId", "name"],
      "reason": "为什么这样判断",
      "uncertaintyNotes": ["若不确定，列出原因；完全确定时可为空数组"]
    }
  ],
  "duplicateGroups": [
    {
      "paperIds": ["疑似重复的 paperId，至少 2 个"],
      "paperCodes": ["对应的 paperCode，顺序与 paperIds 对齐"],
      "confidence": 0 到 1 之间的小数，只有在你非常确定重复时才接近 1,
      "reason": "为什么判断这些卷子疑似是同一份卷子重复录入",
      "evidence": ["支持该判断的证据点"]
    }
  ]
}
`.trim();
