# ContextForge v0.8 — CE2 Real-World Validation Protocol & Quality Decision Gate

> Work order: `CE2-RW-01A`
>
> Repository baseline: `main` at `199d1814f259180b706e1b63708561edd0bd18e1`
>
> Basis: completed `CE2-RW-00` read-only discovery; independent review precedes the next work order.
>
> Scope: benchmark methodology and roadmap dependency only. No corpus, runner, benchmark execution, CE2 change, or release-quality measurement is delivered here.

## Evidence and authority vocabulary

- **CURRENT FACT** — behavior evidenced at the repository baseline or a limitation recorded by CE2-RW-00.
- **PROTOCOL REQUIREMENT** — a mandatory condition for the future evaluation and its quality decision.
- **PROPOSED TARGET** — a candidate numerical target, not an achieved result or an approved release threshold.
- **NOT YET AVAILABLE** — a measurement, artifact, approval, or implementation that must be supplied by a later work order.

Paths below are repository-relative. Existing validation documents retain their own historical scope. A passing component smoke, a protocol check, or a sealed synthetic golden does not establish real-world human-task quality.

## 1. Background and motivation

Task Pack lifecycle and external-boundary work establishes stable aggregate/revision identities. Bounded work splitting in TP-LC-08 will rely on meaningful owner discovery and guarded edit scope, not merely on valid persistence or transport contracts. Before increasing the amount of work derived from a human request, ContextForge needs an independent measurement of that request's interpretation, file ownership, supporting context, and authorization.

**CURRENT FACT.** CE2-RW-00 completed discovery, not a 60-case evaluation. It found usable production CE2 components and validation assets, but no existing harness with demonstrated full parity for the automatic human-task Task Pack preparation path. Quality on the new blind corpus is **unmeasured**.

**PROTOCOL REQUIREMENT.** After TP-LC-07 closure and before TP-LC-08 starts, a CE2 Real-World Quality Decision Gate is mandatory. TP-LC-08 and TP-LC-09 retain their existing content and ordering. This additional prerequisite neither revises historical milestone outcomes nor certifies TP-LC-07 closure.

This protocol extends, rather than replaces, [CE-06 Validation and Quality Model](../context-engine-v2/CE-06_Validation_and_Quality_Model.md). It does not commit to preserving today's selection architecture or to starting CE3. Measurement must inform an explicit accept, repair, redesign, or hold decision.

## 2. CE2-RW-00 findings and production/harness parity

### 2.1 Production authority

The automatic human-task path identified in RW-00 is:

```text
TaskPackBuilderPage::runUnderstandingPreflight
  -> api.understandTaskPack -> POST /api/task-packs/understand
  -> analyzeTaskIntent / understanding snapshot resolution
  -> applyTaskClarificationsToUnderstanding -> groundTaskCurrentState
  -> interaction policy: continue / review / clarify
  -> Dashboard / useDashboardController create or materialize dispatch
  -> routes/taskPacks::prepareTaskPackWithPipeline
  -> primary mode: runLiveTaskPackPrimary
     -> taskPackPrimaryService::executeLiveTaskPackPrimaryInvestigation
     -> createLiveContextEngineExecution -> createInvestigationRunner
     -> file-backed facts, graph, deriveImplementationOwnerProofs, stop policy
     -> context projection -> validateTaskPackPrimaryCandidate
     -> applyTaskPackPrimaryProductionResolution
  -> final context-quality and execution-authorization gates
  -> context/memory/rules/template/refinement preparation
  -> createGeneratedTaskPack or materializeDraft [WRITES; excluded from runner]
```

Source anchors are `apps/desktop/renderer/src/pages/TaskPackBuilderPage.tsx`, `apps/desktop/renderer/src/hooks/useDashboardController.ts`, `server/src/routes/taskPacks.ts`, `server/src/contextEngineV2/retirement/taskPackPrimaryService.ts`, and `server/src/contextEngineV2/facade/liveContextEngineRuntime.ts`. The CE2 compatibility projection maps a DTO; its Legacy name does not mean that it executes the Legacy selector.

