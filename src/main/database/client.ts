import path from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

let database:
  | ReturnType<typeof drizzle<typeof schema>> & { $client: Database.Database }
  | null = null;

function ensureColumn(
  connection: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const columns = connection
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === columnName)) {
    connection.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition};`);
  }
}

function ensureSchema(connection: Database.Database): void {
  connection.pragma('journal_mode = WAL');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      stats_json TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      paper_code TEXT NOT NULL,
      page_count INTEGER NOT NULL,
      original_pages_json TEXT NOT NULL,
      scan_status TEXT NOT NULL,
      grading_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS result_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      paper_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      model_result_json TEXT NOT NULL,
      final_result_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL,
      speed REAL NOT NULL,
      eta TEXT,
      started_at TEXT,
      finished_at TEXT,
      abortable INTEGER NOT NULL,
      current_paper_label TEXT,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      timeout_ms INTEGER NOT NULL,
      reasoning_effort TEXT NOT NULL DEFAULT 'medium',
      storage_mode TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answer_drafts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt_preset TEXT NOT NULL,
      prompt_text TEXT NOT NULL DEFAULT '',
      source_images_json TEXT NOT NULL,
      markdown TEXT NOT NULL,
      generation_status TEXT NOT NULL DEFAULT 'idle',
      generation_error TEXT,
      generation_task_id TEXT,
      generation_stage TEXT,
      generation_logs_json TEXT NOT NULL DEFAULT '[]',
      generation_reasoning_text TEXT NOT NULL DEFAULT '',
      generation_preview_text TEXT NOT NULL DEFAULT '',
      last_generation_started_at TEXT,
      last_generation_completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureColumn(
    connection,
    'tasks',
    'started_at',
    'started_at TEXT',
  );
  ensureColumn(
    connection,
    'tasks',
    'finished_at',
    'finished_at TEXT',
  );
  ensureColumn(
    connection,
    'settings',
    'reasoning_effort',
    "reasoning_effort TEXT NOT NULL DEFAULT 'medium'",
  );
  ensureColumn(connection, 'answer_drafts', 'prompt_text', "prompt_text TEXT NOT NULL DEFAULT ''");
  ensureColumn(
    connection,
    'answer_drafts',
    'generation_status',
    "generation_status TEXT NOT NULL DEFAULT 'idle'",
  );
  ensureColumn(connection, 'answer_drafts', 'generation_error', 'generation_error TEXT');
  ensureColumn(connection, 'answer_drafts', 'generation_task_id', 'generation_task_id TEXT');
  ensureColumn(connection, 'answer_drafts', 'generation_stage', 'generation_stage TEXT');
  ensureColumn(
    connection,
    'answer_drafts',
    'generation_logs_json',
    "generation_logs_json TEXT NOT NULL DEFAULT '[]'",
  );
  ensureColumn(
    connection,
    'answer_drafts',
    'generation_reasoning_text',
    "generation_reasoning_text TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    connection,
    'answer_drafts',
    'generation_preview_text',
    "generation_preview_text TEXT NOT NULL DEFAULT ''",
  );
  ensureColumn(
    connection,
    'answer_drafts',
    'last_generation_started_at',
    'last_generation_started_at TEXT',
  );
  ensureColumn(
    connection,
    'answer_drafts',
    'last_generation_completed_at',
    'last_generation_completed_at TEXT',
  );
}

export function getDatabase() {
  if (database) {
    return database;
  }

  const dbPath = path.join(app.getPath('userData'), 'neuromark.db');
  const connection = new Database(dbPath);
  ensureSchema(connection);
  database = drizzle(connection, { schema }) as ReturnType<
    typeof drizzle<typeof schema>
  > & { $client: Database.Database };
  return database;
}
