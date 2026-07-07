# ContextForge

**ContextForge** is a desktop devtool for preparing software projects for AI coding agents.

It scans local repositories, detects stack and scripts, builds project context, generates `AGENTS.md`, and creates structured Task Packs for tools like **Codex**, **Cursor**, **Claude Code**, and other AI coding assistants.

Current version: **v0.5.6-alpha**  
Current app phase: **Phase 0.5.6 — Task Pack Quality & Core Intelligence Lite**

---

## What ContextForge does now

- Adds local projects by path.
- Scans project structure and detects stack, package manager, scripts, important files, docs and config.
- Calculates an AI readiness score with readable recommendations.
- Generates an `AGENTS.md` draft for the selected project.
- Saves `AGENTS.md` into the project root.
- Creates AI Task Packs from a raw user task.
- Scores Task Pack quality with checks for clarity, scope, rules, acceptance criteria, verification and safety.
- Shows Context Review Lite with selected files, reasons, snippets, warnings and review signals.
- Shows context load/budget hints with compact, standard and detailed target modes.
- Provides recipe-guided task understanding and conservative dynamic intent warnings.
- Supports agent profiles for Codex, Cursor, Claude Code, Gemini and generic AI agents.
- Provides an Agents page for comparing prompt style, limitations and verification behavior.
- Provides a Templates library with task presets for UI/UX, bugfix, backend, tests, refactor, docs, security and release workflows.
- Applies prompt templates, rule profiles and acceptance criteria.
- Supports custom template/profile copy, edit and delete flows for reusable project workflows.
- Uses a Context Composer flow to select relevant files/snippets for a task.
- Supports optional Ollama generation/refinement with fallback to safe template mode.
- Stores projects, settings and generated Task Packs in a local SQLite database by default.

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
APP_VERSION=0.5.6-alpha
```

To test the PostgreSQL adapter instead:

```env
STORAGE_DRIVER=postgres
DATABASE_URL=postgresql://contextforge:contextforge@127.0.0.1:5433/contextforge
SERVER_PORT=4000
OLLAMA_URL=http://localhost:11434
APP_VERSION=0.5.6-alpha
```

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
  "version": "0.5.6-alpha"
}
```

---

## MVP status

The current project already has a strong v0.5 foundation: scanner, readiness report, rules, templates, Task Packs, Context Composer, Task Pack Quality Score and optional Ollama routes.

The main MVP gaps are now:

1. Add local Git status and changed-files awareness.
2. Add Diff Review Lite for AI-agent output review.
3. Improve fallback selector clarity and candidate confidence wording.
4. Package a friendly desktop build.
5. Polish onboarding and first-run guidance.

See:

- [`docs/MVP.md`](docs/MVP.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)

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