**CURRENT FACT.** Task Pack `contextEngineMode` defaults to `disabled`; Composer has its own mode and defaults to `legacy`. Task Pack primary explicitly uses a deterministic CE2 planner. Upstream model-backed Task Understanding is a separate configuration axis. RW-00 did not read the user's main database settings, so their actual mode is unknown. A report must establish mode from execution, not infer it from the product or harness name.

**CURRENT FACT.** `prepareTaskPackWithPipeline` can enqueue/persist diagnostics before aggregate creation. Calling it while omitting the final create is therefore not sufficient proof of zero database writes. Grounding current shortcut/config values is also not equivalent to universal owner discovery. Evidence-backed findings still need an independent semantic owner oracle.

### 2.2 Harness comparison

Parity below concerns the full human-task primary preparation path, not whether a harness's own tests pass.

| Existing asset | What it actually exercises | Parity and reuse limit |
|---|---|---|
| [External Retirement Validation](../context-engine-v2/EXTERNAL_RETIREMENT_VALIDATION.md); `server/src/commands/contextEngineExternalRetirementHarness.ts` | Live inventory/read/extract/graph, actual primary service/projection, production candidate validation callback, two same-process runs | **PARTIAL.** Best primary-selection starting point; deterministic intent fallback rather than full understanding/review/clarification flow; no outer final preparation or Task Pack creation |
| [Validation Lab](../VALIDATION_LAB.md) | Understanding API followed by Composer preview; supplied clarifications/review acceptance | **PARTIAL.** Composer mode is not Task Pack primary; preview and its private local export are not a portable primary trace |
| [Selector benchmark](../SELECTOR_BENCHMARK.md); `server/src/selection/benchmark/benchmarkRunner.ts` | Legacy selection and older candidate-retrieval/ranking Shadow flow | **FAIL for CE2 human-task parity.** Reuse family/split/role/lock ideas, not the engine result as CE2 evidence |
| `server/src/contextEngineV2/validation/` and `testing/` | Core contracts, real runner through trusted executor ports, structured inputs, fixtures/goldens, metrics | **PARTIAL.** Useful mechanical regression infrastructure; supplied explicit targets may bypass natural-language discovery; no full product adoption chain |
| CE2 canary/shadow and safety smokes | Rollout containment, compatibility, authorization and explicit-target invariants | Regression prerequisites, not an independent human-task corpus or semantic oracle |

RW-00 recorded bounded scanner/inventory behavior and metadata-derived snapshot identity, not a cryptographic seal of all source bytes. Same-process replay alone does not prove cross-process determinism. External report schema 2 supplies useful sanitized roles, authority, fingerprints, budgets, and timings, but some search/unique-read/contradiction metrics are unavailable. Raw internal investigation results can contain private semantic/source content and must not be exported wholesale.

Other scoring limitations remain explicit: a hard-safety exit code is not an 85% quality decision; core measured denominators can omit NOT_RUN; a one-run replay can be vacuously equivalent; required-target precision is not authorized-edit precision. Validation Lab's snippet removal does not remove all task text or local paths. Historical selector documentation must not be used to guess current CE2 settings.

## 3. Scope and non-goals

**PROTOCOL REQUIREMENT.** Evaluate human intent and read-only context preparation using project-agnostic production functions. UI, backend, and monorepo tasks use the same execution mechanism; architecture-specific evidence belongs in the oracle, not in runtime ranking rules.

This work order delivers this document and a compact lifecycle-roadmap dependency note only. It does not create the 60 cases, choose/download projects, implement a runner, execute a benchmark, change benchmarks/locks, or tune CE2.

Future evaluation also excludes production create/materialize, project edits, Git mutations, automatic shell/script execution, source uploads, dependency installation, Task Pack lifecycle/review writes, and TP-LC-08/09 implementation. Generated instructions are not executed. Persisted Task Pack quality, generated-document quality, and live-provider output quality must not be claimed when their stages are outside the declared profile.

