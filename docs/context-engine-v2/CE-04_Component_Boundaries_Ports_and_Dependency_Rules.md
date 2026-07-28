# CE-04 — Component Boundaries, Ports, and Dependency Rules

**Project:** ContextForge<br>
**Architecture:** Context Engine v2<br>
**Status:** Normative specification<br>
**Depends on:** CE-01, CE-02, CE-03

---

## 1. Purpose

This document defines where Context Engine v2 code lives, how its components depend on one another, which capabilities are exposed through ports, and which legacy/product layers are forbidden from entering the engine core.

The main goal is to prevent the new subsystem from reproducing the current architecture's central problem: high-level orchestration, repository scanning, ranking, safety, model integration, and output construction becoming mutually dependent.

---

## 2. Bounded context

Context Engine v2 owns:

- repository snapshot interpretation;
- repository fact extraction;
- knowledge graph operations;
- investigation questions and hypotheses;
- investigation planning and execution;
- evidence and contradiction evaluation;
- stop decisions;
- context projections.

Context Engine v2 does not own:

- HTTP transport;
- UI state and renderer DTOs;
- project persistence implementation;
- Task Pack Markdown generation;
- AI provider retries or prompt parsing;
- billing, accounts, or subscriptions;
- GitHub authentication;
- product-specific notification behavior;
- final write authorization policy.

---

## 3. Required physical structure

```text
server/src/contextEngineV2/
├── contracts/
│  ├── ids.ts
│  ├── json.ts
│  ├── repository.ts
│  ├── entities.ts
│  ├── facts.ts
│  ├── evidence.ts
│  ├── task.ts
│  ├── investigation.ts
│  ├── projection.ts
│  └── index.ts
├── domain/
│  ├── invariant.ts
│  ├── entityIdentity.ts
│  ├── factIdentity.ts
│  ├── evidenceLedger.ts
│  ├── hypothesisLedger.ts
│  ├── contradictionRegistry.ts
│  ├── knowledgeGapRegistry.ts
│  ├── investigationState.ts
│  ├── coverage.ts
│  ├── stopPolicy.ts
│  └── index.ts
├── application/
│  ├── contextEngineService.ts
│  ├── investigationInterpreter.ts
│  ├── deterministicInvestigationPlanner.ts
│  ├── investigationRunner.ts
│  ├── investigationEvaluator.ts
│  ├── contextProjectionService.ts
│  └── index.ts
├── ports/
│  ├── taskInterpreterPort.ts
│  ├── repositorySnapshotPort.ts
│  ├── repositoryReaderPort.ts
│  ├── repositorySearchPort.ts
│  ├── factExtractor.ts
│  ├── knowledgeGraphStore.ts
│  ├── clockPort.ts
│  ├── idGeneratorPort.ts
│  ├── traceSinkPort.ts
│  └── index.ts
├── adapters/
│  ├── legacyInventorySnapshotAdapter.ts
│  ├── localRepositoryReader.ts
│  ├── legacyRepositorySearchAdapter.ts
│  ├── typescriptFactExtractor.ts
│  ├── manifestFactExtractor.ts
│  ├── inMemoryKnowledgeGraphStore.ts
│  ├── legacyTaskUnderstandingAdapter.ts
│  ├── legacyTaskFileSelectionProjection.ts
│  ├── performanceTraceSinkAdapter.ts
│  └── index.ts
├── policy/
│  ├── repositoryAccessPolicy.ts
│  ├── secretScopePolicy.ts
│  ├── projectionEligibilityPolicy.ts
│  └── index.ts
├── validation/
│  ├── architecture.smoke.ts
│  ├── contracts.smoke.ts
│  ├── repositorySnapshot.smoke.ts
│  ├── factExtraction.smoke.ts
│  ├── investigationLoop.smoke.ts
│  ├── projection.smoke.ts
│  └── fixtures/
└── index.ts
```

