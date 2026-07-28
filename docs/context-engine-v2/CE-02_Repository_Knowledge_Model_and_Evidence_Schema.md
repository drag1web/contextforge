# CE-02 — Repository Knowledge Model and Evidence Schema

**Project:** ContextForge<br>
**Architecture:** Context Engine v2<br>
**Status:** Normative specification<br>
**Depends on:** CE-01

---

## 1. Purpose

This document defines the canonical knowledge model for Context Engine v2.

The current ContextForge core represents most understanding indirectly through candidate scores, selected-file metadata, execution contracts, and selector-specific evidence. Context Engine v2 instead requires explicit, inspectable, versioned knowledge objects.

The model must support all of the following without becoming tied to one language, framework, task family, or project:

- repository snapshots;
- files, symbols, routes, APIs, configuration, tests, data stores, and other entities;
- exact and inferred facts;
- relationships between entities;
- source spans and extraction provenance;
- claims derived from one or more facts;
- hypotheses that may be supported, rejected, or remain unresolved;
- contradictions and knowledge gaps;
- findings suitable for downstream context projection;
- traceability from every conclusion back to repository evidence.

The knowledge model is not an authorization model. It describes what the engine knows and why. Separate policy layers decide whether a finding is sufficient to permit implementation.

---

## 2. Design principles

### 2.1 Snapshot-relative truth

A repository fact is true only relative to a specific `RepositorySnapshot`.

The engine must never silently combine facts from different snapshots unless an explicit reconciliation operation has verified that the underlying source fingerprints are unchanged.

### 2.2 Provenance before confidence

Every fact and accepted finding must identify where it came from.

A confidence label without a source span, extractor identity, or derivation record is invalid.

### 2.3 Observation is not interpretation

The model separates:

- **observed facts** — directly extracted from repository content;
- **derived facts** — deterministically calculated from observed facts;
- **claims** — meaningful statements assembled from facts;
- **hypotheses** — statements the investigation is actively trying to confirm or reject;
- **findings** — investigation conclusions supported to the required level.

### 2.4 Contradictions are first-class

The engine must preserve contradictory evidence instead of averaging it into a score or silently choosing one side.

### 2.5 Missing knowledge is explicit

An unknown owner, missing implementation, unresolved route, ambiguous state source, or truncated snapshot becomes a `KnowledgeGap`, not an implicit low score.

### 2.6 Stable identifiers

Identifiers must be deterministic inside a snapshot where practical. Re-running the same extractor over unchanged content should produce stable entity, fact, and relation identities.

### 2.7 Language-neutral core

The domain model must not contain TypeScript-only concepts as mandatory fields. Language-specific extractors may add typed attributes and predicates through extension-safe records.

---

## 3. Core vocabulary

| Term | Meaning |
|---|---|
| Snapshot | Immutable repository state used by one investigation |
| Entity | A repository object that can be referenced |
| Fact | One atomic proposition with provenance |
| Relation | A fact whose object is another entity |
| Evidence | A source-backed record supporting or contradicting a claim |
| Claim | A meaningful statement assembled from facts/evidence |
| Hypothesis | A claim under active investigation |
| Contradiction | Evidence that cannot be reconciled under current knowledge |
| Knowledge gap | Missing information required for a decision |
| Finding | A supported conclusion suitable for output |
| Projection | A downstream representation of findings, such as implementation context |

---

## 4. Repository snapshot model

### 4.1 RepositorySnapshot

```ts
export interface RepositorySnapshot {
  id: SnapshotId;
  projectId: string;
  rootUri: string;
  rootFingerprint: string;
  createdAt: string;
  source: SnapshotSource;
  files: FileDescriptor[];
  limits: SnapshotLimits;
  truncation: SnapshotTruncation;
  metadata: Record<string, JsonValue>;
}

export type SnapshotSource =
  | "legacy_inventory_adapter"
  | "local_repository"
  | "remote_repository"
  | "test_fixture";

export interface SnapshotLimits {
  maxFiles?: number;
  maxBytes?: number;
  excludedPatterns: string[];
}

export interface SnapshotTruncation {
  truncated: boolean;
  reasons: Array<
    | "file_limit"
    | "byte_limit"
    | "permission_denied"
    | "unsupported_source"
    | "adapter_limit"
  >;
  omittedPathCount?: number;
}
```

