# CE-07 — Implementation Roadmap and Codex Work Orders

**Project:** ContextForge<br>
**Architecture:** Context Engine v2<br>
**Status:** Approved staged implementation plan<br>
**Depends on:** CE-01 through CE-06

---

## 1. Purpose

This document converts the architecture into bounded implementation assignments.

Each `CE2-*` work order is independently reviewable and must end in a checkpoint. Codex may read the full architecture package, but it must implement only the assigned work order.

A work order is not complete because the code compiles. It is complete only when:

- scope constraints were respected;
- architecture invariants hold;
- required tests pass;
- production behavior remains appropriate for the stage;
- the implementation report is complete;
- human review accepts the diff.

---

## 2. Pre-implementation repository checkpoint

Before CE2-00, preserve the current uncommitted v1 grounding work separately.

Recommended history:

```text
checkpoint A — accepted v1 grounding changes
checkpoint B — architecture documents
checkpoint C — CE2-00 implementation
```

Do not create a commit containing both unfinished legacy selector changes and new v2 engine files.

Minimum baseline commands:

```powershell
git branch --show-current
git status --short
git diff --check
npm run build
```

Run the current relevant smoke suites before the first v2 code change and save the results as baseline evidence.

---

## 3. Global constraints for every work order

### Required

- read CE-01 through CE-06 before editing;
- preserve existing product behavior unless the work order explicitly changes integration;
- add generic fixtures and tests;
- keep all v2 domain facts evidence-backed;
- return exact changed files and checks;
- keep commits focused.

### Forbidden

- project-specific engine rules;
- new legacy selector scoring patches;
- broad unrelated UI changes;
- replacing safe unresolved behavior with guesses;
- hiding contradictions or gaps;
- adding a model dependency before CE2-08;
- direct filesystem/storage/provider access from v2 domain/application;
- changing old test expectations merely to make a stage green without justification.

### Standard verification

Run at minimum:

```powershell
git diff --check
npm run build -w @contextforge/server
npm run build -w @contextforge/renderer
```

Also run all stage-specific commands. If a workspace script name differs, identify and run the closest canonical existing script, and report the substitution.

---

# CE2-00 — Boundary, Contracts, and Architecture Guard

## Goal

Create the isolated Context Engine v2 skeleton and dependency-neutral contracts without changing any production route or selector behavior.

## In scope

- `server/src/contextEngineV2/` structure;
- IDs and JSON-safe primitives;
- repository/entity/fact/evidence/task/investigation/projection contracts;
- invariant helpers;
- public facade placeholder;
- architecture import guard;
- contract and architecture smoke tests.

## Expected files

```text
server/src/contextEngineV2/contracts/**
server/src/contextEngineV2/domain/invariant.ts
server/src/contextEngineV2/ports/**
server/src/contextEngineV2/application/contextEngineService.ts
server/src/contextEngineV2/validation/contracts.smoke.ts
server/src/contextEngineV2/validation/architecture.smoke.ts
server/src/contextEngineV2/index.ts
server/package.json            only for explicit test scripts if required
```

## Implementation requirements

1. Define branded or opaque ID aliases where useful.
2. Define the complete contracts from CE-02/CE-03, but methods may remain unimplemented.
3. Add validation/invariant helpers for snapshot consistency and evidence requirements.
4. Add a public engine interface whose implementation may throw a typed `not_implemented` error.
5. Add an automated forbidden-import check.
6. Ensure JSON serialization of representative contracts.
7. Use deterministic test clock/ID fakes.

## Forbidden changes

- no imports from legacy selector in core layers;
- no route changes;
- no scanner changes;
- no actual repository reads;
- no scoring;
- no LLM/model integration;
- no renderer changes.

## Acceptance criteria

- server compiles;
- architecture smoke rejects a deliberately forbidden fixture/import pattern or validates rules against source files;
- representative `InvestigationResult` serializes;
- invalid cross-snapshot fact/evidence fixtures fail;
- v2 directory can be deleted without changing production behavior;
- no legacy type appears in contracts/domain/application.

