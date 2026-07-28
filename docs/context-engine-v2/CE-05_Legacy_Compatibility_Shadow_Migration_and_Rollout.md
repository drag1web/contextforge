# CE-05 — Legacy Compatibility, Shadow Migration, and Rollout

**Project:** ContextForge<br>
**Architecture:** Context Engine v2<br>
**Status:** Normative migration specification<br>
**Depends on:** CE-01 through CE-04

---

## 1. Purpose

This document defines how Context Engine v2 coexists with the current ContextForge selector, how results are compared without affecting users, and how production responsibility is transferred gradually and reversibly.

The migration must preserve the current product while creating a path away from the selector-centered architecture.

---

## 2. Migration principles

1. **No flag-day rewrite.**<br>
   The current selector remains available until v2 passes explicit cross-project and safety gates.

2. **No hidden production influence during shadow mode.**<br>
   V2 may collect diagnostics but cannot alter selected files, blocking behavior, generated Task Packs, or UI output.

3. **One canonical v2 engine.**<br>
   Task Understanding, Composer preview, Task Pack generation, Validation Lab, and MCP must eventually call the same application service rather than maintain separate orchestration copies.

4. **Compatibility is a projection.**<br>
   V2 does not adopt the legacy `TaskFileSelection` as its internal truth. A boundary adapter creates it from `InvestigationResult`.

5. **Safety parity before quality ambition.**<br>
   V2 must first preserve safe blocking, explicit-target protection, negative constraints, secret handling, and generated-file behavior.

6. **Rollback is always available.**<br>
   Every rollout stage keeps a tested route back to legacy behavior until legacy retirement.

---

## 3. Legacy baseline

The compatibility baseline consists of the behavior present at the audited checkpoint, including:

- Task Understanding and clarification snapshots;
- Project Memory/current-state/route-owner grounding;
- explicit-target resolution and protection;
- legacy/shadow selector pipeline;
- context quality evaluation;
- execution authorization authority;
- manual Context Composer override;
- Task Pack generation and reliability checks;
- Validation Lab and selector benchmark cases.

The baseline must be checkpointed separately from v2 work.

Allowed legacy changes during migration:

- correctness fixes with a reproducible failing case;
- security/privacy fixes;
- build compatibility fixes;
- instrumentation required for fair comparison.

Disallowed legacy changes during migration:

- new generic ranking weights;
- new task-family branches;
- new final-selection exceptions;
- project-specific target rules;
- broad refactors whose only purpose is to make legacy look like v2.

---

## 4. Compatibility projection

### 4.1 LegacyTaskFileSelectionProjection

```ts
export interface LegacyTaskFileSelectionProjection {
  project(
    result: InvestigationResult,
    options: LegacyProjectionOptions,
  ): LegacyProjectionResult;
}
```

The adapter maps:

```text
confirmed implementation-target findings → selected target files
confirmed/probable supporting findings   → supporting/reference files
test-target findings                      → test files
blocking gaps/contradictions              → clarification/block diagnostics
stop reason                               → selector-compatible reason codes
```

### 4.2 Projection constraints

- each selected legacy file must reference at least one v2 finding and evidence chain;
- unsupported legacy fields must be populated conservatively and labeled compatibility-derived;
- a compatibility score, if required by current UI, must not be interpreted as v2 domain confidence;
- no projected file may violate explicit negative constraints or repository access policy;
- unresolved or review-only findings must not become silently authorized targets.

### 4.3 Role mapping

| V2 role | Legacy role |
|---|---|
| target | primary selected file |
| supporting | selected/reference depending current contract |
| reference | reference context only |
| test | selected test/supporting test |
| excluded | omitted with diagnostic reason |

---

## 5. Shadow execution topology

```text
Canonical request preparation
          │
          ├──────────────► Legacy selector ─────► production result
          │
          └──────────────► Context Engine v2 ───► shadow result
                                              │
                                              ▼
                                    comparison + diagnostics
```

Both paths must receive semantically equivalent input:

- same project snapshot or fingerprint-equivalent source;
- same normalized task and clarifications;
- same explicit references and negative constraints;
- same relevant settings translated to each contract;
- separately measured budgets and timings.

V2 failure during shadow execution must be captured as diagnostics and must not fail the production request.

---

## 6. Shadow comparison record

```ts
export interface ContextEngineShadowComparison {
  comparisonId: string;
  projectId: string;
  taskFingerprint: string;
  snapshotFingerprint: string;
  legacy: LegacySelectionSummary;
  v2: V2InvestigationSummary;
  overlap: SelectionOverlap;
  safety: SafetyComparison;
  evidence: EvidenceComparison;
  outcomes: ComparisonOutcome[];
  timing: ShadowTiming;
  createdAt: string;
}
```

