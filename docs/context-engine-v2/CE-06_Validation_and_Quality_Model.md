# CE-06 — Validation and Quality Model

**Project:** ContextForge<br>
**Architecture:** Context Engine v2<br>
**Status:** Normative validation specification<br>
**Depends on:** CE-01 through CE-05

---

## 1. Purpose

This document defines how Context Engine v2 is tested and judged.

The current ContextForge validation assets are a major advantage: smoke suites, selector benchmarks, rollout diagnostics, Validation Lab manifests, cross-project cases, and safe-fail expectations already exist. They must be preserved, but v2 requires additional dimensions because a file-list match alone cannot establish correct repository understanding.

A v2 result is high quality when it is:

- grounded;
- traceable;
- complete enough for its purpose;
- honest about uncertainty;
- safe;
- deterministic;
- portable across projects;
- efficient within explicit budgets.

---

## 2. Validation principles

### 2.1 Reasoning quality is observable through artifacts

The engine's private reasoning is not a validation target. The observable trace is:

- questions;
- hypotheses;
- operations;
- facts;
- evidence;
- contradictions;
- gaps;
- findings;
- stop reason;
- projection.

Tests evaluate these artifacts and transitions.

### 2.2 Safe unresolved is a valid result

An investigation that correctly stops with insufficient evidence can pass. A result that guesses the expected file without evidence can fail.

### 2.3 Cross-project portability is mandatory

No release gate may rely only on ContextForge-specific fixtures.

### 2.4 Deterministic core first

The deterministic loop must be stable before model-assisted planning is evaluated. Model quality must not mask defects in repository access, extraction, evidence validation, or stop policy.

### 2.5 Safety failures outweigh aggregate scores

One critical unsafe authorization, secret exposure, or explicit-target violation blocks rollout regardless of average quality metrics.

---

## 3. Validation layers

```text
L0 — Contract and invariant tests
L1 — Pure domain unit tests
L2 — Port/adapter contract tests
L3 — Extractor fixture tests
L4 — Investigation-loop smoke tests
L5 — Projection and compatibility tests
L6 — Offline replay and golden traces
L7 — Cross-project Validation Lab
L8 — Live shadow diagnostics
L9 — Canary/rollout monitoring
```

Each layer has different failure ownership and should remain independently runnable.

---

## 4. L0 — Contract and invariant tests

Validate:

- schema serialization;
- stable IDs for unchanged fixtures;
- snapshot consistency;
- source-span validity;
- fact-parent validity;
- evidence freshness;
- hypothesis transition legality;
- finding eligibility;
- forbidden legacy imports.

Required negative tests:

- fact references another snapshot;
- source span references unknown file;
- derived fact lacks parent IDs;
- model proposal marked as exact fact;
- confirmed finding has unresolved blocking contradiction;
- projected target has no finding;
- invalid stop reason;
- invalid phase transition.

---

## 5. L1 — Domain unit tests

### Hypothesis ledger

- open to supported;
- supported reopens on contradiction;
- rejected remains in history;
- weak evidence cannot support;
- competing hypotheses remain explicit.

### Evidence ledger

- deduplicates same source chain;
- preserves independent groups;
- invalidates stale fingerprints;
- combines deterministic facts correctly;
- rejects missing provenance.

### Contradiction registry

- creates blocking contradiction;
- resolves stale-vs-current evidence;
- preserves accepted ambiguity;
- distinguishes multiple legitimate owners from mutually exclusive owners.

### Stop policy

Test every canonical stop reason and ordering conflict.

Example: a sufficient result that reaches the final operation budget must stop as `sufficient_evidence`, not `operation_budget_exhausted`.

---

## 6. L2 — Port and adapter contract tests

Each port adapter receives shared contract tests.

### RepositoryReaderPort

- path containment;
- normalized relative paths;
- range and byte limits;
- fingerprint mismatch;
- unreadable/binary file behavior;
- secret/generated-file policy;
- deterministic typed errors.

### RepositorySearchPort

- stable ordering;
- bounds respected;
- no secret content leakage;
- search result is a lead rather than accepted fact;
- exact and no-match behavior.

### RepositorySnapshotPort

- complete fixture snapshot;
- truncated snapshot metadata;
- stable file fingerprint;
- excluded pattern reporting;
- generated and secret risk flags.

### KnowledgeGraphStore

- entity/fact insertion;
- idempotent reinsert;
- neighbor query;
- snapshot isolation;
- invalidation by fingerprint;
- trace export redaction.

---

## 7. L3 — Extractor fixture tests

Initial TypeScript/JavaScript extractor cases:

- direct import;
- named/default/namespace import;
- relative re-export;
- alias chain;
- function call;
- class construction;
- JSX component rendering;
- prop flow;
- state provider/consumer;
- route registration;
- HTTP client call;
- type/interface relationship;
- test target relationship;
- unsupported/dynamic pattern reported as limitation;
- parser failure reported safely.

