# CE-03 — Investigation Loop and Stop Policy

**Project:** ContextForge<br>
**Architecture:** Context Engine v2<br>
**Status:** Normative specification<br>
**Depends on:** CE-01, CE-02

---

## 1. Purpose

This document defines the stateful investigation process that turns a task and repository snapshot into an evidence-backed `InvestigationResult`.

The central architectural change is the move from a mostly one-pass flow:

```text
task → retrieve candidates → rank → finalize file list
```

to an iterative process:

```text
interpret → ask repository questions → form hypotheses
→ execute bounded operations → extract evidence
→ update knowledge → detect gaps/contradictions
→ schedule next operation or stop explicitly
```

The first production-capable loop must be deterministic. Model assistance may propose operations in a later stage, but it must never own repository access, fact acceptance, evidence validation, or stop authorization.

---

## 2. Investigation input and output

### 2.1 Input

```ts
export interface InvestigationRequest {
  requestId: string;
  projectId: string;
  task: EngineTaskUnderstanding;
  snapshot: RepositorySnapshot;
  explicitTargets: ExplicitTargetConstraint[];
  negativeConstraints: NegativeConstraint[];
  priorKnowledge?: PriorKnowledgeReference[];
  budget: InvestigationBudget;
  purpose: InvestigationPurpose;
}

export type InvestigationPurpose =
  | "implementation_context"
  | "review_context"
  | "clarification"
  | "shadow_comparison";
```

### 2.2 Output

```ts
export interface InvestigationResult {
  investigationId: string;
  requestId: string;
  snapshotId: SnapshotId;
  taskUnderstanding: EngineTaskUnderstanding;
  hypotheses: InvestigationHypothesis[];
  evidence: EvidenceRecord[];
  findings: Finding[];
  contradictions: ContradictionRecord[];
  knowledgeGaps: KnowledgeGap[];
  operationLog: InvestigationOperationRecord[];
  coverage: InvestigationCoverage;
  stop: InvestigationStop;
  projection: ContextProjection;
}
```

The output must remain useful even when the engine cannot identify a safe implementation target.

---

## 3. Investigation state machine

```ts
export type InvestigationPhase =
  | "initialized"
  | "interpreting"
  | "planning"
  | "executing"
  | "evaluating"
  | "projecting"
  | "stopped";
```

Allowed transitions:

```text
initialized → interpreting
interpreting → planning
planning → executing
executing → evaluating
evaluating → planning      when more evidence is needed
evaluating → projecting    when a stop decision is reached
projecting → stopped
```

The runner must reject invalid transitions and record every successful transition in the trace.

---

## 4. Investigation questions

Before searching for files, the interpreter converts the task into repository questions.

Example task:

```text
Add validation to project deletion and show the server error in the confirmation modal.
```

Possible questions:

```text
Q1. Which server route receives project deletion?
Q2. Which service or storage owner performs the deletion?
Q3. Where are deletion constraints currently enforced?
Q4. Which client function calls the endpoint?
Q5. Which modal triggers deletion and displays errors?
Q6. Which tests cover the route, service, and modal behavior?
```

Questions are semantic and project-neutral. They must not assume a file path before evidence establishes one.

```ts
export interface InvestigationQuestion {
  id: QuestionId;
  text: string;
  category:
    | "owner"
    | "behavior"
    | "data_flow"
    | "route_flow"
    | "state_flow"
    | "constraint"
    | "test_coverage"
    | "risk";
  priority: "critical" | "high" | "normal" | "low";
  status: "open" | "answered" | "partially_answered" | "blocked";
  answerFindingIds: FindingId[];
}
```

At least one critical question must exist for an implementation-context investigation.

---

## 5. Hypothesis seeding

Initial hypotheses may come from:

- explicit path or symbol references in the task;
- deterministic route, endpoint, symbol, and manifest indexes;
- Project Memory facts adapted as prior knowledge;
- current-state grounding;
- repository conventions detected from manifests;
- weak text/path matches used only as leads.

Examples:

```text
H1: A route module owns the DELETE project endpoint.
H2: A service called by that route enforces deletion constraints.
H3: A confirmation modal is the direct UI trigger.
```

Initial hypotheses are `open`. Explicit user references may raise priority but do not automatically make a hypothesis supported.

---

## 6. Operation model

### 6.1 Operation union

```ts
export type InvestigationOperation =
  | SearchPathsOperation
  | SearchTextOperation
  | SearchSymbolsOperation
  | ReadFileOperation
  | ReadRangeOperation
  | ParseFileOperation
  | FollowRelationshipOperation
  | InspectManifestOperation
  | InspectGitContextOperation
  | EvaluateAbsenceOperation;
```

