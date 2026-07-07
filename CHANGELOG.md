# Changelog

## 0.5.6-alpha

### Added

- Added Task Pack Quality Score with readiness status, issue summaries and detailed quality breakdown.
- Added a polished Quality Details view with compact readiness checks and next best actions.
- Added a sectioned Task Pack Builder workspace for Task, Recipe, Rules, Acceptance and Context review.
- Added Context Review Lite inside the builder with selected files, file reasons, confidence signals, snippets and warnings.
- Added Context Budget UI with current context load, pressure breakdown and compact/standard/detailed target mode preview.
- Added Task Understanding cards for recipe-guided intent review and conservative dynamic intent mismatch warnings.

### Changed

- Improved Context Review and Full Review wording so UI, backend, tests, docs and build tasks use clearer task-aware labels.
- Reworked intent review to avoid frontend semantic keyword dictionaries and rely on recipe metadata plus dynamic context analysis when available.
- Made fallback/source warnings softer and more user-readable without blocking Task Pack generation.
- Updated the active app phase to `Phase 0.5.6 — Task Pack Quality & Core Intelligence Lite`.
- Synced root, server, renderer, shared package, lockfile, README and app metadata to `0.5.6-alpha`.

### Fixed

- Fixed misleading intent jumps where UI/backend tasks could be interpreted as tests or bugfixes because the task mentioned verify, test, check or fix.
- Fixed Context Review wording that described backend/API tasks with UI-centric page/component language.

## 0.5.5-alpha

### Added

- Added a full Agents page with Codex, Cursor, Claude Code, Gemini and Generic agent profiles.
- Added a Template Library foundation with task presets for UI/UX redesign, bug fixes, backend API changes, tests, refactors, docs, security audits and release checklists.
- Added template preset selection to the Task Pack Builder with recipe auto-wiring for task type, target tool, prompt template, rule profile and acceptance criteria.
- Added custom template and custom profile editing flows, including copy-to-custom, reset and built-in protection behavior.

### Changed

- Simplified the Task Pack Builder so task input stays primary while preset and recipe setup live in focused modals.
- Compactly grouped template catalog cards by agent target to reduce long scrolling.
- Updated the active app phase to `Phase 0.5.5 — Agents & Templates Foundation`.
- Synced root, server, renderer, shared package, lockfile, README and app metadata to `0.5.5-alpha`.

### Fixed

- Fixed icon contrast for selected agent/provider cards and dropdown items.
- Fixed Templates page scrolling and preset-card motion stability.
- Fixed a stale animation overlay that could leave a black clickable layer after template copy/delete/filter actions.
- Fixed Task Pack Builder remount flicker when changing preset, task type or target tool.

## 0.5.4-alpha

### Added

- Added Project Memory / Decision Log support for persistent project rules and decisions.
- Added Claude API as an internal AI provider while keeping Claude Code as an external agent target.
- Added polished Reports analytics with workspace readiness, Task Pack activity and `.md` / `.txt` export.
- Added a dedicated Scanners workbench for deep scanner/readiness diagnostics.
- Added scanner signal details for packages, commands, docs, tests, environment examples, CI, configs and inventory.

### Changed

- Improved generic scanner detection for nested package manifests, scripts, docs, tests, env examples and CI files.
- Made Projects more compact by moving full scanner evidence to the Scanners page.
- Softened CI readiness weighting for local MVP projects.
- Updated the active app phase to `Phase 0.5.4 — Scanner Workbench & Reports`.
- Synced root, server, renderer, shared package, lockfile, README and app metadata to `0.5.4-alpha`.

### Fixed

- Stabilized Scanners page motion so project switching no longer makes the right column jump.

## 0.5.3-alpha

### Added

- Added editable `AGENTS.md` preview flow with Preview, Edit and Raw modes.
- Added safer save choices for `AGENTS.md`, including overwrite warning and `AGENTS.generated.md` copy option.

### Changed

- Synced root, server, renderer, shared package, lockfile, README and app metadata to `0.5.3-alpha`.
- Updated the active app phase to `Phase 0.5.3 — MVP Stabilization`.

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
