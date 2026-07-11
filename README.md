# ContextForge

**ContextForge** is a desktop devtool for preparing software projects for AI coding agents.

It scans local repositories, detects stack and scripts, builds project context, generates `AGENTS.md`, and creates structured Task Packs for tools like **Codex**, **Cursor**, **Claude Code**, and other AI coding assistants.

Current version: **v0.6.5-alpha**
Current app phase: **Phase 0.6.5 — Shadow Precision & Abstention UX**

This release sharpens the opt-in Shadow selector used by real Task Pack generation: uncertain tasks now abstain instead of reporting a false success, supporting context is more compact, edit roles require stronger evidence, and exported Task Packs no longer expose the absolute local project root.

---

## What ContextForge does now

- Adds local projects by path.
- Scans project structure and detects stack, package manager, scripts, important files, docs and config.
- Calculates an AI readiness score with readable recommendations.
- Generates an `AGENTS.md` draft for the selected project.
- Saves `AGENTS.md` into the project root.
- Creates AI Task Packs from a raw user task.
- Supports opt-in Legacy, Compare, and Shadow selector modes for internal Task Pack rollout.
- Lets Shadow abstain with a clear reason and Full Review actions when it cannot confirm a safe implementation target.
- Keeps supporting context compact and limits edit roles to evidence-backed primary targets.
- Shows privacy-safe local selector diagnostics, human-readable selection reasons, and a bounded 50-run history without source content or absolute paths.
- Exports Task Pack project metadata without the machine-specific absolute project root.
- Scores Task Pack quality with checks for clarity, scope, rules, acceptance criteria, verification and safety.
- Shows Context Review Lite with selected files, reasons, snippets, warnings and review signals.
- Shows context load/budget hints with compact, standard and detailed target modes.
- Provides recipe-guided task understanding and conservative dynamic intent warnings.
- Shows local working-tree status with branch, latest commit, staged, unstaged and untracked counts.
- Adds current local changes into Task Pack drafts as awareness-only context without turning them into edit targets.
- Provides Diff Review Lite with metadata-only diff summaries, review signals, suggested verification and Task Pack alignment.
- Supports agent profiles for Codex, Cursor, Claude Code, Gemini and generic AI agents.
- Provides an Agents page for comparing prompt style, limitations and verification behavior.
- Provides a Templates library with task presets for UI/UX, bugfix, backend, tests, refactor, docs, security and release workflows.
- Applies prompt templates, rule profiles and acceptance criteria.
- Supports custom template/profile copy, edit and delete flows for reusable project workflows.
- Uses a Context Composer flow to select relevant files/snippets for a task.
- Supports optional Ollama generation/refinement with fallback to safe template mode.
- Stores projects, settings and generated Task Packs in a local SQLite database by default.
- Supports an optional GitHub device-auth foundation for future repository and issue workflows.
- Links local projects to GitHub repository metadata through local Git remotes without uploading source files.
- Provides quick local Git setup actions for initializing Git and setting a GitHub `origin` remote.
- Loads GitHub issues from linked repositories and creates local Task Packs from issue title/body/labels.

---

## Current architecture

```text
Desktop app
  ├─ Electron shell
  ├─ React + TypeScript renderer
  └─ Local server API
       ├─ Express routes
       ├─ Project scanner
       ├─ Context Composer
       ├─ Task Pack builder
       ├─ Local Git status, diff summary and remote-linking services
       ├─ Rules and templates
       ├─ Optional Ollama integration
       └─ StorageAdapter
            ├─ SQLite local storage by default
            └─ PostgreSQL adapter for cloud/dev experiments
```

> Normal desktop use now starts from local SQLite. Docker/PostgreSQL are optional and only needed when explicitly testing the PostgreSQL adapter.

---

## Monorepo structure

```text
.
├─ apps/
│  └─ desktop/
│     ├─ electron/              # Electron main/preload process
│     └─ renderer/              # React + Vite desktop UI
├─ server/                      # Express API, scanner, prompts, Ollama, DB schema
├─ packages/
│  └─ shared/                   # Shared types/utilities
├─ docs/                        # MVP and roadmap docs
├─ docker-compose.yml           # Development PostgreSQL only
├─ README.md
└─ CHANGELOG.md
```

---

## Stack

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- Framer Motion
- Node.js
- Express
- SQLite local database for desktop storage
- PostgreSQL adapter kept for future cloud/dev experiments
- Optional Ollama integration
- Optional GitHub OAuth device flow for account pairing and issue metadata workflows

---

## Requirements for development

