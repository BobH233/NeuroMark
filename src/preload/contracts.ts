export type ImageDetailLevel = 'low' | 'high' | 'auto';
export type JobKind = 'scan' | 'grading' | 'answer-generation';
export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type PaperStageStatus =
  | 'pending'
  | 'ready'
  | 'processing'
  | 'completed'
  | 'skipped';

export interface ProjectSettings {
  gradingConcurrency: number;
  drawRegions: boolean;
  defaultImageDetail: ImageDetailLevel;
}

export interface ProjectStats {
  importedPaperCount: number;
  scannedPaperCount: number;
  gradedPaperCount: number;
  averageScore: number;
  pageCount: number;
  lastTaskSummary: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  stats: ProjectStats;
  settings: ProjectSettings;
}

export interface CornerPoint {
  x: number;
  y: number;
}

export interface PaperPage {
  pageIndex: number;
  originalPath: string;
  scannedPath?: string;
  debugPreviewPath?: string;
  corners?: CornerPoint[];
}

export interface PaperRecord {
  id: string;
  projectId: string;
  paperCode: string;
  pageCount: number;
  originalPages: PaperPage[];
  scanStatus: PaperStageStatus;
  gradingStatus: PaperStageStatus;
}

export interface StudentInfo {
  className: string;
  studentId: string;
  name: string;
}

export interface QuestionScore {
  questionId: string;
  questionTitle: string;
  maxScore: number;
  score: number;
  reasoning: string;
  issues: string[];
}

export interface QuestionRegion {
  questionId: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ModelResult {
  studentInfo: StudentInfo;
  questionScores: QuestionScore[];
  totalScore: number;
  overallComment: string;
  questionRegions?: QuestionRegion[];
}

export interface FinalResult extends ModelResult {
  manualTotalScore?: number | null;
}

export interface ResultRecord {
  id: string;
  projectId: string;
  paperId: string;
  filePath: string;
  modelResult: ModelResult;
  finalResult: FinalResult;
  updatedAt: string;
}

export interface BackgroundJob {
  id: string;
  kind: JobKind;
  projectId: string;
  projectName: string;
  status: JobStatus;
  progress: number;
  speed: number;
  eta: string | null;
  createdAt: string;
  updatedAt: string;
  abortable: boolean;
  currentPaperLabel?: string;
  summary: string;
}

export interface GlobalLlmSettings {
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  apiKeyStored: boolean;
  timeoutMs: number;
  storageMode: 'safeStorage' | 'plainText';
}

export interface SaveGlobalLlmSettingsInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface TestLlmConnectionPayload {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export interface TestLlmConnectionResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

export interface AnswerDraftRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  sourceImages: string[];
  promptPreset: string;
  markdown: string;
}

export interface PromptPreset {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export interface ProjectDetail {
  project: ProjectMeta;
  referenceAnswerMarkdown: string;
  originals: PaperRecord[];
  scans: PaperRecord[];
  results: ResultRecord[];
  recentJobs: BackgroundJob[];
}

export interface CreateProjectInput {
  name: string;
  basePath: string;
  gradingConcurrency?: number;
  drawRegions?: boolean;
  defaultImageDetail?: ImageDetailLevel;
}

export interface ImportOriginalImagesResult {
  projectId: string;
  addedPaperCount: number;
  addedPageCount: number;
}

export interface PreviewImageItem {
  src: string;
  title: string;
  caption?: string;
  regions?: QuestionRegion[];
}

export interface PreviewSession {
  token: string;
  title: string;
  initialIndex: number;
  images: PreviewImageItem[];
}

export interface StartJobOptions {
  skipCompleted?: boolean;
}

export interface AnswerDraftInput {
  promptPreset: string;
  sourceImages: string[];
}

export type TaskUpdateHandler = (tasks: BackgroundJob[]) => void;

export interface NeuromarkApi {
  app: {
    getVersion: () => Promise<string>;
    selectDirectory: () => Promise<string | null>;
    selectImages: () => Promise<string[]>;
    openPath: (targetPath: string) => Promise<void>;
    getPreviewSession: (token: string) => Promise<PreviewSession | null>;
  };
  projects: {
    create: (input: CreateProjectInput) => Promise<ProjectMeta>;
    list: () => Promise<ProjectMeta[]>;
    getDetail: (projectId: string) => Promise<ProjectDetail>;
    importOriginalImages: (
      projectId: string,
      filePaths: string[],
    ) => Promise<ImportOriginalImagesResult>;
    updateSettings: (
      projectId: string,
      settings: ProjectSettings,
    ) => Promise<ProjectMeta>;
  };
  scan: {
    start: (projectId: string, options?: StartJobOptions) => Promise<BackgroundJob>;
    cancel: (jobId: string) => Promise<void>;
    list: (projectId: string) => Promise<PaperRecord[]>;
  };
  grading: {
    start: (projectId: string, options?: StartJobOptions) => Promise<BackgroundJob>;
    cancel: (jobId: string) => Promise<void>;
    resume: (projectId: string) => Promise<BackgroundJob>;
  };
  results: {
    list: (projectId: string) => Promise<ResultRecord[]>;
    get: (projectId: string, paperId: string) => Promise<ResultRecord | null>;
    saveFinal: (
      projectId: string,
      paperId: string,
      finalResult: FinalResult,
    ) => Promise<ResultRecord>;
    exportJson: (projectId: string, targetPath?: string) => Promise<string>;
  };
  settings: {
    get: () => Promise<GlobalLlmSettings>;
    save: (input: SaveGlobalLlmSettingsInput) => Promise<GlobalLlmSettings>;
    testLlmConnection: (
      payload: TestLlmConnectionPayload,
    ) => Promise<TestLlmConnectionResult>;
  };
  answerGenerator: {
    listDrafts: () => Promise<AnswerDraftRecord[]>;
    listPromptPresets: () => Promise<PromptPreset[]>;
    createDraft: (input: AnswerDraftInput) => Promise<AnswerDraftRecord>;
    updateDraft: (draftId: string, markdown: string) => Promise<AnswerDraftRecord>;
  };
  tasks: {
    list: () => Promise<BackgroundJob[]>;
    onUpdated: (handler: TaskUpdateHandler) => () => void;
  };
  preview: {
    open: (
      images: PreviewImageItem[],
      initialIndex?: number,
      title?: string,
    ) => Promise<void>;
  };
}