Known regression and blind evaluation complement existing validation; neither silently replaces its gates. Runner or observer changes require a separate bounded implementation order, not a selection/ranking/stop-policy rewrite disguised as test infrastructure.

## 4. Human-task corpus design

The target first blind batch is **60 cases**, with mutually exclusive primary categories:

| Category | Count |
|---|---:|
| UI/localization | 10 |
| Existing behavior bugfix | 10 |
| Small feature | 10 |
| Backend/API/storage | 8 |
| Refactoring | 8 |
| Cross-layer | 6 |
| Investigation | 4 |
| Negative constraints | 4 |
| **Total** | **60** |

Secondary tags may overlap; a case still occupies exactly one primary-category slot. Record language, repository architecture, ambiguity, naturally named file, and single/cross-layer scope as strata. No category, repository, or difficult case may be dropped after observing results to improve a score.

Use at least **three independent real JS/TS projects with differing architectures**, such as UI, API/storage, and full-stack/workspace structures. Repository owners must authorize local inspection and evaluation before acquisition/use. Record the actual ownership/access permission, license constraints, pinned source, and privacy classification. Do not automatically download unknown repositories, install dependencies, or execute their code. Architecture and repository-size distribution must be approved before sealing; scanner limits are observed, not avoided by silently selecting only easy projects.

Each task must be a natural user request with verifiable grounding in the pinned code. Do not rewrite it as a path/symbol answer key. A naturally named file is legitimate user input, but must be tagged and scored separately from unhinted owner discovery. Unsupported user assumptions, genuine ambiguity, investigations, and negative constraints remain legitimate cases rather than being rewritten into solvable edit requests.

Ordinary user/default task-type and tool choices may accompany the request. Benchmark authors must not inject oracle-derived task types, paths, protected scopes, clarifications, or architecture hints. Human-provided clarification is allowed only as a sealed transcript/policy; score the unaided first result separately from an explicitly assisted continuation.

## 5. Independent oracle and evidence requirements

### 5.1 Required expected-case record

RW-01B must prepare, review, and seal the following for every future case, without executing CE2 on the blind batch:

| Field group | Required content |
|---|---|
| Identity/input | Neutral case ID, task family ID, original task wording, category/strata, repository alias and pinned commit, relevant source-byte seal, normal user inputs |
| Meaning | Expected intent, action, positive/negative scope, readiness/clarification/abstention expectations and their rationale |
| Ownership alternatives | Primary owner and required obligations, or named **complete alternative owner bundles**, each with its own required/allowed edit and inspect/support sets |
| Authority | Required editable files, allowed editable files, required inspect/support files, admissible supporting context, forbidden selected paths, forbidden editable paths |
| Coupled behavior | Cross-layer obligations and expected evidence, including interfaces/state/storage/tests where genuinely required |
| Evidence | Repository-relative file/symbol/line references at the pinned commit, code-based reasoning, uncertainty and conflicting evidence |
| Review | Author/reviewer aliases, actual reviewer model, independence limitations, approval status, human confidence/rationale, approval timestamp and seal digest |

Alternative bundles are not a union that lets incomplete fragments from different solutions pass. Required edit recall and required inspect recall are separate. Inspect/support inclusion never creates edit authority. Investigation cases may correctly require no editable output.

Expected state is assessed against existing code, not synthetic golden answers, CE2's own search/ranking, a future implementation invented by the evaluator, or mere filename plausibility. Confidence in the **oracle** is human-reviewed evidence confidence, not an engine correctness probability.

### 5.2 Reviewer policy

Codex may locate evidence and draft expectations, but is never the sole oracle for non-obvious meaning/ownership. Human approval is mandatory for complex expectations. Independent source verification must be a distinct review activity, separated from initial drafting and preferably performed by a reviewer not involved in CE2 tuning.

