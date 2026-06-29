# ContextForge MVP

This document describes the practical MVP target for **ContextForge v0.5.x**.

---

## Product goal

ContextForge should help a developer prepare a local software project for AI coding agents without rewriting the project, leaking private files, or manually explaining the same context every time.

The MVP is not an AI chat and not an auto-coding tool. It is a preparation layer for better prompts, safer context and repeatable Task Packs.

---

## Current MVP foundation

Already implemented or partially implemented:

- Desktop shell with Electron.
- React/Vite renderer.
- Express local API.
- Project adding by local path.
- Project scanning.
- Project readiness score.
- `AGENTS.md` preview and save flow.
- Task Pack generation.
- Rule profiles.
- Prompt templates.
- Acceptance criteria presets.
- Context Composer.
- Optional Ollama refinement with fallback.
- Workspace search.
- Settings.

---

## Required MVP flow

```text
1. User opens ContextForge.
2. User adds a local project folder.
3. App scans the project.
4. User sees stack, scripts, readiness score and recommendations.
5. User generates AGENTS.md.
6. User edits and saves AGENTS.md into the project root.
7. User writes a raw task.
8. User selects Codex, Cursor, Claude or generic target.
9. User applies rules/templates/criteria.
10. App creates a Task Pack with relevant project context.
11. User copies or exports the Task Pack.
12. User returns later and sees saved projects/history.
```

---

## MVP acceptance criteria

- App runs without Docker for normal desktop use.
- SQLite is used by default for local desktop storage.
- PostgreSQL remains only for cloud/dev experiments.
- A project can be added and rescanned.
- Scan results survive app restart.
- Task Packs survive app restart.
- `AGENTS.md` can be generated, edited and saved.
- Task Packs can be copied to clipboard.
- Task Packs can be exported to `.md` and `.txt`.
- Russian text in tasks and exports works correctly.
- Optional Ollama failures do not break template-based generation.
- UI has clear empty states and readable errors.

---

## MVP storage entities

Recommended local SQLite tables:

```text
projects
project_scans
task_packs
app_settings
prompt_templates
rule_profiles
rule_items
acceptance_criteria_presets
project_memories
file_snapshots
sync_queue
```

---

## MVP non-goals

Not required for the MVP:

- Full cloud sync.
- Team workspaces.
- Billing.
- Marketplace.
- Automatic code edits.
- Automatic PR creation.
- Full AI chat.
- Mandatory login.
- Storing full private source code in the cloud.

---

## MVP release checklist

- [ ] Versions are synced to `0.5.2-alpha`.
- [ ] README describes the actual project state.
- [ ] `/api/health` returns the current version.
- [x] SQLite storage is available for desktop.
- [x] Docker is not needed for normal user flow.
- [ ] Exports work for Task Packs.
- [ ] `AGENTS.md` edit/save flow is polished.
- [ ] Project Memory is implemented.
- [ ] Scanner is stable across several project types.
- [ ] Portable/installer build is tested.
