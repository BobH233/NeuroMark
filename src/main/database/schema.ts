import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projectsTable = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rootPath: text('root_path').notNull().unique(),
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
  status: text('status').notNull(),
  progress: real('progress').notNull(),
  speed: real('speed').notNull(),
  eta: text('eta'),
  abortable: integer('abortable', { mode: 'boolean' }).notNull(),
  currentPaperLabel: text('current_paper_label'),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const settingsTable = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  baseUrl: text('base_url').notNull(),
  model: text('model').notNull(),
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  timeoutMs: integer('timeout_ms').notNull(),
  storageMode: text('storage_mode').notNull(),
});

export const answerDraftsTable = sqliteTable('answer_drafts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  promptPreset: text('prompt_preset').notNull(),
  promptText: text('prompt_text').notNull(),
  sourceImagesJson: text('source_images_json').notNull(),
  markdown: text('markdown').notNull(),
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
