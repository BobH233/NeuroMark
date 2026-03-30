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
      storage_mode TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answer_drafts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt_preset TEXT NOT NULL,
      prompt_text TEXT NOT NULL DEFAULT '',
      source_images_json TEXT NOT NULL,
      markdown TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  ensureColumn(connection, 'answer_drafts', 'prompt_text', "prompt_text TEXT NOT NULL DEFAULT ''");
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