### 6.2 Shared operation fields

```ts
export interface InvestigationOperationBase {
  id: OperationId;
  type: string;
  reason: string;
  questionIds: QuestionId[];
  hypothesisIds: HypothesisId[];
  priority: number;
  estimatedCost: OperationCost;
  deduplicationKey: string;
  safetyClassification: "safe" | "restricted" | "blocked";
}
```

### 6.3 Required operation types

#### SearchPathsOperation

Search normalized paths, file names, and structural roles.

#### SearchTextOperation

Search bounded text tokens or exact strings. Secret files and generated files remain subject to repository policy.

#### SearchSymbolsOperation

Search parser-backed symbol and export indexes.

#### ReadFileOperation / ReadRangeOperation

Read current snapshot content through `RepositoryReaderPort`. Every read returns a fingerprint and must be rejected if it no longer matches the snapshot.

#### ParseFileOperation

Run registered deterministic extractors and store facts.

#### FollowRelationshipOperation

Traverse one or more verified graph edges within explicit depth and fan-out bounds.

#### InspectManifestOperation

Read framework/build/package manifests to resolve repository structure or runtime variants.

#### InspectGitContextOperation

Optional operation for recent changes when the task depends on current work state. Git context is supporting evidence, not source-of-truth implementation evidence.

#### EvaluateAbsenceOperation

Records a bounded negative search and its coverage before creating an absence claim.

---

## 7. Operation lifecycle

```ts
export type OperationStatus =
  | "proposed"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "blocked"
  | "deduplicated";

export interface InvestigationOperationRecord {
  operation: InvestigationOperation;
  status: OperationStatus;
  startedAt?: string;
  completedAt?: string;
  actualCost?: OperationCost;
  producedEntityIds: EntityId[];
  producedFactIds: FactId[];
  producedEvidenceIds: EvidenceId[];
  error?: SafeOperationError;
}
```

A failed operation does not automatically fail the investigation. The evaluator decides whether an alternative operation exists or whether the failure creates a blocking gap.

---

## 8. Planner responsibilities

The planner receives the current investigation state and proposes a small ordered batch of next operations.

```ts
export interface InvestigationPlanner {
  proposeNextOperations(
    state: Readonly<InvestigationState>,
  ): Promise<InvestigationPlan>;
}

export interface InvestigationPlan {
  rationale: string;
  operations: InvestigationOperation[];
  expectedEvidence: EvidenceRequirement[];
}
```

The deterministic planner should prioritize:

1. explicit target verification;
2. critical unanswered questions;
3. blocking contradictions;
4. owner and data-flow discovery;
5. missing test or constraint context;
6. lower-value supporting/reference context.

The planner must not schedule operations merely to increase a score. Every operation must name the question or hypothesis it serves.

---

## 9. Operation priority

A recommended deterministic priority model:

```text
priority = semantic urgency
         + evidence deficit
         + contradiction severity
         + expected information gain
         - operation cost
         - duplication penalty
         - unsafe scope penalty
```

This formula is conceptual, not a required numeric scoring implementation. The implementation may use ordered rules and categories.

Tie-breaking must be deterministic:

1. lower expected cost;
2. narrower scope;
3. stable operation type order;
4. normalized path/symbol order;
5. operation ID.

---

## 10. Runner responsibilities

```ts
export interface InvestigationRunner {
  run(request: InvestigationRequest): Promise<InvestigationResult>;
  continue(
    state: PersistedInvestigationState,
    additionalBudget?: Partial<InvestigationBudget>,
  ): Promise<InvestigationResult>;
}
```

The runner owns orchestration only. It delegates:

- interpretation to `TaskInterpreterPort`;
- planning to `InvestigationPlanner`;
- repository access to reader/search ports;
- fact extraction to registered extractors;
- graph updates to `KnowledgeGraphStore`;
- claim/hypothesis updates to domain ledgers;
- stopping to `StopPolicy`;
- output construction to `ContextProjectionService`.

The runner must not import Express routes, Task Pack generation, renderer DTOs, or legacy selector implementation.

---

## 11. Evaluation cycle

After each completed operation or bounded batch, the evaluator performs:

```text
1. Validate new facts and provenance
2. Deduplicate entities/facts/evidence
3. Update claims
4. Update hypothesis statuses
5. Detect contradictions
6. Resolve or create knowledge gaps
7. Update question coverage
8. Update budget consumption
9. Ask StopPolicy for a decision
10. If continuing, ask planner for the next operations
```