The exact file split may change, but the layer boundaries and dependency direction are mandatory.

---

## 4. Dependency direction

```text
contracts
   ↑
domain       ports
   ↑          ↑
application ─┘
   ↑
adapters / policy / validation
   ↑
product clients and legacy integration
```

More precisely:

- `contracts` imports only standard TypeScript types or dependency-neutral utility types.
- `domain` imports `contracts` only.
- `ports` imports `contracts` only, and domain types only when unavoidable and dependency-neutral.
- `application` imports `contracts`, `domain`, and `ports`.
- `adapters` may import application ports/contracts plus external or legacy modules.
- `policy` may import contracts/domain, but no product route or renderer code.
- product clients import the public `contextEngineV2` facade and compatibility adapters.

No lower layer imports a higher layer.

---

## 5. Forbidden imports

The following imports are forbidden from `contracts/`, `domain/`, `ports/`, and `application/`:

```text
server/src/routes/**
server/src/contextComposer/**
server/src/ollama/taskFileSelector.ts
server/src/selection/finalSelectionDecision.ts
server/src/selection/selectorPipelineOrchestrator.ts
server/src/taskPacks/** generation/prompt modules
apps/desktop/renderer/**
Express request/response types
storage implementation classes
Ollama/OpenAI provider clients
```

Legacy types may appear only in adapter files whose names and responsibilities clearly indicate translation at the boundary.

---

## 6. Public engine facade

Clients should depend on one narrow facade:

```ts
export interface ContextEngineV2 {
  investigate(
    request: ContextEngineRequest,
  ): Promise<ContextEngineResponse>;
}

export interface ContextEngineRequest {
  projectId: string;
  task: EngineTaskInput;
  purpose: InvestigationPurpose;
  constraints?: EngineConstraints;
  budget?: Partial<InvestigationBudget>;
  diagnostics?: DiagnosticsRequest;
}

export interface ContextEngineResponse {
  result: InvestigationResult;
  diagnostics?: ContextEngineDiagnostics;
}
```

The facade must not expose adapter instances, mutable investigation state, graph-store implementation, or legacy selector objects.

---

## 7. Port definitions

### 7.1 TaskInterpreterPort

```ts
export interface TaskInterpreterPort {
  interpret(input: EngineTaskInput): Promise<EngineTaskUnderstanding>;
}
```

Responsibilities:

- normalize task text and structured clarification;
- preserve explicit references and negative constraints;
- identify broad task intent and investigation questions;
- avoid selecting files.

Initial adapter: translate the current Task Understanding snapshot into the v2 contract.

### 7.2 RepositorySnapshotPort

```ts
export interface RepositorySnapshotPort {
  createSnapshot(request: SnapshotRequest): Promise<RepositorySnapshot>;
  getSnapshot(id: SnapshotId): Promise<RepositorySnapshot | null>;
}
```

Initial adapter: wrap `projectInventoryScanner` output without changing the old scanner.

### 7.3 RepositoryReaderPort

```ts
export interface RepositoryReaderPort {
  readFile(request: ReadFileRequest): Promise<RepositoryReadResult>;
  readRange(request: ReadRangeRequest): Promise<RepositoryReadResult>;
}
```

Requirements:

- repository-relative paths only;
- fingerprint validation;
- byte and line bounds;
- secret/generated/binary access checks;
- safe typed failures;
- no direct `fs` access from domain/application code.

### 7.4 RepositorySearchPort

```ts
export interface RepositorySearchPort {
  searchPaths(query: PathSearchQuery): Promise<SearchResult[]>;
  searchText(query: TextSearchQuery): Promise<SearchResult[]>;
  searchSymbols(query: SymbolSearchQuery): Promise<SearchResult[]>;
}
```

Search results are leads, not facts. A result becomes evidence only after a read/extraction operation validates it.

### 7.5 FactExtractor

