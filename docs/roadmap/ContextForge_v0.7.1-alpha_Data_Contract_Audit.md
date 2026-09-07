# ContextForge v0.7.1-alpha — UI Data Contract Audit

Status: COMPLETE

Audit ID: `UI-DATA-01`

Development baseline:

- Branch: `main`
- Baseline HEAD: `6f71471e1efe92ef885af388a4f06cf9c3471969`
- Version: `0.7.1-alpha`

## Purpose

This document records which ContextForge engine and repository signals are
currently available to the desktop renderer, which exist only inside Context
Engine v2, and which must not be inferred by the UI.

The goal is to establish a deterministic data boundary for the planned
`v0.7.1-alpha` UI/UX work.

This audit does not change Context Engine semantics.

Context Engine v2 remains frozen at Phase A2 and disabled by default.

Frozen CE2 checkpoint:

`8458ffb96b78dd3541207e6ba6ddf6b04cb6a7c8`

Tag:

`checkpoint-ce2-a2-2026-09-06`

## Classification

Each planned UI datum is classified as one of:

- `AVAILABLE` — already reaches the renderer through a stable current contract.
- `PARTIAL` — some verified information reaches the renderer, but not enough for the complete planned UI.
- `NOT EXPOSED` — exists in a server-side result or projection but is not part of the renderer-facing DTO.
- `CE2 ONLY` — exists inside Context Engine v2 investigation state and is not currently exposed through the Composer boundary.
- `DERIVABLE` — can be deterministically computed from already exposed stable data without inventing semantics.
- `DO NOT DERIVE` — the UI must not synthesize this value from proxies, heuristics, similarity, file size, timestamps, or presentation needs.

## Current data path

The active Context Composer data path is:

```text
Context Engine v2
    ↓
InvestigationRunnerResult
    ↓
ContextProjectionResult
    ↓
server/src/contextEngineV2/composer/contextComposerEngine.ts
    ↓
ContextComposerEngineView
    ↓
server/src/contextComposer/contextComposerService.ts
    ↓
POST /api/context-composer/preview
    ↓
apps/desktop/renderer/src/api/client.ts
    ↓
ContextComposerPreview
    ↓
ContextComposerPage / ContextComposerEnginePanel
```

`ContextComposerEngineView` is the current renderer-safe presentation boundary
for Context Engine data.

## Audited source surfaces

Primary server-side sources:

- `server/src/contextComposer/contextComposerService.ts`
- `server/src/routes/contextComposer.ts`
- `server/src/contextEngineV2/composer/contextComposerEngine.ts`
- `server/src/contextEngineV2/composer/composerTypes.ts`
- `server/src/contextEngineV2/application/projectionTypes.ts`
- `server/src/contextEngineV2/application/investigationRunnerTypes.ts`
- `server/src/contextEngineV2/application/strictRelationshipChain.ts`
- `server/src/contextEngineV2/application/sourceIdentity.ts`
- `server/src/contextEngineV2/contracts/evidence.ts`
- `server/src/contextEngineV2/contracts/facts.ts`
- `server/src/contextEngineV2/contracts/investigation.ts`
- `server/src/contextEngineV2/contracts/operations.ts`
- `server/src/contextEngineV2/contracts/projection.ts`
- `server/src/contextEngineV2/contracts/repository.ts`

Primary renderer sources:

- `apps/desktop/renderer/src/api/client.ts`
- `apps/desktop/renderer/src/types/index.ts`
- `apps/desktop/renderer/src/pages/ContextComposerPage.tsx`
- `apps/desktop/renderer/src/components/contextComposer/ContextComposerEnginePanel.tsx`
- `apps/desktop/renderer/src/components/contextComposer/ContextComposerUiSemantics.ts`

Additional relevant surfaces:

- `apps/desktop/renderer/src/utils/taskPackQuality.ts`
- `server/src/performance/performanceTrace.ts`
- `server/src/git/gitTypes.ts`
- `server/src/routes/taskPacks.ts`

## Renderer data matrix

