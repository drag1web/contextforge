# ContextForge Roadmap

## v0.5.1 — Version, README and metadata sync

Goal: make the repository honestly describe the current v0.5 alpha state.

- [x] Sync root package version.
- [x] Sync server package version.
- [x] Sync renderer package version.
- [x] Keep shared package version synced.
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

- [x] Export Task Pack to `.md`.
- [x] Export Task Pack to `.txt`.
- [x] Use safe readable filenames.
- [x] Make `AGENTS.md` preview editable.
- [x] Warn when `AGENTS.md` already exists.
- [x] Support overwrite / save as copy / cancel.

## v0.5.4 — Scanner Workbench & Reports

Goal: close the MVP stabilization pass with project memory, provider clarity, workspace analytics and scanner diagnostics.

- [x] Add Project Memory / Decision Log.
- [x] Include enabled memories in Task Packs and `AGENTS.md`.
- [x] Add Claude API provider and clarify provider vs agent target selection.
- [x] Polish Integrations provider and agent target UI.
- [x] Add Reports analytics and workspace report export.
- [x] Improve generic scanner/readiness detection.
- [x] Add Scanners workbench for detailed diagnostics.
- [x] Keep Projects compact with scanner snapshots.
- [x] Polish scanner motion and readiness explanations.

## v0.5.5 — Agents & Templates Foundation

Goal: make agent profiles and task templates a real part of the Task Pack workflow.

- [x] Add a full Agents page for Codex, Cursor, Claude Code, Gemini and Generic.
- [x] Explain best fit, prompt style, limitations, context size and verification behavior per agent.
- [x] Add a Template Library with task presets for UI/UX, bugfix, backend, tests, refactor, docs, security and release workflows.
- [x] Compact the template catalog into grouped agent cards.
- [x] Connect template presets to Task Pack Builder recipe setup.
- [x] Keep the task input primary by moving preset and recipe setup into focused modals.
- [x] Add custom template/profile copy and edit flows with built-in protection.

## v0.5.6 — Task Pack Quality & Core Intelligence Lite

Goal: warn users when a task is too vague, too broad or missing verification context.

- [ ] Score raw task quality.
- [ ] Check goal, scope, constraints, selected files, rules, criteria and verification.
- [ ] Show warnings without blocking generation.
- [ ] Explain why files were selected.
- [ ] Add context budget hints.

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
