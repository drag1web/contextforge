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

Goal: warn users when a task is too vague, too broad, missing verification context or using risky/unclear context selection.

- [x] Score raw task quality.
- [x] Check goal, scope, constraints, selected files, rules, criteria and verification.
- [x] Show warnings without blocking generation.
- [x] Explain selected files through Context Review Lite and Full Review copy.
- [x] Add context budget hints and target mode preview.
- [x] Add recipe-guided task understanding and conservative dynamic intent warnings.

## v0.5.7 — Local Git Context & Diff Review Lite

Goal: understand the local working tree before GitHub/cloud integrations.

- [x] Detect current branch and latest commit.
- [x] Detect dirty state, changed files and untracked files.
- [x] Distinguish staged and unstaged changes.
- [x] Add changed-files context to Task Pack workflows.
- [x] Add Diff Review Lite for local diffs.
- [x] Add metadata-only review signals, suggested verification and Task Pack alignment.

## v0.5.8 — Desktop Persistence & Release Readiness

Goal: make local desktop persistence visible, versioned, backupable and ready for the next onboarding pass.

- [x] Add Storage audit in Settings.
- [x] Add SQLite schema versioning and migration metadata.
- [x] Move custom rules/templates catalog into SQLite-backed storage.
- [x] Keep legacy JSON as transition backup.
- [x] Add secret-safe workspace backup export.
- [x] Add compact desktop release readiness checks.
- [ ] Keep guarded backup restore/import for a later dedicated flow.

## v0.5.9 — Onboarding & First Run Experience

Goal: teach the user the main local-first workflow before GitHub integration.

- [ ] Add first-run welcome screen.
- [ ] Explain Add project → Scan → AGENTS.md → Task Pack → Local changes.
- [ ] Store onboarding completed state.
- [ ] Add Replay onboarding action in Settings.
- [ ] Keep Skip available for experienced users.

## v0.6 — Optional GitHub workflow bridge

Goal: add optional browser auth and GitHub workflow metadata without making login required for local use.

- [x] Add GitHub button/foundation UI.
- [x] Open GitHub device flow in browser.
- [x] Add pairing code screen.
- [x] Store GitHub token server-side/local-only.
- [x] Add GitHub sign out.
- [x] Add GitHub account status.
- [x] Keep local mode available when not signed in.

## v0.6.0 — GitHub Issue Loop & Release Baseline

Goal: close the optional GitHub issue workflow while preserving local-first desktop behavior.

- [x] Add GitHub OAuth Device Flow start/poll routes.
- [x] Add setup-required state when `GITHUB_OAUTH_CLIENT_ID` is missing.
- [x] Store GitHub token server-side/local-only and never return it to the renderer.
- [x] Add connected account status and sign out.
- [x] Exclude GitHub auth data from workspace backups.
- [x] Link local projects to GitHub repositories through local Git remotes.
- [x] Add quick local Git setup for `git init` and GitHub `origin` configuration.
- [x] Build a local Task Pack from a GitHub Issue.
- [x] Create a GitHub Issue from a generated Task Pack.
- [x] Save source/created issue metadata in Task Pack result and archive views.
- [x] Keep project source files local; GitHub receives only metadata and generated task briefs.

## v0.6.1 — Core Quality & Safety Hardening

Goal: harden the Context Composer / selector / safety layer before adding more GitHub workflow complexity.

- [ ] Add hard-blocks for requests to read or export `.env`, `.env.local`, tokens, keys, credentials and secrets.
- [ ] Add prompt-injection and destructive-intent blocking before inventory and file selection.
- [ ] Improve explicit target resolution: if a named file/page/component is not in inventory, block or ask for clarification.
- [ ] Improve Ollama selector JSON contract with schema, retry/repair and raw-response diagnostics.
- [ ] Calibrate context score so weak fallback selections cannot receive high-confidence scores.
- [ ] Split user-selected task type from inferred implementation area and surface conflicts clearly.
- [ ] Add docs/test/review routing that prefers README/package/config/test infrastructure over random pages.
- [ ] Add self-core awareness for ContextForge selector, scanner, context composer, safety and Task Pack builder tasks.

## v0.6.2 — PR / CI Workflows

Goal: extend the optional GitHub bridge from issues to pull requests and CI checks.

- [ ] Add PR browser for linked repositories.
- [ ] Show PR title, author, branches, state and changed files count.
- [ ] Create PR Review Task Packs from PR metadata and changed-file summaries.
- [ ] Add GitHub Actions / checks summary for linked repositories or PRs.
- [ ] Create Task Packs from failed CI checks.
- [ ] Keep diffs bounded and metadata-first; do not upload local source files automatically.

## v0.7 — Output Review & Safety Audit

Goal: help users review AI-agent output without automatic code edits.

- [ ] Paste diff.
- [ ] Parse changed files.
- [ ] Compare changes against selected files/rules.
- [ ] Warn about forbidden/generated files, secrets and unexpected backend/frontend changes.
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