## Verification

```powershell
npm run test:context-engine-v2:contracts -w @contextforge/server
npm run test:context-engine-v2:architecture -w @contextforge/server
npm run build -w @contextforge/server
git diff --check
```

Add these scripts only if the repository convention supports stage-specific smoke scripts.

## Codex stop condition

Stop after the skeleton, contracts, guards, tests, and report. Do not continue to snapshot adaptation.

---

# CE2-01 — Repository Snapshot Adapter

## Goal

Adapt the existing project inventory into a versioned v2 `RepositorySnapshot` while leaving the legacy scanner unchanged.

## In scope

- `LegacyInventorySnapshotAdapter`;
- normalized file descriptors;
- file content fingerprints;
- snapshot fingerprint/ID inputs;
- truncation and exclusion metadata;
- repository snapshot port implementation for legacy inventory;
- generic fixture tests.

## Implementation requirements

1. Accept existing `ProjectInventory` only inside the adapter.
2. Normalize paths to repository-relative POSIX form.
3. Compute stable content/file fingerprints using existing bounded content or an authorized reader where required.
4. Preserve readable/generated/kind/language metadata.
5. Report adapter limitations and truncation.
6. Do not copy secret content into the snapshot.
7. Produce stable file/entity IDs for unchanged fixture input.
8. Introduce no reverse import from old scanner into v2 core.

## Forbidden changes

- do not refactor `projectInventoryScanner.ts` broadly;
- do not change old inventory output semantics;
- do not extract facts beyond minimal file/repository metadata;
- do not connect routes or selector;
- do not add persistent storage.

## Acceptance criteria

- identical inventory fixture produces identical descriptors/fingerprints;
- changed file content changes the file fingerprint;
- excluded/truncated conditions are represented;
- absolute paths do not appear in domain output;
- secret-risk fixture does not expose raw content;
- snapshot adapter contract tests pass.

## Verification

```powershell
npm run test:context-engine-v2:snapshot -w @contextforge/server
npm run test:context-engine-v2:architecture -w @contextforge/server
npm run build -w @contextforge/server
git diff --check
```

## Codex stop condition

Stop once snapshot adaptation and tests are complete. Do not build the fact graph yet.

---

# CE2-02 — Fact Extraction and In-Memory Knowledge Graph

## Goal

Extract deterministic TypeScript/JavaScript and manifest facts with provenance, and store them behind an in-memory graph port.

## In scope

- `FactExtractor` registry;
- TypeScript/JavaScript extractor;
- manifest extractor for minimal repository structure;
- in-memory knowledge graph store;
- stable entity/fact identity;
- extraction fixture suite.

## Implementation requirements

1. Reuse parser ideas from existing source-symbol and relationship adapters without importing selector-oriented contracts.
2. Initial predicates:
   - contains;
   - imports;
   - exports/re_exports;
   - calls;
   - renders;
   - defines_route/defines_endpoint where deterministically available;
   - tests;
   - configuration/dependency facts from manifests.
3. Every fact has exact source span or repository metadata source.
4. Derived facts list parent fact IDs.
5. Parser limitations are returned explicitly.
6. Graph insertion is idempotent.
7. Snapshot isolation is enforced.
8. No model-generated facts.

## Forbidden changes

- no investigation planner;
- no file ranking;
- no final findings;
- no persistent graph database;
- no production integration;
- no copied monolith from `taskFileSelector.ts`.

## Acceptance criteria

- generic fixtures emit expected facts and source ranges;
- unchanged extraction has stable IDs;
- alias and re-export facts are represented without guessing final ownership;
- parser failure becomes a limitation, not an unhandled exception;
- graph neighbor query works;
- stale fingerprint invalidation works;
- architecture tests pass.

## Verification

