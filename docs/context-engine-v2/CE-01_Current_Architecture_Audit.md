# CE-01 — Context Engine v2: Current Architecture Audit

**Project:** ContextForge<br>
**Snapshot:** `ContextForge_source_context-engine-v2-audit.zip`<br>
**Version in snapshot:** `0.7.0-alpha`<br>
**Audit date:** 2026-07-28<br>
**Status:** Architecture baseline accepted; Context Engine v2 implementation has not started.

---

## 1. Executive verdict

ContextForge already has a strong product shell and a valuable grounding baseline, but the current context-selection core has reached its practical architectural limit.

The existing system is not merely a selector anymore. It contains task understanding, repository inventory, semantic extraction, candidate retrieval, ranking, safety policy, investigation-like tracing, final reconciliation, authorization, quality evaluation, manual review, prompt assembly, and generation. These responsibilities are implemented across several large, mutually dependent modules and are coordinated independently by multiple entry points.

The most important conclusion is:

> **Context Engine v2 must not be implemented as another patch layer inside `taskFileSelector.ts`, `finalSelectionDecision.ts`, or `candidateRetrieval.ts`.**

The v2 foundation should be a separate engine with explicit ports and immutable contracts. The current selector remains a compatibility baseline while v2 is built and compared against it.

---

## 2. Snapshot integrity and scope

The archive contains:

- React/Electron renderer;
- Express server;
- scanner and project inventory;
- Task Understanding and clarification flow;
- legacy/shadow selector pipeline;
- semantic graph and repository evidence;
- bounded investigation trace prototype;
- Context Composer;
- Task Pack generation;
- Validation Lab, selector benchmarks, and smoke suites;
- current uncommitted grounding work:
  - `effectiveTaskIntent.ts`;
  - `projectMemoryGrounding.ts`;
  - `structuredRouteOwnerGrounding.ts`.

Static inventory:

- 295 files in the extracted snapshot;
- 219 TypeScript/TSX files;
- approximately 66,450 lines of production TypeScript under `server/src` when smoke/replay files are excluded.

Dynamic validation was not used as an audit input. Dependency installation in the isolated sandbox did not complete within the available execution window, so the later build attempt lacked `vite/client` and `@types/node`. This is an environment/dependency-install limitation, not evidence of a source-code regression.

---

## 3. Actual current pipeline

The real Task Pack creation flow is concentrated in `server/src/routes/taskPacks.ts` and currently performs the following stages:

```text
Request
  ↓
Project lookup
  ↓
Full project inventory scan
  ↓
Settings + Project Memory
  ↓
Clarification normalization
  ↓
Task Understanding snapshot lookup/reuse
  ↓
Task intent analysis or reanalysis
  ↓
Current-state grounding
  ↓
Project Memory grounding
  ↓
Structured route-owner grounding
  ↓
Review acceptance
  ↓
Explicit-target fast path
  ↓
Selector pipeline
  ├─ legacy selector
  ├─ shadow comparison
  └─ shadow primary with legacy fallback
  ↓
Explicit-target guard
  ↓
Optional manual Context Composer override
  ↓
Context quality evaluation
  ↓
Execution authorization authority
  ↓
Execution contract
  ↓
Block / clarification decision
  ↓
Selected file snippets
  ↓
Universal Task Pack context
  ↓
Template + prompt assembly
  ↓
Validated AI/template generation
  ↓
Storage + diagnostics
```

Primary implementation location:

- `server/src/routes/taskPacks.ts:2136` — `createTaskPackWithPipeline`.

The Task Understanding endpoint repeats the beginning of this flow:

- `server/src/routes/taskPacks.ts:1885` — `/understand`.

The Context Composer repeats most of the understanding and selection flow again:

- `server/src/contextComposer/contextComposerService.ts:424` — `buildContextComposerPreview`.

This means the product currently has multiple orchestration owners rather than one canonical context-engine application service.

---

## 4. Current selector topology

