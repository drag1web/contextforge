import type { Database } from "sql.js";

import {
  buildLegacyTaskPackRevisionContent,
  contentHashForRevision,
  type LegacyTaskPackPersistenceRow,
} from "./taskPackLifecyclePersistence.js";
import {
  parseTaskPackGitHubCreatedIssueCompatibilityLink,
  type TaskPackGitHubCreatedIssueLinkRecord,
} from "./types.js";

export const SQLITE_SCHEMA_VERSION = 5;
export const TASK_PACK_LIFECYCLE_MIGRATION_ID =
  "0003_task_pack_lifecycle_revisions" as const;
export const TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID =
  "0004_task_pack_github_created_issue_link" as const;
export const TASK_PACK_DRAFTS_MIGRATION_ID = "0005_task_pack_drafts" as const;

export interface SqliteMigrationDefinition {
  id: string;
  version: number;
  name: string;
  description: string;
  checksum: string;
  run(db: Database): void;
}

export interface SqliteMigrationTransactionHooks {
  /** Test-only failure injection after migration validation and before ledger insertion. */
  beforeRecord?: (migration: SqliteMigrationDefinition) => void;
}

const SQLITE_TASK_PACK_LIFECYCLE_DDL = `
  CREATE TABLE task_pack_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_pack_id INTEGER NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    base_revision_id INTEGER,
    source_kind TEXT NOT NULL CHECK (
      source_kind IN ('generated', 'manual_edit', 'regenerated', 'imported', 'split', 'legacy_snapshot')
    ),
    raw_task TEXT NOT NULL,
    task_type TEXT NOT NULL,
    target_tool TEXT NOT NULL,
    generated_prompt TEXT NOT NULL,
    generation_mode TEXT NOT NULL CHECK (generation_mode IN ('template', 'ollama')),
    generation_model TEXT,
    generation_message TEXT,
    generation_used_fallback INTEGER NOT NULL CHECK (generation_used_fallback IN (0, 1)),
    generation_duration_ms REAL,
    generation_recipe TEXT,
    diagnostics TEXT,
    grounded_context_snapshot TEXT,
    freshness_basis TEXT,
    content_hash TEXT NOT NULL CHECK (
      length(content_hash) = 71
      AND substr(content_hash, 1, 7) = 'sha256:'
      AND substr(content_hash, 8) NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL,
    generated_at TEXT,
    FOREIGN KEY (task_pack_id) REFERENCES task_packs(id) ON DELETE CASCADE,
    FOREIGN KEY (task_pack_id, base_revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id),
    UNIQUE (task_pack_id, revision_number),
    UNIQUE (task_pack_id, id)
  );

  ALTER TABLE task_packs
    ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'
      CHECK (lifecycle_state IN ('active', 'completed', 'archived'));
  ALTER TABLE task_packs
    ADD COLUMN archived_from_state TEXT
      CHECK (archived_from_state IS NULL OR archived_from_state IN ('active', 'completed'));
  ALTER TABLE task_packs ADD COLUMN current_revision_id INTEGER;
  ALTER TABLE task_packs ADD COLUMN accepted_revision_id INTEGER;
  ALTER TABLE task_packs
    ADD COLUMN lifecycle_version INTEGER NOT NULL DEFAULT 1 CHECK (lifecycle_version >= 1);
  ALTER TABLE task_packs ADD COLUMN completed_at TEXT;
  ALTER TABLE task_packs ADD COLUMN archived_at TEXT;

  CREATE TABLE task_pack_lifecycle_events (
    id TEXT PRIMARY KEY,
    task_pack_id INTEGER NOT NULL,
    revision_id INTEGER,
    event_type TEXT NOT NULL CHECK (
      event_type IN ('completed', 'reopened', 'archived', 'unarchived')
    ),
    from_state TEXT NOT NULL CHECK (from_state IN ('active', 'completed', 'archived')),
    to_state TEXT NOT NULL CHECK (to_state IN ('active', 'completed', 'archived')),
    source TEXT NOT NULL CHECK (source IN ('user', 'system', 'migration', 'import')),
    actor_id TEXT,
    created_at TEXT NOT NULL,
    metadata TEXT,
    FOREIGN KEY (task_pack_id) REFERENCES task_packs(id) ON DELETE CASCADE,
    FOREIGN KEY (task_pack_id, revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id)
  );

  CREATE INDEX idx_task_pack_lifecycle_events_task_pack_created
    ON task_pack_lifecycle_events(task_pack_id, created_at, id);

  CREATE TABLE task_pack_revision_review_events (
    id TEXT PRIMARY KEY,
    task_pack_id INTEGER NOT NULL,
    revision_id INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK (
      event_type IN ('review_started', 'accepted', 'changes_requested')
    ),
    from_state TEXT NOT NULL CHECK (
      from_state IN ('unreviewed', 'in_review', 'accepted', 'changes_requested')
    ),
    to_state TEXT NOT NULL CHECK (
      to_state IN ('unreviewed', 'in_review', 'accepted', 'changes_requested')
    ),
    source TEXT NOT NULL CHECK (source IN ('user', 'system', 'migration', 'import')),
    actor_id TEXT,
    created_at TEXT NOT NULL,
    metadata TEXT,
    FOREIGN KEY (task_pack_id) REFERENCES task_packs(id) ON DELETE CASCADE,
    FOREIGN KEY (task_pack_id, revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id)
  );

  CREATE INDEX idx_task_pack_revision_review_events_revision_created
    ON task_pack_revision_review_events(task_pack_id, revision_id, created_at, id);

  CREATE TRIGGER task_pack_revisions_immutable
  BEFORE UPDATE ON task_pack_revisions
  BEGIN
    SELECT RAISE(ABORT, 'task_pack_revisions are immutable');
  END;

  CREATE TRIGGER task_pack_lifecycle_events_immutable
  BEFORE UPDATE ON task_pack_lifecycle_events
  BEGIN
    SELECT RAISE(ABORT, 'task_pack_lifecycle_events are append-only');
  END;

  CREATE TRIGGER task_pack_revision_review_events_immutable
  BEFORE UPDATE ON task_pack_revision_review_events
  BEGIN
    SELECT RAISE(ABORT, 'task_pack_revision_review_events are append-only');
  END;

  CREATE TRIGGER task_packs_revision_pointer_ownership_insert
  BEFORE INSERT ON task_packs
  WHEN NEW.current_revision_id IS NOT NULL OR NEW.accepted_revision_id IS NOT NULL
  BEGIN
    SELECT CASE
      WHEN NEW.current_revision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM task_pack_revisions
        WHERE id = NEW.current_revision_id AND task_pack_id = NEW.id
      ) THEN RAISE(ABORT, 'current revision belongs to another Task Pack')
    END;
    SELECT CASE
      WHEN NEW.accepted_revision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM task_pack_revisions
        WHERE id = NEW.accepted_revision_id AND task_pack_id = NEW.id
      ) THEN RAISE(ABORT, 'accepted revision belongs to another Task Pack')
    END;
  END;

  CREATE TRIGGER task_packs_revision_pointer_ownership_update
  BEFORE UPDATE OF current_revision_id, accepted_revision_id ON task_packs
  BEGIN
    SELECT CASE
      WHEN NEW.current_revision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM task_pack_revisions
        WHERE id = NEW.current_revision_id AND task_pack_id = NEW.id
      ) THEN RAISE(ABORT, 'current revision belongs to another Task Pack')
    END;
    SELECT CASE
      WHEN NEW.accepted_revision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM task_pack_revisions
        WHERE id = NEW.accepted_revision_id AND task_pack_id = NEW.id
      ) THEN RAISE(ABORT, 'accepted revision belongs to another Task Pack')
    END;
  END;

  CREATE TRIGGER task_packs_lifecycle_projection_insert
  BEFORE INSERT ON task_packs
  BEGIN
    SELECT CASE
      WHEN NEW.lifecycle_state = 'archived'
        AND (NEW.archived_from_state IS NULL OR NEW.archived_at IS NULL)
      THEN RAISE(ABORT, 'archived Task Pack requires prior state and archived_at')
      WHEN NEW.lifecycle_state <> 'archived'
        AND (NEW.archived_from_state IS NOT NULL OR NEW.archived_at IS NOT NULL)
      THEN RAISE(ABORT, 'non-archived Task Pack cannot retain archive projection')
    END;
  END;

  CREATE TRIGGER task_packs_lifecycle_projection_update
  BEFORE UPDATE OF lifecycle_state, archived_from_state, archived_at ON task_packs
  BEGIN
    SELECT CASE
      WHEN NEW.lifecycle_state = 'archived'
        AND (NEW.archived_from_state IS NULL OR NEW.archived_at IS NULL)
      THEN RAISE(ABORT, 'archived Task Pack requires prior state and archived_at')
      WHEN NEW.lifecycle_state <> 'archived'
        AND (NEW.archived_from_state IS NOT NULL OR NEW.archived_at IS NOT NULL)
      THEN RAISE(ABORT, 'non-archived Task Pack cannot retain archive projection')
    END;
  END;
`;