```powershell
npm run test:context-engine-v2:extraction -w @contextforge/server
npm run test:context-engine-v2:graph -w @contextforge/server
npm run test:context-engine-v2:architecture -w @contextforge/server
npm run build -w @contextforge/server
git diff --check
```

## Codex stop condition

Stop after deterministic extraction and graph storage. Do not infer implementation targets.

---

# CE2-03 — Hypothesis Ledger, Evidence Evaluation, and Stop Policy

## Goal

Implement the pure domain state needed for investigation before repository operations are orchestrated end to end.

## In scope

- evidence ledger;
- hypothesis ledger;
- claim derivation helpers;
- contradiction registry;
- knowledge-gap registry;
- coverage calculator;
- canonical stop policy;
- exhaustive domain tests.

## Implementation requirements

1. Enforce all CE-02 invariants.
2. Track append-only hypothesis transitions.
3. Deduplicate evidence by independence group/source chain.
4. Reopen supported hypotheses when contradictory evidence arrives.
5. Preserve multiple legitimate owners separately from contradictions.
6. Implement stop-policy ordering from CE-03.
7. Make budgets and coverage explicit state.
8. Keep services deterministic and repository-independent.

## Forbidden changes

- no repository reader/search execution;
- no production integration;
- no legacy selection projection;
- no numeric confidence authorization;
- no task-family-specific resolver.

## Acceptance criteria

- all hypothesis transitions are tested;
- all canonical stop reasons are tested;
- sufficient evidence beats simultaneous final budget exhaustion;
- safety/repository-change stops beat sufficient evidence;
- weak evidence cannot support a claim;
- blocking contradiction prevents confirmed finding;
- domain tests require no filesystem or ContextForge database.

## Verification

```powershell
npm run test:context-engine-v2:domain -w @contextforge/server
npm run test:context-engine-v2:architecture -w @contextforge/server
npm run build -w @contextforge/server
git diff --check
```

## Codex stop condition

Stop when the pure domain model is complete and green. Do not implement the runner in the same work order.

---

# CE2-04 — Deterministic Investigation Planner and Runner

## Goal

Create the first real iterative investigation loop over generic fixtures.

## In scope

- task-to-question interpreter;
- deterministic planner;
- operation scheduler/deduplication;
- repository reader/search fake adapters and local adapter if needed;
- runner state machine;
- evaluator integration;
- operation/budget trace;
- loop smoke suite.

## Implementation requirements

1. Implement CE-03 phases A-D.
2. Every operation names served questions/hypotheses.
3. Search results remain leads until read/extraction validates them.
4. Detect snapshot fingerprint mismatch.
5. Respect all operation/file/byte/time/planner budgets.
6. Preserve partial result on budget exhaustion.
7. Apply concurrent results deterministically or remain sequential initially.
8. Produce `InvestigationResult` with findings/gaps/stop but no legacy DTO.
9. Support exact import/call/render/route traversal from existing graph facts.
10. Avoid heuristic task-family branches.

## Required smoke cases

- route to service owner;
- re-export chain;
- competing owners;
- missing implementation;
- contradiction;
- budget exhaustion;
- repository mutation;
- secret access block;
- no grounded lead;
- clarification required.

## Forbidden changes

- no production route integration;
- no legacy projection;
- no model planner;
- no ContextForge-specific fixture names;
- no fallback to old selector inside the runner.

## Acceptance criteria

- a trace visibly contains search/read/parse/follow/evaluate cycles;
- repeated equivalent operations are deduplicated;
- projected findings cite evidence;
- all stop reasons are truthful;
- same fixture run is deterministic;
- no raw secret content appears in trace;
- engine can return a safe unresolved result.

## Verification

```powershell
npm run test:context-engine-v2:investigation -w @contextforge/server
npm run test:context-engine-v2:domain -w @contextforge/server
npm run test:context-engine-v2:architecture -w @contextforge/server
npm run build -w @contextforge/server
git diff --check
```

