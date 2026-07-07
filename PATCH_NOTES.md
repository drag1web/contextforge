# ContextForge Stage 10 Closeout — v0.5.6-alpha

This patch closes the 10.x block as `v0.5.6-alpha` / `Phase 0.5.6 — Task Pack Quality & Core Intelligence Lite`.

## Updated

- Root/server/renderer/shared package versions to `0.5.6-alpha`.
- Root `package-lock.json` workspace versions.
- Server health fallback app version.
- Renderer app metadata/version/phase.
- README current status, environment examples, health check version and MVP gaps.
- CHANGELOG with the `0.5.6-alpha` entry.
- MVP checklist for Task Pack Quality and Context Review Lite.
- Roadmap: v0.5.6 marked complete; next v0.5.7 aligned to Local Git Context & Diff Review Lite.

## Verification run in sandbox

- `npm run build -w @contextforge/server` — passed.
- `npx tsc -b apps/desktop/renderer/tsconfig.json` — passed.
- `npm run build -w @contextforge/renderer` — TypeScript passed, then `vite build` failed in the sandbox with `sh: 1: vite: Permission denied`. This is the known sandbox executable-permission issue, not a TypeScript error.