Record the actual reviewer model: for example, human author plus independent human reviewer, AI-assisted draft plus human source review, or one human performing separately recorded authoring and review passes. If only one human is available, do **not** claim two independent people. Disclose the reduced independence and uncertainty; the quality decision must consider that limitation. Independent review is not established by assigning two aliases to the same person or by having the same AI approve its own draft.

Unresolved ownership disputes remain `oracle_pending` and block case sealing. Resolve them before execution or replace the case under a documented pre-seal corpus decision. After execution, any oracle correction requires human evidence and a versioned adjudication record. Preserve the original expectation and measurement; a corrected replay cannot silently rewrite the original blind score or become new independent evidence.

## 6. Dataset splitting, novelty and leakage prevention

Maintain two distinct evidence tracks:

- **Known regression:** a small permanent set of disclosed known failures, used only to check non-regression and development. Passing it does not establish fresh quality.
- **Fresh blind evaluation:** previously unused human tasks/families, with expectations sealed before execution and inaccessible to CE2 developers/runner input until the declared evaluation/adjudication stage.

After a material CE2 change, independent reassessment requires a **new blind batch**. Exposed old batches may become development/regression material but must never be counted again as independent quality proof. Routine replay of an unchanged sealed run is reproducibility evidence, not a new blind sample.

**PROTOCOL REQUIREMENTS:**

1. Assign stable task family IDs covering issue/feature lineage, paraphrases, translations, and substantially equivalent owner obligations.
2. Split by whole family. No sibling wording or translated variant may cross development/regression and blind evaluation.
3. Check exact/normalized duplicates, paraphrases, translations, and related issue lineage against a registry of prior corpora. Text hashing assists but does not replace human semantic review.
4. Pin repository commits and relevant source-byte identities; record dirty/untracked state and reject undisclosed drift. Do not rely only on CE2 inventory metadata fingerprints.
5. Seal wording, inputs, oracle, alternatives, reviewer record, evaluation rubric, settings/profile, and pre-approved thresholds before blind execution.
6. Separate runner-visible request/project basis from evaluator-only answers. Family/category/expected status/owner bundles are not engine hints; opaque IDs may be used for logging only.
7. Keep original measurements and manifests immutable with digests. Record every rerun, exclusion, correction, and assisted continuation separately.

If previous private corpus records are unavailable, novelty cannot be asserted globally. State the comparison coverage and unresolved risk; obtain a reviewer-approved novelty decision before running. Known regression runs must not warm blind tasks or expose their answers through caches, logs, file names, or evaluator feedback.

## 7. Execution profiles and parity requirements

### 7.1 Baseline profile

The intended baseline is **Human-task primary, read-only, production-equivalent**. RW-02 must retain real production understanding, clarification/review policy, grounding, live inventory/extraction, CE2 primary owner discovery/projection, and downstream safety/authorization, including outer final gates relevant to the declared preparation scope. Oracle data is unavailable to these functions.

Record the actual ContextForge commit, runtime/tooling identity, engine and planner modes, understanding provider/fallback mode, ordinary task inputs, settings, context-quality policy, scan/snapshot basis, budgets, and cache/review/clarification state for every run. Store only safe settings in portable evidence; credentials and endpoints are not report fields. Provider-backed understanding is a separately authorized, labeled profile, never an automatic upload of private source content.

Production budgets, selection, ranking, and stop policy remain unchanged. At the audited baseline, primary uses 20 operations, 8 file reads, 512000 read bytes, 7 parsed files, 12 relationship hops, 10 planner rounds, concurrency 1, 1500 ms internal and 1750 ms boundary limits. These are baseline facts to verify and record, not evaluation overrides or permanent schema constants. A later production-policy change requires a new sealed configuration and explicit comparison, not a hidden budget increase.

### 7.2 Parity proof and isolation

RW-02 must supply a stage/function parity ledger: production entry point, runner entry point, settings/basis, real or omitted/substituted stage, reason, observable output, and effect on the claim. Replace side-effect dependencies with isolated read-only inputs and non-persisting diagnostic sinks, not alternate algorithms. Prove no main database access/write and no project source write; simply stopping before create/materialize is insufficient.

