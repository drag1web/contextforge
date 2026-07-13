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

## v0.6.1–v0.6.3 — Selector Core Hardening & Validation Foundation

Goal: replace weak project-specific selection behavior with a universal, safety-first selector foundation.

- [x] Add secret and prompt-injection safety policies.
- [x] Protect explicit missing targets and review-only requests.
- [x] Add deterministic candidate retrieval from real inventory.
- [x] Add constrained ranking with role caps and candidate-ID validation.
- [x] Add semantic project graph and Context Assembly Engine.
- [x] Add replay, synthetic benchmark, real regression and sealed closed-validation infrastructure.
- [x] Stabilize validation locks with content fingerprints.
- [x] Validate the Shadow core on 28 real regression cases and 40 sealed holdout cases.

## v0.6.4-alpha — Shadow Internal Rollout & Real Task Pack Integration

Goal: connect the validated Shadow selector to the real Task Pack workflow without removing Legacy.

- [x] Add Legacy, Compare and Shadow rollout modes.
- [x] Add a selector pipeline orchestrator shared by preview and final generation.
- [x] Keep Compare output on Legacy while recording local Shadow diagnostics.
- [x] Use Shadow as the real selection in Shadow mode.
- [x] Limit Legacy fallback to technical failures.
- [x] Add bounded privacy-safe diagnostics history, badges and modal UI.
- [x] Preserve safety, missing-target and manual-review decisions across fallback.
- [x] Add manual-selection origin and fallback visibility.

## v0.6.5-alpha — Shadow Precision & Abstention UX

Goal: make live Shadow selections smaller, more explainable, and honest when a target cannot be confirmed.

- [x] Replace `success + 0 files` with an explicit abstention outcome.
- [x] Add stable abstention reason codes and Full Review actions.
- [x] Tighten support budgets and prune weak contextual neighbours.
- [x] Keep supporting/reference files inspect-only without strong edit evidence.
- [x] Add human-readable selection reasons and evidence-strength labels.
- [x] Remove business/project-specific runtime aliases.
- [x] Remove absolute local roots from exported Task Pack metadata.
- [x] Expand rollout smoke coverage for abstention, precision and privacy.

## v0.6.6-alpha — Ollama Task Pack Generation Reliability

Goal: reduce `Ollama returned unusable content` and make final Task Pack generation predictable.

- [x] Add a strict response schema for generated Task Packs.
- [x] Add bounded parsing, repair and controlled retry.
- [x] Detect truncated and incomplete responses.
- [x] Validate required sections before accepting a generated Task Pack.
- [x] Record precise fallback reasons without storing sensitive source content.
- [x] Improve template fallback quality and prompt-size budgeting.
- [x] Filter unauthorized Git actions, forced verification claims, and unknown file references from AI refinements.
- [x] Add generic missing-value clarification safeguards and cross-section consistency.
- [x] Deduplicate near-identical refinement items and apply bounded per-section limits.
- [x] Add privacy-safe semantic-policy and consistency diagnostics.

## v0.6.7-alpha — Task Understanding & Clarification

Goal: handle informal and ambiguous user tasks without confident guessing.

Implementation status: the grounded contract, preflight API, compact confirm/correct UI, clean clarification grounding, subjective-review sensitivity, configurable interaction modes, and resume-after-clarification flow are implemented.

- [x] Show a compact interpretation of goal, target, actions and constraints.
- [x] Detect missing context and ask one focused clarification question.
- [x] Let the user confirm or correct the interpreted task before selection.
- [x] Preserve RU/EN/mixed-language intent without project-specific rules.
- [x] Keep fallback intent analysis available when Ollama is offline.
- [x] Add Automatic, Balanced, and Confirm every task interaction modes in Settings.
- [x] Keep required missing information non-bypassable in every mode.
- [x] Show a saved-answer checking state and enforce truthful manual-verification reporting.

## Performance stabilization before v0.6.8

Goal: measure and reduce cold-start cost, repeated AI calls, repeated project work, and UI blocking before continuing the feature roadmap.

- [x] Add privacy-safe end-to-end timings and real AI call counters.
- [x] Remove redundant Task Understanding calls after simple clarification or confirmation.
- [x] Reuse confirmed Understanding snapshots during generation.
- [ ] Add incremental inventory and better-scoped caches.
- [ ] Add AI request queueing, warm-up/keep-alive controls, and resource profiles.
- [ ] Reduce prompt budgets and add cancellation/progress UX.

## v0.6.8-alpha — Shadow Readiness & Default Evaluation

Goal: decide whether Shadow is ready to become recommended for new installations.

- [ ] Review local Compare/Shadow history across varied real projects.
- [ ] Measure abstention, manual overrides, fallbacks and supporting-context size.
- [ ] Add a local readiness summary without cloud telemetry.
- [ ] Keep Legacy available even if Shadow becomes recommended.
- [ ] Do not change the default until release gates and live smoke checks pass.

## v0.7.x — Repository Intelligence & Output Review

Goal: connect Task Packs more deeply to Git/GitHub state and review agent output safely.

- [ ] Add a separate Project Details page for readiness, scanner, Git/GitHub state and recent Task Packs.
- [ ] Build Task Packs from PR metadata, review comments and failed CI checks.
- [ ] Use bounded branch/diff/commit context without uploading local source automatically.
- [ ] Parse pasted or local diffs and compare changes against selected files and project rules.
- [ ] Warn about unexpected edits, generated files, secrets and scope drift.

## v0.8.x — Task Pack Workflow & Multi-Agent Work

Goal: turn Task Packs into a reusable workflow rather than one-off prompts.

- [ ] Add Task Pack versions, drafts and comparison.
- [ ] Add project task history and lifecycle states.
- [ ] Split large work into frontend, backend, tests, docs and review packs.
- [ ] Adapt outputs for Codex, Claude Code, Cursor, Gemini and generic agents.
- [ ] Pass bounded results from one agent step to the next.

## v0.9.x — Production Hardening

Goal: prepare a dependable public desktop release.

- [ ] Harden SQLite migrations, backup/restore and corruption recovery.
- [ ] Add installer, portable build, signed releases and update flow.
- [ ] Improve bundle size, code splitting and large-project performance.
- [ ] Finish onboarding, accessibility, RU/EN localization and error boundaries.
- [ ] Complete security and privacy audits.

## v1.0.0 — Stable desktop release

Goal: a production-ready local-first workspace for real AI-assisted development.

- [ ] Add and scan a local project without Docker or mandatory sign-in.
- [ ] Understand a natural-language task and clarify ambiguity.
- [ ] Select explainable, safe, real project context.
- [ ] Generate and export a reliable Task Pack for the chosen agent.
- [ ] Keep source code local unless the user explicitly chooses an external workflow.
- [ ] Preserve project/task history across restarts with a stable desktop release.
