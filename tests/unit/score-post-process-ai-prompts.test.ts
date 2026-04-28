import { describe, expect, it } from 'vitest';
import { SCORE_POST_PROCESS_AI_SCRIPT_SYSTEM_PROMPT } from '../../src/main/prompts/score-post-process-ai/system';
import { buildScorePostProcessAiScriptUserPrompt } from '../../src/main/prompts/score-post-process-ai/user';

describe('score post-process AI script prompts', () => {
  it('emphasizes strict JSON-only output and script body requirements', () => {
    expect(SCORE_POST_PROCESS_AI_SCRIPT_SYSTEM_PROMPT).toContain(
      '只输出一个合法 JSON 对象',
    );
    expect(SCORE_POST_PROCESS_AI_SCRIPT_SYSTEM_PROMPT).toContain('scriptCode');
    expect(SCORE_POST_PROCESS_AI_SCRIPT_SYSTEM_PROMPT).toContain(
      '同步 JavaScript 脚本正文',
    );
  });

  it('includes runtime contract and builtin objects in the user prompt', () => {
    const prompt = buildScorePostProcessAiScriptUserPrompt({
      instruction: '把 80 分以下压缩到 60-80 分段',
      project: {
        id: 'project-1',
        name: '测试项目',
        rootPath: '/tmp/project-1',
        referenceAnswerVersion: 1,
        stats: {
          importedPaperCount: 3,
          scannedPaperCount: 3,
          gradedPaperCount: 3,
          averageScore: 76,
          pageCount: 6,
          lastTaskSummary: 'done',
        },
        settings: {
          gradingConcurrency: 2,
          drawRegions: false,
          defaultImageDetail: 'auto',
          enableScanPostProcess: false,
          skipScanProcessing: false,
          scanMarginRatio: 1,
          studentRoster: null,
        },
      },
      scoreStats: {
        paperCount: 3,
        minScore: 58,
        maxScore: 93,
        averageScore: 76,
        medianScore: 78,
        variance: 102.25,
        standardDeviation: 10.1119,
        q1: 65,
        q3: 84,
        p10: 60,
        p90: 91,
      },
    });

    expect(prompt).toContain('paper.paperId');
    expect(prompt).toContain('paper.totalScore');
    expect(prompt).toContain('utils.normalizeToRange');
    expect(prompt).toContain('outputMany');
    expect(prompt).toContain('Math');
    expect(prompt).toContain('不是完整函数，不是模块');
    expect(prompt).toContain('"medianScore": 78');
    expect(prompt).toContain('"variance": 102.25');
    expect(prompt).toContain('"standardDeviation": 10.1119');
    expect(prompt).toContain('不代表固定分制');
  });
});
