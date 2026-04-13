import type {
  ScorePostProcessProjectContext,
  ScorePostProcessScriptError,
} from '@preload/contracts';
import { SCORE_POST_PROCESS_AI_SCRIPT_RUNTIME_PROMPT } from '@preload/scorePostProcessScriptContract';

interface BuildScorePostProcessAiScriptUserPromptInput {
  instruction: string;
  project: ScorePostProcessProjectContext;
  scoreStats: {
    paperCount: number;
    minScore: number;
    maxScore: number;
    averageScore: number;
    medianScore: number;
    variance: number;
    standardDeviation: number;
    q1: number;
    q3: number;
    p10: number;
    p90: number;
  };
  repairError?: ScorePostProcessScriptError | null;
  previousScriptName?: string;
  previousScriptCode?: string;
}

export function buildScorePostProcessAiScriptUserPrompt(
  input: BuildScorePostProcessAiScriptUserPromptInput,
): string {
  const repairSection = input.repairError
    ? `
上一轮生成的脚本没有通过执行器校验，请你修复后重新返回完整 JSON：

上一轮脚本名称：
${input.previousScriptName ?? '未提供'}

上一轮脚本代码：
${input.previousScriptCode ?? '未提供'}

失败阶段：
${input.repairError.phase}

错误信息：
${input.repairError.message}

错误位置：
第 ${input.repairError.lineNumber ?? '?'} 行，第 ${input.repairError.columnNumber ?? '?'} 列

错误堆栈：
${input.repairError.stack}
`.trim()
    : '';

  return `
请为当前项目生成一段“分数后处理”脚本。

教师意图：
${input.instruction.trim()}

当前项目上下文：
${JSON.stringify(
    {
      projectId: input.project.id,
      projectName: input.project.name,
      referenceAnswerVersion: input.project.referenceAnswerVersion,
      stats: input.project.stats,
      settings: input.project.settings,
    },
    null,
    2,
  )}

当前批次答卷统计：
${JSON.stringify(input.scoreStats, null, 2)}

${SCORE_POST_PROCESS_AI_SCRIPT_RUNTIME_PROMPT}

编写要求：
1. 优先生成能稳定运行的脚本，再考虑花哨写法。
2. 如果教师意图要求“只改部分答卷”，请让未命中的答卷保留原分。
3. 如果需要整体统计，请先从 \`papers\` 提取分数数组再计算。
4. \`scriptName\` 要简洁明确，适合直接展示给教师。
5. \`summary\` 要说明主要处理逻辑。
6. \`metadata\` 只在确实有帮助时返回，保持为普通 JSON 对象。
7. 上面的统计信息只是帮助你理解当前分数分布，不代表固定分制，也不代表教师一定想做归一化；仍要以教师意图为第一优先级。
8. 除了 JSON 外，不要输出任何额外文字。

${repairSection}
`.trim();
}
