# ContextForge Roadmap

## v0.5.1 — Version, README and metadata sync

Goal: make the repository honestly describe the current v0.5 alpha state.

- [x] Sync root package version.
- [x] Sync server package version.
- [x] Sync renderer package version.
- [x] Keep shared package at `0.5.2-alpha`.
- [x] Update `/api/health` version.
- [x] Rewrite root README.
- [x] Add MVP documentation.
- [x] Add roadmap documentation.
- [x] Update changelog.

## v0.5.2 — Local database architecture

Goal: move desktop storage to SQLite while keeping PostgreSQL available for future cloud/dev work.

- [x] Add `StorageAdapter` interface.
- [x] Add `PostgresStorageAdapter` for the current code path.
- [x] Add `SqliteStorageAdapter` for desktop MVP.
- [x] Add SQLite schema/init.
- [x] Move app settings into SQLite.
- [x] Move projects into SQLite.
- [x] Move task packs into SQLite.
- [x] Remove Docker requirement from normal desktop startup.

## v0.5.3 — Export and AGENTS.md polish

Goal: finish practical output/export features.

- [ ] Export Task Pack to `.md`.
- [ ] Export Task Pack to `.txt`.
- [ ] Use safe readable filenames.
- [ ] Show toast after export.
- [ ] Show clear write errors.
- [ ] Make `AGENTS.md` preview editable.
- [ ] Warn when `AGENTS.md` already exists.
- [ ] Support overwrite / save as copy / cancel.

## v0.5.4 — Project Memory / Decision Log

Goal: let users store long-term project rules and decisions.

- [ ] Add `project_memories` table.
- [ ] Add CRUD API routes.
- [ ] Add categories and priorities.
- [ ] Add enable/disable toggle.
- [ ] Include enabled memories in Task Packs.
- [ ] Show which memories were used.

## v0.5.5 — Scanner and readiness stabilization

Goal: make scanning universal and project-agnostic.

- [ ] Use project inventory scanner as primary fact source.
- [ ] Keep scanner generic; no hardcoded domain rules.
- [ ] Improve stack detection.
- [ ] Improve script/config/env/docs/tests detection.
- [ ] Improve readiness report.
- [ ] Add readable recommendations and status.

## v0.5.6 — Task Pack Quality Score

Goal: warn users when a task is too vague or too broad.

- [ ] Score raw task quality.
- [ ] Check goal, scope, constraints, files, criteria and verification.
- [ ] Show warnings without blocking generation.

## v0.5.7 — Context Drift Detector

Goal: detect when generated context may be outdated.

- [ ] Save file snapshots.
- [ ] Store size/mtime/hash for important files.
- [ ] Link Task Packs to scans.
- [ ] Warn when files changed after generation.
- [ ] Offer rescan.

## v0.6 — Optional browser auth and cloud pairing

Goal: add optional sign-in without making login required for local use.

- [ ] Add GitHub/Google buttons.
- [ ] Open website OAuth flow in browser.
- [ ] Add pairing code screen.
- [ ] Store token securely.
- [ ] Add sign out.
- [ ] Add account status.
- [ ] Keep sync disabled when not signed in.

## v0.7 — Diff Review Lite

Goal: help users review AI-agent output without automatic code edits.

- [ ] Paste diff.
- [ ] Parse changed files.
- [ ] Compare changes against selected files/rules.
- [ ] Warn about forbidden/generated files.
- [ ] Save manual review status.

## v0.8 — Optional AI/Ollama polish

Goal: make AI enhancement useful but never required.

- [ ] Improve model selector.
- [ ] Add connection check polish.
- [ ] Improve fallback to template mode.
- [ ] Improve AI file selector.
- [ ] Improve AI summaries.

## v1.0 — Stable desktop release

Goal: a portfolio-ready desktop app that can be used by real users.

- [ ] SQLite by default.
- [ ] No Docker required.
- [ ] Stable installer.
- [ ] Portable build.
- [ ] Onboarding.
- [ ] Empty states.
- [ ] Error boundaries.
- [ ] Full RU/EN localization.
- [ ] Demo project.
- [ ] Screenshots/GIFs.
- [ ] Release notes.