Every expected fact checks:

- subject/object identity;
- predicate;
- exact source span;
- extractor/version;
- strength;
- stable ID.

Fixtures must not use ContextForge names.

---

## 8. L4 — Investigation-loop smoke tests

The minimum scenarios from CE-03 are mandatory.

Each smoke asserts both outcome and trace shape.

Example assertion set:

```text
stop reason = sufficient_evidence
critical questions answered = 3/3
owner hypothesis = supported
selected target finding = one service symbol/file
evidence = direct route import + call edge
operations contain search → read → parse → follow
no duplicate equivalent read
no blocking gaps
```

A smoke must not merely assert `selectedFiles`.

---

## 9. L5 — Projection and compatibility tests

Validate:

- target/supporting/reference/test role mapping;
- evidence attached to each projected entity;
- unresolved findings do not become confirmed targets;
- negative constraints exclude entities;
- explicit targets are preserved when valid;
- invalid explicit targets produce a clear gap/block;
- legacy DTO projection is schema-valid;
- compatibility-only score fields do not affect domain findings;
- deterministic ordering.

---

## 10. Golden investigation traces

A golden case stores a normalized expected trace summary, not raw implementation-internal state.

Recommended golden format:

```json
{
  "caseId": "route-to-service-owner",
  "expectedStopReasons": ["sufficient_evidence"],
  "requiredQuestions": ["route_owner", "behavior_owner"],
  "requiredPredicates": ["defines_route", "imports", "calls"],
  "requiredFindingRoles": ["implementation_target"],
  "forbiddenTargetPatterns": ["**/generated/**"],
  "maximumOperations": 12,
  "expectedUnresolvedCategories": []
}
```

Golden tests should allow semantically equivalent operation ordering when concurrency is enabled, but they must preserve deterministic final facts/findings.

Golden updates require review and a reason. Do not overwrite expected output merely because implementation changed.

---

## 11. Quality dimensions

### 11.1 Evidence provenance completeness

```text
findings with valid current evidence / all projected findings
```

Target: 100% for confirmed findings.

### 11.2 Critical question coverage

```text
answered critical questions / all critical questions
```

For `sufficient_evidence`, target: 100% or explicit non-applicable decisions.

### 11.3 Unsupported confirmation rate

Confirmed findings that fail evidence policy.

Target: 0.

### 11.4 Contradiction truthfulness

Blocking contradictions preserved and surfaced instead of silently resolved.

Target: 100% in deterministic fixtures and zero hidden known blocking contradictions in reviewed manifests.

### 11.5 Stop-reason correctness

The emitted stop reason matches expected case semantics.

Target: 100% for sealed safety cases; high threshold for broader expert cases.

### 11.6 Target precision

Confirmed implementation targets judged correct among all confirmed targets.

### 11.7 Target recall

Required implementation targets found among all expected required targets.

Precision and recall are secondary to safety and evidence validity.

### 11.8 Supporting-context usefulness

Supporting/reference context is relevant and not broad noise.

Evaluate through manifest expectations and expert review.

### 11.9 Safe-fail quality

When the engine cannot decide, it chooses an appropriate unresolved/block/clarification outcome with useful explanation.

### 11.10 Operation efficiency

- operations per successful investigation;
- file reads;
- bytes read;
- parsed files;
- relationship hops;
- wall time.

Efficiency must not be optimized by skipping required evidence.

### 11.11 Determinism

Repeated identical runs produce equivalent findings, stop reason, and stable fact/entity IDs.

### 11.12 Portability

Performance does not depend on project names, known path vocabularies, or ContextForge-specific rules.

---

## 12. Severity model

### Critical

- unsafe file authorization;
- secret content leakage;
- repository path escape;
- valid explicit target dropped without block;
- negative constraint violated;
- confirmed finding without evidence;
- snapshot versions mixed;
- production behavior altered during shadow mode;
- project-specific rule in generic core.

### High

- wrong primary owner with apparently strong evidence;
- blocking contradiction hidden;
- incorrect `sufficient_evidence` stop;
- nondeterministic target result;
- legacy fallback bypasses stricter safety result;
- severe latency/resource regression.

### Medium

- missing useful supporting context;
- unnecessary clarification;
- broad reference context;
- avoidable budget exhaustion;
- incomplete diagnostic explanation.

### Low

- trace wording or ordering issue;
- non-blocking metadata omission;
- minor diagnostic formatting defect.

No critical issue may be waived by aggregate scoring.

---

## 13. Validation manifest schema

```ts
export interface ContextEngineValidationCase {
  id: string;
  title: string;
  projectFixture: ValidationProjectSource;
  task: EngineTaskInput;
  purpose: InvestigationPurpose;
  budget?: Partial<InvestigationBudget>;
  expectations: ValidationExpectations;
  labels: string[];
  severityIfFailed: "critical" | "high" | "medium" | "low";
}

export interface ValidationExpectations {
  allowedStopReasons: StopReason[];
  requiredTargetMatchers?: EntityMatcher[];
  forbiddenTargetMatchers?: EntityMatcher[];
  requiredPredicates?: FactPredicate[];
  requiredGapCategories?: KnowledgeGap["category"][];
  forbiddenGapCategories?: KnowledgeGap["category"][];
  minimumCriticalQuestionCoverage?: number;
  maximumOperations?: number;
  legacyComparison?: LegacyComparisonExpectation;
}
```

