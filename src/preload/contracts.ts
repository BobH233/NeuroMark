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
  skipScanProcessing: boolean;
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

export type ScorePostProcessPresetSource = 'builtin' | 'custom';
export type ScorePostProcessErrorPhase = 'compile' | 'runtime' | 'normalize';

export interface ScorePostProcessPreset {
  id: string;
  name: string;
  description: string;
  code: string;
  source: ScorePostProcessPresetSource;
  readonly: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ScorePostProcessPresetInput {
  id?: string;
  name: string;
  description: string;
  code: string;
}

export interface ScorePostProcessProjectContext {
  id: string;
  name: string;
  rootPath: string;
  referenceAnswerVersion: number;
  stats: ProjectStats;
  settings: ProjectSettings;
}

export interface ScorePostProcessPaperQuestion {
  questionId: string;
  questionTitle: string;
  score: number;
  maxScore: number;
}

export interface ScorePostProcessPaperData {
  paperId: string;
  paperCode: string;
  originalScore: number;
  totalScore: number;
  modelScore: number;
  manualScore: number | null;
  studentInfo: StudentInfo;
  questionScores: ScorePostProcessPaperQuestion[];
  nameMatchStatus: NameMatchStatus;
  referenceAnswerVersion: number;
  updatedAt: string;
  pageCount: number;
  scanStatus: PaperStageStatus;
  gradingStatus: PaperStageStatus;
}

export interface ScorePostProcessScriptError {
  phase: ScorePostProcessErrorPhase;
  name: string;
  message: string;
  stack: string;
  lineNumber: number | null;
  columnNumber: number | null;
}

export interface ScorePostProcessPaperResult {
  paperId: string;
  paperCode: string;
  studentInfo: StudentInfo;
  originalScore: number;
  processedScore: number;
  scoreDelta: number;
  applied: boolean;
  gradeLabel: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
}

export interface ScorePostProcessRunSummary {
  paperCount: number;
  appliedCount: number;
  averageOriginalScore: number;
  averageProcessedScore: number;
  minProcessedScore: number;
  maxProcessedScore: number;
}

export interface ScorePostProcessRunRecord {
  id: string;
  projectId: string;
  scriptName: string;
  presetId: string | null;
  presetName: string | null;
  presetSource: ScorePostProcessPresetSource | 'adhoc';
  scriptCode: string;
  createdAt: string;
  summary: ScorePostProcessRunSummary;
  scriptSummary: Record<string, unknown> | null;
  results: ScorePostProcessPaperResult[];
  logs: string[];
  exportPath: string | null;
}

export interface ScorePostProcessProjectSnapshot {
  projectId: string;
  latestRun: ScorePostProcessRunRecord | null;
}

export type ScorePostProcessAiGenerationStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed';

export interface GenerateScorePostProcessAiScriptInput {
  instruction: string;
}

export interface ScorePostProcessAiScriptResult {
  scriptName: string;
  scriptCode: string;
  summary: string;
  assumptions: string[];
}

export interface ScorePostProcessAiScriptSnapshot {
  projectId: string;
  status: ScorePostProcessAiGenerationStatus;
  stage: string | null;
  reasoningText: string;
  previewText: string;
  errorMessage: string | null;
  result: ScorePostProcessAiScriptResult | null;
  updatedAt: string;
}

export interface ExecuteScorePostProcessInput {
  scriptName?: string;
  presetId?: string | null;
  scriptCode: string;
}

export interface ScorePostProcessExecutionResult {
  success: boolean;
  run: ScorePostProcessRunRecord | null;
  error: ScorePostProcessScriptError | null;
}

export interface ExportScorePostProcessOptions {
  targetDirectory?: string;
}

export type SmartNameMatchRunStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed';
export type SmartNameMatchScope = 'unverified' | 'all';
export type SmartNameMatchDecision =
  | 'certain_update'
  | 'certain_keep'
  | 'uncertain'
  | 'no_match';

export interface StartSmartNameMatchOptions {
  scope?: SmartNameMatchScope;
}

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
  streamPreviewText: string;
  streamReasoningText: string;
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

export type LlmUsageSource =
  | 'answer-generation'
  | 'grading-paper'
  | 'grading-rubric'
  | 'settings-test'
  | 'smart-name-match'
  | 'score-postprocess-ai-script';

export interface LlmPricingSettings {
  currency: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
  reasoningPerMillion: number;
}

export interface LlmUsageRecord {
  id: string;
  source: LlmUsageSource;
  label: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  billableInputTokens: number;
  billableOutputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  createdAt: string;
}

export interface LlmUsageRecordPage {
  page: number;
  pageSize: number;
  total: number;
  records: LlmUsageRecord[];
}

export interface LlmUsageBreakdownItem {
  source: LlmUsageSource;
  label: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface LlmUsageSummary {
  pricing: LlmPricingSettings;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  billableInputTokens: number;
  billableOutputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  breakdown: LlmUsageBreakdownItem[];
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

export type ResultExportScope = 'graded' | 'graded-and-verified';

export interface ExportResultsOptions {
  scope?: ResultExportScope;
  targetPath?: string;
}

export interface CreateProjectInput {
  name: string;
  basePath: string;
  gradingConcurrency?: number;
  drawRegions?: boolean;
  defaultImageDetail?: ImageDetailLevel;
  enableScanPostProcess?: boolean;
  skipScanProcessing?: boolean;
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
export type ProjectUpdateHandler = (projects: ProjectMeta[]) => void;
export type AnswerGeneratorUpdateHandler = (
  snapshot: AnswerGeneratorSnapshot,
) => void;
export type DebugLogHandler = (entry: DebugLogEntry) => void;
export type SmartNameMatchUpdateHandler = (
  snapshot: SmartNameMatchSnapshot,
) => void;
export type ScorePostProcessAiUpdateHandler = (
  snapshot: ScorePostProcessAiScriptSnapshot,
) => void;

export interface NeuromarkApi {
  app: {
    getVersion: () => Promise<string>;
    getDefaultProjectBasePath: () => Promise<string>;
    selectDirectory: () => Promise<string | null>;
    selectExportDirectory: () => Promise<string | null>;
    selectImages: () => Promise<string[]>;
    selectPaperImageDirectory: () => Promise<string | null>;
    selectJsonSavePath: (defaultFileName: string) => Promise<string | null>;
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
    importOriginalImageDirectory: (
      projectId: string,
      directoryPath: string,
    ) => Promise<ImportOriginalImagesResult>;
    updateSettings: (
      projectId: string,
      settings: ProjectSettings,
    ) => Promise<ProjectMeta>;
    updateReferenceAnswer: (
      projectId: string,
      markdown: string,
    ) => Promise<ProjectMeta>;
    onUpdated: (handler: ProjectUpdateHandler) => () => void;
  };
  scan: {
    start: (
      projectId: string,
      options?: StartJobOptions,
    ) => Promise<BackgroundJob>;
    cancel: (jobId: string) => Promise<void>;
    list: (projectId: string) => Promise<PaperRecord[]>;
  };
  grading: {
    start: (
      projectId: string,
      options?: StartJobOptions,
    ) => Promise<BackgroundJob>;
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
    exportJson: (
      projectId: string,
      options?: ExportResultsOptions,
    ) => Promise<string>;
    getSmartNameMatchSnapshot: (
      projectId: string,
    ) => Promise<SmartNameMatchSnapshot>;
    startSmartNameMatch: (
      projectId: string,
      rosterText: string,
      options?: StartSmartNameMatchOptions,
    ) => Promise<SmartNameMatchSnapshot>;
    applySmartNameMatch: (projectId: string) => Promise<string[]>;
    onSmartNameMatchUpdated: (
      handler: SmartNameMatchUpdateHandler,
    ) => () => void;
  };
  settings: {
    get: () => Promise<GlobalLlmSettings>;
    save: (input: SaveGlobalLlmSettingsInput) => Promise<GlobalLlmSettings>;
    testLlmConnection: (
      payload: TestLlmConnectionPayload,
    ) => Promise<TestLlmConnectionResult>;
  };
  scorePostProcess: {
    listPresets: () => Promise<ScorePostProcessPreset[]>;
    savePreset: (
      input: ScorePostProcessPresetInput,
    ) => Promise<ScorePostProcessPreset>;
    deletePreset: (presetId: string) => Promise<void>;
    getProjectSnapshot: (
      projectId: string,
    ) => Promise<ScorePostProcessProjectSnapshot>;
    execute: (
      projectId: string,
      input: ExecuteScorePostProcessInput,
    ) => Promise<ScorePostProcessExecutionResult>;
    getAiScriptSnapshot: (
      projectId: string,
    ) => Promise<ScorePostProcessAiScriptSnapshot>;
    startAiScriptGeneration: (
      projectId: string,
      input: GenerateScorePostProcessAiScriptInput,
    ) => Promise<ScorePostProcessAiScriptSnapshot>;
    onAiScriptUpdated: (
      handler: ScorePostProcessAiUpdateHandler,
    ) => () => void;
    exportLatest: (
      projectId: string,
      options?: ExportScorePostProcessOptions,
    ) => Promise<string>;
  };
  llmUsage: {
    getSummary: () => Promise<LlmUsageSummary>;
    getRecordPage: (
      page?: number,
      pageSize?: number,
    ) => Promise<LlmUsageRecordPage>;
    savePricing: (input: LlmPricingSettings) => Promise<LlmPricingSettings>;
  };
  answerGenerator: {
    getState: () => Promise<AnswerGeneratorSnapshot>;
    listDrafts: () => Promise<AnswerDraftRecord[]>;
    listPromptPresets: () => Promise<PromptPreset[]>;
    savePromptPreset: (input: PromptPresetInput) => Promise<PromptPreset>;
    deletePromptPreset: (presetId: string) => Promise<void>;
    createDraft: (input: AnswerDraftInput) => Promise<AnswerDraftRecord>;
    startGeneration: (draftId: string) => Promise<AnswerDraftRecord>;
    updateDraft: (
      draftId: string,
      markdown: string,
    ) => Promise<AnswerDraftRecord>;
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
    setActiveQuestion: (
      token: string | null,
      activeQuestionId: string,
    ) => Promise<void>;
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
    saveImage: (
      source: string,
      suggestedName?: string,
    ) => Promise<string | null>;
  };
}