## Codex stop condition

Stop after generic deterministic investigation works. Do not connect legacy selection or product routes.

---

# CE2-05 — Context Projection and Legacy Compatibility Adapter

## Goal

Project `InvestigationResult` into implementation/review/clarification contexts and the current legacy selection contract for offline comparison.

## In scope

- context projection service;
- role assignment from findings;
- projection eligibility policy;
- legacy TaskFileSelection adapter;
- compatibility diagnostics;
- offline fixture comparisons.

## Implementation requirements

1. Target/supporting/reference/test roles derive from finding semantics and evidence.
2. Every projected target references findings/evidence.
3. Unresolved findings remain review-only or ineligible.
4. Enforce explicit and negative constraints.
5. Produce conservative legacy fields.
6. Keep compatibility scores outside domain truth.
7. Provide stable ordering and reason strings.
8. Add comparison summary types from CE-05.

## Forbidden changes

- no production selector replacement;
- no route integration;
- no old selector edits except type-safe boundary import if absolutely necessary and reviewed;
- no claim that legacy overlap proves correctness.

## Acceptance criteria

- projection fixtures pass;
- invalid unresolved target cannot be projected as confirmed;
- legacy DTO validates against current contract;
- every selected file has traceable evidence;
- negative and explicit target sealed cases pass;
- production behavior unchanged.

## Verification

```powershell
npm run test:context-engine-v2:projection -w @contextforge/server
npm run test:context-engine-v2:compatibility -w @contextforge/server
npm run test:context-engine-v2:architecture -w @contextforge/server
npm run build -w @contextforge/server
git diff --check
```

## Codex stop condition

Stop after offline projection. Do not introduce live shadow execution.

---

# CE2-06 — Offline Replay, Validation Lab, and Golden Traces

## Goal

Run v2 against existing and new manifests without changing live product behavior.

## In scope

- v2 validation manifest support;
- translation/reuse of relevant existing cases;
- golden trace summaries;
- comparison reports;
- cross-project offline runs;
- export format updates where isolated.

## Implementation requirements

1. Preserve existing legacy Validation Lab behavior.
2. Add a separate v2 execution path or mode.
3. Record knowledge-quality and safety metrics, not only file overlap.
4. Classify outcomes using CE-05 labels.
5. Include ContextForge, GameHub, License Monitor, ROI calculator, Metall project, and generic fixtures when source snapshots/manifests are available.
6. Keep project-specific expectations in validation manifests, not engine code.
7. Export redacted evidence/operation summaries.
8. Establish measured baseline thresholds for later rollout.

## Forbidden changes

- no live route shadow yet unless explicitly split into a later reviewed substage;
- no rewriting expected outcomes without reason;
- no production result influence;
- no named project rules in engine code.

## Acceptance criteria

- legacy and v2 reports can be viewed separately;
- zero critical safety failures in sealed fixtures;
- unsupported confirmed finding count is zero;
- deterministic reruns match;
- cross-project report separates PASS/ACCEPTABLE/SAFE FAIL/CRITICAL FAIL/ENGINE ERROR;
- baseline metrics and known gaps are documented.

## Verification

```powershell
npm run test:context-engine-v2:validation -w @contextforge/server
npm run test:selector
npm run test:selector:rollout
npm run test:selector:benchmark
npm run build

git diff --check
```

Use the exact existing root scripts available in the repository and report all commands.

## Codex stop condition

Stop after offline replay and report. Do not enable v2 on real Task Pack requests.

---

# CE2-07 — Live Shadow Integration

## Goal

Run v2 beside the production legacy pipeline with zero influence on user-visible behavior.

## In scope

- canonical input preparation for both paths;
- live shadow invocation;
- timeout/resource isolation;
- shadow comparison persistence/trace;
- feature flag `disabled|shadow`;
- diagnostics and privacy controls;
- failure containment.

## Implementation requirements

