# Changelog

## 0.5.2-alpha

### Added

- Added `StorageAdapter` interface for local/cloud storage separation.
- Added SQLite storage adapter as the default desktop storage mode.
- Added PostgreSQL storage adapter for future cloud/dev experiments.
- Added local SQLite schema/init for MVP entities, including future-ready tables for project memories, file snapshots and sync queue.

### Changed

- Moved projects, task packs and app settings behind the storage adapter.
- Updated `/api/db/health` to report the active storage driver.
- Updated `.env.example`, README and roadmap for Docker-free normal desktop startup.

## 0.5.0-alpha

### Added

- Added Context Composer flow for task-aware project context.
- Added project inventory based file selection.
- Added semantic validation for selected files.
- Added safer Task Pack generation flow with protected backend-generated sections.
- Added rules, templates and acceptance criteria integration for Task Packs.
- Added optional Ollama refinement with fallback to template mode.
- Added `docs/MVP.md` and `docs/ROADMAP.md`.

### Changed

- Synced package versions to `0.5.0-alpha`.
- Updated `/api/health` to return the current app version.
- Rewrote README to describe the actual v0.5 alpha state.
- Documented the next MVP direction: SQLite for desktop, PostgreSQL for future cloud/dev usage.

### Fixed

- Fixed outdated root README phase text.
- Fixed version mismatch between UI metadata, packages and server health endpoint.

## 0.2.0-alpha

### Added

- Added Markdown Preview for generated Task Packs.
- Added Preview / Raw Markdown switch in the Task Pack modal.
- Added safer Task Pack body labels: Safe Template and Ollama refined.
- Added universal task intent analysis for UI, backend, fullstack, build, docs, and asset tasks.
- Added project inventory based file selection.
- Added semantic validation for selected files.
- Added asset-focused file selection for logo/favicon tasks.
- Added frontend-only warning for fullstack tasks when no backend/server route files are found.
- Added task-aware context scanning and project inventory scanning.

### Changed

- Task Pack type now uses the effective inferred task area instead of the originally selected task type.
- Improved fullstack file coverage for UI + client API + backend tasks.
- Improved build/config, docs, asset-only, and fake-path task handling.
- Improved Task Pack modal layout, spacing, scrolling, and copy behavior.
- Improved Ollama fallback behavior so protected backend-generated sections remain stable.

### Fixed

- Fixed fake or non-existent paths leaking into generated Task Packs.
- Fixed `.env` being included in documentation Task Packs.
- Fixed confusing `Generation: Template` wording.
- Fixed markdown prompt display being shown only as raw text.
- Fixed Task Pack prompt scroll overlapping the modal footer.