```ts
export interface FactExtractor {
  readonly id: string;
  readonly version: string;
  supports(input: ExtractorInput): boolean;
  extract(input: ExtractorInput): Promise<ExtractionResult>;
}
```

Extractors:

- are deterministic for identical content/configuration;
- return facts with source spans;
- do not mutate the graph directly;
- do not produce final findings;
- do not import the legacy selector;
- report unsupported or partial parsing honestly.

### 7.6 KnowledgeGraphStore

As defined in CE-02. The domain/application depends on the interface only.

### 7.7 ClockPort and IdGeneratorPort

Time and generated IDs must be injectable to keep tests deterministic.

```ts
export interface ClockPort {
  nowIso(): string;
  monotonicMs(): number;
}

export interface IdGeneratorPort {
  next(prefix: string): string;
}
```

Content-derived entity/fact IDs should use deterministic identity helpers instead of the random generator.

### 7.8 TraceSinkPort

```ts
export interface TraceSinkPort {
  record(event: ContextEngineTraceEvent): void | Promise<void>;
}
```

The engine emits safe structured events. The adapter decides whether to store them in performance traces, Validation Lab diagnostics, logs, or nowhere.

Trace failures must not change investigation semantics unless diagnostics were explicitly required by a validation run.

---

## 8. Domain services

### 8.1 HypothesisLedger

Owns hypothesis state and transition invariants.

### 8.2 EvidenceLedger

Owns evidence deduplication, independence grouping, freshness, and acceptance.

### 8.3 ContradictionRegistry

Creates, updates, and resolves contradictions without dropping conflicting evidence.

### 8.4 KnowledgeGapRegistry

Tracks missing knowledge and converts only external-intent gaps into clarification candidates.

### 8.5 StopPolicy

Pure deterministic decision service over immutable investigation state.

### 8.6 CoverageCalculator

Produces descriptive coverage data but does not determine truth independently.

Domain services should be side-effect-free except for controlled mutation of domain aggregate instances.

---

## 9. Application services

### 9.1 ContextEngineService

Single canonical application entry point.

Responsibilities:

```text
interpret task
→ acquire snapshot
→ initialize investigation
→ run investigation
→ project result
→ emit response
```

It must not duplicate the investigation sequence in clients.

### 9.2 InvestigationInterpreter

Builds initial questions and hypotheses from normalized task understanding and repository metadata.

### 9.3 DeterministicInvestigationPlanner

Proposes operations according to CE-03.

### 9.4 InvestigationRunner

Executes the state machine and budgets.

### 9.5 InvestigationEvaluator

Applies facts/evidence to claims, hypotheses, gaps, contradictions, and coverage.

### 9.6 ContextProjectionService

Creates purpose-specific projections without changing knowledge truth.

---

## 10. Adapter rules

Adapters are allowed to know both legacy and v2 contracts. This is the only layer where translation belongs.

### 10.1 LegacyInventorySnapshotAdapter

May import `ProjectInventory` and related scanner types.

Must:

- normalize paths;
- create file fingerprints;
- preserve truncation/omission information;
- translate parser facts with provenance;
- avoid copying secret content;
- not call selector ranking.

### 10.2 LegacyTaskUnderstandingAdapter

May import current task-understanding snapshot types.

Must preserve:

- normalized task;
- explicit paths/symbols;
- negative constraints;
- clarification answers;
- uncertainty/ambiguity;
- current-state and Project Memory inputs as separately labeled prior knowledge.

### 10.3 TypeScriptFactExtractor

May reuse or extract algorithms from:

- `sourceSymbolSyntax.ts`;
- `typescriptRelationshipAdapter.ts`;
- repository semantic graph helpers.

It must not import their selector-oriented result types. Copying a small pure parser helper into a neutral module is preferable to creating a reverse dependency.

### 10.4 LegacyTaskFileSelectionProjection

Translates a v2 projection into the current `TaskFileSelection` contract for shadow comparison and later compatibility.