1. The legacy result remains the sole production result.
2. V2 receives fingerprint-equivalent task/snapshot inputs.
3. V2 errors are captured and never fail Task Pack creation.
4. Hard time/resource ceilings are enforced.
5. Safety disagreement is marked critical.
6. Diagnostics are redacted.
7. Shadow can be disabled instantly through configuration.
8. Add integration tests proving no output influence.

## Forbidden changes

- no v2-selected files in production result;
- no UI replacement;
- no legacy fallback inversion;
- no asynchronous promise that survives process lifecycle without controlled tracking;
- no raw repository source persisted by default.

## Acceptance criteria

- disabling shadow reproduces baseline behavior;
- enabling shadow produces identical production output;
- v2 timeout/error leaves legacy request successful;
- comparison record is created where enabled;
- privacy and performance tests pass;
- all existing core suites pass.

## Verification

```powershell
npm run test:context-engine-v2:shadow -w @contextforge/server
npm run test:understanding
npm run test:clarification
npm run test:selector
npm run test:selector:rollout
npm run test:selector:benchmark
npm run build

git diff --check
```

## Codex stop condition

Stop at shadow-only integration. Do not switch Composer or Task Packs to v2 primary.

---

# CE2-08 — Context Composer Adoption

## Goal

Make Context Composer consume v2 findings and evidence as its candidate source for eligible tasks while preserving manual review and rollback.

## In scope

- v2-to-Composer DTO adapter;
- evidence/role display data;
- opt-in or feature-flagged Composer primary mode;
- manual selection compatibility;
- old-vs-v2 suggestion comparison;
- removal of independent Composer semantic ranking only after parity proof.

## Implementation requirements

1. Composer displays target/supporting/reference/test roles.
2. Each suggestion has a human-readable evidence reason.
3. Unresolved/review-required items are visibly distinguished.
4. Explicit target and protected-scope behavior remains deterministic.
5. Manual user selection remains authoritative.
6. Legacy Composer mode remains available during rollout.
7. Mixed localization remains tracked separately; do not combine broad localization cleanup with engine migration unless explicitly assigned.

## Forbidden changes

- no automatic Task Pack primary switch;
- no removal of legacy Composer logic before checkpoint and rollback test;
- no UI redesign unrelated to evidence/context roles;
- no synthetic confidence percentage presented as truth.

## Acceptance criteria

- Composer can render v2 projections;
- manual selection produces the same downstream contract;
- unsupported tasks fall back cleanly;
- existing UI/build tests pass;
- parity/quality report supports removal of duplicate ranking;
- rollback flag restores previous Composer behavior.

## Verification

```powershell
npm run test:context-engine-v2:composer -w @contextforge/server
npm run build -w @contextforge/server
npm run build -w @contextforge/renderer
npm run build

git diff --check
```

## Codex stop condition

Stop after Composer adoption. Do not migrate Task Pack production authority in this work order.

---

# CE2-09 — Task Pack Canary and Canonical Orchestration

## Goal

Use v2 as primary context authority for tightly eligible Task Pack requests, retain safe legacy fallback, and begin consolidating duplicated orchestration.

## In scope

- canary eligibility policy;
- v2 primary projection for eligible requests;
- legacy fallback conditions;
- deterministic authorization integration;
- shared result reuse between understand/preview/generate where safe;
- rollout metrics and kill switch;
- canary-specific tests.

## Implementation requirements

1. Only `sufficient_evidence` and projection-eligible results enter canary.
2. Safety disagreement uses the stricter outcome.
3. Internal v2 failure may fall back; v2 safety block may not be bypassed silently.
4. Existing authorization authority remains final until separately migrated.
5. `/understand`, Composer, and generation begin sharing canonical v2 orchestration rather than duplicating it.
6. Cache keys include snapshot/task/clarification/config/extractor versions.
7. Rollback is one configuration change or isolated revert.
8. Canary metrics satisfy CE-06 before expansion.

