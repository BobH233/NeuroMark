export type ImageDetailLevel = 'low' | 'high' | 'auto';
export type LlmReasoningEffort = 'low' | 'medium' | 'high';
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
export type DraftGenerationStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed';

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
  startedAt: string | null;
  finishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  abortable: boolean;
  currentPaperLabel?: string;
  summary: string;
}

export interface GlobalLlmSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  reasoningEffort: LlmReasoningEffort;
}

export interface SaveGlobalLlmSettingsInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  reasoningEffort: LlmReasoningEffort;
}

export interface TestLlmConnectionPayload {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  reasoningEffort: LlmReasoningEffort;
}

export interface TestLlmConnectionResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

export interface AnswerSourceImage {
  src: string;
  name: string;
}

export interface AnswerDraftRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  sourceImages: AnswerSourceImage[];
  promptPreset: string;
  promptText: string;
  markdown: string;
  generationStatus: DraftGenerationStatus;
  generationError: string | null;
  generationTaskId: string | null;
  generationStage: string | null;
  generationLogs: string[];
  generationReasoningText: string;
  generationPreviewText: string;
  lastGenerationStartedAt: string | null;
  lastGenerationCompletedAt: string | null;
}

export interface PromptPreset {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export interface PromptPresetInput {
  id?: string;
  name: string;
  description: string;
  prompt: string;
}

export interface AnswerGeneratorSnapshot {
  drafts: AnswerDraftRecord[];
  presets: PromptPreset[];
  programPromptText: string;
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
  title: string;
  promptPreset: string;
  promptText: string;
  sourceImages: AnswerSourceImage[];
}

export type TaskUpdateHandler = (tasks: BackgroundJob[]) => void;
export type AnswerGeneratorUpdateHandler = (
  snapshot: AnswerGeneratorSnapshot,
) => void;

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
    getState: () => Promise<AnswerGeneratorSnapshot>;
    listDrafts: () => Promise<AnswerDraftRecord[]>;
    listPromptPresets: () => Promise<PromptPreset[]>;
    savePromptPreset: (input: PromptPresetInput) => Promise<PromptPreset>;
    deletePromptPreset: (presetId: string) => Promise<void>;
    createDraft: (input: AnswerDraftInput) => Promise<AnswerDraftRecord>;
    startGeneration: (draftId: string) => Promise<AnswerDraftRecord>;
    updateDraft: (draftId: string, markdown: string) => Promise<AnswerDraftRecord>;
    deleteDraft: (draftId: string) => Promise<void>;
    onUpdated: (handler: AnswerGeneratorUpdateHandler) => () => void;
  };
  tasks: {
    list: () => Promise<BackgroundJob[]>;
    listArchived: () => Promise<BackgroundJob[]>;
    archiveVisible: () => Promise<void>;
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
