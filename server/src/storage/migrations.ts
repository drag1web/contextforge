import type { Database } from "sql.js";

export const SQLITE_SCHEMA_VERSION = 2;

export interface SqliteMigrationDefinition {
  id: string;
  version: number;
  name: string;
  description: string;
  checksum: string;
  run(db: Database): void;
}

export const SQLITE_MIGRATIONS: SqliteMigrationDefinition[] = [
  {
    id: "0001_sqlite_baseline",
    version: 1,
    name: "SQLite baseline schema",
    description:
      "Marks the current SQLite workspace schema as the baseline before incremental desktop migrations.",
    checksum: "sqlite-baseline-v1",
    run(_db) {
      // Baseline only. The current adapter still creates compatibility tables before
      // migrations run so existing developer-preview databases remain readable.
    }
  },
  {
    id: "0002_rules_templates_catalog",
    version: 2,
    name: "Rules and templates catalog",
    description:
      "Adds an adapter-backed SQLite catalog for custom templates, rule items, rule profiles and acceptance criteria presets.",
    checksum: "rules-templates-catalog-v1",
    run(db) {
      db.run(`
        CREATE TABLE IF NOT EXISTS rules_templates_catalog_items (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rules_templates_catalog_items_kind
          ON rules_templates_catalog_items(kind);
      `);
    }
  }
];
