import type { ResultRecord } from '@preload/contracts';

export function buildSmartNameMatchUserPrompt(input: {
  rosterText: string;
  results: Array<
    ResultRecord & {
      finalResult: NonNullable<ResultRecord['finalResult']>;
      modelResult: NonNullable<ResultRecord['modelResult']>;
    }
  >;
}): string {
  const paperPayload = input.results.map((item) => ({
    paperId: item.paperId,
    paperCode: item.paperId,
    currentStudentInfo: {
      className: item.finalResult.studentInfo.className,
      studentId: item.finalResult.studentInfo.studentId,
      name: item.finalResult.studentInfo.name,
    },
    originalModelStudentInfo: {
      className: item.modelResult.studentInfo.className,
      studentId: item.modelResult.studentInfo.studentId,
      name: item.modelResult.studentInfo.name,
    },
    nameMatchStatus: item.nameMatchStatus,
  }));

  return `
请对以下已批阅答卷做智能核名。

【班级名册开始】
${input.rosterText.trim()}
【班级名册结束】

【待核对答卷开始】
${JSON.stringify(paperPayload, null, 2)}
【待核对答卷结束】

补充要求：
1. 名册文本可能是自然语言、自由格式、带空格、带标点或说明文字，你需要自行理解并提取。
2. 优先综合班级、学号、姓名三者进行交叉判断，不要只靠单一字段。
3. 如果姓名接近但班级或学号冲突，不可判定为 100% 确定。
4. 如果某个强特征能唯一命中名册，例如学号唯一命中，而姓名只是明显 OCR/手写误识别，你可以直接给出 certain_update 且 confidence=1。
5. 如果能明显判断是 OCR/手写识别错误，例如同音、近形、少字、多字、顺序错位，只要和名册唯一对应，就可以给出 certain_update。
6. 还请检查这些答卷之间是否疑似重复录入同一份卷子，并输出 duplicateGroups。
7. 输出必须覆盖所有 paperId，不允许遗漏。
`.trim();
}