### 4.1 Pipeline orchestrator

`server/src/selection/selectorPipelineOrchestrator.ts` provides rollout modes:

- `legacy`;
- `shadow_compare`;
- `shadow_primary` with legacy fallback.

The shadow path is currently:

```text
retrieveCandidates
  ↓
deterministicCandidateRanking
  ↓
shadowSelectionFromResult
  ↓
finalizeTaskFileSelectionWithCanonicalDecision
```

The legacy path is:

```text
buildFallbackSelection
  ↓
optional Ollama selection / repair / retry
  ↓
normalizeModelSelection
  ↓
withSelectorSafetyProfile
  ↓
execution contract + semantic evidence
  ↓
optional investigation trace
  ↓
final selection reconciliation
```

Both paths eventually converge into the same large canonical/safety layer in `taskFileSelector.ts`.

### 4.2 Size and concentration

Largest production modules:

| Module | Approx. lines | Architectural meaning |
|---|---:|---|
| `ollama/taskFileSelector.ts` | 15,073 | Selector, fallback, model integration, scoring, guards, contracts, trace integration, canonical finalization |
| `selection/finalSelectionDecision.ts` | 5,311 | Many task-family-specific final decision strategies |
| `routes/taskPacks.ts` | 2,811 | HTTP route plus end-to-end application orchestration and prompt/context construction |
| `ollama/taskPackGenerationReliability.ts` | 2,426 | Generation and validation reliability |
| `selection/explicitTargetGuard.ts` | 1,605 | Explicit target handling and safety |
| `selection/contextQuality.ts` | 1,595 | Quality and blocking evaluation |
| `ollama/taskIntentAnalyzer.ts` | 1,589 | Task classification, structured intent, model/fallback behavior |
| `taskPacks/taskExecutionContract.ts` | 1,420 | Execution layers, evidence gates, authorization-related semantics |
| `contextComposer/contextComposerService.ts` | 1,409 | Duplicate orchestration plus independent candidate search/suggestions |
| `selection/contextAssemblyEngine.ts` | 1,335 | Candidate context assembly |
| `investigation/investigationTraceEngine.ts` | 1,244 | Bounded relationship traversal |

`taskFileSelector.ts` contains approximately **339 named functions**. This is no longer a replaceable selector component; it is a subsystem compressed into one file.

### 4.3 Coupling

Static import analysis shows:

- `routes/taskPacks.ts` has approximately 27 internal outgoing dependencies;
- `contextComposerService.ts` has approximately 17;
- `taskFileSelector.ts` has approximately 16;
- `projectInventoryScanner.ts` is imported by approximately 30 production modules;
- `taskIntentAnalyzer.ts` is imported by approximately 22.

A large strongly connected component exists around:

- task intent;
- settings;
- task file selector;
- candidate retrieval/ranking;
- final decision;
- investigation trace;
- repository semantic evidence;
- execution contract;
- selector orchestrator.

Some edges are type-only and disappear at runtime, but the architectural contract cycle remains: low-level evidence modules depend on high-level selector and task-intent types, while high-level selector modules depend back on those evidence modules.

---

## 5. Investigation prototype assessment

ContextForge already contains a valuable prototype:

- `server/src/investigation/investigationTraceEngine.ts`;
- `server/src/investigation/typescriptRelationshipAdapter.ts`.

It provides:

- bounded graph traversal;
- seed sources;
- AST-backed edges for TypeScript/JavaScript;
- import, JSX, prop, state, route, API, translation, call, and type-field relationships;
- ownership classifications;
- evidence chains;
- hop/file/symbol/time limits;
- confirmed/probable/reference/unresolved outcomes.

This code is useful as a **behavioral prototype and source of test cases**, but it is not yet the Context Engine v2 investigation loop.

### Why it is not yet an autonomous investigator