| Planned UI datum | Status | Current evidence |
| --- | --- | --- |
| Explicit target | `AVAILABLE` | Structured target metadata and provenance are present in Task Understanding / structured intent. |
| File path | `AVAILABLE` | Present in selected files and Context Engine file views. |
| File role | `AVAILABLE` | `target`, `test`, `supporting`, `reference`. |
| File usage | `AVAILABLE` | `inspect-and-edit`, `inspect-only`, `asset-reference`, `config-reference`. |
| Source mode | `AVAILABLE` | `legacy`, `v2`, `manual`. |
| Review required | `AVAILABLE` | Boolean per Context Engine file. |
| Engine reason | `AVAILABLE` | Stable `reasonCode` and `reasonCodes[]`. |
| Finding IDs | `AVAILABLE` | Present per projected file. |
| Evidence IDs | `AVAILABLE` | Present per projected file. |
| Evidence role | `AVAILABLE` | `supports`, `contradicts`, `context_only`. |
| Evidence strength | `AVAILABLE` | `lead`, `corroborating`, `substantial`, `conclusive`. |
| Evidence predicate | `AVAILABLE` | Deterministic fact/relation predicate when present. |
| Evidence relation kind | `AVAILABLE` | `fact` or `relation` when present. |
| Evidence source path | `AVAILABLE` | Relative repository path when source span exists. |
| Evidence line range | `AVAILABLE` | `startLine` and `endLine` when source span exists. |
| Composer engine status | `AVAILABLE` | `legacy`, `v2_ready`, `v2_review_required`, `legacy_fallback`, `safety_blocked`. |
| Effective engine source | `AVAILABLE` | `legacy` or `v2`. |
| Stop reason | `AVAILABLE` | Context Engine investigation stop reason is projected into the Composer view. |
| Fallback reason | `AVAILABLE` | Stable Context Composer engine reason code. |
| Engine limitations | `AVAILABLE` | Stable reason-code list. |
| Legacy / v2 comparison | `AVAILABLE` | Exact editable overlap and disagreement summary is exposed. |
| Context selection quality | `AVAILABLE` | `ready`, `warning`, `blocked`, plus warnings, blocking reasons and review requirement. |
| Selector abstention | `AVAILABLE` | Selector diagnostics expose abstention code, message and next actions where applicable. |
| Inventory totals | `AVAILABLE` | Total/scanned files and truncation state. |
| File size | `AVAILABLE` | `sizeBytes` is present. |
| Safe snippet content | `AVAILABLE` | Bounded safe text snippets are already exposed. |
| Git dirty state | `AVAILABLE` | Existing Git status contracts expose current working tree state. |
| Git changed files | `AVAILABLE` | Existing Git status/diff contracts expose changed paths and change kind. |
| Git diff totals | `AVAILABLE` | File/addition/deletion totals exist. |
| Unresolved question category | `AVAILABLE` | Context Engine view exposes category. |
| Unresolved question status | `AVAILABLE` | Context Engine view exposes status. |
| Full unresolved question text | `NOT EXPOSED` | The runner contains the text, but the Composer view exposes only category and status. |
| Finding statement | `NOT EXPOSED` | CE2 findings contain statements, but the renderer receives only finding IDs. |
| Finding authorization hint | `NOT EXPOSED` | `eligible`, `review_required`, `not_eligible` exists internally. |
| Evidence summary text | `NOT EXPOSED` | Present in `EvidenceRecord`, omitted from renderer DTO. |
| Evidence freshness | `NOT EXPOSED` | Snapshot/current/freshness reason exists internally. |
| Evidence limitations | `NOT EXPOSED` | Present on evidence records but omitted from Composer evidence view. |
| Full source identity proof | `PARTIAL` | `source_identity` can reach the renderer as an evidence predicate, but the complete identity proof is not projected. |
| Investigation questions | `PARTIAL` | Category/status exposed; detailed question data remains internal. |
| Claim graph | `CE2 ONLY` | Claims, statuses and derivation are retained in InvestigationRunnerResult. |
| Hypotheses | `CE2 ONLY` | Hypothesis state and history remain internal. |
| Contradiction details | `CE2 ONLY` | Severity, status and evidence references remain internal. |
| Knowledge gap details | `CE2 ONLY` | Gap question, blockers, related entities and suggested operations remain internal. |
| Investigation coverage | `CE2 ONLY` | Questions, hypotheses, files, relationship hops and blocked scopes are retained internally. |
| Investigation budget state | `CE2 ONLY` | Budget, actual usage and exhausted limits remain internal. |
| Investigation operation log | `CE2 ONLY` | Operation type, reason, status, timestamps, cost and produced records remain internal. |
| Investigation trace | `CE2 ONLY` | Planner rounds, question updates, gap evaluation, operations and stop checks remain internal. |
| Repository entities | `CE2 ONLY` | Stable entities exist internally but are not exposed by ContextComposerEngineView. |
| Raw repository relation facts | `CE2 ONLY` | Relation facts contain subject, predicate and object. |
| Strict relationship chains | `CE2 ONLY` | Context Engine can build deterministic bounded relation chains. |
| Context Map graph edges | `NOT EXPOSED` | Renderer does not receive enough subject/object identity to render verified graph edges. |
| Context token cost | `DO NOT DERIVE` | File bytes, snippet chars or prompt chars are not an authoritative context token budget. |
| File relevance score for CE2 | `DO NOT DERIVE` | No renderer-safe deterministic CE2 relevance score exists. |
| Decorative confidence score | `DO NOT DERIVE` | UI must not synthesize confidence from evidence count, reason codes or file rank. |
| Task A → Task B selected-file diff | `DERIVABLE` | Two stable ContextComposerPreview results can be compared by normalized file identity. |
| Task A → Task B role/reason diff | `DERIVABLE` | Stable role/reason-code changes can be compared between previews. |
| Complete explanation of Task Diff | `PARTIAL` | Current reason/evidence data can explain some changes, but not the entire internal investigation transition. |
| Repository rescan delta | `NOT EXPOSED` | Current Git state exists, but no canonical previous scan snapshot delta is exposed to renderer. |
| Task Pack staleness | `DO NOT DERIVE` | Created/updated timestamps or Git dirty state alone do not prove a Task Pack is stale. |
| Existing Task Pack quality | `AVAILABLE` | Current renderer utility provides heuristic Task Pack quality checks. |
| Grounded Task Pack health | `PARTIAL` | Diagnostics exist, but repository freshness/staleness proof is incomplete. |
| AI prompt token diagnostics | `PARTIAL` | Provider-reported prompt/response token diagnostics exist for traced AI calls, but this is not equivalent to Composer context budget. |