## Forbidden changes

- no broad v2-only rollout;
- no deletion of legacy selector;
- no removal of fallback before observation gates;
- no model-assisted planner bundled into canary;
- no acceptance threshold changes without documented review.

## Acceptance criteria

- eligible canary request uses v2 projection;
- ineligible request remains legacy;
- v2 internal error falls back safely;
- safety block is not bypassed;
- result reuse prevents unnecessary duplicate investigation;
- kill switch is tested;
- zero critical sealed/cross-project failures;
- canary report is produced.

## Verification

```powershell
npm run test:context-engine-v2:canary -w @contextforge/server
npm run test:understanding
npm run test:clarification
npm run test:selector
npm run test:selector:rollout
npm run test:selector:benchmark
npm run build

git diff --check
```

## Codex stop condition

Stop at controlled canary. Legacy retirement requires a new explicit approval and follow-up work order.

---

# CE2-10 — Optional Model-Assisted Planner

## Goal

Improve operation proposal quality under deterministic containment after the non-model engine is proven.

## Preconditions

- CE2-00 through CE2-09 accepted;
- deterministic planner quality baseline exists;
- model unavailability does not break the engine;
- proposal schema and rejection tests exist.

## In scope

- model proposal port;
- strict structured proposal schema;
- proposal validation/deduplication;
- deterministic fallback;
- usefulness and containment metrics.

## Forbidden

- model-authored facts;
- model override of stop/safety/authorization;
- direct model repository access;
- model-expanded budgets;
- mandatory online/model dependency for core function.

## Acceptance criteria

- malformed and unsafe proposals are rejected;
- engine works identically with model disabled;
- accepted proposals still require deterministic read/extraction;
- measured improvement exists on approved cases without safety regression.

---

# CE2-11 — Legacy Retirement

## Goal

Remove obsolete selector orchestration only after v2 primary operation is proven and explicitly approved.

## Preconditions

- CE-06 retirement gates pass;
- fallback usage is below approved threshold;
- remaining unsupported categories are documented;
- rollback archive exists;
- explicit human approval is recorded.

## In scope

- remove old selector rollout branches;
- remove duplicate Composer/Task Pack selection orchestration;
- archive relevant legacy benchmark artifacts;
- update docs, changelog, and migration notes;
- simplify compatibility adapters where no longer needed.

## Forbidden

- deleting historical tests without replacement evidence;
- removing rollback archive;
- mixing unrelated product refactors;
- claiming full language/framework support beyond validated coverage.

## Acceptance criteria

- production uses one canonical Context Engine application service;
- legacy code no longer executes;
- full build and all replacement suites pass;
- migration report lists removed modules and preserved behaviors;
- rollback/archive checkpoint is verified.

---

## 4. Required Codex report format for every work order

```text
Work order:
Status: complete | partial | blocked

Changed files:
- path — purpose

Architecture decisions:
- decision and reason

Behavior changes:
- none, or exact user-visible/runtime changes

Tests added/updated:
- path / scenario

Commands run:
- command — result

Validation summary:
- pass/fail counts

Known limitations:
- explicit limitation

Scope deviations:
- none, or exact deviation and reason

Git summary:
- git diff --check
- git diff --stat
- git status --short
```

Codex must not hide failed commands. A partial result with an honest report is preferable to unverified completion.

---

## 5. Human review checklist after each stage

- Did the diff stay inside the assigned work order?
- Did any generic core rule mention a specific project/task/path?
- Did any lower layer import legacy/product code?
- Can every finding be traced to evidence?
- Are contradictions and gaps preserved?
- Did production behavior remain appropriate for the stage?
- Are tests generic and meaningful rather than snapshot-only?
- Are new scripts and dependencies justified?
- Is rollback or deletion of the stage still simple?
- Are failed/untested paths disclosed?

Only after this review should the stage be committed and the next work order assigned.
