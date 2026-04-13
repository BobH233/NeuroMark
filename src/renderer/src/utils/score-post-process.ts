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
