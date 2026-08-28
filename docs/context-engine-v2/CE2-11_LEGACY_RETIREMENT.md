# CE2-11 Legacy Retirement Readiness

## Status and authority boundary

CE2-11 code implements a closed, opt-in `primary` Task Pack mode. In that mode,
Context Engine v2 is the only automatic repository-grounding authority. The
legacy selector is evaluated lazily only after an allowlisted infrastructure
failure (`capacity_exhausted`, `execution_timeout`, or `execution_error`).
Semantic uncertainty never invokes a legacy winner.

The persisted default remains `disabled`. Formal legacy retirement is not
approved by this code checkpoint. The roadmap still requires an external
canary/primary observation window without critical regressions, an approved
fallback-rate threshold, a documented real-project unsupported/fallback-case
inventory, a verified rollback/archive checkpoint, and explicit human rollout
approval before the global default changes. Those external rollout artifacts
are not present in this worktree. Consequently:

> Primary authority is code-ready for external retirement validation inside
> opt-in primary mode; formal legacy retirement remains externally gated and
> the global default remains legacy pending rollout approval.

No automatic setting migration is performed. `primary -> disabled`,
`primary -> shadow`, and `primary -> canary` take effect on the next request.

## Retirement matrix

| Component | Current callers | Authority before CE2-11 | V2 replacement | Disabled | Shadow | Canary | Rollback | Test/benchmark | Authority retirement | Source removal | Blocking reason if retained |
|---|---|---|---|---:|---:|---:|---:|---:|---|---|---|
| Automatic legacy Task Pack selector | Task Pack route | Production winner for every request; canary baseline | Deterministic Task Pack primary service plus grounded proof and production revalidation | yes | yes | yes | yes, lazy | yes | retired in `primary` | no | supported modes and typed rollback still require it |
| Legacy selection diagnostics | Task Pack route/settings history | Described effective legacy selection | Repository-effective diagnostics in `primary`; original diagnostics elsewhere | yes | yes | yes | yes | yes | retired in `primary` | no | baseline and rollback observability |
| Legacy selector scoring/ranking | selector orchestrator | Chose automatic winner | CE2 deterministic investigation/projection in `primary` | yes | baseline | canary baseline | yes | benchmark | retired in `primary` | no | disabled/shadow/canary/rollback/benchmark |
| Legacy Composer automatic ranking | Composer service | Effective in `legacy`, comparison baseline in `shadow_compare`, transient fallback in `v2_primary` | Composer v2 execution/projection | n/a | diagnostic baseline | n/a | transient only | yes | retired for semantic outcomes in `v2_primary` | no | explicit `legacy`, `shadow_compare`, and infrastructure rollback |
| Composer `legacy` mode | Composer settings/service | Explicit production mode | `v2_primary` after independent Composer adoption gate | n/a | n/a | n/a | yes | yes | not globally retired | no | roadmap approval/default migration is external; manual selection remains independent |
| Shadow legacy baseline | CE2-07 shadow | Comparison-only baseline | no replacement intended | n/a | yes | n/a | n/a | yes | not an effective winner | no | required for shadow comparison |
| Canary legacy baseline | CE2-09 canary | Baseline/fallback; effective outside cohort/ineligible | CE2 primary mode for proven replacements | n/a | n/a | yes | yes | yes | not retired in canary | no | canary semantics and rollback contract are frozen |
| Legacy compatibility adapter | shadow/canary/Composer/primary | Projection-to-TaskFileSelection compatibility boundary, not ranking authority | retained one-way typed mapping boundary | n/a | yes | yes | n/a | yes | never a winner in primary | no | stable mapping and trace validation still required |
| Legacy inventory adapter | live CE2 canonical input | Converts the single scanner inventory to a RepositorySnapshot | retained adapter boundary | yes | yes | yes | yes | yes | not a selection authority | no | scanner snapshot reuse; prevents a second scan |
| Old grounding helpers outside `server/src/selection` | Task Understanding, quality, authorization | Product safety and downstream proof checks | reused as monotonic production guards | yes | yes | yes | yes | yes | not retired | no | they are safety/authorization boundaries, not competing selector winners |
| Legacy selection cache assumptions | prompt/refinement cache | Cache key derived from effective selected path/usage and context | unchanged effective-selection-derived identity | yes | yes | yes | yes | yes | retired as a hidden primary input | no | cache mechanism is shared production infrastructure |
| Legacy manual-review/abstention semantics | diagnostics/UI/product block | Effective for legacy selections | repository-effective diagnostics and safe no-selection in primary | yes | yes | yes | yes | yes | retired as authority in `primary` | no | still correct for retained legacy modes |
| Manual selected file paths | Composer and Task Pack request | Explicit user authority | no replacement; intentionally retained | yes | yes | yes | yes | yes | not legacy grounding | no | user authority is a product invariant |

## Retired authority

Inside `contextEngineMode=primary`:

- legacy scoring/ranking does not execute before a v2 decision;
- a legacy score, confidence, reason, or candidate cannot override v2;
- semantic ambiguity, contradictions, insufficient evidence, mandatory gaps,
  unsafe paths, and negative constraints produce review/clarification/safe
  failure without legacy substitution;
- automatic selections are either the complete validated v2 mapping, the
  complete typed infrastructure rollback selection, or no automatic
  selection;
- Task Pack primary always assembles the live runtime with
  `plannerMode=deterministic`.

## Retained legacy

Legacy code remains solely for explicit supported roles:

- `disabled` production authority;
- `shadow` comparison baseline;
- `canary` baseline and fallback;
- closed primary infrastructure rollback;
- the one-way projection compatibility mapping;
- historical selector tests and benchmark.

No new product feature should depend on legacy selector scoring.

## Not yet physically removed

`server/src/selection` and the legacy selector implementation are not removed.
Physical deletion would break supported disabled/shadow/canary/rollback modes
and the historical benchmark. Removing them requires the formal roadmap's
external rollout observation and explicit approval, followed by a separate
documented migration that first removes those supported roles.

## Code-readiness gate

The offline retirement gate consumes verdicts derived from 60 actual
deterministic engine executions across 27 generic repository fixture shapes;
fixtures prescribe expectations, not verdicts or safety booleans. The gate
reports separate verdict totals and separately requires zero:

- critical failures;
- unsafe automatic adoptions;
- negative-constraint violations;
- secret/generated/unreadable editable selections;
- silent hybrid selections;
- Task Pack model-planner uses;
- deterministic replay failures;
- unsafe ambiguity outcomes;
- unsupported grounded roles.

Synthetic/generic fixtures are offline evidence only. No private GameHub,
License Monitor, ROI Calculator, or Metall project manifest was found or run as
part of CE2-11, so this document does not claim a private cross-project gate.