Do not use Legacy, Composer, or Validation Lab as a hidden substitute for CE2 primary. A production infrastructure-only rollback, if encountered, is recorded as such; its context is not scored as successful CE2 primary discovery. A selected manual scope likewise is not automatic owner discovery. No semantic failure may silently trigger a different selector to obtain a passing case.

Until full declared parity is demonstrated, an External-derived runner must be labeled `deterministic-primary-selection` or another precise partial profile. Missing understanding, outer gates, final assembly, provider stages, or interaction stages must be visible. **Partial parity must never be renamed full end-to-end.** Even complete read-only preparation parity excludes persistence and code execution. If context/template preparation is omitted, no generated Task Pack body-quality claim is allowed.

Run the baseline sequentially with production limits. Compare at least two deterministic runs on the same sealed basis, plus a separate-process replay where supported; qualify cold/warm measurements explicitly. Unsupported replay/profile stages are unavailable, not automatically equivalent. Do not execute repository scripts to establish an oracle or improve discovery.

## 8. Quality metrics and semantic verdicts

### 8.1 Independent measurements

| Metric | Evaluation requirement |
|---|---|
| Intent correctness | Human-approved goal/action/scope/constraints rubric; task-area or text overlap alone is insufficient |
| Primary owner discovery | Correct primary role within an approved complete owner bundle; a path found only as support is not a primary-owner hit |
| Required-edit recall | Required editable obligations satisfied with actual authorization, not just selected paths |
| Required-inspect recall | Required inspect/support obligations satisfied independently from edit permissions |
| Authorized editable-target precision | Authorized targets inside the approved allowed-edit set divided by all authorized targets; separately report forbidden/unsupported authority |
| Supporting-context relevance | Required/allowed/irrelevant inspect context assessed by the oracle; presence is not relevance |
| Cross-layer completeness | All coupled obligations of one admissible bundle satisfied; no mix-and-match partial bundle |
| Unnecessary investigation | Clarification/review/abstention on a sealed solvable task distinguished from necessary uncertainty |
| Correct safe abstention | Expected ambiguity/unsafe scope handled correctly; not used to hide failure on solvable tasks |
| Wrong-context actionability | Wrong/unproven scope presented as ready or edit-authorized, independent of numeric confidence |
| Negative constraints | Forbidden selected and forbidden editable paths/operations measured separately |
| Deterministic replay | Equivalent semantic selection/roles/authority/stop on identical source/settings; timing/transient IDs compared separately |
| Latency and operation budgets | Stage and total latency, read/parse/operation/hop/round usage, timeouts, cold/warm qualification; unavailable values remain null |
| Execution completeness | Every planned case accounted for, including not-run, skipped, timeout, engine error, invalid input, and drift |

Existing core metrics, role assertions, External observations, and safety suites are reusable. Add only a bounded independent semantic evaluator and privacy-safe observations in RW-02; do not automatically replace CE-06 or old schemas. Missing search/contradiction/stage details require explicit unavailable markers, not invented zeros.

Empty precision/recall denominators must be labeled not applicable and retain raw counts; they must not manufacture success. Show macro per-case and per-repository/category results alongside micro obligation counts. Publish planned and completed denominators, per-category/repository failures, and profile coverage, not only one weighted mean.

### 8.2 Verdicts versus execution status

| Semantic verdict | Meaning |
|---|---|
| `PASS` | Approved intent, owner bundle, roles, and constraints satisfied without unsafe authority |
| `ACCEPTABLE` | A pre-approved harmless alternative or bounded deviation under the sealed rubric; not post-hoc leniency |
| `SAFE_FAIL` | Safe but insufficient result on a task expected to be solvable; usefulness failure, not full success |
| `WRONG_CONTEXT` | Wrong/incomplete meaning or owner context without dangerous actionable confidence |
| `DANGEROUS_FALSE_CONFIDENCE` | Wrong, unproven, or forbidden scope presented as ready/edit-authorized; numeric confidence is not required |

