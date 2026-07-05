# ContextForge Stage 8.1 — Scanner Detection Upgrade

## Scope

Backend-only scanner/readiness improvement. This patch does not change AI selector, Ollama file selection, context composer selection logic, safety policy, or UI layout.

## Changed files

- `server/src/scanner/projectScanner.ts`

## What changed

- Replaced top-level-only scan with a bounded recursive inventory scanner.
- Ignores heavy/generated folders such as `node_modules`, `.git`, `dist`, `build`, `.next`, coverage, caches and similar paths.
- Detects nested `package.json` files in monorepos and multi-package projects.
- Aggregates scripts from root and nested packages while keeping prefixed script names for traceability.
- Detects practical dev commands such as `app`, `start`, `desktop`, `electron`, `dev:*` and `serve`.
- Detects build commands such as `build`, `compile`, `dist`, `package`, `make`, `vite build`, `tsc`, and `electron-builder`.
- Detects test commands such as `test`, `test:*`, `unit`, `e2e`, `vitest`, `jest`, `playwright`, and `cypress`.
- Detects docs/context files: `README.md`, `AGENTS.md`, `AGENTS.generated.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and `docs/`.
- Detects safe env examples: `.env.example`, `.env.sample`, `.env.template`, `.env.local.example`, `.env.development.example`, `.env.production.example`.
- Does not read `.env`, `.env.local`, private keys, or secret files.
- Detects test files/configs: `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `vitest.config.*`, `jest.config.*`, `playwright.config.*`, `cypress.config.*`.
- Detects CI files: `.github/workflows/*.yml`, `.github/workflows/*.yaml`, `.gitlab-ci.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`.
- Adds scanner signals into `readinessReport.signals` for future UI/readiness display.
- Makes readiness issue messages more actionable.

## Verification performed

- `npm run build -w @contextforge/server` — passed.
- `npx tsc -b apps/desktop/renderer` — passed.
- `npm run build -w @contextforge/renderer` could not complete inside the sandbox because `vite` from Windows `node_modules` is not executable on Linux (`vite: Permission denied`).

## Manual verification after applying

1. Rescan projects from the app.
2. Check Projects/Reports readiness scores.
3. Check that projects with `app`, `dev:client`, `dev:server`, `electron`, or nested package scripts no longer incorrectly show only `Dev command missing`.
4. Check that `.env.example`, test configs/files, docs, and CI are detected when present.
5. Confirm Task Pack generation still works normally.