1. It operates on one already-built `ProjectInventory` snapshot.
2. It does not own repository reads or request additional file ranges after detecting a gap.
3. It does not create and revise explicit hypotheses as first-class state.
4. It does not schedule new search operations based on unresolved questions.
5. It does not distinguish knowledge collected in the current investigation from scanner-wide cached hints strongly enough.
6. It returns a selector-oriented outcome (`confirmedOwners`, `probableOwners`, selected-file evidence), not a reusable repository understanding result.
7. It imports selector and execution-contract types, tying it to the old pipeline.
8. It is invoked from the large selector finalization flow rather than acting as the owner of context discovery.

Therefore:

> Reuse its AST extraction ideas, edge vocabulary, bounded traversal behavior, and smoke cases — but do not promote the current module unchanged to the v2 core.

---

## 6. Scanner and semantic model assessment

### 6.1 What is already strong

`projectInventoryScanner.ts` already supplies a broad repository snapshot:

- normalized relative paths;
- file kind and role;
- imports, exports, symbols;
- route hints;
- bounded content previews;
- semantic facts;
- TypeScript/JavaScript parser-backed symbol syntax;
- generated-file and readable-text flags;
- secret-text redaction during analysis.

This is a strong bootstrap layer for v2.

### 6.2 Current limitation

The inventory is a broad eager scan and a shared mutable-shaped data contract for the whole old core. It mixes:

- filesystem metadata;
- parser facts;
- regex-derived facts;
- semantic hints;
- content preview;
- inferred technical role.

For v2, these should become separate versioned records with provenance:

```text
FileDescriptor
ParsedFileFacts
DerivedSemanticFacts
RepositoryRelationship
EvidenceRecord
```

The scanner may continue producing the initial snapshot, but the engine should consume it through an adapter rather than directly importing `ProjectInventory` everywhere.

---

## 7. Main architectural findings

### A1 — Orchestration is duplicated

Task Understanding, Task Pack creation, and Context Composer each assemble overlapping pipelines. Bug fixes must be copied or can behave differently between preview and final generation.

**v2 response:** one canonical `ContextEngineApplicationService`, with preview/generate/MCP/Validation Lab as clients.

### A2 — Selection is the center of the architecture

Repository understanding exists mainly to justify a final file list. This forces evidence, trace, confidence, and contracts into selector-shaped APIs.

**v2 response:** the central output becomes an `InvestigationResult`; file selection is a downstream projection.

### A3 — The current investigation is post-selection

The trace usually starts from selected/ranked/model-proposed files and attempts to verify or repair them.

**v2 response:** investigation starts from the task and repository questions, then produces candidate targets only after evidence collection.

### A4 — Knowledge is not persisted as a first-class graph

Graphs and indexes are rebuilt around inventory objects and cached with `WeakMap<ProjectInventory, ...>`. Knowledge cannot be versioned, diffed, invalidated by file hash, or reused transparently across tasks.

**v2 response:** introduce a repository snapshot ID, per-file fingerprints, fact provenance, and a graph store interface.

### A5 — Evidence and confidence remain selector-coupled

`FileSelectionEvidence` is useful but describes action permission for files. It is not a general claim/evidence model.

**v2 response:** evidence records support arbitrary claims, source spans, extraction method, freshness, and contradiction status. Authorization remains a separate policy projection.

### A6 — Heuristic growth is visible

Large token alias tables, regex patterns, task-family branches, score adjustments, and final-decision resolvers encode many locally correct exceptions. Their interactions are increasingly hard to reason about globally.

**v2 response:** heuristics may seed search, but they must not directly become final truth. Facts and verified relationships determine conclusions.

### A7 — Type contracts are owned by high-level modules

Low-level investigation and retrieval import `TaskIntentAnalysis`, `SelectedTaskFile`, and `TaskExecutionContract` from old high-level locations.

**v2 response:** create a dependency-neutral `context-engine/contracts` package/directory. Adapters translate legacy types at the boundary.

### A8 — Context Composer has an independent ranking layer

Besides calling the selector pipeline, Context Composer implements its own search tokenization, candidate scoring, suggested groups, protected-scope checks, and usage assignment.