function runSqliteTaskPackLifecycleMigration(db: Database): void {
  db.run(SQLITE_TASK_PACK_LIFECYCLE_DDL);

  const rows = readSqliteRows<LegacyTaskPackPersistenceRow>(
    db,
    `SELECT
      id, raw_task, task_type, target_tool, generated_prompt,
      generation_mode, generation_model, generation_message,
      generation_used_fallback, generation_duration_ms, generation_recipe, created_at
    FROM task_packs
    ORDER BY id ASC;`,
  );

  for (const row of rows) {
    const content = buildLegacyTaskPackRevisionContent(row);
    const contentHash = contentHashForRevision(content);
    db.run(
      `INSERT INTO task_pack_revisions (
        task_pack_id, revision_number, base_revision_id, source_kind,
        raw_task, task_type, target_tool, generated_prompt,
        generation_mode, generation_model, generation_message,
        generation_used_fallback, generation_duration_ms, generation_recipe,
        diagnostics, grounded_context_snapshot, freshness_basis,
        content_hash, created_at, generated_at
      ) VALUES (?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL);`,
      [
        row.id,
        content.sourceKind,
        content.rawTask,
        content.taskType,
        content.targetTool,
        content.generatedPrompt,
        content.generationMode,
        content.generationModel,
        content.generationMessage,
        content.generationUsedFallback ? 1 : 0,
        content.generationDurationMs,
        sqliteJsonStorageValue(row.generation_recipe),
        contentHash,
        timestampString(row.created_at),
      ],
    );
    const revisionId = Number(readSqliteScalar(db, "SELECT last_insert_rowid() AS value;"));
    db.run(
      `UPDATE task_packs
       SET lifecycle_state = 'active', archived_from_state = NULL,
           current_revision_id = ?, accepted_revision_id = NULL,
           lifecycle_version = 1, completed_at = NULL, archived_at = NULL
       WHERE id = ?;`,
      [revisionId, row.id],
    );
  }

  validateSqliteTaskPackLifecycleMigration(db);
}

