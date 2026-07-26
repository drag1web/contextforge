# ContextForge MVP

This document defines the practical alpha product boundary after `v0.7.0-alpha`.

## Product goal

ContextForge helps a developer prepare a local software project for AI coding agents without repeatedly rebuilding context, leaking private files, or granting an AI tool broad repository authority.

It is a preparation and review layer, not an autonomous coding agent.

## Current alpha workflow

```text
1. Add a local project.
2. Scan structure, stack, scripts, tests, docs, CI, and configuration.
3. Review readiness and project details.
4. Maintain Project Memory and generate/edit AGENTS.md.
5. Describe a task in natural language.
6. Confirm or clarify the interpreted task when needed.
7. Review grounded implementation and supporting context.
8. Apply templates, rules, and acceptance criteria.
9. Generate, edit, copy, export, or save a Task Pack.
10. Reuse saved context through the desktop app or local MCP.
```

## Implemented MVP foundation

- Electron desktop shell with React, TypeScript, Vite, Tailwind CSS, and Framer Motion.
- Local Express API with SQLite-first `StorageAdapter`.
- Project scanning, readiness, Project Details, local Git state, and Diff Review Lite.
- Project Memory and editable `AGENTS.md` preview/save workflow.
- Task Understanding, clarification, grounded context selection, authorization, and Task Pack generation.
- Templates, rule profiles, custom rules, acceptance criteria, diagnostics, and export.
- Optional Ollama and external AI-provider refinement with validated fallback.
- Optional GitHub issue workflow and optional website Desktop Link.
- Local stdio MCP server with read-only defaults and guarded Task Pack creation.
- English and Russian desktop localization across the main user workflow.

## MVP acceptance criteria

- [x] Normal local development works without Docker.
- [x] SQLite is the default desktop storage.
- [x] Projects, settings, memories, templates, rules, and Task Packs survive restart.
- [x] A project can be added, rescanned, and reviewed.
- [x] `AGENTS.md` can be generated, edited, and saved safely.
- [x] Task Packs can be generated, edited, copied, and exported to `.md` and `.txt`.
- [x] Missing required values cannot be invented or bypassed.
- [x] Subjective or weakly grounded work remains review/investigation instead of confident implementation.
- [x] Exported Task Packs omit the absolute local project root.
- [x] Optional provider failure does not break guarded template fallback.
- [x] MCP is read-only by default and cannot edit repositories or mutate Git.
- [x] MCP Task Pack creation requires global opt-in and per-call confirmation.
- [x] GitHub and website integrations remain optional.
- [x] Source release metadata is synchronized to `0.7.0-alpha`.
- [ ] Installer/portable packaging is tested.
- [ ] Backup restore and corruption recovery are production-hardened.
- [ ] Deep polyglot selector adapters are added beyond the current TS/JS strength.
- [ ] Accessibility, code splitting, and large-project performance receive a final production pass.

## Current non-goals

Not part of the current alpha MVP:

- full AI chat;
- automatic source-code modification;
- arbitrary shell execution;
- automatic Git operations or pull requests;
- remote/cloud MCP hosting;
- Codex App Server task orchestration;
- mandatory login;
- team workspaces, billing, or marketplace;
- cloud storage of private source code.

## Release position

`v0.7.0-alpha` is a source pre-release. It is suitable for development, evaluation, controlled local workflows, MCP integration experiments, and continued product validation. It is not yet presented as a packaged stable desktop application.