Correctly expected investigation/abstention may be PASS/ACCEPTABLE under its frozen rubric. Abstention on a solvable task remains SAFE_FAIL. Legacy role-confidence constants and CE2 readiness are not probabilities of correctness; unavailable CE2 numeric confidence remains unavailable.

Execution statuses are separate, for example `completed`, `not_run`, `skipped`, `timeout`, `engine_error`, `invalid_input`, `source_changed`, or `oracle_pending`. They must not be relabeled semantic success. A completed engine response is not necessarily a PASS, and an unexecuted case has no successful semantic verdict.

Report `(PASS + ACCEPTABLE) / all planned cases` and a separately labeled completed-case ratio, with every verdict/status count visible. SAFE_FAIL on solvable tasks is excluded from the success numerator. Skips/not-run/errors remain in the planned accounting and cannot be removed to inflate quality.

### 8.3 Minimum future result record

RW-02 must record run/profile/protocol/manifest/oracle digests, source/settings identities, case/repository aliases, technical status, actual engine outcome, independent semantic verdict/reason codes, matched owner bundle, selected path roles, authorized targets, metric counts, stop/budget/latency observations, replay qualification, missing stages/metrics, and trace/adjudication references. Sensitive expectation content remains in private custody. A result schema is not implemented by this document.

## 9. Safety, privacy and isolation

ContextForge remains a local-first context workspace, not an autonomous coding agent. Evaluation authorizes read-only inspection only. No create/materialize, database writes, project source writes, Git mutations, automatic dependency/script execution, or external source upload belongs in the runner. Do not weaken explicit-target, secret/unsafe-path, injection, destructive-intent, or authorization guards.

Use isolated project/settings/memory/rules inputs and per-run state; do not toggle the main workspace configuration. Prove source and database non-mutation with before/after identities and side-effect instrumentation; no-op diagnostic persistence must not alter engine decisions. Source/settings drift invalidates the affected run and prevents approval until reconciled.

Private local root maps, task wording, code evidence, and sealed oracle records stay under owner-approved custody outside Git. Portable reports contain aliases, approved relative paths, digests, safe codes/counts, and whitelisted role/authority/operation metadata. Do not dump raw prompts/responses, source snippets, arbitrary facts, secrets/credentials, endpoints, stacks/causes, or absolute local roots. Relative paths/labels also require publication review if sensitive. Missing diagnostics are disclosed rather than filled with private raw data.

Leakage of oracle answers into execution, privacy violations, or isolation failure is an audit failure, not merely a low score. Preserve safe evidence, halt unsafe execution, account for remaining cases explicitly, and require an independent review before a new sealed attempt.

## 10. Baselines, thresholds and quality decision gate

### 10.1 Current status and threshold authority

| Item | Status |
|---|---|
| RW-00 discovery/parity inventory | Completed; not a blind quality measurement |
| Quality of the new 60 human tasks | **NOT YET AVAILABLE** |
| CE-06 historical 85% acceptable-or-better | **PROPOSED TARGET**; neither achieved here nor automatically an active release gate |
| Numerical human-task release thresholds | Require explicit approval **before** the blind run |
| Process/safety conditions in this protocol | Mandatory prerequisites; a numerical score cannot waive them |

RW-01B must obtain a named human approval of the semantic rubric, aggregate/per-category/repository thresholds, allowed deviations, minimum coverage, replay policy, latency/budget criteria, technical-error policy, and reviewer limitations. RW-02 must verify that these measurements are actually available before RW-03 starts. A threshold dependent on unavailable observations must be resolved before sealing, not invented afterward.

The historical 85% may inform that proposal but must not be reported as measured accuracy, statistical generalization, or already approved policy. A 60-case sample is evidence about its approved tasks/profiles, not a guarantee for all projects. Do not calibrate thresholds after seeing blind results. Changes to thresholds or oracle after exposure require a versioned decision and a fresh blind batch for a new independence claim.

