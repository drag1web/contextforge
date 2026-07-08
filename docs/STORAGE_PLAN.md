# ContextForge Storage Plan

> Stage: **12.3.1 — Workspace Backup Export Foundation**  
> Target version: **v0.5.8-alpha — Desktop Persistence & Release Readiness**

## Goal

ContextForge should remain a **local-first desktop app**. A normal user should be able to install and use it without Docker, PostgreSQL, cloud sync, or an account.

This document captures the current persistence state and the safe migration direction before deeper storage changes.

## Current storage map

| Area | Current location | Status | Notes |
|---|---|---:|---|
| Projects | SQLite/Postgres storage adapter | ✅ Ready | `projects` table stores path, stack, scripts, readiness report and scan timestamps. |
| Task Pack history | SQLite/Postgres storage adapter | ✅ Ready | `task_packs` table stores generated prompts and generation metadata. |
| Project Memory | SQLite/Postgres storage adapter | ✅ Ready | `project_memories` table stores decision log entries. |
| App settings | SQLite/Postgres storage adapter | ✅ Ready | `app_settings` table stores provider/settings values. Secret backup/export needs care later. |
| Schema migrations | SQLite `schema_migrations` + `app_storage_metadata` | ✅ Ready | Migration metadata records schema version before deeper storage changes. |
| Rules & Templates | SQLite `rules_templates_catalog_items` | ✅ Ready | Custom templates, rule profiles, rule items and acceptance presets are adapter-backed. Legacy JSON remains as a transition backup. |
| Scanner snapshots | Partial SQLite schema | 🟡 Planned | Tables exist for future scan snapshots/file snapshots, but the app still relies mainly on current project records. |
| Report/export history | Generated files only | 🟡 Planned | Export files are created, but retention/history/cleanup is not centralized yet. |
| Backup/export | `data/backups/*.json` | ✅ Export ready | Settings can create local JSON backups with projects, Task Packs, Project Memory, rules/templates and safe settings. Restore/import remains planned. |
| Release storage location | Developer workspace path | 🟡 Planned | Packaged desktop builds should use an app data directory rather than the repo working directory. |

## SQLite-first direction

SQLite should be the default desktop persistence layer:

```text
ContextForge app
  ↓
Storage adapter
  ↓
SQLite database in local app data
```

PostgreSQL can remain as a developer/advanced adapter, but it must not be required for normal desktop use.

## Stage 12 plan

### 12.1 — SQLite-first storage plan

- Add live storage audit endpoint and Settings view. ✅
- Document current storage map and migration gaps. ✅
- Add explicit schema version/migration strategy. ✅
- Decide final packaged app data path.

### 12.2 — Local database migration

- Move `rules-and-templates.json` into SQLite-backed storage. ✅
- Keep backward-compatible import from the JSON catalog. ✅
- Preserve existing custom templates/rules during migration. ✅
- Avoid deleting legacy files until backup/export exists. ✅
- Next: move scanner snapshots/export history only after backup/export basics are clearer.

### 12.3 — Backup / export workspace data

- Export workspace data to `.json`. ✅
- Exclude provider API keys, provider URLs, source files and raw diffs from backups. ✅
- Import workspace data from `.json`.
- Backup before destructive migrations.
- Restore safely with clear warnings.

### 12.4 — Release build checks

- Verify clean first run.
- Verify portable and installer behavior.
- Verify no Docker/Postgres requirement for normal users.
- Verify local database path and backup path.

## Migration principles

1. **No data loss.** Existing JSON catalogs must be imported before being retired.
2. **No forced cloud.** All storage remains local by default.
3. **No hard cutover without backup.** Legacy files should remain until export/import is available.
4. **Small migrations.** Each patch should move one area at a time.
5. **Clear UI.** Settings should explain where data is stored and what is still planned.

## Current known gaps

- Workspace backup export exists; import/restore is still planned.
- Packaged app data directory is not finalized.
- Export history and cleanup controls are not centralized.
- Scanner snapshot persistence is still partial.

## Migration metadata

Stage 12.1.2 added a migration ledger before moving more data:

- `schema_migrations` records applied SQLite migrations.
- `app_storage_metadata` records current schema metadata.
- `0001_sqlite_baseline` marks the developer-preview schema as version `1`.

Stage 12.2.1 adds the rules/templates catalog migration:

- `0002_rules_templates_catalog` moves custom rules/templates behind adapter-backed SQLite storage.
- `rules_templates_catalog_items` stores custom templates, rule profiles, rule items and acceptance presets as JSON payload rows.
- `data/rules-and-templates.json` remains as a readable transition backup during 12.x.
- Reads prefer SQLite when available; writes update SQLite and keep the legacy JSON backup in sync.

Stage 12.3.1 adds workspace backup export:

- `POST /api/storage/backups/export` writes a local JSON backup under `data/backups/`.
- Backup payload includes projects, Task Packs, Project Memory, rules/templates catalog, schema metadata and safe settings.
- Provider API keys, provider URLs, source files, raw diffs and GitHub tokens are intentionally excluded.
- Settings → Storage exposes a small export action and shows the created backup path/counts.

## Next recommended patch

**Stage 12.3.2 — Workspace Backup Restore Plan / Guardrails**

Design the import/restore flow with clear warnings, preview before overwrite, and backup-before-restore behavior before implementing destructive writes.


## Stage 12.4 — Release readiness checks

Implemented as a compact Settings → Storage checklist covering SQLite-first mode, database presence, schema status, rules/templates SQLite catalog, workspace backup export and backup creation. Backup restore/import remains intentionally guarded for a later dedicated flow.
