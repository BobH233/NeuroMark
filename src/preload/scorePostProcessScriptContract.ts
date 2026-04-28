export interface ScorePostProcessScriptDocItem {
  title: string;
  description: string;
}

export const SCORE_POST_PROCESS_SCRIPT_DOC_ITEMS: ScorePostProcessScriptDocItem[] =
  [
    {
      title: '可用全局对象',
      description:
        '`project`、`papers`、`utils`、`output()`、`outputMany()`、`log()`',
    },
    {
      title: 'project',
      description:
        '当前项目信息，只读。包含 `id`、`name`、`rootPath`、`referenceAnswerVersion`、`stats`、`settings`。',
    },
    {
      title: 'papers',
      description:
        '已批改答卷数组，只读。每项都有 `paperId`、`paperCode`、`originalScore`、`totalScore`、`modelScore`、`manualScore`、`studentInfo`、`questionScores`、`nameMatchStatus`、`referenceAnswerVersion`、`updatedAt`、`pageCount`、`scanStatus`、`gradingStatus`。',
    },
    {
      title: 'studentInfo',
      description:
        '`studentInfo.className` 是班级，`studentInfo.studentId` 是学号，`studentInfo.name` 是姓名。',
    },
    {
      title: 'questionScores',
      description:
        '`questionScores[*].questionId` 是题目 ID，`questionTitle` 是题目标题，`score` 是该题得分，`maxScore` 是该题满分。',
    },
    {
      title: 'utils',
      description:
        '内置数学工具：`clamp`、`round`、`sum`、`average`、`min`、`max`、`quantile`、`percentile`、`zScore`、`normalizeToRange`。',
    },
    {
      title: 'JS 内建对象',
      description:
        '可以使用安全的 JavaScript 内建对象，例如 `Math`、`Number`、`String`、`Boolean`、`Array`、`Object`、`JSON`。',
    },
    {
      title: '输出结果',
      description:
        '可以直接 `return [...]`，也可以 `return { outputs, summary }`，还可以调用 `output(...)` / `outputMany(...)`。每条输出至少要有 `paperId`。',
    },
    {
      title: 'summary',
      description:
        '`return { summary }` 里的 `summary` 会显示在“脚本汇总”里，必须是普通 JSON 对象。',
    },
    {
      title: 'log()',
      description:
        '`log(...args)` 会把调试信息写到“脚本日志”区域，适合排查计算逻辑。',
    },
    {
      title: '限制',
      description:
        '脚本必须是同步 JavaScript 正文，不要写 `async` / `await`、`import`、`require`、文件系统、网络请求或无限循环。',
    },
  ];