Optional Legacy/Composer comparisons are separate, explicitly labeled baselines under unchanged policies. They do not replace primary execution or count toward its score. Known-regression performance is separately reported.

### 10.2 Hard blockers for approval

Any of the following prevents a positive quality decision regardless of averages:

- Unauthorized editable scope or expansion of support/reference files into unproven edit targets.
- Violation of sealed negative constraints.
- Dangerous confident wrong context, including evidence-backed but wrong-for-task editable output.
- Oracle leakage into engine inputs, configuration, cache, or execution decisions.
- Undisclosed substitution/omission of production stages or an unsupported parity claim.
- Unnoticed/unreconciled source or settings drift.
- Incomplete execution without explicit planned-case accounting; skipped/not-run cases counted as successful or hidden.
- Privacy or read-only isolation violations.

The default approval evidence is the full sealed 60-case batch with every case accounted for and the pre-approved execution/coverage policy satisfied. An incomplete run may produce a valid failure report, but is not a complete-batch quality qualification. Explicit accounting does not itself waive pre-approved coverage thresholds.

### 10.3 Decision outcomes

RW-05 records **accept**, **targeted repair**, **scoped redesign**, or **hold** using immutable results, independent adjudication, parity/isolation evidence, reviewer limitations, and pre-approved thresholds. Execution completion and architectural approval are different events. A red result must remain red; no automatic rollout follows a CLI exit code or component smoke.

## 11. Work orders CE2-RW-01 through CE2-RW-06+

| Work order | Boundary and dependency | Completion condition |
|---|---|---|
| **CE2-RW-00 — Discovery** | Existing production/harness inventory, read-only evidence; completed | Source-backed parity and limitations recorded; no quality claim or CE2 changes |
| **CE2-RW-01A — Protocol and roadmap** | Current documentation-only order, based on RW-00 | Protocol and compact prerequisite reviewed; no cases, runner, execution, or code changes |
| **CE2-RW-01B — Corpus/oracle preparation** | Independent review of RW-01A; owner permissions, reviewer model, prior-corpus access | 60 tasks and complete source-backed oracles reviewed/sealed, novelty/splits/custody established, thresholds approved before execution; no blind CE2 run or tuning |
| **CE2-RW-02 — Isolated production-parity runner** | Approved protocol; mechanical fixtures/dev cases only; sealed blind answers remain inaccessible | Real understanding/grounding/primary/downstream functions, explicit parity ledger, no-write isolation, bounded privacy-safe observer/evaluator, complete accounting/replay proven; no selection/ranking/stop-policy changes or blind quality claim |
| **CE2-RW-03 — First blind evaluation** | RW-01B seal and RW-02 parity/isolation acceptance, fixed source/settings/budgets | Full planned ledger and immutable measurements/adjudication; all failures/errors retained; no tuning, oracle rewrite, or budget increase; completion does not imply quality approval |
| **CE2-RW-04 — Failure taxonomy/root-cause analysis** | Immutable RW-03 evidence and reviewer access | Failures traced to understanding, grounding, inventory/search/extraction, proof, projection, authorization, budget, harness, or oracle; ambiguity preserved; no fixes bundled |
| **CE2-RW-05 — Architectural decision** | RW-04 plus independently reviewed quality and safety evidence | Named human accept/repair/redesign/hold decision against approved criteria; no automatic CE3 or architecture-preservation commitment |
| **CE2-RW-06+ — Approved repair/redesign and fresh revalidation** | Explicit RW-05 authorization and separate bounded work orders | Project-agnostic approved changes, frozen safety preserved, exposed cases regression-only, new independently sealed blind batch; quality gate requalified before downstream work |

RW-01B and RW-02 may prepare independent inputs/mechanics without sharing sealed answers. RW-03 depends on **both** completion gates. RW-02 is not permission to run the blind 60 cases, touch the main database, or repair ranking. RW-06+ is not authorized by this document.