No operation may directly mark a finding as confirmed. Findings emerge from claim and evidence evaluation.

---

## 12. Hypothesis ledger behavior

```ts
export interface HypothesisLedger {
  add(hypothesis: InvestigationHypothesis): void;
  applyEvidence(evidence: EvidenceRecord[]): HypothesisTransition[];
  rejectUnsupportedAssumptions(reason: string): HypothesisTransition[];
  getOpen(): InvestigationHypothesis[];
  getBlocking(): InvestigationHypothesis[];
  snapshot(): InvestigationHypothesis[];
}
```

Rules:

- weak leads may create hypotheses but cannot support them;
- supported hypotheses may reopen after contradictory evidence;
- two competing owner hypotheses remain open until evidence distinguishes them or the engine records multiple legitimate owners;
- a hypothesis must not disappear from the ledger when rejected;
- transition history is append-only for the investigation.

---

## 13. Budgets

```ts
export interface InvestigationBudget {
  maxOperations: number;
  maxFileReads: number;
  maxFileBytes: number;
  maxParsedFiles: number;
  maxRelationshipHops: number;
  maxWallTimeMs: number;
  maxPlannerRounds: number;
  maxConcurrentOperations: number;
}
```

Recommended initial local defaults for smoke and shadow execution:

```text
maxOperations: 40
maxFileReads: 24
maxFileBytes: 1.5 MB
maxParsedFiles: 24
maxRelationshipHops: 4
maxWallTimeMs: 4,000
maxPlannerRounds: 12
maxConcurrentOperations: 4
```

Defaults are policy values and should be configurable. Tests must use smaller explicit budgets.

Budget exhaustion is a normal stop condition, not an exception.

---

## 14. Coverage model

```ts
export interface InvestigationCoverage {
  criticalQuestionsTotal: number;
  criticalQuestionsAnswered: number;
  questionsTotal: number;
  questionsAnswered: number;
  hypothesesTotal: number;
  hypothesesSupported: number;
  hypothesesRejected: number;
  hypothesesUnresolved: number;
  filesConsidered: number;
  filesRead: number;
  filesParsed: number;
  relationshipHops: number;
  evidenceIndependentGroups: number;
  snapshotTruncated: boolean;
  blockedScopes: string[];
}
```

Coverage describes what was investigated. It must not be presented as certainty.

---

## 15. Stop policy

### 15.1 Stop decision

```ts
export interface StopPolicy {
  evaluate(state: Readonly<InvestigationState>): StopDecision;
}

export type StopDecision =
  | { action: "continue"; reason: string }
  | { action: "stop"; stop: InvestigationStop };

export interface InvestigationStop {
  reason: StopReason;
  message: string;
  blockingGapIds: KnowledgeGapId[];
  contradictionIds: ContradictionId[];
  budgetState: InvestigationBudgetState;
  safeToProject: boolean;
}
```

### 15.2 Canonical stop reasons

```ts
export type StopReason =
  | "sufficient_evidence"
  | "clarification_required"
  | "no_grounded_lead"
  | "contradictory_evidence"
  | "operation_budget_exhausted"
  | "file_budget_exhausted"
  | "byte_budget_exhausted"
  | "time_budget_exhausted"
  | "planner_round_budget_exhausted"
  | "repository_snapshot_truncated"
  | "repository_changed"
  | "safety_blocked"
  | "internal_error";
```

### 15.3 Sufficient evidence

The engine may stop with `sufficient_evidence` when:

- all critical investigation questions are answered or explicitly non-applicable;
- at least one safe implementation target finding exists for implementation purpose;
- required evidence policies are satisfied;
- no blocking contradiction remains;
- no blocking knowledge gap remains;
- evidence is current for the active snapshot;
- deterministic authorization preconditions can be evaluated downstream.

### 15.4 Clarification required

Use `clarification_required` only when:

- the unresolved issue depends on user intent or external requirements;
- safe repository operations cannot resolve it;
- the question materially changes target or behavior;
- the engine can ask a concrete question.

Bad clarification:

```text
Which files should I use?
```

Good clarification:

```text
Should deleting a project with active runs be blocked, or should the runs be deleted as well?
```

### 15.5 No grounded lead

Use when all available deterministic leads have been exhausted and no evidence-backed owner or behavior path exists.

The result should include:

- operations attempted;
- searched scopes;
- weak leads rejected;
- limitations.

### 15.6 Contradictory evidence

Use when a blocking contradiction remains after all reasonable bounded resolution operations.

