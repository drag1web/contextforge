# ContextForge v0.6.0-alpha — Release Finalization

## Summary

This patch finalizes the current working state as **v0.6.0-alpha — GitHub Issue Loop & Release Baseline**.

The goal is not to add another feature, but to freeze the completed GitHub issue workflow into a clean release point before the next core-quality hardening pass.

## Completed GitHub stages

- **13.1 — Browser auth / pairing**
  - GitHub OAuth Device Flow pairing.
  - Connected account status.
  - Sign out.
  - Token remains server-side/local-only.

- **13.2 — Repository linking**
  - Local project → GitHub repository linking.
  - Local Git remote detection.
  - Manual owner/repo fallback.
  - Safe repository metadata storage.

- **13.3 — Issue → Task Pack**
  - GitHub issue list, filters and preview.
  - Create local Task Pack from issue title/body/labels.
  - Source issue metadata saved in Task Pack recipe.

- **13.4 — Task Pack → Issue**
  - Create GitHub issue from generated Task Pack.
  - Preview/edit title, body and labels before creation.
  - Created issue metadata saved back to Task Pack history.

## Release cleanup

- Bumped app/package versions to `0.6.0-alpha`.
- Updated app metadata to `Phase 0.6.0 — GitHub Issue Loop & Release Baseline`.
- Updated README current-state copy.
- Updated roadmap and MVP docs so GitHub issue workflows are marked done.
- Added core-quality backlog documentation for the next focused engineering pass.
- Kept PR / CI workflows deferred until after the release baseline.

## Local-first / safety

- GitHub sign-in is optional.
- Local scanning, AGENTS.md, Project Memory and Task Packs work without GitHub.
- GitHub tokens are not returned to the renderer.
- GitHub auth settings are excluded from workspace backups.
- Project source files are not uploaded by auth, repository linking, issue import or issue creation.

## Not changed

- No selector/safety-core rewrite in this finalization patch.
- No PR / CI workflows yet.
- No cloud sync, billing, team accounts or automatic source upload.
- No commits, pushes or automatic PR creation.

## Next recommended work

Before PR / CI workflows, run a focused **Core Quality & Safety Hardening** pass:

1. Secret exfiltration hard-blocks for `.env`, tokens, keys and credentials.
2. Prompt-injection and destructive-intent blocking before inventory/file selection.
3. Explicit target resolver: unknown page/file targets should block or clarify, not map to random files.
4. Ollama selector JSON contract, repair/retry and raw-response diagnostics.
5. Context score calibration so weak fallback selections do not receive 95–100/100.
6. Better routing for docs/tests/review tasks.

## Checks run

- `npx tsc -b apps/desktop/renderer/tsconfig.json` ✅
- `npm run build -w @contextforge/server` ✅
- Full `npm run build` still reaches renderer TypeScript, then stops in this sandbox at `vite: Permission denied`.