## 12. Acceptance criteria and failure handling

RW-01A is acceptable only with the complete protocol, honest RW-00 limitations, explicit proposed-versus-approved threshold status, and a minimal lifecycle-roadmap note. Its validation is repository hygiene and CE2 documentation integrity plus Git scope/diff checks, not runtime quality tests.

Before blind execution, require:

- Owner-approved projects and source pins, the 60-case allocation, reviewed independent oracles, whole-family novelty checks, sealed custody, and pre-approved criteria.
- Demonstrated production-stage parity for the declared profile, real unchanged safety/authorization gates, no main-DB/source writes, and privacy-safe complete result accounting.
- Actual mode/settings/budgets recorded, unavailable stages/metrics identified, replay qualification and error handling tested on non-blind material.

During evaluation, preserve every original measurement. Infrastructure failures, unavailable projects, drift, or pending oracle do not become passes. Halt on privacy/isolation breaches; otherwise retain failure rows and follow the pre-approved execution policy. No silent retries until a case passes: each attempt/reason stays visible, and only the pre-sealed scoring policy determines which attempt is evaluated.

After evaluation, independently adjudicate disputed results without hiding uncertainty. Distinguish an engine defect from a harness mismatch, invalid oracle, or source drift. Report per-stage root cause and technical/semantic status separately. Do not fix CE2 during RW-03/04/05 or relabel SAFE_FAIL to reach a target. Maintainer approval of the architecture decision and, when needed, fresh revalidation are required before closing the gate.

## 13. Dependencies and blockers

**NOT YET AVAILABLE:** the approved real repositories/commits, owner permissions, sealed 60-task oracle, actual reviewers/custody, complete prior-corpus registry, and approved quantitative criteria. RW-00 did not inspect private prior manifests or establish global novelty. These are RW-01B dependencies, not reasons to invent answers.

RW-02 must resolve the missing full human-task read-only preparation adapter, diagnostic side effects, final-gate parity, and observation gaps without changing selection semantics. Main-workspace settings/provider availability are unknown and must not be guessed. If actual understanding stages cannot be reproduced safely, document the partial profile and hold the intended full-parity claim.

Scanner bounds, metadata-only snapshot fingerprints, model/provider nondeterminism, same-process-only replay, oracle subjectivity, limited reviewer independence, small sample size, and uneven repository coverage are known threats to validity. Freeze source bytes/configuration independently, publish stratum results and uncertainty, and do not select away failures. Neither component goldens nor a model's self-assessment removes these limitations.

Existing TP-LC-07 closure evidence remains its own prerequisite. This protocol does not certify that gate, change external-boundary semantics, or reopen completed lifecycle work.

## 14. Conditions for resuming TP-LC-08

TP-LC-08 may resume only after:

1. TP-LC-07 has been independently closed under its existing gate.
2. RW-01A/RW-01B methodology, oracle, novelty, reviewer model, and pre-execution thresholds have been approved.
3. RW-02 parity, safety, privacy, and isolation are accepted for the declared profile.
4. RW-03 measurements and RW-04 analysis are complete, independently reviewed, and satisfy coverage/accounting policy.
5. RW-05 records a positive quality decision with no hard blockers and criteria met. If repair/redesign is required, approved RW-06+ work and a fresh blind revalidation must first requalify the gate.
6. A maintainer explicitly authorizes the next bounded TP-LC-08 work order.

TP-LC-09 continues to follow its existing dependencies and remains behind this decision gate. Its output/diff linkage scope and TP-LC-08 splitting scope are unchanged. Until the gate is qualified, the correct outcome is hold, not a promise to keep today's architecture or a premature start of CE3, TP-LC-08, or TP-LC-09.

---

**Current stopping point:** CE2-RW-01A documentation and audit only. Independent review is next; CE2-RW-01B, CE2-RW-02, benchmark execution, and downstream implementation require separate work orders.