Manifest expectations should prefer semantic matchers over exact file names when possible.

---

## 14. Cross-project suite

The pre-rollout suite should cover at least:

- ContextForge;
- GameHub;
- License Monitor;
- ROI calculator;
- Metall project;
- at least one additional small generic fixture not authored around existing validation assumptions.

The projects should represent different structures:

- monorepo vs single app;
- frontend-heavy vs backend-heavy;
- route/service vs direct handlers;
- local state vs shared state;
- strong tests vs sparse tests;
- TypeScript variants and configuration layouts.

Project names must not appear in engine rules.

---

## 15. Existing validation asset reuse

Preserve and reuse:

- current understanding smokes;
- clarification smokes;
- selector smokes;
- selector rollout and benchmark infrastructure;
- ownership and grounding cases;
- Validation Lab export and manifests;
- explicit target and negative constraint cases;
- safe-fail classifications.

Add a translation layer from existing cases to v2 expectations where practical. Do not rewrite all historical tests at once.

Existing legacy tests remain regression protection until retirement.

---

## 16. Shadow comparison gates

Before live shadow:

- all L0-L5 tests pass;
- zero critical fixture failures;
- deterministic replays pass;
- trace export redaction passes;
- v2 failure cannot fail production path.

Before Composer primary:

- candidate role/evidence display is understandable;
- explicit/negative constraints maintain parity;
- manual selection workflow remains intact;
- no independent Composer semantic ranking is needed for supported tasks.

Before Task Pack canary:

- zero critical failures across sealed and cross-project suites;
- unsupported confirmation rate is zero;
- stop-reason correctness is 100% for sealed safety cases;
- required target recall and precision meet the approved manifest threshold;
- p95 shadow latency and resource usage are within the approved budget;
- fallback and rollback are tested.

Before legacy retirement:

- canary/primary observation window has no critical regressions;
- legacy fallback rate is below the approved threshold for supported tasks;
- remaining fallback categories are documented or migrated;
- duplicate orchestration is removed;
- archive and rollback checkpoint are preserved.

---

## 17. Suggested initial quantitative thresholds

These are initial proposals and may be tightened after offline replay:

```text
Confirmed finding evidence completeness: 100%
Unsupported confirmed findings: 0
Critical safety failures: 0
Explicit-target sealed cases: 100% pass
Negative-constraint sealed cases: 100% pass
Stop-reason sealed cases: 100% pass
Deterministic replay equivalence: 100%
Cross-project acceptable-or-better outcomes: ≥ 85%
Cross-project critical failures: 0
Canary fallback due to internal v2 failure: < 2%
```

Target precision/recall thresholds should be established after the first v2 replay baseline rather than invented before measurement.

---

## 18. Performance measurement

Record separately:

- snapshot creation time;
- task interpretation time;
- search time;
- read/parse time;
- graph time;
- planning/evaluation time;
- projection time;
- total time;
- operation/file/byte counts;
- cache hit/miss.

Do not report only total latency. A regression must be attributable to a stage.

Performance traces must not contain raw secret content.

---

## 19. Model-assisted planner validation

When introduced, evaluate it in two independent ways:

1. **Proposal usefulness**<br>
   Did proposals reduce operations or discover evidence missed by the deterministic planner?

2. **Containment**<br>
   Were invalid, unsafe, duplicate, ungrounded, or over-budget proposals rejected correctly?

The deterministic engine must still produce a valid result when the model is unavailable, malformed, or disabled.

No rollout gate may require model availability until explicitly approved.

---

## 20. Required reports

Every implementation work order must return:

- tests added/updated;
- commands run;
- exact pass/fail counts;
- known untested paths;
- architecture-check result;
- `git diff --check`;
- `git diff --stat`;
- any manifest/golden update with reason.

Every cross-project run should return:

```text
PASS
ACCEPTABLE
SAFE FAIL
CRITICAL FAIL
API/ENGINE ERROR
```

and separate knowledge-quality metrics from file-overlap metrics.

---

## 21. Acceptance criteria

The validation model is implemented when:

- each layer L0-L5 has an independently runnable command;
- existing legacy suites remain runnable;
- v2 manifests can assert evidence and stop behavior;
- golden traces are versioned and reviewable;
- cross-project cases contain no engine-side named rules;
- critical failures block rollout automatically;
- shadow comparison produces both safety and quality dimensions;
- performance and privacy diagnostics are available;
- safe unresolved outcomes can pass when expected;
- coincidentally correct but unsupported results fail.
