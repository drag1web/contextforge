# ContextForge — Supporting Context Grounding v1

**Subsystem:** Canonical Core Decision Pipeline  
**Version marker:** `2026-07-21.supporting-context-grounding-v1`  
**Status:** focused implementation complete; live validation required

## 1. Purpose

The change closes a remaining coverage gap in otherwise correct create-and-wire decisions. When a task explicitly requires reuse of an existing API, storage layer, repository, service, client, hook, schema, or contract, the final Task Pack must include one grounded provider/example as `inspect-only` context without granting permission to edit it.

The motivating case created and registered `server/src/routes/projectDiagnostics.ts` while requiring reuse of the existing project storage API. The canonical edit targets were already correct, but the relevant existing route using that API was absent from context.

## 2. Decision contract

The new resolver runs inside the canonical final-selection stage, after literal targets are established and before the execution contract is finalized.

It enforces the following invariants:

1. Supporting context is added only when the user explicitly asks to reuse an existing implementation.
2. A candidate must match both the requested provider kind and the task entity.
3. Scope constraints such as backend-only or UI-only are applied before ranking.
4. At most one explicit provider reference is retained for a literal-target decision.
5. The supporting file is always `inspect-only` and cannot expand `authorizedTargets`.
6. Tests, documentation, generated files, assets, styles, and unrelated providers are excluded from provider proof.
7. Entity-specific examples outrank large, generic files with incidental matches.

## 3. Grounding strategy

The resolver extracts reuse clauses in English, Russian, and Ukrainian, identifies provider kinds, and derives entity tokens from both the clause and literal target paths. Candidates are ranked using repository evidence already present in the inventory:

- file role and path;
- imports and exports;
- declarations and references;
- route paths and structural hints;
- directory and target-role affinity;
- scope compatibility;
- noise and size penalties.

This is deterministic repository grounding. No project-specific IDs, test IDs, fixed ContextForge paths, or model-only authorization rules are used in runtime logic.

## 4. Verification

Local regression results:

- Supporting Context Grounding: **6/6**
- Canonical Core Decision: **9/9**
- Task File Selector: **passed**
- Selector Rollout: **32/32**
- Execution Contract: **21/21**
- Context Quality: **6/6**
- Symbol Syntax: **8/8**
- Investigation Trace: **25/25**
- Repository Semantic Index: **19/19**
- Task Understanding: **46/46**
- Shadow benchmark: **54/54**, primary accuracy **100%**, edit precision **97.9%**, Shadow failures **0**

A replay against the latest CCQ-39 inventory produced:

- `server/src/routes/projectDiagnostics.ts` — `create-and-edit`;
- `server/src/index.ts` — `inspect-and-edit`;
- `server/src/routes/projects.ts` — `inspect-only`;
- authorization limited to the new route and `server/src/index.ts`.

## 5. Residual limits

The resolver is intentionally conservative. It does not attempt full interprocedural data-flow analysis or infer implicit dependencies when the user did not request reuse. Ambiguous provider ownership remains eligible for investigation rather than speculative edit authorization.

## 6. Release position

The change is suitable for focused live validation. Acceptance requires correct provider inclusion for explicit reuse tasks, unchanged edit authorization, no unrelated cross-scope files, and no regression in the existing Canonical Core and Shadow benchmark suites.