### 15.7 Budget exhaustion

Budget exhaustion may still produce a review projection, but implementation targets must be marked `review_required` or `not_eligible` according to unresolved gaps.

### 15.8 Repository changed

If a read fingerprint differs from the snapshot, stop or rebuild the snapshot. Never mix changed content into the same investigation silently.

### 15.9 Internal error

`internal_error` is reserved for invariant violations or unexpected engine failures. Ordinary unreadable files, parser failures, or unsupported languages should usually become gaps rather than internal errors.

---

## 16. Stop-policy ordering

Evaluate in this order:

1. invariant violation / internal error;
2. repository changed;
3. safety block;
4. sufficient evidence;
5. clarification required;
6. blocking unresolved contradiction with no remaining operation;
7. hard budget exhaustion;
8. snapshot truncation that blocks critical questions;
9. no grounded lead;
10. continue.

This ordering prevents a budget stop from hiding an already sufficient result and prevents a high-quality result from overriding a safety block.

---

## 17. Deterministic first-loop strategy

The first implementation should use ordered deterministic phases:

### Phase A — explicit grounding

- verify explicit paths;
- verify explicit symbols;
- register negative constraints;
- seed direct hypotheses.

### Phase B — structural discovery

- inspect manifests and repository roles;
- search route/endpoint/symbol indexes;
- parse likely owner files;
- follow exact imports, exports, calls, renders, and route registrations.

### Phase C — behavioral expansion

- follow service/storage/state relationships;
- identify supporting constraints and tests;
- resolve aliases and re-exports;
- detect multiple owners or variants.

### Phase D — completion

- answer critical questions;
- evaluate missing test/constraint evidence;
- perform bounded negative searches where needed;
- run stop policy;
- build projection.

No language model is required for these phases.

---

## 18. Model-assisted planner rules

Model assistance is deferred until the deterministic loop is stable.

When introduced, a model may:

- propose repository questions;
- propose hypotheses;
- propose operations from an allowed schema;
- summarize evidence already accepted by the engine.

A model may not:

- read arbitrary repository paths directly;
- assert facts without deterministic evidence;
- override safety blocks;
- mark findings confirmed;
- create new stop reasons;
- increase budgets;
- bypass negative constraints;
- write directly to the knowledge graph.

Every model proposal must be validated and may be rejected without affecting the engine state.

---

## 19. Concurrency and determinism

Operations may run concurrently only when they do not depend on one another's output.

The runner must apply completed results in deterministic order, such as operation priority then operation ID. This prevents nondeterministic fact ordering and flaky traces.

The same request, snapshot, budgets, extractor versions, and configuration should produce semantically equivalent results.

---

## 20. Resume and continuation

A stopped investigation may be resumed only when:

- the snapshot is unchanged;
- persisted state passes schema validation;
- extractor/planner versions are compatible;
- the user provides clarification or additional budget;
- prior evidence fingerprints remain current.

A new snapshot requires a new investigation or an explicit revalidation process.

---

## 21. Required smoke scenarios

1. **Exact import owner**<br>
   Search identifies a route file, parses it, follows an exact import, and confirms a service owner.

2. **Re-export chain**<br>
   The engine follows a bounded re-export before identifying the implementation symbol.

3. **Competing owners**<br>
   Two plausible owners remain open until call or registration evidence resolves them.

4. **Missing implementation**<br>
   A declared route with no handler produces a gap and safe unresolved result.

5. **Contradictory configuration**<br>
   Two runtime variants produce a material contradiction rather than a merged score.

6. **Budget exhaustion**<br>
   The trace stops explicitly and preserves partial findings.

7. **Repository mutation**<br>
   A fingerprint mismatch stops with `repository_changed`.

8. **Safety-restricted file**<br>
   The engine records a safety gap and does not read secret content.

9. **No grounded lead**<br>
   Weak path matches are exhausted and rejected truthfully.

10. **Clarification required**<br>
    Repository evidence cannot determine a material product behavior choice.

Fixtures must be generic and small.

---

## 22. Acceptance criteria

The investigation loop conforms to this specification when:

- every operation identifies its question/hypothesis purpose;
- operation deduplication prevents repeated equivalent reads/searches;
- facts are added only after provenance validation;
- hypotheses maintain append-only transition history;
- contradictions and gaps survive into the result;
- all stops use canonical explicit reasons;
- budget exhaustion returns partial trace rather than throwing;
- snapshot mutation is detected;
- a successful trace can explain why each projected target was included;
- the loop does not import or call the legacy selector;
- the same fixture run is deterministic.