It may calculate compatibility-only values, but must label them as projection diagnostics rather than domain confidence.

---

## 11. Policy boundary

Some deterministic restrictions may be represented in `contextEngineV2/policy`, including:

- secret and generated-file read restrictions;
- repository-relative path enforcement;
- negative constraint enforcement;
- projection eligibility based on evidence status.

Final product authorization may remain in existing ContextForge authority modules during migration.

The engine produces an `authorizationHint`; the existing authority produces the actual allow/block decision until a later dedicated migration.

---

## 12. Error model

Use typed domain/application errors:

```ts
export type ContextEngineError =
  | SnapshotUnavailableError
  | RepositoryChangedError
  | InvalidContractError
  | AccessPolicyError
  | UnsupportedExtractorError
  | OperationExecutionError
  | InvariantViolationError;
```

Expected investigation limitations should become result data rather than thrown errors:

- unreadable optional file;
- unsupported language;
- no search match;
- parser partial failure;
- budget exhaustion;
- unresolved alias.

Thrown errors are for failures that prevent a valid result object or violate invariants.

---

## 13. Configuration boundary

Engine configuration is passed through a validated contract:

```ts
export interface ContextEngineConfiguration {
  schemaVersion: 1;
  defaultBudget: InvestigationBudget;
  enabledExtractors: string[];
  accessPolicy: RepositoryAccessPolicyConfig;
  planner: DeterministicPlannerConfig;
  diagnostics: DiagnosticsConfig;
}
```

The domain must not read process environment variables or product settings directly.

An adapter may translate current settings into this configuration.

---

## 14. Architecture enforcement

At least one automated architecture check is required from CE2-00.

Acceptable strategies:

- a TypeScript smoke script that scans imports under `contextEngineV2`;
- ESLint `no-restricted-imports` scoped by directory;
- dependency-cruiser or equivalent only if adding the dependency is justified;
- a combination of compile-time path aliases and a smoke check.

Minimum forbidden patterns:

```text
contracts/** → domain/application/adapters/legacy

domain/** → application/adapters/routes/selection/ollama

ports/** → adapters/routes/selection/ollama

application/** → routes/contextComposer/taskFileSelector/renderer
```

The architecture test must fail with a clear file and import path.

---

## 15. Testability requirements

All core application components must support construction with in-memory fakes:

```ts
createContextEngineForTest({
  clock,
  ids,
  snapshotPort,
  reader,
  search,
  extractors,
  graphStore,
  traceSink,
});
```

No core smoke test should require:

- a real ContextForge database;
- Express server startup;
- Ollama/OpenAI access;
- Electron/renderer;
- current ContextForge repository paths;
- network access.

---

## 16. Public exports

`server/src/contextEngineV2/index.ts` should export only:

- public request/response contracts;
- the engine factory/facade;
- configuration contract;
- explicitly supported compatibility factories.

It should not export internal ledgers, mutable state classes, adapter internals, or all files through wildcard exports by default.

---

## 17. Migration constraints

During CE2-00 through CE2-03:

- no production route calls v2;
- no existing selector result changes;
- no old selector file is reorganized merely to support v2;
- legacy algorithms may be reused only through neutral extracted helpers or adapters;
- v2 remains deletable without changing product behavior.

During shadow integration:

- failures in v2 must not fail legacy Task Pack generation;
- time and resource budgets are independent;
- diagnostics clearly distinguish legacy and v2 results;
- no v2 output affects selected files until an explicit rollout stage.

---

## 18. Acceptance criteria

The boundary architecture is correct when:

- `contextEngineV2` compiles independently from product routes;
- architecture tests prevent forbidden imports;
- a test engine can run entirely with in-memory ports;
- adapters contain all legacy type references;
- application services use ports rather than filesystem/storage/provider implementations;
- the domain has no side effects or environment reads;
- the public facade is narrow and versionable;
- removing the `contextEngineV2` directory before shadow integration restores the original product without further edits.