const SQLITE_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL = `
  CREATE TABLE task_pack_github_created_issue_links (
    task_pack_id INTEGER PRIMARY KEY,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    full_name TEXT NOT NULL,
    issue_number INTEGER NOT NULL CHECK (issue_number > 0),
    issue_title TEXT NOT NULL,
    issue_url TEXT NOT NULL,
    issue_state TEXT NOT NULL CHECK (issue_state IN ('open', 'closed')),
    labels TEXT NOT NULL,
    repository_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_pack_id) REFERENCES task_packs(id) ON DELETE CASCADE
  );
`;

interface LegacyTaskPackGitHubLinkRow {
  readonly id: number;
  readonly generation_recipe: unknown;
}

function parseLegacyGenerationRecipe(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function insertSqliteTaskPackGitHubCreatedIssueLink(
  db: Database,
  link: TaskPackGitHubCreatedIssueLinkRecord,
): void {
  db.run(
    `INSERT INTO task_pack_github_created_issue_links (
      task_pack_id, owner, repo, full_name, issue_number, issue_title,
      issue_url, issue_state, labels, repository_url, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      link.taskPackId,
      link.owner,
      link.repo,
      link.fullName,
      link.issueNumber,
      link.issueTitle,
      link.issueUrl,
      link.issueState,
      JSON.stringify(link.labels),
      link.repositoryUrl,
      link.createdAt,
    ],
  );
}

function runSqliteTaskPackGitHubCreatedIssueLinkMigration(db: Database): void {
  db.run(SQLITE_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL);
  const rows = readSqliteRows<LegacyTaskPackGitHubLinkRow>(
    db,
    "SELECT id, generation_recipe FROM task_packs ORDER BY id ASC;",
  );
  for (const row of rows) {
    const recipe = parseLegacyGenerationRecipe(row.generation_recipe);
    if (!recipe || !Object.hasOwn(recipe, "githubCreatedIssue")) continue;
    const link = parseTaskPackGitHubCreatedIssueCompatibilityLink(
      recipe.githubCreatedIssue,
      Number(row.id),
    );
    if (!link) continue;
    insertSqliteTaskPackGitHubCreatedIssueLink(db, link);
    const cleanedRecipe = { ...recipe };
    delete cleanedRecipe.githubCreatedIssue;
    db.run("UPDATE task_packs SET generation_recipe = ? WHERE id = ?;", [
      JSON.stringify(cleanedRecipe),
      row.id,
    ]);
  }
}

const SQLITE_TASK_PACK_DRAFTS_DDL = `
  CREATE TABLE task_pack_drafts (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL,
    task_pack_id INTEGER,
    base_revision_id INTEGER,
    content TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL
      CHECK (lifecycle_state IN ('active', 'materialized', 'discarded')),
    materialized_revision_id INTEGER,
    draft_version INTEGER NOT NULL CHECK (
      draft_version >= 1 AND draft_version <= 9007199254740991
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (task_pack_id) REFERENCES task_packs(id) ON DELETE CASCADE,
    FOREIGN KEY (task_pack_id, base_revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id) ON DELETE CASCADE,
    FOREIGN KEY (task_pack_id, materialized_revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id) ON DELETE CASCADE,
    CHECK (base_revision_id IS NULL OR task_pack_id IS NOT NULL),
    CHECK (
      (lifecycle_state = 'active' AND materialized_revision_id IS NULL)
      OR
      (lifecycle_state = 'materialized'
        AND task_pack_id IS NOT NULL
        AND materialized_revision_id IS NOT NULL)
      OR
      (lifecycle_state = 'discarded' AND materialized_revision_id IS NULL)
    )
  );

  CREATE INDEX idx_task_pack_drafts_active_updated
    ON task_pack_drafts(updated_at DESC, id)
    WHERE lifecycle_state = 'active';

  CREATE INDEX idx_task_pack_drafts_project_active_updated
    ON task_pack_drafts(project_id, updated_at DESC, id)
    WHERE lifecycle_state = 'active';
`;

export const SQLITE_MIGRATIONS: SqliteMigrationDefinition[] = [
  {
    id: "0001_sqlite_baseline",
    version: 1,
    name: "SQLite baseline schema",
    description:
      "Marks the current SQLite workspace schema as the baseline before incremental desktop migrations.",
    checksum: "sqlite-baseline-v1",
    run(_db) {
      // Baseline only. Compatibility tables are created before migrations run.
    },
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
    },
  },
  {
    id: TASK_PACK_LIFECYCLE_MIGRATION_ID,
    version: 3,
    name: "Task Pack lifecycle and immutable revisions",
    description:
      "Adds aggregate lifecycle projection, immutable revisions, append-only lifecycle/review events, and legacy revision backfill.",
    checksum: "task-pack-lifecycle-revisions-v1",
    run: runSqliteTaskPackLifecycleMigration,
  },
  {
    id: TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID,
    version: 4,
    name: "Task Pack created GitHub issue linkage",
    description:
      "Moves valid aggregate-owned created GitHub issue linkage out of the flat generation recipe.",
    checksum: "task-pack-github-created-issue-link-v1",
    run: runSqliteTaskPackGitHubCreatedIssueLinkMigration,
  },
  {
    id: TASK_PACK_DRAFTS_MIGRATION_ID,
    version: 5,
    name: "Persisted Task Pack drafts",
    description:
      "Adds local persisted Task Pack drafts with optimistic concurrency and terminal draft lifecycle state.",
    checksum: "task-pack-drafts-v1",
    run(db) {
      db.run(SQLITE_TASK_PACK_DRAFTS_DDL);
    },
  },
];

export function applySqliteMigrationTransaction(
  db: Database,
  migration: SqliteMigrationDefinition,
  appliedAt: string,
  hooks: SqliteMigrationTransactionHooks = {},
): void {
  db.run("BEGIN IMMEDIATE;");
  try {
    migration.run(db);
    hooks.beforeRecord?.(migration);
    db.run(
      `INSERT INTO schema_migrations (id, version, name, description, checksum, applied_at)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [migration.id, migration.version, migration.name, migration.description, migration.checksum, appliedAt],
    );
    db.run("COMMIT;");
  } catch (error) {
    try {
      db.run("ROLLBACK;");
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  }
}

export interface PostgresMigrationClient {
  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export const POSTGRES_TASK_PACK_LIFECYCLE_DDL = `
  ALTER TABLE task_packs
    ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'active'
      CHECK (lifecycle_state IN ('active', 'completed', 'archived')),
    ADD COLUMN IF NOT EXISTS archived_from_state TEXT
      CHECK (archived_from_state IS NULL OR archived_from_state IN ('active', 'completed')),
    ADD COLUMN IF NOT EXISTS current_revision_id INTEGER,
    ADD COLUMN IF NOT EXISTS accepted_revision_id INTEGER,
    ADD COLUMN IF NOT EXISTS lifecycle_version INTEGER NOT NULL DEFAULT 1
      CHECK (lifecycle_version >= 1),
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

  CREATE TABLE task_pack_revisions (
    id SERIAL PRIMARY KEY,
    task_pack_id INTEGER NOT NULL REFERENCES task_packs(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    base_revision_id INTEGER,
    source_kind TEXT NOT NULL CHECK (
      source_kind IN ('generated', 'manual_edit', 'regenerated', 'imported', 'split', 'legacy_snapshot')
    ),
    raw_task TEXT NOT NULL,
    task_type TEXT NOT NULL,
    target_tool TEXT NOT NULL,
    generated_prompt TEXT NOT NULL,
    generation_mode TEXT NOT NULL CHECK (generation_mode IN ('template', 'ollama')),
    generation_model TEXT,
    generation_message TEXT,
    generation_used_fallback BOOLEAN NOT NULL,
    generation_duration_ms DOUBLE PRECISION,
    generation_recipe JSONB,
    diagnostics JSONB,
    grounded_context_snapshot JSONB,
    freshness_basis JSONB,
    content_hash TEXT NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL,
    generated_at TIMESTAMPTZ,
    UNIQUE (task_pack_id, revision_number),
    UNIQUE (task_pack_id, id),
    FOREIGN KEY (task_pack_id, base_revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id)
  );

  CREATE TABLE task_pack_lifecycle_events (
    id TEXT PRIMARY KEY,
    task_pack_id INTEGER NOT NULL REFERENCES task_packs(id) ON DELETE CASCADE,
    revision_id INTEGER,
    event_type TEXT NOT NULL CHECK (
      event_type IN ('completed', 'reopened', 'archived', 'unarchived')
    ),
    from_state TEXT NOT NULL CHECK (from_state IN ('active', 'completed', 'archived')),
    to_state TEXT NOT NULL CHECK (to_state IN ('active', 'completed', 'archived')),
    source TEXT NOT NULL CHECK (source IN ('user', 'system', 'migration', 'import')),
    actor_id TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    metadata JSONB,
    FOREIGN KEY (task_pack_id, revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id)
  );

  CREATE INDEX idx_task_pack_lifecycle_events_task_pack_created
    ON task_pack_lifecycle_events(task_pack_id, created_at, id);

  CREATE TABLE task_pack_revision_review_events (
    id TEXT PRIMARY KEY,
    task_pack_id INTEGER NOT NULL REFERENCES task_packs(id) ON DELETE CASCADE,
    revision_id INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK (
      event_type IN ('review_started', 'accepted', 'changes_requested')
    ),
    from_state TEXT NOT NULL CHECK (
      from_state IN ('unreviewed', 'in_review', 'accepted', 'changes_requested')
    ),
    to_state TEXT NOT NULL CHECK (
      to_state IN ('unreviewed', 'in_review', 'accepted', 'changes_requested')
    ),
    source TEXT NOT NULL CHECK (source IN ('user', 'system', 'migration', 'import')),
    actor_id TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    metadata JSONB,
    FOREIGN KEY (task_pack_id, revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id)
  );

  CREATE INDEX idx_task_pack_revision_review_events_revision_created
    ON task_pack_revision_review_events(task_pack_id, revision_id, created_at, id);
`;

export const POSTGRES_TASK_PACK_LIFECYCLE_CONSTRAINTS = `
  ALTER TABLE task_packs
    ADD CONSTRAINT task_packs_current_revision_ownership_fk
      FOREIGN KEY (id, current_revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id)
      DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT task_packs_accepted_revision_ownership_fk
      FOREIGN KEY (id, accepted_revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id)
      DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT task_packs_archive_projection_check CHECK (
      (lifecycle_state = 'archived' AND archived_from_state IS NOT NULL AND archived_at IS NOT NULL)
      OR (lifecycle_state <> 'archived' AND archived_from_state IS NULL AND archived_at IS NULL)
    );

  CREATE FUNCTION reject_task_pack_revision_update() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'task_pack_revisions are immutable';
  END;
  $$;

  CREATE TRIGGER task_pack_revisions_immutable
    BEFORE UPDATE ON task_pack_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_task_pack_revision_update();

  CREATE FUNCTION reject_task_pack_event_update() RETURNS trigger
  LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'Task Pack lifecycle/review events are append-only';
  END;
  $$;

  CREATE TRIGGER task_pack_lifecycle_events_immutable
    BEFORE UPDATE ON task_pack_lifecycle_events
    FOR EACH ROW EXECUTE FUNCTION reject_task_pack_event_update();

  CREATE TRIGGER task_pack_revision_review_events_immutable
    BEFORE UPDATE ON task_pack_revision_review_events
    FOR EACH ROW EXECUTE FUNCTION reject_task_pack_event_update();
`;

export const POSTGRES_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL = `
  CREATE TABLE task_pack_github_created_issue_links (
    task_pack_id INTEGER PRIMARY KEY REFERENCES task_packs(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    full_name TEXT NOT NULL,
    issue_number INTEGER NOT NULL CHECK (issue_number > 0),
    issue_title TEXT NOT NULL,
    issue_url TEXT NOT NULL,
    issue_state TEXT NOT NULL CHECK (issue_state IN ('open', 'closed')),
    labels JSONB NOT NULL,
    repository_url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );
`;

export const POSTGRES_TASK_PACK_DRAFTS_DDL = `
  CREATE TABLE task_pack_drafts (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_pack_id INTEGER REFERENCES task_packs(id) ON DELETE CASCADE,
    base_revision_id INTEGER,
    content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
    lifecycle_state TEXT NOT NULL
      CHECK (lifecycle_state IN ('active', 'materialized', 'discarded')),
    materialized_revision_id INTEGER,
    draft_version BIGINT NOT NULL CHECK (
      draft_version >= 1
      AND draft_version <= 9007199254740991
    ),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    FOREIGN KEY (task_pack_id, base_revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id) ON DELETE CASCADE,
    FOREIGN KEY (task_pack_id, materialized_revision_id)
      REFERENCES task_pack_revisions(task_pack_id, id) ON DELETE CASCADE,
    CHECK (base_revision_id IS NULL OR task_pack_id IS NOT NULL),
    CHECK (
      (lifecycle_state = 'active' AND materialized_revision_id IS NULL)
      OR
      (lifecycle_state = 'materialized'
        AND task_pack_id IS NOT NULL
        AND materialized_revision_id IS NOT NULL)
      OR
      (lifecycle_state = 'discarded' AND materialized_revision_id IS NULL)
    )
  );

  CREATE INDEX idx_task_pack_drafts_active_updated
    ON task_pack_drafts(updated_at DESC, id)
    WHERE lifecycle_state = 'active';

  CREATE INDEX idx_task_pack_drafts_project_active_updated
    ON task_pack_drafts(project_id, updated_at DESC, id)
    WHERE lifecycle_state = 'active';
`;

export async function applyPostgresTaskPackLifecycleMigration(
  client: PostgresMigrationClient,
  appliedAt: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(POSTGRES_TASK_PACK_LIFECYCLE_DDL);
    const legacy = await client.query<LegacyTaskPackPersistenceRow>(`
      SELECT id, raw_task, task_type, target_tool, generated_prompt,
             generation_mode, generation_model, generation_message,
             generation_used_fallback, generation_duration_ms,
             generation_recipe, created_at
      FROM task_packs
      ORDER BY id ASC;
    `);

    for (const row of legacy.rows) {
      const content = buildLegacyTaskPackRevisionContent(row);
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO task_pack_revisions (
          task_pack_id, revision_number, base_revision_id, source_kind,
          raw_task, task_type, target_tool, generated_prompt,
          generation_mode, generation_model, generation_message,
          generation_used_fallback, generation_duration_ms, generation_recipe,
          diagnostics, grounded_context_snapshot, freshness_basis,
          content_hash, created_at, generated_at
        ) VALUES (
          $1, 1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12::jsonb, NULL, NULL, NULL, $13, $14, NULL
        ) RETURNING id;`,
        [
          row.id,
          content.sourceKind,
          content.rawTask,
          content.taskType,
          content.targetTool,
          content.generatedPrompt,
          content.generationMode,
          content.generationModel,
          content.generationMessage,
          content.generationUsedFallback,
          content.generationDurationMs,
          content.generationRecipe === null ? null : JSON.stringify(content.generationRecipe),
          contentHashForRevision(content),
          timestampString(row.created_at),
        ],
      );
      await client.query(
        `UPDATE task_packs
         SET lifecycle_state = 'active', archived_from_state = NULL,
             current_revision_id = $1, accepted_revision_id = NULL,
             lifecycle_version = 1, completed_at = NULL, archived_at = NULL
         WHERE id = $2;`,
        [inserted.rows[0]!.id, row.id],
      );
    }

    await validatePostgresTaskPackLifecycleMigration(client, legacy.rows);
    await client.query(POSTGRES_TASK_PACK_LIFECYCLE_CONSTRAINTS);
    await client.query(
      `INSERT INTO schema_migrations (id, version, name, description, checksum, applied_at)
       VALUES ($1, 3, $2, $3, $4, $5);`,
      [
        TASK_PACK_LIFECYCLE_MIGRATION_ID,
        "Task Pack lifecycle and immutable revisions",
        "Adds aggregate lifecycle projection, immutable revisions, append-only lifecycle/review events, and legacy revision backfill.",
        "task-pack-lifecycle-revisions-v1",
        appliedAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  }
}

export async function applyPostgresTaskPackGitHubCreatedIssueLinkMigration(
  client: PostgresMigrationClient,
  appliedAt: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(POSTGRES_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL);
    const legacy = await client.query<LegacyTaskPackGitHubLinkRow>(`
      SELECT id, generation_recipe FROM task_packs ORDER BY id ASC;
    `);
    for (const row of legacy.rows) {
      const recipe = parseLegacyGenerationRecipe(row.generation_recipe);
      if (!recipe || !Object.hasOwn(recipe, "githubCreatedIssue")) continue;
      const link = parseTaskPackGitHubCreatedIssueCompatibilityLink(
        recipe.githubCreatedIssue,
        Number(row.id),
      );
      if (!link) continue;
      await client.query(
        `INSERT INTO task_pack_github_created_issue_links (
          task_pack_id, owner, repo, full_name, issue_number, issue_title,
          issue_url, issue_state, labels, repository_url, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11);`,
        [
          link.taskPackId,
          link.owner,
          link.repo,
          link.fullName,
          link.issueNumber,
          link.issueTitle,
          link.issueUrl,
          link.issueState,
          JSON.stringify(link.labels),
          link.repositoryUrl,
          link.createdAt,
        ],
      );
      await client.query(
        `UPDATE task_packs
         SET generation_recipe = generation_recipe - 'githubCreatedIssue'
         WHERE id = $1;`,
        [link.taskPackId],
      );
    }
    await client.query(
      `INSERT INTO schema_migrations (id, version, name, description, checksum, applied_at)
       VALUES ($1, 4, $2, $3, $4, $5);`,
      [
        TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID,
        "Task Pack created GitHub issue linkage",
        "Moves valid aggregate-owned created GitHub issue linkage out of the flat generation recipe.",
        "task-pack-github-created-issue-link-v1",
        appliedAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  }
}

export async function applyPostgresTaskPackDraftsMigration(
  client: PostgresMigrationClient,
  appliedAt: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(POSTGRES_TASK_PACK_DRAFTS_DDL);
    await client.query(
      `INSERT INTO schema_migrations (id, version, name, description, checksum, applied_at)
       VALUES ($1, 5, $2, $3, $4, $5);`,
      [
        TASK_PACK_DRAFTS_MIGRATION_ID,
        "Persisted Task Pack drafts",
        "Adds local persisted Task Pack drafts with optimistic concurrency and terminal draft lifecycle state.",
        "task-pack-drafts-v1",
        appliedAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  }
}

function validateSqliteTaskPackLifecycleMigration(db: Database): void {
  const taskPackCount = Number(readSqliteScalar(db, "SELECT COUNT(*) AS value FROM task_packs;"));
  const revisionCount = Number(
    readSqliteScalar(db, "SELECT COUNT(*) AS value FROM task_pack_revisions;"),
  );
  if (taskPackCount !== revisionCount) throw new Error("Task Pack lifecycle backfill count mismatch.");
  assertZeroSqliteCount(
    db,
    `SELECT COUNT(*) AS value
     FROM task_packs tp
     LEFT JOIN task_pack_revisions r ON r.id = tp.current_revision_id
     WHERE tp.current_revision_id IS NULL OR r.task_pack_id <> tp.id;`,
    "Every Task Pack must point to its own current revision.",
  );
  assertZeroSqliteCount(
    db,
    `SELECT COUNT(*) AS value FROM task_pack_revisions
     WHERE revision_number <> 1 OR base_revision_id IS NOT NULL;`,
    "Legacy revisions must be first revisions without a base.",
  );
  assertZeroSqliteCount(
    db,
    `SELECT COUNT(*) AS value
     FROM task_packs tp
     JOIN task_pack_revisions r ON r.task_pack_id = tp.id
     WHERE tp.generation_recipe IS NOT r.generation_recipe;`,
    "Legacy generation recipes must be preserved exactly, including null.",
  );
  const revisionColumns = readSqliteRows<{ name: string }>(
    db,
    "PRAGMA table_info(task_pack_revisions);",
  ).map((row) => row.name);
  if (revisionColumns.includes("title") || revisionColumns.includes("project_id")) {
    throw new Error("Revision storage cannot own Task Pack title or project identity.");
  }

  const rows = readSqliteRows<LegacyTaskPackPersistenceRow & { content_hash: string }>(
    db,
    `SELECT tp.id, tp.raw_task, tp.task_type, tp.target_tool, tp.generated_prompt,
            tp.generation_mode, tp.generation_model, tp.generation_message,
            tp.generation_used_fallback, tp.generation_duration_ms,
            tp.generation_recipe, tp.created_at, r.content_hash
     FROM task_packs tp
     JOIN task_pack_revisions r ON r.task_pack_id = tp.id AND r.revision_number = 1;`,
  );
  for (const row of rows) {
    const expected = contentHashForRevision(buildLegacyTaskPackRevisionContent(row));
    if (row.content_hash !== expected) {
      throw new Error(`Task Pack ${row.id} revision content hash validation failed.`);
    }
  }
}

async function validatePostgresTaskPackLifecycleMigration(
  client: PostgresMigrationClient,
  legacyRows: readonly LegacyTaskPackPersistenceRow[],
): Promise<void> {
  const counts = await client.query<{ task_pack_count: string | number; revision_count: string | number }>(`
    SELECT (SELECT COUNT(*) FROM task_packs) AS task_pack_count,
           (SELECT COUNT(*) FROM task_pack_revisions) AS revision_count;
  `);
  if (
    Number(counts.rows[0]?.task_pack_count ?? -1) !== legacyRows.length ||
    Number(counts.rows[0]?.revision_count ?? -1) !== legacyRows.length
  ) {
    throw new Error("PostgreSQL Task Pack lifecycle backfill count mismatch.");
  }
  const invalid = await client.query<{ count: string | number }>(`
    SELECT COUNT(*) AS count
    FROM task_packs tp
    LEFT JOIN task_pack_revisions r ON r.id = tp.current_revision_id
    WHERE tp.current_revision_id IS NULL
       OR r.task_pack_id <> tp.id
       OR r.revision_number <> 1
       OR r.base_revision_id IS NOT NULL
       OR (CASE
             WHEN tp.generation_recipe = 'null'::jsonb THEN NULL
             ELSE tp.generation_recipe
           END) IS DISTINCT FROM r.generation_recipe;
  `);
  if (Number(invalid.rows[0]?.count ?? -1) !== 0) {
    throw new Error("PostgreSQL Task Pack revision ownership/backfill validation failed.");
  }
  const revisions = await client.query<{ task_pack_id: number; content_hash: string }>(`
    SELECT task_pack_id, content_hash FROM task_pack_revisions ORDER BY task_pack_id ASC;
  `);
  const hashes = new Map(revisions.rows.map((row) => [Number(row.task_pack_id), row.content_hash]));
  for (const row of legacyRows) {
    const expected = contentHashForRevision(buildLegacyTaskPackRevisionContent(row));
    if (hashes.get(Number(row.id)) !== expected) {
      throw new Error(`PostgreSQL Task Pack ${row.id} content hash validation failed.`);
    }
  }
}

function readSqliteRows<T>(db: Database, sql: string): T[] {
  const statement = db.prepare(sql);
  try {
    const rows: T[] = [];
    while (statement.step()) rows.push(statement.getAsObject() as T);
    return rows;
  } finally {
    statement.free();
  }
}

function readSqliteScalar(db: Database, sql: string): unknown {
  return readSqliteRows<{ value: unknown }>(db, sql)[0]?.value;
}

function assertZeroSqliteCount(db: Database, sql: string, message: string): void {
  if (Number(readSqliteScalar(db, sql)) !== 0) throw new Error(message);
}

function timestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function sqliteJsonStorageValue(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error("SQLite legacy generation_recipe must be JSON text or null.");
  }
  return value;
}