### 4.2 Snapshot identity

The snapshot ID should be derived from:

- project identity;
- normalized repository root;
- relevant file fingerprints;
- scanner/adaptor version;
- exclusion policy version.

The initial implementation may use a generated ID, but the snapshot must still carry deterministic file fingerprints. A later cache layer may replace the generated ID with a content-derived ID.

### 4.3 FileDescriptor

```ts
export interface FileDescriptor {
  id: EntityId;
  snapshotId: SnapshotId;
  path: string;
  normalizedPath: string;
  extension: string | null;
  language: string | null;
  kind: FileKind;
  sizeBytes: number;
  contentFingerprint: string;
  readable: boolean;
  generated: boolean;
  secretRisk: "none" | "possible" | "known";
  attributes: Record<string, JsonValue>;
}

export type FileKind =
  | "source"
  | "test"
  | "configuration"
  | "documentation"
  | "asset"
  | "generated"
  | "data"
  | "unknown";
```

Paths must be normalized to repository-relative POSIX form. Absolute local paths must not enter domain facts or persisted traces.

---

## 5. Entity model

### 5.1 EntityRef

```ts
export interface EntityRef {
  id: EntityId;
  snapshotId: SnapshotId;
  kind: EntityKind;
  displayName: string;
  canonicalName?: string;
  fileId?: EntityId;
  attributes?: Record<string, JsonValue>;
}

export type EntityKind =
  | "repository"
  | "file"
  | "directory"
  | "module"
  | "symbol"
  | "function"
  | "class"
  | "interface"
  | "type"
  | "component"
  | "route"
  | "endpoint"
  | "configuration_key"
  | "database_entity"
  | "state_store"
  | "event"
  | "test_case"
  | "external_dependency"
  | "literal"
  | "unknown";
```

The union is intentionally broad but not exhaustive. New kinds require a documented extension and must not change the meaning of existing kinds.

### 5.2 Entity identity rules

Preferred identity components:

```text
snapshot ID
+ normalized file path
+ language-specific symbol identity
+ stable source range or qualified name
```

A rename or move may create a new entity in a new snapshot. Cross-snapshot identity reconciliation belongs to a later repository-history feature and is not required for CE2-00 through CE2-06.

---

## 6. Source provenance

### 6.1 SourceSpan

```ts
export interface SourceSpan {
  snapshotId: SnapshotId;
  fileId: EntityId;
  path: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  contentFingerprint: string;
  excerptHash?: string;
}
```

Rules:

- line and column numbers are one-based;
- the span must belong to the same snapshot as the fact;
- `contentFingerprint` must match the file descriptor;
- source text itself is not required to be persisted in the domain record;
- secret-bearing excerpts must not be copied into trace or diagnostics.

### 6.2 ExtractionProvenance

```ts
export interface ExtractionProvenance {
  extractorId: string;
  extractorVersion: string;
  method:
    | "parser"
    | "compiler_api"
    | "manifest_parser"
    | "deterministic_text"
    | "repository_metadata"
    | "derived"
    | "model_proposed";
  observedAt: string;
  parentFactIds?: FactId[];
  operationId?: OperationId;
}
```

`model_proposed` output is never accepted as an observed fact. It may create a hypothesis or search proposal that must later be grounded by deterministic evidence.

---

## 7. Fact and relation schema

### 7.1 FactRecord

```ts
export interface FactRecord {
  id: FactId;
  snapshotId: SnapshotId;
  subject: EntityRef;
  predicate: FactPredicate;
  object: EntityRef | LiteralValue;
  source: SourceSpan | RepositoryMetadataSource;
  provenance: ExtractionProvenance;
  strength: FactStrength;
  status: FactStatus;
  attributes: Record<string, JsonValue>;
}

export type FactStrength = "exact" | "strong" | "supporting" | "weak";
export type FactStatus = "active" | "superseded" | "invalidated";
```

### 7.2 LiteralValue

```ts
export type LiteralValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "null"; value: null }
  | { type: "json"; value: JsonValue };
```

### 7.3 Predicate vocabulary

Initial generic predicates:

