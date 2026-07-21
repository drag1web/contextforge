# ContextForge Patch A — Universal Authorization Authority

**Baseline commit:** `67c2fcd`  
**Date:** 2026-07-21  
**Patch scope:** final edit-authorization authority, immutable protected references, symbol conflict safety, and universal technical-layer recognition.

## Purpose

This patch closes the highest-priority cross-project authorization failures found in the 69-case baseline. It does not add rules for GameHub, License Monitor, ROI Calculator, Metall Perm, ContextForge IDs, or concrete project names.

## Main changes

1. **Final monotonic authorization authority**
   - Runs after selection quality.
   - Can preserve or reduce permissions, but never promote a target.
   - Hard safety clears selection and `authorizedTargets`.
   - `qualityStatus: blocked` revokes implementation authorization.
   - Stale, protected, secret-like, and non-editable targets are removed from authorization.
   - The authoritative contract is synchronized into diagnostics used by composer/export paths.

2. **Immutable grouped reference-only constraints**
   - All explicitly named provider/reference files are retained as `inspect-only`.
   - Protected paths cannot be reintroduced as editable by downstream selection or create-and-wire logic.
   - Group references and follow-up wording such as “those provider files” are preserved through normalized protection evidence.

3. **Safer target and symbol proof**
   - Rename parsing now accepts wording such as `exported TypeScript type` / exported-public qualifiers.
   - Destination symbol conflicts remain `investigation` with empty authorization.
   - Untrusted model-proposed same-stem UI targets do not become user-confirmed edit targets.
   - Literal UI grounding uses exact phrase/token evidence rather than loose substring coincidence.

4. **Universal layer recognition**
   - Recognizes root `src/server.*`, Next App Router API routes, separate `client/.../api.*`, root `src/App.*`, storage/repository roles, state owners, and inventory semantic roles.
   - Explicit protected scopes such as backend/API/server, database/storage, or frontend/UI remove those layers from required editable coverage.

## Added regression coverage

- `executionAuthorizationAuthority.smoke.ts`: 6 final-authority scenarios.
- `canonicalCoreDecision.smoke.ts`: 13 scenarios total, including grouped providers, exported-type destination conflict, and untrusted same-stem target rejection.
- `taskExecutionContract.smoke.ts`: 22 scenarios total, including protected backend/API coverage.

## Verification completed

Passed on the patch workspace:

- `npm run test:authorization-authority` — 6/6
- `npm run test:canonical-core` — 13/13
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

The renderer still emits the pre-existing Vite large-chunk warning; build succeeds.

## Known remaining item

The full selector replay is not yet green. The baseline `67c2fcd` already failed earlier at `en-devices-pairing-ui`. This patch fixes that case and the next same-stem `ConnectPage` hallucination case, after which replay reaches the pre-existing unrelated case `en-server-session-bug` (backend session ownership is incorrectly classified as UI investigation). That issue belongs to the next correctness/coverage backlog and is intentionally not hidden or patched with project-specific logic here.

## Apply

Extract this archive into the ContextForge repository root with overwrite enabled, then run the focused commands supplied with the patch delivery message.