**v2 response:** Composer should query the engine's candidate/evidence views, not maintain a second semantic selector.

### A9 — Validation assets are highly reusable

Smoke cases, selector benchmark, rollout diagnostics, Validation Lab manifests, and safe-fail expectations are a major asset.

**v2 response:** keep them as compatibility and migration gates. Add trace-quality expectations rather than discarding existing tests.

### A10 — Safety must remain outside probabilistic reasoning

Explicit target safety, secret paths, generated files, negative constraints, authorization authority, and clarification blocking are valuable deterministic boundaries.

**v2 response:** preserve these as policy gates around the engine, not as scoring weights inside investigation reasoning.

---

## 8. Reuse classification

### 8.1 Reuse substantially as-is

- storage adapters and storage contracts;
- project records and Project Memory persistence;
- performance tracing infrastructure;
- Validation Lab runner/export boundary;
- selector benchmark infrastructure;
- Task Pack templates, rules, post-processing, and generation reliability;
- Git/GitHub/MCP product integrations;
- secret-path and hard safety policy concepts;
- source symbol parser smoke cases;
- renderer workflow and diagnostics surfaces, with contract adapters.

### 8.2 Reuse behind adapters

- `projectInventoryScanner.ts`;
- `sourceSymbolSyntax.ts`;
- `typescriptRelationshipAdapter.ts` extraction logic;
- `projectSemanticGraph.ts` relationship ideas;
- `repositorySemanticIndex.ts` evidence vocabulary;
- Task Understanding and clarification snapshot flow;
- Project Memory grounding;
- current-state grounding;
- structured route-owner grounding;
- execution authorization and context quality policy;
- explicit target resolution.

### 8.3 Use as behavior/reference only

- `investigationTraceEngine.ts`;
- `candidateRetrieval.ts`;
- `constrainedCandidateRanking.ts`;
- `contextAssemblyEngine.ts`;
- `finalSelectionDecision.ts`.

These contain useful algorithms and regression knowledge but should not define v2 interfaces.

### 8.4 Freeze as legacy compatibility core

- `ollama/taskFileSelector.ts`;
- current selector rollout modes;
- selector-specific canonical finalization.

Only correctness/security fixes should enter this layer while v2 is developed. No new general-purpose scoring patches should be added.

### 8.5 Must not enter the v2 core

- Express request/response objects;
- renderer DTOs;
- storage records tied directly to engine logic;
- Task Pack Markdown/prompt construction;
- Ollama response parsing and retry logic;
- UI-specific candidate grouping;
- legacy selection confidence percentages;
- project-specific validation cases or named project rules.

---

## 9. Target Context Engine v2 architecture

```text
Clients
├─ Task Pack Builder
├─ Context Composer
├─ Validation Lab
└─ MCP
        │
        ▼
ContextEngineApplicationService
        │
        ├─ TaskInterpreterPort
        ├─ RepositorySnapshotPort
        ├─ RepositoryReaderPort
        ├─ RepositorySearchPort
        ├─ FactExtractorRegistry
        ├─ KnowledgeGraphStore
        ├─ InvestigationPlanner
        ├─ InvestigationRunner
        ├─ EvidenceEvaluator
        ├─ StopPolicy
        └─ ContextProjectionService
                ├─ implementation context
                ├─ review context
                ├─ clarification result
                └─ legacy TaskFileSelection adapter
```

### Required dependency direction

```text
contracts
  ↑
domain
  ↑
application
  ↑
adapters / clients
```

The domain must not import:

- Express;
- storage implementation;
- old selector types;
- renderer types;
- Ollama client;
- Task Pack generator.

---

## 10. Minimum v2 domain contracts

### Repository snapshot

```ts
interface RepositorySnapshot {
  id: string;
  projectId: string;
  rootFingerprint: string;
  createdAt: string;
  files: FileDescriptor[];
  truncated: boolean;
}
```

### Facts and relationships