export const SCORE_POST_PROCESS_AI_SCRIPT_RUNTIME_PROMPT = `
当前分数后处理脚本运行环境如下，请严格按这个环境生成代码：

1. 你的 \`scriptCode\` 会被程序直接包进：
\`"use strict"; (function () { /* 这里插入 scriptCode */ })()\`
所以你返回的必须是“函数体内部的同步脚本正文”，不是完整函数，不是模块，不要包裹三引号或代码块。

2. 可用全局对象：
- \`project\`: 当前项目信息，只读。
  - \`project.id\`: 项目 ID
  - \`project.name\`: 项目名称
  - \`project.rootPath\`: 项目目录路径，只读说明信息，不可用来读写文件
  - \`project.referenceAnswerVersion\`: 当前参考答案版本
  - \`project.stats.importedPaperCount\`: 导入答卷数量
  - \`project.stats.scannedPaperCount\`: 已扫描答卷数量
  - \`project.stats.gradedPaperCount\`: 已批改答卷数量
  - \`project.stats.averageScore\`: 当前平均分
  - \`project.stats.pageCount\`: 总页数
  - \`project.stats.lastTaskSummary\`: 最近任务摘要
  - \`project.settings.gradingConcurrency\`: 批阅并发数
  - \`project.settings.drawRegions\`: 是否绘制区域
  - \`project.settings.defaultImageDetail\`: 图像细节等级
  - \`project.settings.enableScanPostProcess\`: 是否开启扫描后处理
  - \`project.settings.skipScanProcessing\`: 是否跳过扫描处理
  - \`project.settings.scanMarginRatio\`: 扫描裕度比例

- \`papers\`: 已批改答卷数组，只读。每个元素都表示一份答卷。
  - \`paper.paperId\`: 试卷唯一 ID，输出结果时必须原样带回
  - \`paper.paperCode\`: 试卷编号
  - \`paper.originalScore\`: 当前原始最终分数
  - \`paper.totalScore\`: 与 \`originalScore\` 相同，可视为当前最终分
  - \`paper.modelScore\`: 模型打分总分
  - \`paper.manualScore\`: 人工修订后的总分，没有则为 \`null\`
  - \`paper.studentInfo.className\`: 班级
  - \`paper.studentInfo.studentId\`: 学号
  - \`paper.studentInfo.name\`: 姓名
  - \`paper.questionScores\`: 每题得分数组
    - \`question.questionId\`: 题目 ID
    - \`question.questionTitle\`: 题目标题
    - \`question.score\`: 该题得分
    - \`question.maxScore\`: 该题满分
  - \`paper.nameMatchStatus\`: 核名状态，\`unverified\` 或 \`verified\`
  - \`paper.referenceAnswerVersion\`: 该答卷对应的参考答案版本
  - \`paper.updatedAt\`: 更新时间
  - \`paper.pageCount\`: 页数
  - \`paper.scanStatus\`: 扫描状态
  - \`paper.gradingStatus\`: 批阅状态

- \`utils\`: 数学工具对象，只读。
  - \`utils.clamp(value, min, max)\`
  - \`utils.round(value, digits?)\`
  - \`utils.sum(values)\`
  - \`utils.average(values)\`
  - \`utils.min(values)\`
  - \`utils.max(values)\`
  - \`utils.quantile(values, q)\`
  - \`utils.percentile(values, score)\`
  - \`utils.zScore(value, population)\`
  - \`utils.normalizeToRange(values, targetMin, targetMax)\`

- \`output(row)\`: 追加一条输出结果
- \`outputMany(rows)\`: 批量追加输出结果
- \`log(...args)\`: 输出调试日志
- 可以使用安全的 JavaScript 内建对象：\`Math\`、\`Number\`、\`String\`、\`Boolean\`、\`Array\`、\`Object\`、\`JSON\`

3. 允许的输出方式：
- 直接 \`return [{ paperId, processedScore, gradeLabel, note, metadata }]\`
- 或 \`return { outputs: [...], summary: {...} }\`
- 或调用 \`output(...)\` / \`outputMany(...)\`

4. 每条输出对象字段约定：
- \`paperId\`: 必填，必须来自当前 \`papers[*].paperId\`
- \`processedScore\`: 可选，数字；不填则该答卷保留原分
- \`gradeLabel\`: 可选，字符串或 \`null\`
- \`note\`: 可选，字符串或 \`null\`
- \`metadata\`: 可选，普通 JSON 对象

5. 重要限制：
- 只能写同步 JavaScript，不要 \`async\`、\`await\`
- 不要 \`import\`、\`export\`、\`require\`
- 不要访问文件系统、网络、进程、定时器或外部环境
- 不要生成解释文字、Markdown 代码块或额外包装
- 代码必须能直接通过当前分数后处理执行器编译并运行
`.trim();

export const SCORE_POST_PROCESS_EDITOR_TYPES = `declare interface StudentInfo {
  className: string;
  studentId: string;
  name: string;
}

declare interface ScorePostProcessProject {
  id: string;
  name: string;
  rootPath: string;
  referenceAnswerVersion: number;
  stats: {
    importedPaperCount: number;
    scannedPaperCount: number;
    gradedPaperCount: number;
    averageScore: number;
    pageCount: number;
    lastTaskSummary: string;
  };
  settings: {
    gradingConcurrency: number;
    drawRegions: boolean;
    defaultImageDetail: 'low' | 'high' | 'auto';
    enableScanPostProcess: boolean;
    skipScanProcessing: boolean;
    scanMarginRatio: number;
  };
}

declare interface ScorePostProcessPaper {
  paperId: string;
  paperCode: string;
  originalScore: number;
  totalScore: number;
  modelScore: number;
  manualScore: number | null;
  studentInfo: StudentInfo;
  questionScores: Array<{
    questionId: string;
    questionTitle: string;
    score: number;
    maxScore: number;
  }>;
  nameMatchStatus: 'unverified' | 'verified';
  referenceAnswerVersion: number;
  updatedAt: string;
  pageCount: number;
  scanStatus: 'pending' | 'ready' | 'processing' | 'completed' | 'skipped' | 'failed';
  gradingStatus: 'pending' | 'ready' | 'processing' | 'completed' | 'skipped' | 'failed';
}

declare interface ScorePostProcessOutput {
  paperId: string;
  processedScore?: number;
  gradeLabel?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}

declare const project: ScorePostProcessProject;
declare const papers: ScorePostProcessPaper[];
declare const utils: {
  clamp(value: number, min: number, max: number): number;
  round(value: number, digits?: number): number;
  sum(values: number[]): number;
  average(values: number[]): number;
  min(values: number[]): number;
  max(values: number[]): number;
  quantile(values: number[], q: number): number;
  percentile(values: number[], score: number): number;
  zScore(value: number, population: number[]): number;
  normalizeToRange(values: number[], targetMin: number, targetMax: number): number[];
};
declare function output(row: ScorePostProcessOutput): void;
declare function outputMany(rows: ScorePostProcessOutput[]): void;
declare function log(...args: unknown[]): void;
`;