```text
contains
imports
exports
re_exports
calls
constructs
reads
writes
renders
wraps
extends
implements
references
configures
defines_route
defines_endpoint
handles_request
uses_state
provides_state
subscribes_to
publishes
persists_to
reads_from_store
writes_to_store
validates
serializes
deserializes
tests
mocks
owns
supports
conflicts_with
```

Language/framework adapters may emit specialized predicates, but each specialized predicate must map to a generic semantic family.

### 7.4 Fact strength semantics

- `exact`: parser/compiler/manifest evidence directly establishes the proposition.
- `strong`: deterministic evidence establishes the proposition with one bounded inference step.
- `supporting`: relevant but insufficient alone for a final claim.
- `weak`: heuristic lead permitted only for planning/search; never sufficient for a finding.

Fact strength is categorical. It is not a disguised percentage.

### 7.5 Derived facts

A derived fact must list all parent facts through `parentFactIds` and use `method: "derived"`.

Example:

```text
Observed: route module imports ProjectController
Observed: ProjectController handles GET /projects/:id
Derived: route module supports project-details endpoint
```

A derived fact may not have a stronger strength than its weakest required parent unless the derivation rule itself adds exact compiler-backed proof.

---

## 8. Evidence model

### 8.1 EvidenceRecord

```ts
export interface EvidenceRecord {
  id: EvidenceId;
  snapshotId: SnapshotId;
  claimId?: ClaimId;
  role: "supports" | "contradicts" | "context_only";
  factIds: FactId[];
  sourceSpans: SourceSpan[];
  summary: string;
  strength: EvidenceStrength;
  independenceGroup: string;
  freshness: EvidenceFreshness;
  limitations: string[];
}

export type EvidenceStrength =
  | "conclusive"
  | "substantial"
  | "corroborating"
  | "lead";

export interface EvidenceFreshness {
  snapshotId: SnapshotId;
  current: boolean;
  reason?: "snapshot_match" | "fingerprint_match" | "stale" | "unknown";
}
```

### 8.2 Evidence independence

Multiple facts extracted from the same source statement are not independent evidence.

`independenceGroup` groups evidence records that share the same underlying source or derivation chain. The evaluator must not treat ten aliases from one import statement as ten independent confirmations.

### 8.3 Evidence acceptance

A finding is eligible for projection only when:

- all required evidence references exist;
- evidence is current for the active snapshot;
- no conclusive contradiction remains unresolved;
- the finding's required evidence policy is satisfied;
- all evidence can be traced to source spans or repository metadata.

---

## 9. Claims and hypotheses

### 9.1 ClaimRecord

```ts
export interface ClaimRecord {
  id: ClaimId;
  snapshotId: SnapshotId;
  type: ClaimType;
  statement: string;
  subject?: EntityRef;
  object?: EntityRef | LiteralValue;
  supportingEvidenceIds: EvidenceId[];
  contradictingEvidenceIds: EvidenceId[];
  status: ClaimStatus;
  derivation: ClaimDerivation;
}

export type ClaimType =
  | "implementation_owner"
  | "supporting_context"
  | "behavior"
  | "data_flow"
  | "route_flow"
  | "state_flow"
  | "configuration"
  | "test_coverage"
  | "absence"
  | "risk"
  | "custom";

export type ClaimStatus =
  | "proposed"
  | "supported"
  | "rejected"
  | "contradicted"
  | "unresolved";

export interface ClaimDerivation {
  ruleId: string;
  ruleVersion: string;
  inputFactIds: FactId[];
}
```

### 9.2 InvestigationHypothesis

```ts
export interface InvestigationHypothesis {
  id: HypothesisId;
  claimId: ClaimId;
  priority: "critical" | "high" | "normal" | "low";
  status: "open" | "supported" | "rejected" | "unresolved";
  requiredEvidence: EvidenceRequirement[];
  supportingEvidenceIds: EvidenceId[];
  contradictingEvidenceIds: EvidenceId[];
  openQuestionIds: KnowledgeGapId[];
  revision: number;
  history: HypothesisTransition[];
}
```

### 9.3 EvidenceRequirement

```ts
export interface EvidenceRequirement {
  id: string;
  description: string;
  acceptedFactPredicates?: FactPredicate[];
  acceptedEntityKinds?: EntityKind[];
  minimumStrength: EvidenceStrength;
  minimumIndependentGroups: number;
  required: boolean;
}
```