## Explainability readiness

The current renderer contract is already sufficient for an initial
Explainability Lens and Persistent Inspector.

A projected file can currently expose:

```text
path
role
usage
reviewRequired
reasonCode
reasonCodes[]
findingIds[]
evidenceIds[]
evidence[]
```

Each evidence item may contain:

```text
evidenceId
role
strength
predicate
relationKind
path
startLine
endLine
reasonCode
```

This is sufficient to truthfully show:

- why a file is present;
- whether it is a target, test, supporting or reference file;
- whether it is editable or inspect-only;
- whether review is required;
- what stable engine reason codes support the decision;
- which evidence supports or contradicts it;
- which source file and line range produced available evidence.

The UI must not transform these fields into invented numerical certainty.

## Investigation Timeline readiness

Context Engine already records enough internal information for a deterministic
Investigation Timeline.

Internal runner state contains:

- questions;
- hypotheses;
- findings;
- knowledge gaps;
- evidence;
- coverage;
- budget state;
- operation records;
- trace events;
- stop decision.

Operation records include:

- operation type;
- reason;
- question/hypothesis references;
- status;
- start/completion timestamps;
- actual cost;
- produced entities;
- produced facts;
- produced evidence;
- safe error details.

Trace events include deterministic events such as:

- plan creation;
- proposal synthesis;
- question updates;
- gap evaluation;
- domain evaluation;
- operation selection;
- operation completion;
- atomic commit;
- stop checks.

However, these records are not currently exposed through
`ContextComposerEngineView`.

Timeline therefore requires a bounded read-only renderer projection before UI
implementation.

This does not require changing CE2 investigation semantics.

## Context Map readiness

Context Engine internally represents deterministic relation facts as:

```text
subject
  ↓
predicate
  ↓
object
```

`RepositoryRelation` contains:

- subject entity;
- relation predicate;
- object entity;
- source location;
- extraction provenance;
- strength;
- status.

