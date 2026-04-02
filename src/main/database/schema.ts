import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projectsTable = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull().unique(),
  referenceAnswerVersion: integer('reference_answer_version').notNull().default(1),
  statsJson: text('stats_json').notNull(),
  settingsJson: text('settings_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const paperRecordsTable = sqliteTable('paper_records', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  paperCode: text('paper_code').notNull(),
  pageCount: integer('page_count').notNull(),
  originalPagesJson: text('original_pages_json').notNull(),
  scanStatus: text('scan_status').notNull(),
  gradingStatus: text('grading_status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const resultRecordsTable = sqliteTable('result_records', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  paperId: text('paper_id').notNull(),
  filePath: text('file_path').notNull(),
  modelResultJson: text('model_result_json').notNull(),
  finalResultJson: text('final_result_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const tasksTable = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  projectName: text('project_name').notNull(),
  kind: text('kind').notNull(),
  referenceAnswerVersion: integer('reference_answer_version'),
  status: text('status').notNull(),
  progress: real('progress').notNull(),
  speed: real('speed').notNull(),
  eta: text('eta'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  archivedAt: text('archived_at'),
  abortable: integer('abortable', { mode: 'boolean' }).notNull(),
  currentPaperLabel: text('current_paper_label'),
  summary: text('summary').notNull(),
  runtimeLogsJson: text('runtime_logs_json').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const settingsTable = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  baseUrl: text('base_url').notNull(),
  model: text('model').notNull(),
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  timeoutMs: integer('timeout_ms').notNull(),
  reasoningEffort: text('reasoning_effort').notNull(),
  answerGenerationTemperature: real('answer_generation_temperature').notNull().default(0.2),
  gradingTemperature: real('grading_temperature').notNull().default(0),
  storageMode: text('storage_mode').notNull(),
});

export const answerDraftsTable = sqliteTable('answer_drafts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  promptPreset: text('prompt_preset').notNull(),
  promptText: text('prompt_text').notNull(),
  sourceImagesJson: text('source_images_json').notNull(),
  markdown: text('markdown').notNull(),
  generationStatus: text('generation_status').notNull(),
  generationError: text('generation_error'),
  generationTaskId: text('generation_task_id'),
  generationStage: text('generation_stage'),
  generationLogsJson: text('generation_logs_json').notNull(),
  generationReasoningText: text('generation_reasoning_text').notNull(),
  generationPreviewText: text('generation_preview_text').notNull(),
  lastGenerationStartedAt: text('last_generation_started_at'),
  lastGenerationCompletedAt: text('last_generation_completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const promptPresetsTable = sqliteTable('prompt_presets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  prompt: text('prompt').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type Schema = {
  projectsTable: typeof projectsTable;
  paperRecordsTable: typeof paperRecordsTable;
  resultRecordsTable: typeof resultRecordsTable;
  tasksTable: typeof tasksTable;
  settingsTable: typeof settingsTable;
  answerDraftsTable: typeof answerDraftsTable;
  promptPresetsTable: typeof promptPresetsTable;
};