Requirements should describe semantic proof, not hard-coded file names.

Bad:

```text
Must include src/pages/ProjectPage.tsx
```

Good:

```text
Must identify the component or route that directly renders the project-details view.
```

### 9.4 Hypothesis transition rules

Allowed transitions:

```text
open → supported
open → rejected
open → unresolved
supported → contradicted/open after new evidence
rejected → open after invalidation or new evidence
```

Every transition records:

- previous status;
- next status;
- reason;
- evidence IDs;
- operation ID;
- timestamp.

A hypothesis cannot become supported only because its search score is high.

---

## 10. Contradictions

### 10.1 ContradictionRecord

```ts
export interface ContradictionRecord {
  id: ContradictionId;
  snapshotId: SnapshotId;
  claimId: ClaimId;
  evidenceIds: EvidenceId[];
  type:
    | "mutually_exclusive_claims"
    | "stale_vs_current"
    | "declared_vs_implemented"
    | "multiple_owners"
    | "parser_disagreement"
    | "unresolved_alias"
    | "custom";
  severity: "blocking" | "material" | "informational";
  status: "open" | "resolved" | "accepted_ambiguity";
  resolution?: ContradictionResolution;
}
```

### 10.2 Resolution rules

A contradiction may be resolved by:

- reading a more precise source range;
- following an alias or re-export;
- identifying different runtime/build variants;
- recognizing multiple legitimate owners;
- invalidating stale evidence;
- requesting clarification;
- explicitly preserving ambiguity.

The engine must not resolve contradictions by selecting the higher numeric score.

---

## 11. Knowledge gaps and unresolved questions

### 11.1 KnowledgeGap

```ts
export interface KnowledgeGap {
  id: KnowledgeGapId;
  snapshotId: SnapshotId;
  category:
    | "missing_owner"
    | "missing_behavior"
    | "missing_relationship"
    | "missing_runtime_variant"
    | "missing_test_evidence"
    | "ambiguous_user_intent"
    | "snapshot_truncated"
    | "unreadable_source"
    | "safety_restricted"
    | "custom";
  question: string;
  blocks: Array<"finding" | "projection" | "authorization">;
  relatedEntityIds: EntityId[];
  relatedHypothesisIds: HypothesisId[];
  suggestedOperations: InvestigationOperationProposal[];
  status: "open" | "resolved" | "accepted_unresolved";
}
```

### 11.2 User-facing unresolved questions

Only gaps that truly require information outside the repository should become user clarification questions.

The engine must first exhaust safe repository operations within budget. It should not ask the user which file to edit when the repository can answer that question.

---

## 12. Findings

### 12.1 Finding

```ts
export interface Finding {
  id: FindingId;
  snapshotId: SnapshotId;
  type:
    | "implementation_target"
    | "supporting_context"
    | "behavior_summary"
    | "constraint"
    | "risk"
    | "test_target"
    | "clarification_requirement";
  statement: string;
  entityIds: EntityId[];
  evidenceIds: EvidenceId[];
  status: "confirmed" | "probable" | "unresolved";
  limitations: string[];
  authorizationHint: "eligible" | "review_required" | "not_eligible";
}
```

### 12.2 Confirmed, probable, unresolved

- `confirmed`: requirements satisfied by current, sufficiently independent evidence.
- `probable`: strong evidence exists but one non-blocking requirement remains incomplete.
- `unresolved`: evidence is insufficient or contradictory.

These statuses describe knowledge quality. They do not directly grant permission to modify files.

### 12.3 Absence findings

Claims such as “no tests exist” or “the route has no owner” require explicit negative-search evidence:

- searched scopes;
- search method;
- snapshot completeness;
- relevant aliases considered;
- limitations.

Failure to find something is not automatically proof of absence.

---

## 13. Context projection model

```ts
export interface ContextProjection {
  snapshotId: SnapshotId;
  purpose:
    | "implementation"
    | "review"
    | "clarification"
    | "legacy_selection";
  primaryEntities: ProjectedEntity[];
  supportingEntities: ProjectedEntity[];
  referenceEntities: ProjectedEntity[];
  excludedEntities: ProjectedExclusion[];
  findings: Finding[];
  unresolvedQuestions: UnresolvedQuestion[];
  evidenceSummary: ProjectionEvidenceSummary;
}
```

