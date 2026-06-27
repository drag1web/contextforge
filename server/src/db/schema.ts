import { pool } from "./pool.js";

export async function ensureDatabaseSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      local_path TEXT NOT NULL UNIQUE,
      package_manager TEXT,
      detected_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
      scripts JSONB NOT NULL DEFAULT '{}'::jsonb,
      readiness_score INTEGER NOT NULL DEFAULT 0,
      readiness_report JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_scan_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_packs (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      raw_task TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'general',
      target_tool TEXT NOT NULL DEFAULT 'generic',
      generated_prompt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO app_settings (key, value)
    VALUES
      ('ollama_url', to_jsonb('http://localhost:11434'::text)),
      ('generation_mode', to_jsonb('template'::text)),
      ('default_target_tool', to_jsonb('codex'::text)),
      ('default_task_type', to_jsonb('general'::text)),
      ('default_ollama_model', 'null'::jsonb)
    ON CONFLICT (key) DO NOTHING;
  `);

  await pool.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS readiness_score INTEGER NOT NULL DEFAULT 0;
  `);

  await pool.query(`
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS readiness_report JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE task_packs
    ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'template';
  `);

  await pool.query(`
    ALTER TABLE task_packs
    ADD COLUMN IF NOT EXISTS generation_model TEXT;
  `);

  await pool.query(`
    ALTER TABLE task_packs
    ADD COLUMN IF NOT EXISTS generation_message TEXT;
  `);

  await pool.query(`
    ALTER TABLE task_packs
    ADD COLUMN IF NOT EXISTS generation_used_fallback BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    ALTER TABLE task_packs
    ADD COLUMN IF NOT EXISTS generation_duration_ms INTEGER;
  `);
}