# Context Engine V2 Roadmap

This document is the durable roadmap for future Context Engine V2 (CE2) work. It separates the frozen implementation baseline from deferred semantic work, external-validation expansion, rollout decisions, and research. The product-level ContextForge roadmap remains [`ROADMAP.md`](ROADMAP.md).

## 1. Frozen baseline

Context Engine V2 Phase A2 is frozen at commit `8458ffb96b78dd3541207e6ba6ddf6b04cb6a7c8` and annotated tag `checkpoint-ce2-a2-2026-09-06`.

The current `main` when this roadmap was written is `d3ab9358afb361ea8f8b6794f1c89c882506e1ef`, with CI green. Later `main` commits may contain non-CE2 maintenance or test corrections; the semantic Phase A2 checkpoint remains the tagged commit above.

## 2. Completed CE2 foundation

The following foundation is implemented:

- CE2-00 through CE2-10 staged implementation;
- CE2-11 opt-in primary-authority code/readiness checkpoint;
- pre-validation repository and tooling hygiene;
- reproducible external-validation tooling;
- a deterministic investigation pipeline;
- fail-closed selection, projection, and authorization behavior.

The grounding pipeline has explicit stages for:

1. repository snapshot;
2. inventory;
3. bounded read, parse, and search operations;
4. entities;
5. facts;
6. relationships;
7. claims and hypotheses;
8. evidence;
9. findings;
10. grounded proof;
11. projection;
12. authorization.

Current grounded proof classes are:

- `direct_definition`;
- `direct_document_identity`;
- `direct_configuration_identity`;
- `direct_source_identity`;
- `exact_relationship_chain`.

Completion of this foundation does not establish release readiness, approve a global-default change, or authorize physical legacy retirement.

## 3. Phase A2 — exact source file identity

Phase A2 is complete and frozen.

When a task explicitly names an exact editable source path, CE2 can ground the source file itself as file-level implementation authority. The canonical evidence predicate is `source_identity`, and the corresponding grounded proof is `direct_source_identity`.

A valid source identity is:

- bound to the current repository snapshot;
- bound to a verified parse/read operation;
- verified against current content;
- constrained to the exact requested path;
- available only for readable source files;
- unavailable for generated files;
- unavailable unless `secretRisk = none`;
- aware of negative constraints;
- deterministic;
- file-level only.

Source identity proves exact source-file identity and file ownership for the explicit source target. It does **not** prove:

- a specific symbol;
- a function implementation;
- behavior;
- scalar or current values;
- desired values.

## 4. Explicit path and symbol semantics

The current canonical contract represents an explicit target as either a path or a symbol:

```ts
type ExplicitTargetConstraint =
  | { kind: "path"; path: string }
  | { kind: "symbol"; symbol: string };
```

Multiple entries are independent constraints. The coexistence of a path constraint and a symbol constraint does not establish that the symbol belongs to that path. Phase A2 therefore uses hypothesis-specific source-path ownership rather than global path/symbol coupling.

Compound path-and-symbol association remains future **Backlog / Research**. Possible contract directions include a compound target constraint, a stable association ID, or an explicitly scoped symbol target. No direction is approved yet.

Association must not be inferred from array order, textual proximity, the first matching path, alphabetical order, or task-phrasing heuristics.

## 5. Real-project validation

Real-project validation is underway, but it is not a source of production authority. A real repository may reveal an engine defect; it must not define a supposedly universal architecture.

### GameHub — external validation project #1

The accepted high-level semantic checkpoint produced:

- 3 `PASS`;
- 4 `ACCEPTABLE`;
- 1 `SAFE_FAIL`;
- no unsafe adoption.

### Metall-Perm — external validation project #2

The frozen evaluator manifest is `.contextforge-validation/metall-perm-pilot-v1.json`, SHA256 `cde79e4927281ef91c684b639789bd8aa1e449f6eb22d23a015ba0f6a5d7ff54`. It contains MPX-01 through MPX-14.

Important post-A2 observations:

- **MPX-02:** ownership grounding passes; `src/content/steel.ts` is selected through `direct_source_identity`. The current scalar state `15` is not canonically represented, so scalar semantic completeness is not established.
- **MPX-03:** passes through `direct_document_identity`.
- **MPX-04:** passes through `direct_configuration_identity`.
- **MPX-08:** passes through `direct_source_identity`.
- Safety cases remain fail-closed.

MPX-05, MPX-06, and MPX-07 remain dedicated future investigations. Each must proceed through diagnostic root cause, then a universal architecture decision, and only then implementation if justified. Metall-Perm-specific production fixes are prohibited.

## 6. Deferred Phase B — scalar current-state grounding

Phase B is the first major deferred semantic phase. It has not started.

MPX-02 is the motivating example. Repository source contains conceptually:

```ts
const x = 15 + (h % 70);
```

The task requests that the minimum x offset become `20`. CE2 can ground the owning file, `src/content/steel.ts`, but does not yet canonically represent the repository truth `15`.

Therefore:

- ownership grounding is complete;
- semantic current-state grounding is incomplete.

Future research may examine numeric-literal facts, scalar-initializer facts, local declaration/member state, expression facts, current-value evidence, requested-value evidence, and current-to-requested transition validation. These are research directions, not an approved design.

The evidence boundary is mandatory: the current value must come from repository evidence, while the desired value must come from task/user evidence. Requested values must never be presented as repository truth.

## 7. Contradiction model backlog

Earlier MPX-02 diagnostics exposed a contradiction-identity issue: logically equivalent owner conflicts could accumulate as multiple contradiction records because evidence identity contributed to contradiction identity.

