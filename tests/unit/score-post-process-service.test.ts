import { describe, expect, it } from 'vitest';
import type {
  ScorePostProcessPaperData,
  ScorePostProcessProjectContext,
} from '@preload/contracts';
import {
  createScriptError,
  executeScorePostProcessScript,
  normalizeScriptOutputs,
  normalizeToRange,
  parseScorePostProcessAiScriptModelResponse,
} from '@main/services/scorePostProcessService';

function createPaper(
  overrides: Partial<ScorePostProcessPaperData>,
): ScorePostProcessPaperData {
  return {
    paperId: 'paper-1',
    paperCode: 'paper-1',
    originalScore: 72,
    totalScore: 72,
    modelScore: 70,
    manualScore: 72,
    studentInfo: {
      className: '一班',
      studentId: '7482051936',
      name: '沈沐阳',
    },
    questionScores: [],
    nameMatchStatus: 'verified',
    referenceAnswerVersion: 1,
    updatedAt: '2026-04-13T00:00:00.000Z',
    pageCount: 2,
    scanStatus: 'completed',
    gradingStatus: 'completed',
    ...overrides,
  };
}

function createProjectContext(): ScorePostProcessProjectContext {
  return {
    id: 'project-1',
    name: '测试项目',
    rootPath: '/tmp/project-1',
    referenceAnswerVersion: 1,
    stats: {
      importedPaperCount: 2,
      scannedPaperCount: 2,
      gradedPaperCount: 2,
      averageScore: 80,
      pageCount: 4,
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
  };
}

describe('scorePostProcessService helpers', () => {
  it('normalizes a score list into the target range', () => {
    expect(normalizeToRange([50, 75, 100], 60, 100)).toEqual([60, 80, 100]);
  });

  it('falls back to original score when script does not output a paper', () => {
    const rows = normalizeScriptOutputs(
      [
        createPaper({
          paperId: 'paper-1',
          paperCode: '卷一',
          originalScore: 72,
        }),
        createPaper({
          paperId: 'paper-2',
          paperCode: '卷二',
          originalScore: 88,
        }),
      ],
      [
        {
          paperId: 'paper-1',
          processedScore: 90,
          gradeLabel: 'A',
          metadata: {
            boosted: true,
          },
        },
      ],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        paperId: 'paper-1',
        processedScore: 90,
        scoreDelta: 18,
        applied: true,
        gradeLabel: 'A',
      }),
      expect.objectContaining({
        paperId: 'paper-2',
        processedScore: 88,
        scoreDelta: 0,
        applied: false,
        gradeLabel: null,
      }),
    ]);
  });

  it('maps vm stack locations back to script line numbers', () => {
    const runtimeError = new Error('boom');
    runtimeError.stack = 'Error: boom\n    at <score-post-process-script>:5:9';
    const error = createScriptError('runtime', runtimeError);

    expect(error.lineNumber).toBe(3);
    expect(error.columnNumber).toBe(9);
  });

  it('reports compile errors from in-memory script execution', () => {
    const result = executeScorePostProcessScript({
      projectId: 'project-1',
      projectContext: createProjectContext(),
      paperInputs: [createPaper({})],
      scriptName: 'broken',
      scriptCode: 'return {',
    });

    expect(result.success).toBe(false);
    expect(result.error?.phase).toBe('compile');
  });

  it('reports runtime errors from in-memory script execution', () => {
    const result = executeScorePostProcessScript({
      projectId: 'project-1',
      projectContext: createProjectContext(),
      paperInputs: [createPaper({})],
      scriptName: 'boom',
      scriptCode: "throw new Error('boom');",
    });

    expect(result.success).toBe(false);
    expect(result.error?.phase).toBe('runtime');
    expect(result.error?.message).toContain('boom');
  });

  it('reports normalize errors from in-memory script execution', () => {
    const result = executeScorePostProcessScript({
      projectId: 'project-1',
      projectContext: createProjectContext(),
      paperInputs: [createPaper({})],
      scriptName: 'bad-output',
      scriptCode: "return [{ paperId: 'missing-paper', processedScore: 88 }];",
    });

    expect(result.success).toBe(false);
    expect(result.error?.phase).toBe('normalize');
    expect(result.error?.message).toContain('未知试卷');
  });

  it('parses strict AI script JSON responses', () => {
    const parsed = parseScorePostProcessAiScriptModelResponse(`{
      "scriptName": "压缩低分段",
      "summary": "把 80 分以下压缩到 60-80 分段",
      "assumptions": [],
      "scriptCode": "return papers.map((paper) => ({ paperId: paper.paperId }));"
    }`);

    expect(parsed.scriptName).toBe('压缩低分段');
    expect(parsed.assumptions).toEqual([]);
  });

  it('rejects invalid AI script JSON responses', () => {
    expect(() =>
      parseScorePostProcessAiScriptModelResponse('not json'),
    ).toThrow('合法 JSON 对象');
  });
});
