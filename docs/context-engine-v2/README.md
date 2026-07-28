# Context Engine v2 — Architecture Package

**Project:** ContextForge<br>
**Baseline:** `0.7.0-alpha` snapshot audited on 2026-07-28<br>
**Package status:** Approved for staged implementation<br>
**Intended implementer:** Codex or another repository-aware coding agent under human review

---

## 1. Purpose

This package defines the architecture, contracts, migration rules, validation model, and staged implementation plan for Context Engine v2.

Context Engine v2 is **not** a rewrite of ContextForge as a product and is **not** another ranking layer inside the current selector. It is a new bounded subsystem that investigates a repository iteratively, records claims and evidence, tracks unresolved questions, stops by explicit policy, and only then projects the result into implementation context or a legacy-compatible file selection.

The package is intentionally complete enough to give an implementation agent the full architectural picture, but implementation must still proceed one work order at a time.

---

## 2. Canonical document order

1. **CE-01 — Current Architecture Audit**<br>
   Explains why the current core has reached its architectural limit and classifies legacy components by reuse strategy.

2. **CE-02 — Repository Knowledge Model and Evidence Schema**<br>
   Defines snapshots, entities, facts, relations, claims, evidence, hypotheses, contradictions, gaps, findings, and context projections.

3. **CE-03 — Investigation Loop and Stop Policy**<br>
   Defines the deterministic iterative loop, operation lifecycle, budgets, scheduling rules, hypothesis updates, and truthful stopping behavior.

4. **CE-04 — Component Boundaries, Ports, and Dependency Rules**<br>
   Defines the physical module layout, allowed dependency direction, core ports, adapter responsibilities, and architecture tests.

5. **CE-05 — Legacy Compatibility, Shadow Migration, and Rollout**<br>
   Defines coexistence with the current selector, compatibility projections, shadow comparison, observability, rollout gates, and rollback.

6. **CE-06 — Validation and Quality Model**<br>
   Defines test layers, quality dimensions, golden traces, cross-project manifests, safe-fail expectations, and release gates.

7. **CE-07 — Implementation Roadmap and Codex Work Orders**<br>
   Splits the migration into bounded implementation stages with explicit acceptance criteria, forbidden changes, verification commands, and expected reports.

8. **CODEX_EXECUTION_PROTOCOL**<br>
   Defines how to hand one work order to Codex, what evidence Codex must return, and how to prevent scope expansion.

---

## 3. Non-negotiable decisions

The following decisions are architectural constraints, not suggestions:

- Context Engine v2 is a separate bounded subsystem under `server/src/contextEngineV2/`.
- The v2 domain and contracts do not import legacy selector, Express, renderer, storage implementation, or model-provider code.
- The central result is `InvestigationResult`, not a file list.
- Every accepted finding has evidence with provenance.
- A confidence number alone cannot authorize implementation and cannot be a stop reason.
- Investigation starts from task questions and repository evidence, not from a preselected final file set.
- Safety and authorization remain deterministic policy gates outside probabilistic reasoning.
- The legacy selector is frozen except for correctness and security fixes while v2 is developed.
- Production integration begins only after shadow comparison and validation gates pass.
- No project-specific names, paths, or task-family exceptions may enter the generic v2 core.

---

## 4. How to use this package with Codex

Do **not** send Codex the instruction “implement Context Engine v2.”

Use this sequence:

```text
Read the complete architecture package
  ↓
Implement exactly one CE2 work order
  ↓
Run the required checks
  ↓
Return diff, tests, decisions, and limitations
  ↓
Human architecture review
  ↓
Checkpoint commit
  ↓
Next work order
```

Codex may read every document for context, but only the current work order from CE-07 is implementation scope.

The recommended first assignment is **CE2-00 — Boundary and Contracts**.

CE-07 refines and expands the high-level migration sequence described in CE-01. When stage numbering or stage scope differs, **CE-07 is the implementation authority** while CE-01 remains the audit and strategic baseline.

---

## 5. Package-level definition of success

The package is implemented successfully only when ContextForge can:

1. construct a versioned repository snapshot;
2. extract facts and relationships with source provenance;
3. form and update explicit hypotheses;
4. schedule bounded repository operations iteratively;
5. identify missing or contradictory evidence;
6. stop for an explicit, truthful reason;
7. produce findings and unresolved questions;
8. project findings into safe implementation context;
9. compare v2 output with the legacy selector without changing production behavior;
10. pass cross-project quality and safety gates before rollout.

A coincidentally correct file list without supported reasoning is not sufficient.

---

## 6. Versioning and change control

This package is the initial architecture baseline: **CE2 Architecture Baseline 1**.

Changes to the following require an explicit architecture decision recorded in the relevant document:

- core domain entities;
- dependency direction;
- stop reasons;
- evidence requirements;
- compatibility semantics;
- rollout gates;
- work-order boundaries.

Implementation details inside adapters may evolve without changing the baseline, provided contracts and invariants remain intact.

---

## 7. Recommended repository placement

After review, place this package under:

```text
docs/context-engine-v2/
├── README.md
├── CE-01_Current_Architecture_Audit.md
├── CE-02_Repository_Knowledge_Model_and_Evidence_Schema.md
├── CE-03_Investigation_Loop_and_Stop_Policy.md
├── CE-04_Component_Boundaries_Ports_and_Dependency_Rules.md
├── CE-05_Legacy_Compatibility_Shadow_Migration_and_Rollout.md
├── CE-06_Validation_and_Quality_Model.md
├── CE-07_Implementation_Roadmap_and_Codex_Work_Orders.md
└── CODEX_EXECUTION_PROTOCOL.md
```

Do not mix these documents into a commit that also contains unfinished legacy selector changes.