```ts
interface FactRecord {
  id: string;
  snapshotId: string;
  subject: EntityRef;
  predicate: string;
  object: EntityRef | LiteralValue;
  source: SourceSpan;
  extractor: string;
  confidence: "exact" | "strong" | "supporting" | "weak";
}
```

### Hypothesis

```ts
interface InvestigationHypothesis {
  id: string;
  statement: string;
  status: "open" | "supported" | "rejected" | "unresolved";
  requiredEvidence: EvidenceRequirement[];
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
}
```

### Investigation operation

```ts
type InvestigationOperation =
  | SearchPathsOperation
  | SearchSymbolsOperation
  | ReadFileOperation
  | ReadRangeOperation
  | FollowRelationshipOperation
  | ExtractFactsOperation;
```

### Investigation result

```ts
interface InvestigationResult {
  taskUnderstanding: EngineTaskUnderstanding;
  snapshotId: string;
  hypotheses: InvestigationHypothesis[];
  evidence: EvidenceRecord[];
  findings: Finding[];
  unresolvedQuestions: UnresolvedQuestion[];
  stopReason: StopReason;
  coverage: InvestigationCoverage;
  contextProjection: ContextProjection;
}
```

The old `TaskFileSelection` becomes an adapter projection from this result.

---

## 11. Investigation loop

The minimum real loop must be stateful and iterative:

```text
1. Interpret task
2. Build investigation questions
3. Create initial hypotheses
4. Seed searches from explicit targets and repository metadata
5. Execute one bounded operation
6. Extract facts with provenance
7. Update graph and hypotheses
8. Detect missing evidence or contradictions
9. Schedule the next operation
10. Stop only by explicit policy
11. Project findings into context / clarification / safe abstention
```

### Stop reasons must be explicit

- `sufficient_evidence`;
- `clarification_required`;
- `no_grounded_lead`;
- `contradictory_evidence`;
- `operation_budget_exhausted`;
- `file_budget_exhausted`;
- `time_budget_exhausted`;
- `repository_snapshot_truncated`;
- `safety_blocked`.

A numeric confidence alone must never be a stop reason.

---

## 12. Proposed physical structure

```text
server/src/contextEngineV2/
├─ contracts/
│  ├─ repository.ts
│  ├─ facts.ts
│  ├─ evidence.ts
│  ├─ investigation.ts
│  ├─ task.ts
│  └─ projection.ts
├─ domain/
│  ├─ hypothesisLedger.ts
│  ├─ evidenceLedger.ts
│  ├─ investigationState.ts
│  ├─ stopPolicy.ts
│  └─ coverage.ts
├─ application/
│  ├─ contextEngineService.ts
│  ├─ investigationPlanner.ts
│  ├─ investigationRunner.ts
│  └─ contextProjectionService.ts
├─ ports/
│  ├─ repositorySnapshotPort.ts
│  ├─ repositoryReaderPort.ts
│  ├─ repositorySearchPort.ts
│  ├─ factExtractor.ts
│  └─ knowledgeGraphStore.ts
├─ adapters/
│  ├─ legacyInventorySnapshotAdapter.ts
│  ├─ localRepositoryReader.ts
│  ├─ typescriptFactExtractor.ts
│  ├─ inMemoryKnowledgeGraphStore.ts
│  ├─ legacyTaskUnderstandingAdapter.ts
│  └─ legacyTaskFileSelectionProjection.ts
└─ validation/
   ├─ contextEngineV2.smoke.ts
   ├─ investigationLoop.smoke.ts
   └─ legacyParity.smoke.ts
```

A separate package can be considered later. Starting inside the server reduces migration cost while dependency rules are enforced by imports and tests.

---

## 13. Migration sequence

### CE2-00 — Boundary and contracts

Create the directory structure, dependency-neutral contracts, an empty application service, and compile-time import rules. No production route changes.

### CE2-01 — Repository snapshot adapter

