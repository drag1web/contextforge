# ContextForge Patch A.1 — Authorization Gate Completion

**Baseline:** Patch A (`fix/universal-authorization-authority`) on original commit `67c2fcd`  
**Date:** 2026-07-21  
**Scope:** two residual authorization failures from the 14/16 focused cross-project gate.

## Purpose

This patch completes the narrow Patch A authorization scope. It does not add project names, case IDs, repository-specific paths, domain rules, or future coverage/ownership logic.

## Fixed invariants

1. **Grouped reference-only protection is atomic**
   - Every explicitly named file in a grouped provider/reference list is classified from the raw user task.
   - The first or intermediate member cannot remain editable merely because the trailing `reference only` phrase appears after another path.
   - Plural forms such as `reference providers` and common comma/conjunction lists are supported.
   - A separate explicit create/edit target before a protected reference list remains editable.

2. **Symbol rename proof precedes generic file authorization**
   - Rename wording may include the declaration-owner path between the source and destination symbols, for example `Rename type User in client/src/api.ts to RunRow`.
   - Parser-backed source and destination declaration checks now run before the generic literal-file branch.
   - Missing source or an existing destination produces `investigation` with empty `authorizedTargets`.
   - Ranking, UI-surface inference, or a similar file cannot replace the real declaration owner.

## Regression coverage added

- Canonical core smoke increased from 13 to 15 scenarios.
- Added raw-task grouped protection with intentionally incorrect upstream intent metadata.
- Added owner-qualified destination-conflict rename with an unrelated high-ranking UI file.
- Added direct file-mention assertions for the first and last member of a protected group and for a separate create target.

## Verification completed

Passed after the final change:

- `npm run test:authorization-authority` — 6/6
- `npm run test:canonical-core` — 15/15
- `npm run test:handoff` — 22/22
- `npm run test:context-quality` — 6/6
- `npm run test:selector`
- `npm run test:selector:rollout` — 32/32
- `npm run test:understanding` — 46/46
- `npm run test:clarification` — 10/10
- `npm run test:generation:taskpack` — 43/43
- `npm run test:performance` — 6 + 12 + 11 scenarios
- `npm run test:investigation` — 25/25
- `npm run test:ownership` — 19/19
- `npm run test:symbol-syntax` — 8/8
- `npm run test:support-grounding` — 9/9
- renderer + server production build

The full selector replay still reaches the previously recorded unrelated `en-server-session-bug` ownership/coverage failure. Patch A.1 neither hides nor expands into that future Patch B scope.

## Required external acceptance

Repeat the same frozen 16-case Focused Authorization Gate without changing manifests or project sources. Patch A is complete only after 16/16, zero API errors, zero secret leaks, and zero protected editable targets.
