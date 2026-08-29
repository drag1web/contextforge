# ContextForge Roadmap

This roadmap summarizes completed product milestones and the next release phases. Detailed implementation history remains in [`CHANGELOG.md`](../CHANGELOG.md).

## Completed foundation

### v0.5.x — Local desktop MVP

- SQLite-first desktop storage without a Docker requirement.
- Project scanner, readiness, Scanners workspace, Project Memory, and reports.
- Editable `AGENTS.md` generation and safe save/overwrite flow.
- Task Pack Builder, archive, exports, templates, rules, acceptance criteria, and Context Composer.
- Local Git context, Diff Review Lite, storage audit, backup export, and onboarding foundation.

### v0.6.0 — Optional GitHub issue loop

- GitHub device authentication and connected-account status.
- Local project → repository linking through Git remotes.
- GitHub Issue → local Task Pack.
- Task Pack → GitHub Issue.
- Optional workflow metadata without mandatory login or source upload.

### v0.6.1–v0.6.7 — Universal grounding and Task Understanding

- Secret, unsafe-path, prompt-injection, destructive-intent, and explicit-target protection.
- Deterministic retrieval, semantic relationships, ownership evidence, and bounded context assembly.
- Legacy/Compare/Shadow rollout, diagnostics, abstention, manual review, and truthful confidence.
- Task Understanding, focused clarification, exact-value preservation, and configurable interaction modes.
- Canonical core, authorization authority, safety preconditions, explicit create/wiring, supporting-context grounding, and Validation Lab.

## v0.7.0-alpha — Desktop Workspace & Local MCP

Goal: publish the refreshed source baseline and expose ContextForge safely to MCP-compatible clients.

- [x] Complete the main desktop UI refresh across all workspaces.
- [x] Rebuild Task Pack result, editors, diagnostics, global toast, title bar, navigation, and search.
- [x] Localize Project Details and refreshed modal surfaces in Russian and English.
- [x] Fix Account & Sync runtime hook ordering.
- [x] Add ContextForge MCP Server v1 over local stdio.
- [x] Add read tools, resources, workflow prompts, structured envelopes, and safe errors.
- [x] Keep MCP read-only by default.
- [x] Require global permission plus `confirmCreate: true` for Task Pack creation.
- [x] Add desktop MCP status, permissions, Codex setup snippets, and connection testing.
- [x] Publish a GitHub source pre-release with synchronized metadata and cleaned repository documentation.

## Next: v0.7.x — Repository intelligence and MCP hardening

Context Engine v2 implementation status:

- [x] CE2-00 through CE2-10 staged implementation.
- [x] CE2-11 opt-in primary-authority code readiness at `d543114`.
- [x] Reproducible external-retirement validation tooling and repository hygiene.
- [ ] Run approved manifests across real local projects.
- [ ] Complete the observation window and approve a fallback-rate threshold.
- [ ] Verify the rollback/archive checkpoint and receive human rollout approval.
- [ ] Execute physical legacy retirement and change the global default; neither is approved yet.

- [ ] Review live MCP usage across Codex CLI, IDE extension, and desktop surfaces.
- [ ] Add richer stored Git summaries without allowing arbitrary repository reads through MCP.
- [ ] Improve older Task Pack explanation compatibility.
- [ ] Add incremental inventory and better-scoped caches.
- [ ] Add AI request queueing, cancellation, and warm-up/resource controls.
- [ ] Review enough live Shadow runs before changing any default.
- [ ] Expand deep ownership adapters beyond TypeScript/JavaScript.

## v0.8.x — Task Pack lifecycle and output review

- [ ] Task Pack drafts, versions, comparison, and lifecycle states.
- [ ] Split large work into bounded frontend, backend, tests, docs, and review packs.
- [ ] Compare pasted or local diffs against selected files, project rules, and acceptance criteria.
- [ ] Warn about unexpected edits, generated files, secrets, and scope drift.
- [ ] Add explicit multi-step handoff without silently executing agent tasks.

## v0.9.x — Production desktop hardening

- [ ] Installer and portable packaging.
- [ ] Signed releases and update flow.
- [ ] SQLite migration, backup/restore, and corruption recovery hardening.
- [ ] Renderer code splitting and large-project performance work.
- [ ] Accessibility, keyboard, reduced-motion, and error-boundary audit.
- [ ] Security and privacy review of all external integration surfaces.

## v1.0.0 — Stable local-first release

- [ ] Add and scan a project without Docker or mandatory sign-in.
- [ ] Understand and clarify a natural-language task.
- [ ] Select explainable, safe, real project context.
- [ ] Generate and export a reliable Task Pack for the chosen agent.
- [ ] Reuse ContextForge context through a stable local MCP boundary.
- [ ] Keep source code local unless the user explicitly starts an external workflow.
- [ ] Preserve data safely across upgrades with a packaged desktop release.