### 6.1 Required comparison dimensions

- primary target overlap;
- supporting/reference overlap;
- explicit target preservation;
- negative constraint compliance;
- generated/secret file compliance;
- safe block/clarification agreement;
- v2 evidence completeness;
- owner-discovery path quality;
- unresolved-question truthfulness;
- operation budget and latency;
- legacy fallback dependence;
- cross-project behavior.

Exact file-set equality is useful but not the sole success criterion.

---

## 7. Comparison outcomes

Canonical outcome labels:

```ts
export type ComparisonOutcome =
  | "equivalent_supported"
  | "v2_better_supported"
  | "legacy_better_supported"
  | "both_safe_unresolved"
  | "v2_safe_legacy_risky"
  | "legacy_safe_v2_risky"
  | "different_but_both_acceptable"
  | "insufficient_evaluation_data"
  | "v2_execution_failure";
```

Definitions must be based on manifest expectations or expert review, not automatically inferred only from overlap.

---

## 8. Observability and privacy

Shadow diagnostics may store:

- normalized relative paths;
- entity/finding/evidence IDs;
- source line ranges;
- extractor and planner versions;
- stop reasons;
- budget consumption;
- redacted summaries;
- comparison labels.

They must not store:

- raw secret values;
- `.env` contents;
- full source files by default;
- account/payment data unrelated to the task;
- model prompts containing unnecessary repository content.

Diagnostic retention should follow existing ContextForge data-retention policy. Local development exports may be richer only through an explicit user action.

---

## 9. Feature flags and rollout modes

Recommended configuration:

```ts
export type ContextEngineMode =
  | "disabled"
  | "shadow"
  | "preview_opt_in"
  | "composer_primary"
  | "task_pack_canary"
  | "task_pack_primary"
  | "legacy_fallback"
  | "v2_only";
```

### disabled

V2 is not invoked.

### shadow

V2 runs asynchronously within the request budget or after the production decision, but its result has no product effect.

### preview_opt_in

A developer/user can inspect v2 findings in a diagnostic surface. Legacy remains production authority.

### composer_primary

Context Composer suggestions come from v2; manual user decisions remain authoritative. Task Pack generation still uses legacy unless the manual selection is passed through existing behavior.

### task_pack_canary

A small controlled set of eligible tasks uses v2 projection as primary, with automatic legacy fallback on defined failures.

### task_pack_primary

V2 is primary for eligible task classes/projects; legacy remains fallback.

### legacy_fallback

V2 handles nearly all eligible requests; legacy is invoked only for explicit fallback conditions.

### v2_only

Legacy selector is retired from production flow. This is the final stage and requires separate approval.

---

## 10. Eligibility rules

Initial canary eligibility should require:

- supported repository language/framework coverage;
- complete non-truncated snapshot for relevant scope;
- no safety-restricted critical source;
- no unsupported multi-repository dependency;
- v2 stop reason `sufficient_evidence`;
- no blocking contradiction or gap;
- projection eligibility confirmed;
- acceptable latency and operation budget;
- task is represented in validated manifest categories.

Ineligible tasks remain on legacy without being treated as v2 failures.

---

## 11. Rollout stages

### Stage R0 — architecture-only

- contracts, domain, ports, and fixtures exist;
- no product integration;
- production behavior unchanged.

Exit gate: architecture tests and deterministic fixture smokes pass.

### Stage R1 — offline replay

- feed recorded/manifest tasks into v2 outside production flow;
- produce investigation traces and compatibility projections;
- compare against existing expected outcomes.

Exit gate: no critical safety failures and acceptable evidence completeness.

### Stage R2 — live shadow

- run v2 beside real local/opt-in requests;
- production result remains legacy;
- collect timing and comparison diagnostics.

Exit gate: stability, resource, privacy, and cross-project gates pass.

### Stage R3 — diagnostic preview

- expose findings/evidence/stop reason in Validation Lab or developer diagnostics;
- no automatic production selection changes.

Exit gate: reviewers can understand differences and trace every projected target.

### Stage R4 — Composer primary

- Context Composer candidate groups and evidence come from v2;
- users can manually confirm/edit;
- legacy remains Task Pack default.

Exit gate: no regression in manual workflow and Composer no longer runs an independent semantic ranker.

### Stage R5 — Task Pack canary

- v2 primary for tightly eligible tasks;
- legacy automatic fallback for engine failure or ineligibility;
- comparison remains enabled.

