# Changelog

## 0.6.0-alpha — GitHub Issue Loop & Release Baseline

### Added

- Completed the optional GitHub issue workflow loop:
  - Stage 13.1 — GitHub browser/device auth and connected account status.
  - Stage 13.2 — local project → GitHub repository linking through local Git remotes.
  - Stage 13.3 — GitHub Issue → local Task Pack.
  - Stage 13.4 — Task Pack → GitHub Issue.
- Added GitHub source/created issue metadata in Task Pack result and archive views.
- Added safer GitHub issue body formatting with compact summary and generated prompt details.
- Added documentation for core-quality hardening as the next engineering focus before PR / CI workflows.

### Changed

- Bumped root, server, renderer, shared package and app metadata to `0.6.0-alpha`.
- Updated README, roadmap, MVP docs and patch notes to describe the current v0.6 GitHub issue loop.
- Polished GitHub page and Integrations GitHub entry copy so GitHub workflows live in their own workspace.
- Polished Scanners page rendering and project picker behavior before the v0.6.0 baseline.

### Safety

- GitHub remains optional; local scanning, AGENTS.md, Project Memory and Task Packs work without sign-in.
- GitHub tokens remain server-side/local-only and are excluded from workspace backups.
- Project source files are not uploaded by GitHub auth, repository linking, issue import or issue creation.

### Not included

- PR / CI workflows are intentionally deferred.
- Core selector/safety hardening is documented as the next focused pass and not mixed into this release finalization.
- No cloud sync, billing, team workflow, automatic code edits, commits or pushes.


## 0.5.8-alpha — Stage 13.3 patch

### Added

- Added GitHub Issues browser for linked repositories on the dedicated GitHub page.
- Added issue filters for state, text search and comma-separated labels.
- Added Issue Preview with title, body, labels, author, comments count and GitHub links.
- Added Create Task Pack from Issue flow that turns issue title/body/labels into a local Task Pack.
- Added GitHub issue source metadata to Task Pack generation recipes and archive/result badges.
- Added backend GitHub issue API helpers and project issue routes.

### Safety

- Issue import reads GitHub issue metadata only.
- Task Pack file context is still selected from the local project scan.
- No source files are uploaded and no GitHub issue is created in this stage.

### Not included

- Task Pack → GitHub Issue remains Stage 13.4.
- PR / CI workflows remain later v0.6.1 work.

## 0.5.8-alpha — Stage 13.2.1 patch

### Added

- Added GitHub page quick setup actions for local Git initialization and GitHub origin remote setup.
- Added backend routes for local Git init and safe GitHub remote configuration.
- Added command-copy helper and GitHub new-repository shortcut for manual repository setup.

### Changed

- Replaced the GitHub project native select with the shared ContextForge CustomSelect component.
- Made the renderer dev server use Vite strictPort so Electron does not open another app when port 5173 is already busy.

### Safety

- Git setup actions only modify local Git metadata. They do not create GitHub repositories through the API, push commits or upload source files.

## 0.5.8-alpha — Stage 13.2 patch

### Added

- Added GitHub Repository Linking foundation on the dedicated GitHub page.
- Added local Git remote detection and GitHub owner/repo parsing for HTTPS and SSH remotes.
- Added GitHub repository metadata validation through the connected account.
- Added link, refresh, unlink and manual owner/repo fallback actions.
- Added renderer API/types and backend routes for project-level GitHub repository links.

### Changed

- Slimmed down the GitHub section on Integrations so the page stays focused on AI providers and agent targets.
- Promoted the GitHub page into the active Stage 13.2 workspace.

### Safety

- Repository linking stores safe repo metadata only and does not upload project source files.
- GitHub repository links are excluded from workspace backups for this foundation stage.

### Not included

- Issue → Task Pack, Task Pack → Issue, PR context and CI workflows remain future stages.

## 0.5.8-alpha — Stage 13.1.3 patch

### Added

- Added a dedicated GitHub page in the sidebar for browser pairing, account status and the GitHub workflow roadmap.
- Added GitHub navigation labels for English and Russian UI resources.

### Changed

- Moved the live GitHub Device Auth UI out of Integrations.
- Restored Integrations to the provider/agent-target focused layout with the original upcoming GitHub preview card.

### Not included

- Repository linking, GitHub Issues, PR and CI workflows remain future stages.

## 0.5.8-alpha — Stage 13.1.2 patch

### Added

- Added GitHub Device Auth foundation with browser pairing, polling, connected account status and sign out.
- Added safe server-side GitHub token storage and renderer-safe account metadata responses.
- Added Electron external URL opening restricted to `https://github.com/...`.
- Added GitHub auth data exclusions to workspace backups.

### Changed

- Replaced the disabled GitHub preview CTA with a real setup/connected/pairing UI while keeping local-first mode optional.

### Not included

- Repository linking, GitHub Issues, PR and CI workflows remain future stages.

## 0.5.8-alpha

### Added

- Added Storage audit in Settings so local persistence state, SQLite database status, artifacts and migration gaps are visible.
- Added SQLite schema migration metadata with a baseline ledger and explicit schema version status.
- Added SQLite-backed Rules/Templates catalog storage with one-time import from the legacy JSON catalog.
- Added workspace backup export for secret-safe local JSON backups.
- Added Desktop release readiness checks for SQLite-first storage, schema state, catalog storage and backups.

### Changed

- Kept the legacy rules/templates JSON file as a transition backup while SQLite becomes the primary catalog.
- Marked 12.x persistence stages as complete and prepared the project for the next onboarding/first-run pass.
- Updated the active app phase to `Phase 0.5.8 — Desktop Persistence & Release Readiness`.
- Synced root, server, renderer, shared package, lockfile, README and app metadata to `0.5.8-alpha`.

### Fixed

- Fixed three-option settings grids so Composer and Interface option cards no longer leave an invisible fourth column.

## 0.5.7-alpha

### Added

- Added Local Git status detection for current branch, detached head state, latest commit, staged, unstaged and untracked files.
- Added a Project Details page so readiness, scanner evidence and local changes live outside the compact Projects list.
- Added Local Changes awareness in the Task Pack Builder with an awareness-only changed-files note.
- Added Create from changes flow for starting a Task Pack from the current local working tree.
- Added Diff Review Lite with metadata-only file summaries, additions, deletions and binary counts.
- Added review signals, suggested verification and a local manual verdict marker for changed files.
- Added Task Pack alignment that compares local diff files with the latest saved Task Pack context.
- Added a lightweight config/protected-files signal for env, lockfile, config, CI and AGENTS.md changes.

### Changed

- Renamed visible Git wording to Local changes where possible so users do not confuse local Git status with GitHub.
- Kept local changes separate from AI edit targets to avoid unsafe context assumptions.
- Updated the active app phase to `Phase 0.5.7 — Local Git Context & Diff Review Lite`.
- Synced root, server, renderer, shared package, lockfile, README and app metadata to `0.5.7-alpha`.

### Fixed

- Polished Diff Review file badges so unmeasured or untracked files no longer display confusing `+binary` / `-binary` labels.

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

## Stage 13.4 — Task Pack → GitHub Issue

- Added GitHub issue creation from Task Pack result view.
- Added editable issue preview with title, markdown body and comma-separated labels.
- Added backend GitHub issue creation route and safe local metadata persistence.
- Added Task Pack archive/result badges for created GitHub issues.
- Saved outbound issue links in `generationRecipe.githubCreatedIssue`.
- Improved GitHub issue-imported Task Pack titles.