Adapt `ProjectInventory` into a versioned `RepositorySnapshot`. Add file fingerprints and provenance without changing the old scanner.

### CE2-02 — Fact extraction and graph store

Move/copy only extraction concepts needed for TypeScript/JavaScript into a `FactExtractor` adapter. Store facts and edges in an in-memory graph behind a port.

### CE2-03 — Deterministic investigation loop

Implement planner → operation → evidence → hypothesis update → stop policy. No LLM planner initially.

### CE2-04 — Legacy projection and shadow comparison

Project `InvestigationResult` into the current `TaskFileSelection` contract. Run v2 in shadow mode beside the legacy core.

### CE2-05 — Context Composer adoption

Make Composer consume engine findings and candidate projections. Remove its independent semantic scoring only after parity gates pass.

### CE2-06 — Task Pack adoption

Make Task Pack creation consume one engine result. `/understand`, preview, generate, Validation Lab, and MCP share the same application service.

### CE2-07 — Optional model-assisted planner

Allow an AI provider to propose hypotheses/operations under strict schemas. Repository access and evidence validation stay deterministic.

### CE2-08 — Legacy retirement

Retire old selector branches only after cross-project gates prove that v2 meets or exceeds safety, grounding, and acceptable coverage.

---

## 14. First implementation slice

The first code slice should be deliberately small:

1. add `contextEngineV2/contracts`;
2. define `RepositorySnapshot`, `FactRecord`, `EvidenceRecord`, `InvestigationState`, `InvestigationResult`, and ports;
3. add `legacyInventorySnapshotAdapter`;
4. add an in-memory knowledge graph store;
5. add a smoke test proving dependency-neutral creation of a snapshot and one exact import relationship;
6. do not connect routes or the old selector yet.

Acceptance criteria:

- existing production behavior is unchanged;
- old tests remain untouched;
- v2 domain imports no file from `routes`, `contextComposer`, `ollama/taskFileSelector`, `settings`, `storage`, or renderer code;
- every fact contains provenance;
- the smoke test works on an artificial repository fixture rather than ContextForge-specific names;
- no scoring or task-family exceptions are introduced.

---

## 15. Validation strategy

Keep the current visible and sealed validation assets. Add new dimensions:

- hypothesis correctness;
- evidence provenance completeness;
- owner discovery path;
- contradiction detection;
- unresolved-question truthfulness;
- stop-reason correctness;
- operation budget behavior;
- context projection safety;
- legacy-v2 overlap;
- cross-project portability.

Do not use only selected-file exact-match as the v2 success metric. A safe unresolved result can be correct, and a coincidentally correct file list with unsupported reasoning can be wrong.

---

## 16. Working-tree recommendation

The current branch contains uncommitted v1 grounding changes. They are part of the audited baseline but should not be mixed into the first v2 implementation commit.

Recommended history:

```text
commit 1 — finalize/checkpoint current v1 grounding changes
commit 2 — add CE-01 audit document
commit 3 — CE2-00 contracts and empty engine boundary
```

If the v1 changes are not yet accepted, preserve them in a separate checkpoint branch or commit before adding v2 files. Avoid a single commit containing old selector fixes and new engine architecture.

---

## 17. Archive hygiene note

The supplied archive included:

- `.env`;
- local SQLite databases and backups;
- a zero-byte nested copy of the archive.

No secret values were used in this audit. Future source snapshots should additionally exclude:

```text
.env
.env.* (except .env.example)
data/
server/data/
*.sqlite
*.db
*.bak
*.zip
```

This is a packaging hygiene issue, not a Context Engine architecture issue.

---

## 18. Final decision

The architecture audit supports the planned migration.

**Approved direction:** build Context Engine v2 as a new bounded subsystem and integrate it through adapters and shadow comparison.

**Rejected direction:** continue raising the accuracy ceiling of the current core through additional scoring weights, task-family branches, fallback exceptions, or final-decision patches.

**Next document:** CE-02 — Repository Knowledge Model and Evidence Schema.