Context Engine also contains deterministic strict bounded relationship-chain
logic.

The current renderer DTO does not expose the relation subject and object
identities required for a truthful graph.

Therefore the UI must not currently infer edges from:

- file co-selection;
- filename similarity;
- directory proximity;
- shared keywords;
- evidence counts;
- selector ranking;
- semantic similarity.

A Visual Context Map requires a dedicated read-only graph projection from
verified repository entities and active relation facts.

## Context Diff readiness

Two classes of diff must remain separate.

### Engine comparison

Already `AVAILABLE` through the current Context Engine comparison DTO:

- exact editable paths;
- legacy-only editable paths;
- v2-only editable paths;
- safe-block agreement;
- explicit-target disagreements.

### Task A → Task B Context Diff

`DERIVABLE` from two stable preview contracts for:

- added/removed files;
- changed context role;
- changed usage;
- changed review requirement;
- changed reason codes;
- changed evidence IDs.

The UI must not claim a causal explanation unless the corresponding stable
reason/evidence information is available.

## Context Budget

Do not present a synthetic token budget based on:

- file size;
- snippet character count;
- total selected file bytes;
- prompt character count.

Provider performance diagnostics may contain real prompt token counts for AI
calls, but those values describe observed provider requests and are not a
general Context Composer token budget.

Until a dedicated authoritative context-budget contract exists, Context Budget
must use only truthful native units such as:

- file count;
- snippet count;
- bytes where appropriate.

## Task Pack Health

The existing product has multiple useful signals:

- Task Pack quality checks;
- selector diagnostics;
- generation diagnostics;
- performance diagnostics;
- current Git status/diff data.

These signals are not yet sufficient to prove that a stored Task Pack is stale
relative to a newer repository snapshot.

The UI must not equate:

```text
Task Pack timestamp < latest Git activity
```

with:

```text
Task Pack is stale
```

A future stale-state indicator requires a stable repository/context identity
stored with the Task Pack or another deterministic freshness contract.

## Recommended implementation order after this audit

### Phase B — Navigation Foundation

Implement navigation infrastructure before adding multiple new deep-inspection
surfaces.

### Phase C — Persistent Inspector

Can use current renderer contracts without CE2 semantic changes.

Initial Inspector can safely expose:

- file path;
- role;
- usage;
- review state;
- reason codes;
- evidence;
- source path/line ranges.

### Phase D1 — Explainability Lens v1

Can be built from current renderer-facing data.

No new confidence or relevance metric is required.

### Phase D2 — Read-only Explainability Projection

Before Investigation Timeline, expose only the minimum already-existing,
verified information required from:

- findings;
- evidence freshness/limitations;
- unresolved question text;
- investigation coverage;
- operation records;
- trace events.

This must be presentation-only and must not change Context Engine semantics.

### Phase D3 — Investigation Timeline

Build only from the bounded read-only projection.

### Phase E — Visual Context Map

Before implementation, expose a verified graph DTO containing enough stable
identity to represent real relation edges:

```text
subjectEntityId
predicate
objectEntityId
source path/span
fact/evidence identity
```

No graph edge may be invented in the renderer.

## Final audit conclusions

1. `Persistent Inspector` is implementable with the current renderer contract.
2. `Explainability Lens v1` is implementable with the current renderer contract.
3. `Context Diff` has an immediately usable deterministic subset.
4. `Investigation Timeline` requires a read-only presentation projection, not new CE2 semantics.
5. `Visual Context Map` requires a verified graph projection before implementation.
6. Context token cost must not be synthesized from bytes/chars.
7. CE2 relevance/confidence scores must not be invented for presentation.
8. Task Pack staleness is not currently provable from timestamps or Git dirty state alone.
9. Existing CE2 investigation state already contains substantially more grounded information than the current UI exposes.
10. The recommended `v0.7.1-alpha` strategy is to expose existing verified information incrementally rather than resume semantic engineering.

## Next task

`UI-NAV-01 — Navigation History Foundation`

Before implementation, audit the current desktop navigation state model,
titlebar navigation wiring, Global Search transitions, Dashboard nested views,
and any existing state restoration behavior.

No CE2 changes are required.