- Node.js 20+
- npm
- Docker Desktop, optional, only for PostgreSQL adapter experiments
- Optional: Ollama, only for AI refinement mode

---

## Environment

Create `.env` in the project root. SQLite is the default desktop storage mode:

```env
STORAGE_DRIVER=sqlite
SQLITE_DB_PATH=./data/contextforge.sqlite
SERVER_PORT=4000
OLLAMA_URL=http://localhost:11434
APP_VERSION=0.6.5-alpha

# Optional GitHub integration. ContextForge works without this.
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_SCOPES=read:user repo
GITHUB_API_BASE_URL=https://api.github.com
GITHUB_API_VERSION=2022-11-28
```

To test the PostgreSQL adapter instead:

```env
STORAGE_DRIVER=postgres
DATABASE_URL=postgresql://contextforge:contextforge@127.0.0.1:5433/contextforge
SERVER_PORT=4000
OLLAMA_URL=http://localhost:11434
APP_VERSION=0.6.5-alpha
```

---

## Optional GitHub integration

GitHub is an optional workflow layer. Local project scanning, AGENTS.md, Project Memory and Task Packs keep working without sign-in.

To test GitHub pairing, create a GitHub OAuth app, enable Device Flow, and set `GITHUB_OAUTH_CLIENT_ID` in `.env`. ContextForge stores the resulting token server-side only and does not return it to the renderer or workspace backups.

v0.6.0 completes the issue workflow foundation:

- **Stage 13.1** — browser/device pairing and connected account status;
- **Stage 13.2** — repository linking from local Git remotes;
- **Stage 13.3** — GitHub Issue → local Task Pack;
- **Stage 13.4** — Task Pack → GitHub Issue.

Project source files are not uploaded by these workflows. GitHub receives repository metadata, issue metadata and generated Task Pack briefs only when the user explicitly starts the GitHub action. PR / CI workflows and deeper core selector hardening remain later work.

---

## Development

Install dependencies:

```bash
npm install
```

Start the full desktop development flow:

```bash
npm run dev
```

This starts:

- the Express API on `http://localhost:4000`;
- the Vite renderer on `http://localhost:5173`;
- the Electron desktop shell.

SQLite data is saved by default to `data/contextforge.sqlite`.

---

## Build

```bash
npm run build
```

The build runs the renderer build first and then the server TypeScript build.

---

## Useful API checks

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/db/health
```

Expected `/api/health` version:

```json
{
  "ok": true,
  "service": "contextforge-server",
  "version": "0.6.5-alpha"
}
```

---

## MVP status

The current project now has a strong v0.6 alpha foundation: scanner, readiness report, rules, templates, Task Packs, Context Composer, Task Pack Quality Score, Local Git context, Diff Review Lite, SQLite-first persistence, optional Ollama routes and an optional GitHub issue loop.

The main MVP gaps are now:

1. Harden Ollama Task Pack generation so schema repair/retry prevents frequent template fallback.
2. Improve task-understanding and clarification UX for highly informal or ambiguous requests.
3. Evaluate enough live Shadow runs before considering it as the recommended/default selector.
4. Package a friendly desktop build and installer/portable release.
5. Polish onboarding, project details, and first-run guidance while keeping GitHub/cloud workflows optional and local-first.

See:

- [`docs/MVP.md`](docs/MVP.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/CORE_QUALITY_BACKLOG.md`](docs/CORE_QUALITY_BACKLOG.md)

---

## What not to build yet

To keep the product focused, the current MVP should avoid:

- full AI chat;
- automatic code modification;
- automatic pull requests;
- MCP gateway;
- team collaboration;
- billing;
- cloud storage of source code;
- mandatory web version.

---

## Current definition of done for MVP

The MVP is ready when a user can:

1. Start ContextForge without Docker.
2. Add a local project.
3. Scan the project.
4. See stack, scripts, readiness score and recommendations.
5. Generate, edit and save `AGENTS.md`.
6. Create a Task Pack for Codex/Cursor/Claude.
7. Apply rules, templates and acceptance criteria.
8. Copy the prompt.
9. Export the prompt to `.md` and `.txt`.
10. Close and reopen the app while data remains saved.

### GitHub v0.6.0 issue loop

ContextForge can now move in both directions between GitHub issues and local Task Packs:

1. Link a local project to a GitHub repository through its local Git remote.
2. Import a GitHub issue as local Task Pack source context.
3. Create a GitHub issue from a generated Task Pack.
4. Save source/created issue links in Task Pack result and archive metadata.

The issue body is generated from Task Pack metadata and prompt preview. Project source files are not uploaded by this workflow.