A projected entity includes its role and evidence, not merely a score:

```ts
export interface ProjectedEntity {
  entityId: EntityId;
  role: "target" | "supporting" | "reference" | "test";
  reason: string;
  findingIds: FindingId[];
  evidenceIds: EvidenceId[];
  reviewRequired: boolean;
}
```

Legacy match percentages may be calculated by a compatibility adapter for old UI contracts, but they must not be stored as domain truth.

---

## 14. Knowledge graph store contract

```ts
export interface KnowledgeGraphStore {
  beginSnapshot(snapshot: RepositorySnapshot): Promise<void>;
  putEntities(entities: EntityRef[]): Promise<void>;
  putFacts(facts: FactRecord[]): Promise<void>;
  putClaims(claims: ClaimRecord[]): Promise<void>;
  getEntity(id: EntityId): Promise<EntityRef | null>;
  getFacts(query: FactQuery): Promise<FactRecord[]>;
  getNeighbors(query: NeighborQuery): Promise<KnowledgeEdge[]>;
  invalidateByFileFingerprint(
    snapshotId: SnapshotId,
    fileId: EntityId,
    previousFingerprint: string,
  ): Promise<void>;
  exportTrace(snapshotId: SnapshotId): Promise<KnowledgeTraceExport>;
}
```

The initial implementation is in-memory and snapshot-scoped. Persistent storage is a later optimization and must not leak storage-specific types into the domain.

---

## 15. Invariants

The implementation must enforce at least these invariants:

1. Every fact belongs to exactly one snapshot.
2. Every source span references a file in that snapshot.
3. Every derived fact names its parent facts.
4. Model proposals cannot be stored as exact facts.
5. A supported claim has at least one supporting evidence record.
6. A confirmed finding has no unresolved blocking contradiction.
7. A projected target references at least one finding.
8. A finding's evidence is current for the active snapshot.
9. Secret content is never copied into summaries or trace exports.
10. Weak facts can seed operations but cannot independently confirm a finding.
11. Entity and fact IDs are stable for unchanged content within the same extractor version.
12. Invalidated facts cannot participate in new findings.

---

## 16. Serialization and diagnostics

Domain records must be JSON-serializable.

Trace exports should include:

- IDs and semantic summaries;
- paths and safe source ranges;
- extractor names and versions;
- hypothesis transitions;
- contradictions and gaps;
- operation references;
- stop reason;
- redacted diagnostics.

Trace exports must exclude:

- raw `.env` values;
- authentication tokens;
- secret file content;
- full repository source unless explicitly requested through an authorized debug export.

---

## 17. Initial implementation scope

CE2-00 and CE2-01 should implement only:

- ID types;
- repository snapshot;
- file and entity descriptors;
- fact, evidence, claim, hypothesis, gap, finding, and projection contracts;
- invariant helpers;
- in-memory graph-store port and adapter;
- legacy inventory snapshot adapter;
- one deterministic import-relation fixture.

Do not implement persistence, vector search, model-generated facts, cross-snapshot history, or UI DTOs in the first slice.

---

## 18. Acceptance criteria

This specification is correctly implemented when:

- a fixture repository can be adapted into a snapshot;
- one file, one symbol, and one import relation receive stable IDs;
- the import fact contains an exact source span and extractor provenance;
- a claim can cite the fact through an evidence record;
- a hypothesis can transition from open to supported with transition history;
- a finding can be projected as implementation context;
- serialization produces no legacy selector types;
- all invariants fail fast in tests when violated;
- no ContextForge-specific project path or feature name appears in generic fixtures.

---

## 19. Decisions deferred

The following are intentionally deferred:

- persistent graph database selection;
- embeddings and semantic vector retrieval;
- cross-branch and cross-commit identity;
- model-assisted claim proposal;
- user-editable evidence annotations;
- remote repository partial checkout strategy;
- binary and image understanding;
- multi-repository workspace graphs.

These may be added later through ports without changing the foundational distinction between facts, evidence, claims, hypotheses, and findings.
