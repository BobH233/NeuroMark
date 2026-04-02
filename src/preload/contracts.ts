export type ImageDetailLevel = 'low' | 'high' | 'auto';
export type LlmReasoningEffort = 'low' | 'medium' | 'high';
export type JobKind = 'scan' | 'grading' | 'answer-generation';
export type NameMatchStatus = 'unverified' | 'verified';
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
  | 'skipped'
  | 'failed';
export type DraftGenerationStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed';

export interface DebugLogEntry {
  id: string;
  text: string;
  timestamp: string;
  stream: 'stdout' | 'stderr';
}

export interface ProjectSettings {
  gradingConcurrency: number;
  drawRegions: boolean;
  defaultImageDetail: ImageDetailLevel;
  enableScanPostProcess: boolean;
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
  referenceAnswerVersion: number;
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
  originalVersion?: number;
  scannedPath?: string;
  scannedVersion?: number;
  debugPreviewPath?: string;
  debugPreviewVersion?: number;
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
  gradingReferenceAnswerVersion?: number;
  gradingUpdatedAt?: string;
  gradingError?: string | null;
}

export interface StudentInfo {
  className: string;
  studentId: string;
  name: string;
}

export interface ScoreBreakdownItem {
  criterionId: string;
  criterion: string;
  maxScore: number;
  score: number;
  verdict: 'earned' | 'partial' | 'missed' | 'unclear';
  evidence: string;
}

export interface QuestionScore {
  questionId: string;
  questionTitle: string;
  maxScore: number;
  score: number;
  reasoning: string;
  issues: string[];
  scoreBreakdown: ScoreBreakdownItem[];
}

export interface QuestionRegion {
  questionId: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewRegionOverlay extends QuestionRegion {
  score?: number | null;
  maxScore?: number | null;
}

export interface PreviewDisplayOptions {
  showQuestionTags: boolean;
  showQuestionBoxes: boolean;
  showQuestionScores: boolean;
}

export interface OverallAdvice {
  summary: string;
  strengths: string[];
  priorityKnowledgePoints: string[];
  attentionPoints: string[];
  encouragement: string;
}

export interface ModelResult {
  studentInfo: StudentInfo;
  questionScores: QuestionScore[];
  totalScore: number;
  overallComment: string;
  overallAdvice: OverallAdvice;
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
  status: Extract<PaperStageStatus, 'processing' | 'completed' | 'failed'>;
  errorMessage?: string | null;
  referenceAnswerVersion: number;
  modelResult: ModelResult | null;
  finalResult: FinalResult | null;
  nameMatchStatus: NameMatchStatus;
  nameMatchUpdatedAt?: string | null;
  nameMatchSource?: string | null;
  updatedAt: string;
}

export interface SaveFinalResultOptions {
  nameMatchStatus?: NameMatchStatus;
  nameMatchUpdatedAt?: string | null;
  nameMatchSource?: string | null;
}

export type SmartNameMatchRunStatus = 'idle' | 'running' | 'completed' | 'failed';
export type SmartNameMatchDecision =
  | 'certain_update'
  | 'certain_keep'
  | 'uncertain'
  | 'no_match';

export interface SmartNameMatchSuggestion {
  paperId: string;
  paperCode: string;
  currentStudentInfo: StudentInfo;
  suggestedStudentInfo: StudentInfo | null;
  decision: SmartNameMatchDecision;
  confidence: number;
  changedFields: Array<keyof StudentInfo>;
  matchedRosterLine: string | null;
  reason: string;
  uncertaintyNotes: string[];
}

export interface SmartNameMatchDuplicateGroup {
  paperIds: string[];
  paperCodes: string[];
  confidence: number;
  reason: string;
  evidence: string[];
}

export interface SmartNameMatchSummary {
  totalPapers: number;
  certainUpdateCount: number;
  certainKeepCount: number;
  uncertainCount: number;
  noMatchCount: number;
  duplicateGroupCount: number;
}

export interface SmartNameMatchResult {
  summary: SmartNameMatchSummary;
  suggestions: SmartNameMatchSuggestion[];
  duplicateGroups: SmartNameMatchDuplicateGroup[];
}

export interface SmartNameMatchSnapshot {
  projectId: string;
  status: SmartNameMatchRunStatus;
  rosterText: string;
  stage: string | null;
  reasoningText: string;
  previewText: string;
  errorMessage: string | null;
  result: SmartNameMatchResult | null;
  updatedAt: string;
}

export interface BackgroundJob {
  id: string;
  kind: JobKind;
  projectId: string;
  projectName: string;
  referenceAnswerVersion?: number;
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
  runtimeLogs: string[];
}

export interface GlobalLlmSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  reasoningEffort: LlmReasoningEffort;
  answerGenerationTemperature: number;
  gradingTemperature: number;
}

export interface SaveGlobalLlmSettingsInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  reasoningEffort: LlmReasoningEffort;
  answerGenerationTemperature: number;
  gradingTemperature: number;
}

export interface TestLlmConnectionPayload {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  reasoningEffort: LlmReasoningEffort;
  answerGenerationTemperature: number;
  gradingTemperature: number;
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

export interface ProjectRubricDebug {
  projectId: string;
  referenceAnswerVersion: number;
  rubricPath: string;
  exists: boolean;
  updatedAt: string | null;
  rubricJson: string;
  rubricData: unknown | null;
}

export interface CreateProjectInput {
  name: string;
  basePath: string;
  gradingConcurrency?: number;
  drawRegions?: boolean;
  defaultImageDetail?: ImageDetailLevel;
  enableScanPostProcess?: boolean;
}

export interface CreateProjectValidationResult {
  available: boolean;
  message: string | null;
  targetRootPath: string;
}

export interface ImportOriginalImagesResult {
  projectId: string;
  addedPaperCount: number;
  addedPageCount: number;
}

export interface PreviewImageItem {
  src: string;
  cacheKey?: string | number;
  title: string;
  caption?: string;
  regions?: PreviewRegionOverlay[];
}

export interface PreviewSession {
  token: string;
  title: string;
  initialIndex: number;
  images: PreviewImageItem[];
  activeQuestionId?: string;
  displayOptions: PreviewDisplayOptions;
}

export interface PreviewActiveQuestionPayload {
  token: string;
  activeQuestionId: string;
}

export interface PreviewDisplayOptionsPayload {
  token: string;
  displayOptions: PreviewDisplayOptions;
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
export type DebugLogHandler = (entry: DebugLogEntry) => void;
export type SmartNameMatchUpdateHandler = (
  snapshot: SmartNameMatchSnapshot,
) => void;

export interface NeuromarkApi {
  app: {
    getVersion: () => Promise<string>;
    getDefaultProjectBasePath: () => Promise<string>;
    selectDirectory: () => Promise<string | null>;
    selectImages: () => Promise<string[]>;
    openPath: (targetPath: string) => Promise<void>;
    openDevTools: () => Promise<void>;
    enableDebugPanel: () => Promise<void>;
    getPreviewSession: (token: string) => Promise<PreviewSession | null>;
    getDebugLogs: () => Promise<DebugLogEntry[]>;
    onDebugLog: (handler: DebugLogHandler) => () => void;
  };
  projects: {
    create: (input: CreateProjectInput) => Promise<ProjectMeta>;
    validateCreate: (
      input: Pick<CreateProjectInput, 'name' | 'basePath'>,
    ) => Promise<CreateProjectValidationResult>;
    list: () => Promise<ProjectMeta[]>;
    getDetail: (projectId: string) => Promise<ProjectDetail>;
    getRubricDebug: (projectId: string) => Promise<ProjectRubricDebug>;
    delete: (projectId: string) => Promise<void>;
    updateName: (projectId: string, name: string) => Promise<ProjectMeta>;
    removePaper: (projectId: string, paperId: string) => Promise<ProjectDetail>;
    importOriginalImages: (
      projectId: string,
      filePaths: string[],
    ) => Promise<ImportOriginalImagesResult>;
    updateSettings: (
      projectId: string,
      settings: ProjectSettings,
    ) => Promise<ProjectMeta>;
    updateReferenceAnswer: (
      projectId: string,
      markdown: string,
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
      options?: SaveFinalResultOptions,
    ) => Promise<ResultRecord>;
    delete: (projectId: string, paperId: string) => Promise<void>;
    exportJson: (projectId: string, targetPath?: string) => Promise<string>;
    getSmartNameMatchSnapshot: (projectId: string) => Promise<SmartNameMatchSnapshot>;
    startSmartNameMatch: (
      projectId: string,
      rosterText: string,
    ) => Promise<SmartNameMatchSnapshot>;
    applySmartNameMatch: (projectId: string) => Promise<string[]>;
    onSmartNameMatchUpdated: (handler: SmartNameMatchUpdateHandler) => () => void;
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
      activeQuestionId?: string,
      displayOptions?: PreviewDisplayOptions,
    ) => Promise<string>;
    setActiveQuestion: (token: string | null, activeQuestionId: string) => Promise<void>;
    setDisplayOptions: (
      token: string | null,
      displayOptions: PreviewDisplayOptions,
    ) => Promise<void>;
    onActiveQuestionChanged: (
      handler: (payload: PreviewActiveQuestionPayload) => void,
    ) => () => void;
    onDisplayOptionsChanged: (
      handler: (payload: PreviewDisplayOptionsPayload) => void,
    ) => () => void;
    copyImage: (source: string) => Promise<void>;
    saveImage: (source: string, suggestedName?: string) => Promise<string | null>;
  };
}