Exit gate: zero critical safety regressions over the defined canary window and quality gates meet CE-06.

### Stage R6 — Task Pack primary

- v2 primary for supported projects/tasks;
- legacy fallback retained;
- old duplicate orchestration is progressively removed.

Exit gate: cross-project results are stable and fallback rate is below the accepted threshold.

### Stage R7 — legacy retirement

- legacy selector code is removed or isolated as archived compatibility;
- old rollout modes and duplicated selector orchestration are deleted;
- migration and rollback archive is preserved.

Exit gate: explicit architecture approval and release checkpoint.

---

## 12. Automatic fallback conditions

During canary and primary rollout, fallback to legacy may occur when:

- v2 encounters `internal_error`;
- snapshot cannot be built;
- repository changes during investigation;
- required extractor is unavailable;
- v2 exceeds a hard latency ceiling configured for production;
- projection contract validation fails;
- task/repository is outside supported eligibility;
- a temporary rollout kill switch is active.

Fallback must not override a v2 safety block by selecting risky files through legacy without policy review. Safety-related disagreement requires the stricter safe outcome or explicit user review.

---

## 13. Disagreement policy

### 13.1 Explicit target disagreement

If one path drops a valid explicit target and the other preserves it, the difference is critical and must be inspected.

### 13.2 Safety disagreement

Use the safer result. Record a critical comparison event.

### 13.3 Quality disagreement

When both are safe but choose different supported targets, use manifest expectations or expert evaluation. Do not automatically prefer legacy or v2.

### 13.4 Legacy broad / v2 narrow

Prefer v2 only after evidence shows that omitted legacy files are reference-only or unsupported.

### 13.5 V2 unresolved / legacy confident

Do not assume legacy is correct. Inspect whether legacy confidence is grounded. A truthful unresolved result may be superior.

---

## 14. Composer migration

Current Composer duplicates search, candidate ranking, suggested grouping, protected-scope checks, and selection behavior.

Migration steps:

1. add a read-only v2 diagnostic panel in development/Validation Lab;
2. map v2 projected entities into current Composer candidate DTOs;
3. display target/supporting/reference roles and evidence reasons;
4. preserve manual selection and explicit target protection;
5. compare current Composer suggestions with v2 suggestions;
6. switch suggestions to v2 after parity gates;
7. remove independent Composer semantic scoring only after rollback checkpoint.

Composer should become a client and review interface, not a second context engine.

---

## 15. Task Pack migration

The final target flow:

```text
request
→ canonical Task Understanding
→ ContextEngineApplicationService
→ InvestigationResult
→ deterministic authorization policy
→ Context Projection
→ Task Pack context assembly
→ generation reliability
```

`/understand`, Composer preview, generation, Validation Lab, and MCP should reuse the same normalized task/snapshot/investigation result where request boundaries permit.

Avoid rescanning and reinvestigating the same unchanged project/task merely because a different endpoint is called.

---

## 16. Caching and reuse during migration

A result cache key should include:

- snapshot fingerprint;
- normalized task fingerprint;
- clarification fingerprint;
- explicit/negative constraints;
- engine schema version;
- planner version;
- extractor versions;
- relevant policy/configuration fingerprint.

Cached results must be invalidated when any required source fingerprint changes.

Legacy and v2 caches must remain distinguishable.

---

## 17. Rollback strategy

Every rollout stage must document:

- feature-flag value to disable v2;
- files/configuration involved;
- whether schema/data migrations occurred;
- how to clear v2 caches safely;
- expected product behavior after rollback;
- validation command proving rollback health.

Before legacy retirement, rollback should require only a configuration change or a small isolated integration revert, not restoration of deleted code.

---

## 18. Release gates

No stage may advance with any unresolved critical issue in:

- explicit target protection;
- negative constraints;
- secret/generated-file safety;
- unsafe authorization;
- repository path containment;
- ungrounded confirmed findings;
- corrupted snapshot mixing;
- nondeterministic result instability;
- privacy leakage in diagnostics.

Quality and performance thresholds are defined in CE-06.

---

## 19. Migration completion criteria

The migration is complete when:

- one canonical v2 application service owns repository investigation;
- Composer and Task Pack generation consume v2 projections;
- every selected target is traceable to evidence;
- unresolved cases remain truthful and safely reviewable;
- duplicate selection orchestration is removed;
- legacy fallback usage reaches the approved retirement threshold;
- cross-project validation meets CE-06 gates;
- rollback and archived baseline artifacts are preserved;
- legacy selector retirement is explicitly approved and checkpointed.