Future **Backlog / Research**: semantic contradiction canonicalization and stable semantic contradiction IDs.

Any future correction must:

- preserve evidence traceability;
- preserve fail-closed behavior;
- avoid reducing counts by weakening contradiction detection;
- distinguish duplicate representation from genuinely independent conflicts.

## 8. Relationship proof program

`exact_relationship_chain` exists, but broader real-world observation is required before stronger rollout claims.

Future validation must measure:

- real positive relationship-chain use;
- false-positive rate;
- ambiguity behavior;
- bounded traversal behavior;
- cross-file ownership behavior;
- deterministic replay;
- proof traceability.

Synthetic coverage alone does not establish relationship-chain readiness.

## 9. External-validation expansion

Before changing the global CE2 default, validate multiple unrelated real repositories across different sizes, structures, application types, architectures, frameworks, and languages where practical.

Measure at least:

- grounded-selection rate;
- acceptable-abstention rate;
- unsafe-adoption rate;
- fallback rate;
- contradiction rate;
- rollback behavior;
- determinism;
- latency;
- parsed/read file counts;
- authorization behavior.

No single repository or benchmark defines the release threshold.

## 10. Performance and scale

Focused Phase A2 runs showed encouraging latency. This is not a qualified optimization or scale claim.

Future performance qualification must include reproducible baselines, cold and warm runs, repository-size classes, operation/read/parse/graph-traversal counts, wall-clock percentiles, memory and resource observations, and explicit regression thresholds.

Additional **Backlog / Research** areas include incremental inventory, scoped caching, large-repository behavior, bounded graph work, and cancellation/resource control where relevant.

## 11. Language and framework expansion

Deep ownership and semantic extraction are currently strongest for TypeScript and JavaScript projects. Additional language and framework adapters may be added in the future.

The architectural direction remains:

```text
language/framework adapters
            ↓
     universal CE2 core
```

Universal evidence semantics must remain separate from language-specific extraction. TypeScript-, React-, or framework-specific rules must not be embedded in universal core contracts.

## 12. Release posture

> **Context Engine V2 global default remains DISABLED.**
>
> **Legacy retirement is NOT authorized.**
>
> **The release-quality threshold is NOT established.**
>
> **The observation window is NOT complete.**
>
> **Human rollout approval has NOT been granted.**

CE2 is not fully production-approved. Legacy remains available for rollback, shadow, canary, benchmark, and comparison workflows.

## 13. Global-default rollout gates

Before switching the CE2 global default, require at minimum:

- multiple unrelated real repositories validated;
- a defined release threshold;
- unsafe adoption remaining zero;
- acceptable abstention understood;
- fallback rate measured;
- relationship-proof behavior observed;
- performance qualified;
- rollback checkpoint verified;
- observation window completed;
- human approval recorded;
- documentation updated.

There is no automatic global-default switch.

## 14. Legacy-retirement gates

CE2 becoming the default and physical legacy retirement are separate decisions. Default adoption does not authorize deletion.

Physical legacy retirement requires:

- a sustained stable CE2-default period;
- no unresolved critical regression;
- a verified rollback/archive checkpoint;
- a recovery plan;
- preserved historical benchmarks;
- explicit human authorization.

Legacy must not be physically removed merely because CE2 becomes primary.

## 15. CE2 release-readiness definition

“Release ready” requires all of the following gates to be evidenced and approved:

| Area | Requirement | Current posture |
|---|---|---|
| Safety | No unsafe adoption; secret, path, generated-file, contradiction, and negative-scope protections verified | Foundation present; release evidence incomplete |
| Grounding | Current, traceable repository evidence authorizes every editable target | Implemented for supported proof classes; coverage expansion pending |
| Semantic completeness | Requested behavior and necessary current state are represented without invention | Not established; scalar Phase B deferred |
| Determinism | Equivalent inputs and snapshots produce equivalent results | Implemented and tested; broader observation pending |
| Authorization | Projection and downstream authorization preserve only proven edit scope | Implemented; rollout observation pending |
| Performance | Qualified cold/warm and repository-scale thresholds pass | Not established |
| External validation | Multiple unrelated repositories meet a defined threshold | Started with two repositories; threshold not established |
| Rollback | Rollback/archive checkpoint and recovery procedure verified | Pending |
| Documentation | Architecture, limitations, evidence, and rollout decision are current | This roadmap records the current checkpoint; future decisions must update it |
| Human approval | Explicit rollout authorization is recorded | Not granted |

## 16. Future backlog

The following items are **Backlog / Research**, not committed implementation:

- scalar and current-state grounding;
- compound path-and-symbol target association;
- contradiction canonicalization;
- richer relationship evidence;
- multi-language extraction;
- incremental repository indexing;
- larger-repository performance qualification;
- deeper framework adapters;
- richer semantic expressions;
- improved diagnostic explainability.

Each item requires diagnosis and an independently justified universal design before implementation.

## 17. Resume checklist

The first future CE2 session should:

1. verify that `main` contains commit `8458ffb96b78dd3541207e6ba6ddf6b04cb6a7c8`;
2. verify that annotated tag `checkpoint-ce2-a2-2026-09-06` exists and resolves to that commit;
3. read this roadmap;
4. confirm that the release posture has not changed;
5. choose exactly one roadmap item;
6. diagnose before implementing;
7. decide whether the issue requires universal architecture;
8. validate against unrelated real projects;
9. preserve fail-closed safety;
10. record any rollout decision separately and explicitly.
