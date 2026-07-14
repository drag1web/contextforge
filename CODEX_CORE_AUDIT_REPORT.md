# ContextForge Core Ownership Audit

Date: 2026-07-13  
Application version: v0.6.7-alpha  
Working branch: `feature/core-owner-discovery-audit`

## 1. Executive summary

The selector already had strong safety, explicit-target, fallback, rollout, and Task Understanding controls, but it did not keep four separate facts separate:

1. a path exists;
2. a path was proposed by the user, clarification, model, or ranking;
3. code evidence shows that the file owns the requested behavior;
4. the evidence is strong enough to edit the file.

This pass adds a request/inventory-scoped repository semantic index and carries structured ownership evidence through candidate retrieval, Legacy/Shadow normalization, the Execution Contract, context quality, and Task Pack refinement. It also adds graph-seed retention and prevents inspect-only files from becoming mandatory edit targets in generated refinement.

The change is deliberately bounded. It is not a TypeScript compiler and it does not claim production-perfect semantic understanding. Deep support remains strongest for TS/JS projects.

## 2. Root causes

### 2.1 Path validity was treated as ownership

`inventory_exact`, model proposal, graph support, and user confirmation were collapsed into one evidence level. A real path could therefore look like a confirmed implementation owner without a declaration, state, route, or reference chain.

### 2.2 The semantic graph represented imports, not behavior ownership

The existing graph was useful for page-to-component and route-to-service support, but it did not index declarations, object properties, assignments, state symbols, translation keys, route registrations, or references. It could find neighbors but not producer/contract/state-owner/consumer/display chains.

### 2.3 Existing implementation detection was lexical

The old implementation search counted task tokens in path/search text. It returned files, not evidence chains, and could not distinguish declaration, serialization, response mapping, or UI consumption.

### 2.4 Graph seeds could be dropped after model normalization

Fallback seeds could introduce useful graph neighbors and then disappear when the model result was normalized. The final selection retained the support files but lost the central state/display candidate that justified them.

### 2.5 Negative constraints were mostly scope guards

Backend/UI protection worked, but semantic exclusions such as "separate from the existing repository integration" did not consistently lower conflicting candidates or force them to reference-only roles.

### 2.6 Quality rebuilt a pre-gate contract

Context quality rebuilt a base Execution Contract from intent and could ignore the final investigation decision produced by the selection evidence gate. This allowed quality/confidence to look stronger than the final implementation permission.

### 2.7 Refinement validated paths, not per-file action roles

A refinement item could name a selected inspect-only file and turn it into a mandatory edit target. Investigation mode was safer, but implementation-mode refinement had no explicit role-consistency rejection.

## 3. Current pipeline map

```text
Task request
  -> Task Understanding / clarification snapshot
  -> projectInventoryScanner (one file-read pass + bounded semantic facts)
  -> selectorPipelineOrchestrator
       -> Legacy selector or Shadow retrieval/ranking/assembly
       -> repositorySemanticIndex (cached per inventory snapshot)
       -> selection evidence and negative-conflict roles
       -> backend path/safety normalization
  -> Execution Contract evidence gate
  -> context quality using the final execution mode
  -> safe snippets and file references
  -> Task Pack refinement policy
  -> final Task Pack
```

Production entry point remains `server/src/routes/taskPacks.ts`. Existing Legacy and Shadow algorithms were not replaced. The new semantic index is a focused evidence layer used by both paths.

## 4. Why earlier patches closed symptoms

Earlier hardening correctly handled invalid JSON, weak fallback, secret paths, prompt injection, missing explicit files, task-area routing, and import relationships. Those controls answered "is this candidate safe/plausible?" but not "which symbol or state chain proves that this file owns the behavior?" Increasing lexical weights or graph boosts could improve one fixture while displacing another because the underlying evidence dimensions were still conflated.

## 5. Chosen architecture

### Scanner semantic facts

The existing scanner read is reused to collect bounded declarations, references, assignments, object properties, state symbols, translation keys/entries, and route paths. No second filesystem pass was added.

### Repository semantic index

`repositorySemanticIndex.ts` builds once per `ProjectInventory` object using a `WeakMap`, then caches query results. It emits:

- target source: user text, clarification, model inference, or ranking;
- path validity: inventory exact, unresolved, or synthetic;
- ownership evidence: exact symbol, reference graph, route graph, state graph, content support, model-only, or rank-only;
- action confidence: inspect-only, inspect-then-edit, or confirmed-edit;
- semantic roles and producer/consumer evidence links;
- negative-constraint conflicts;
- existing implementation paths.

### Execution and refinement consistency

The Execution Contract only treats user-confirmed files or files with structured code ownership evidence as implementation-capable. Add/create requests that match an existing field/metric/state/endpoint are investigation-first. Context quality reads the final execution mode. Refinement rejects mandatory edits to inspect-only/reference files.

### Graph seed retention

`selectionConsistency.ts` retains an editable central seed when selected support files are direct graph neighbors. If it cannot retain the seed because evidence/limits are stronger elsewhere, it records an explicit omission reason.

## 6. Changed and created files

- `server/src/scanner/projectInventoryScanner.ts`
- `server/src/selection/repositorySemanticIndex.ts` (new)
- `server/src/selection/selectionConsistency.ts` (new)
- `server/src/selection/candidateRetrieval.ts`
- `server/src/selection/selectorPipelineOrchestrator.ts`
- `server/src/ollama/taskFileSelector.ts`
- `server/src/taskPacks/taskExecutionContract.ts`
- `server/src/selection/contextQuality.ts`
- `server/src/routes/taskPacks.ts`
- `server/src/ollama/taskPackGenerationReliability.ts`
- `server/src/selection/repositorySemanticIndex.smoke.ts` (new)
- `server/src/ollama/taskFileSelector.smoke.ts`
- `server/package.json`
- `package.json`
- `CODEX_CORE_AUDIT_REPORT.md` (new)

No renderer UI or GitHub feature implementation file was intentionally changed.

## 7. Five audited scenarios

### Sidebar / i18n - fixed

The selector can now trace a visible translation value to its translation contract and from the translation key to the display consumer. The i18n resource is the implementation-capable target; the component using `labelKey`/`t(...)` is inspect-only when the visible text is owned elsewhere. The selector smoke asserts this role split.

### Understanding Snapshot API - fixed at the ownership/gate layer

Exact object properties and references now form producer/consumer evidence chains. An add-field request that matches an existing runtime field triggers existing-implementation review instead of confidently adding a duplicate persisted Snapshot property. The ownership smoke covers this with `understandingSnapshotReused`.

Live Ollama wording normalization was not manually validated in this pass. The chain is found when Task Understanding supplies the exact/near identifier, which is the intended architecture.

### Performance diagnostics - fixed at the evidence-chain layer

An existing timing property such as `modelLoadMs` can now link backend producer/contract files to client/API and UI consumers. The new smoke verifies exact-symbol discovery and a producer-consumer chain. Natural-language RU-to-identifier normalization still depends on Task Understanding search terms; no project-specific translation rule was added.

### Stale cache bugfix - fixed for seed consistency; state inference remains heuristic

Central graph seeds are retained when their selected neighbors depend on them, and an omission receives an explicit reason. State setters/useState/useReducer/store facts can identify state owners. Highly dynamic state hidden behind factories, computed properties, or unparsed aliases can still require investigation.

### GitHub OAuth clarification - improved, not fully solved

Generic negative clauses now penalize semantically conflicting candidates and force them to inspect-only/reference roles. Existing repository integration may remain useful evidence, but it is no longer automatically treated as the new auth owner. Complex negation, long cross-sentence references, and multilingual nuance remain heuristic.

## 8. Regression tests added or strengthened

`repositorySemanticIndex.smoke.ts` covers nine properties:

1. exact symbol producer-consumer evidence chain;
2. model-proposed existing path is not confirmed ownership;
3. exact existing Snapshot response property blocks duplicate implementation;
4. missing required layers force investigation;
5. central graph seed retention;
6. negative constraints lower conflicting candidates;
7. inspect-only refinement cannot become mandatory edit work;
8. investigation refinement removes confident implementation claims;
9. one 235-file index build plus cached query stays within a bounded local limit.

The existing localized-label selector smoke now also asserts ownership evidence and the edit/inspect role split.

## 9. Test and build results

Successful commands in this working tree:

- `npm run test:understanding` - 32 scenarios passed.
- `npm run test:clarification` - 10 scenarios passed.
- `npm run test:handoff` - 6 scenarios passed.
- `npm run test:selector` - passed.
- `npm run test:selector:replay -w @contextforge/server` - 108 cases passed.
- `npm run test:generation:taskpack` - 41 scenarios passed.
- `npm run test:performance` - performance trace 6, snapshot 9, explicit target guard 9; all passed.
- `npm run test:ownership` - 9 scenarios passed.
- `npm run test:selector:rollout` - 32 scenarios passed.
- `npm run test:selector:rollout-ui` - 7 states passed.
- `npm run test:selector:benchmark -w @contextforge/server` - 54 cases across 24 families passed.
- `npm run build -w @contextforge/server` - TypeScript passed.
- `npx tsc -b apps/desktop/renderer/tsconfig.json` - passed.
- `npm run build` - renderer and server passed; Vite reported only the existing large-chunk warning.

The repository does not contain the external manifests/locks required to rerun the private 28-case real regression and 40-case closed validation from this environment. No result is claimed for those packs in this pass, and their expectations/locks were not changed.

## 10. Performance before and after

The supplied pre-change local observations were:

- ranking: approximately 0.15-3.2 seconds;
- shortlist: approximately 0.06-0.36 seconds;
- normalization: usually below 0.1 seconds.

The new isolated 235-file semantic-index smoke measured 6.0-15.0 ms for the first build plus one cached query across repeated runs. A repeated identical query reports zero query work from the request/inventory cache. Existing performance smoke remained green.

This is not an apples-to-apples ranking benchmark: the semantic layer did not exist before, and machine load varies. It demonstrates that the added layer is bounded and does not reread the repository. End-to-end live Ollama latency was not benchmarked manually.

## 11. Known limitations

- The semantic index is regex/metadata based, not a TypeScript compiler or language server.
- Aliased imports, re-exports, computed properties, factory-generated state, and reflection can be missed.
- Natural-language-to-symbol resolution still depends partly on Task Understanding and its recommended search terms.
- Negative-constraint extraction is sentence-local and heuristic.
- `taskFileSelector.ts` remains large. This pass added only a small integration surface there; a later focused split is still warranted.
- Polyglot ownership analysis is not implemented.
- Live Ollama/Gemma behavior for the five exact Russian prompts still needs manual browser testing.

## 12. Risks and possible regressions

- The stricter owner gate can turn previously automatic low-evidence implementation tasks into investigation. This is intentional, but it changes runtime behavior.
- Broad object-property names can create several evidence candidates; action confidence remains inspect-then-edit unless evidence/source is strong.
- Translation ownership works best for static resource objects and literal keys.
- Seed retention uses direct graph relationships and selection limits; deep multi-hop ownership can still need manual review.

## 13. Recommended next step

Run the five exact Russian tasks through live Ollama/Gemma on at least two unrelated TS/JS projects and save sanitized structured outcomes as regression fixtures. If misses cluster around aliases/re-exports, add a focused TypeScript AST adapter behind the same evidence interface rather than expanding keyword dictionaries. After that, split the large selector into prompt IO, Legacy ranking, evidence policy, and diagnostics modules without changing behavior.

## 14. Project-specific hardcode confirmation

No production rule was added for ContextForge, Sidebar, a named benchmark project, `modelLoadMs`, `understandingSnapshotReused`, GitHub OAuth, or any fixture path. Those names appear only in regression fixtures/reporting. Production logic uses generic declarations, references, routes, state, translation indirection, technical owner suffixes, negative clauses, file roles, inventory paths, and graph relationships.

## Review pass

Date: 2026-07-13  
Scope: follow-up review over the first owner-discovery audit on `feature/core-owner-discovery-audit`.

### Review summary

The review confirmed that the first audit pass added the right architectural direction, but several pieces were still too optimistic:

1. real scanner semantic facts were computed but not attached to `ProjectInventoryFile` output;
2. object-property co-occurrence could still look stronger than it really was;
3. `reference_graph` evidence could still contribute too much implementation confidence;
4. required layer coverage mixed candidate presence with confirmed ownership;
5. Russian negative/protected phrases were partly missed because some existing Cyrillic normalization text is mojibake in source;
6. weak graph seeds could be retained without enough ownership evidence;
7. wording in generation reliability still used "data flow", which overstated what the heuristic index proves.

The pass fixed those confirmed issues without adding project-specific production rules. The remaining limitations are now explicitly documented below.

### Confirmed issues and fixes

#### Real inventory semantic facts

Confirmed. `analyzeTextFile()` built semantic facts, but `scanProjectInventory()` did not carry `textAnalysis.semanticFacts` into the returned inventory entry. This meant some evidence tests could pass on synthetic fixtures while production inventory lost the same data.

Fix:

- `server/src/scanner/projectInventoryScanner.ts` now assigns `semanticFacts: textAnalysis.semanticFacts`.
- `extractMatches()` now de-duplicates before bounded head/middle/tail sampling. This keeps the existing limits but reduces late-symbol loss in large files.

Real inventory regression now scans the actual repository and verifies:

- `understandingSnapshotReused` in `server/src/routes/taskPacks.ts`;
- `modelLoadMs` in `server/src/performance/performanceTrace.ts`;
- `modelLoadMs` in the UI consumer;
- state/diagnostics symbols in `TaskPackResultPage.tsx`;
- `labelKey` / `nav.settings` evidence around `Sidebar`.

#### Co-occurrence versus code relationship

Confirmed. The first pass still risked presenting same-name references as a stronger producer/consumer chain than it could prove.

Fix:

- `SemanticEvidenceLink` now carries a `relation` value: `same_file`, `import_graph`, `route_local`, `translation_key`, or `identifier_reference`.
- Cross-file chains are only emitted when an import/route/local graph relationship is present.
- Same identifier in unrelated files remains `identifier_reference` / `content_supported`, not confirmed ownership.
- Generic object properties are no longer treated as declarations for every file. They count as ownership only in contract-like files such as routes, API clients, types, schema/storage, or DB/schema files.

Positive and negative regression tests were added:

- unrelated files with the same object property do not create a chain;
- a declaration/assignment connected to a consumer through an import graph creates a real relationship chain.

#### Candidate coverage versus confirmed coverage

Confirmed. Required layers could be reported as covered through path/role guesses even when ownership evidence was absent.

Fix:

- `TaskExecutionContract` now exposes:
  - `candidateLayerCoverage`;
  - `confirmedLayerCoverage`;
  - `missingConfirmedLayers`.
- Implementation is blocked when required layers are only candidate-covered.
- Confirmed coverage now requires user confirmation or ownership evidence such as `symbol_exact`, `route_graph`, or `state_graph`.
- Storage is not treated as confirmed merely because a path contains `storage`, `db`, `repository`, `schema`, or `migration`; it needs semantic role/evidence.

Regression coverage:

- backend/client/ui present only as role guesses -> investigation;
- one confirmed layer and remaining candidate-only layers -> investigation;
- all required layers confirmed -> implementation allowed.

#### Target source versus path validity

Partially confirmed and now guarded. The type model already had separate dimensions, but the review added regression coverage to keep them independent through the evidence gate.

Expected state is preserved:

```text
targetSource: model_inference
pathValidity: inventory_exact
ownershipEvidence: model_only
actionConfidence: inspect_only
```

Existing path validity no longer promotes a model proposal into confirmed ownership. The current regression covers the core normalization/evidence gate path; a later UI/export smoke should still verify the full renderer diagnostics display.

#### Russian negative constraints

Confirmed. The previous synthetic negative-constraint test used English text. Existing Cyrillic normalization was partly corrupted by source encoding/mojibake and could miss real Russian phrasing.

Fix:

- A small generic Cyrillic overlay was added for task routing and negative/protected phrases.
- It is a normalization layer only, not a project-specific rule.
- Russian negative constraint tests now cover:
  - "Это отдельная авторизация в приложение, не существующее подключение GitHub-репозиториев.";
  - a neutral UI task with "backend не меняй."

Behavior:

- positive auth/login scope can remain candidate context;
- negative repository-connection scope is reference/inspect-only when useful;
- conflicting files do not become confirmed implementation owners;
- protected backend scope is not accidentally converted into a required backend layer.

#### Investigation notes

Confirmed. Some generation guidance still used overconfident wording such as "data flow" even though the index proves code relationships and ownership evidence, not full runtime data flow.

Fix:

- `taskPackGenerationReliability.ts`, `contextQuality.ts`, and `taskExecutionContract.ts` now use "ownership chain" / "code relationships" wording.
- Investigation guidance tells the agent to verify owners before editing.
- Refinement tests assert that inspect-only files do not become mandatory edit targets and investigation mode neutralizes confident implementation instructions.

#### Graph seed retention

Confirmed. A weak model/ranking seed could be retained too easily after adding graph neighbors.

Fix:

- `retainGraphSeeds()` now retains a central seed only when it has user confirmation or strong ownership evidence.
- Weak omitted seeds produce a structured omission reason instead of silently disappearing or becoming confirmed owners.

Regression coverage:

- strong seed with graph evidence is retained;
- weak model-only seed is not promoted;
- omitted seed leaves an explicit reason.

### Refuted or narrowed concerns

#### "Existing paths always become confirmed owners"

Not true after the current pass. Existing inventory paths can still be selected as candidates, but ownership and edit confidence now require separate evidence. Regression tests cover `model_inference + inventory_exact + model_only + inspect_only`.

#### "Storage path equals storage ownership"

Not true after this pass. Storage-like paths remain candidate evidence unless semantic role/evidence confirms the storage layer. If storage access is dynamic and not discoverable by current regex facts, the task should stay in investigation rather than reporting confirmed storage coverage.

#### "The semantic index proves full data flow"

Refuted as a claim and corrected in wording. The code now distinguishes exact ownership, import/route/local graph relationships, translation-key links, and same-identifier references. It does not claim full runtime data flow.

### Validation command

Requested command:

```text
npm run benchmark:selector:validation
```

Actual result:

```text
tsx src/selection/benchmark/benchmarkRunner.ts --split validation --external-only
--external-only requires --manifest.
```

The working tree contains `selector-validation.projects.example.json`, but the required concrete validation manifest/lock/case set referenced in the prompt was not present at the root or under server paths discoverable by `rg --files`. Therefore this external validation pack was not run, and no PASS is claimed for it.

### Legacy heuristic inventory

The review did not add new domain-specific production heuristics. Existing selector heuristics remain grouped as follows.

Generic framework heuristics:

- page/component/style/backend/api/docs/tests role and path routing in `taskFileSelector.ts` and `candidateRetrieval.ts`;
- import graph and route/local graph support in `projectSemanticGraph.ts` and `repositorySemanticIndex.ts`;
- docs/readme, tests/replay/smoke, config/package/env-example treatment.

Domain-oriented but still technical heuristics:

- OAuth/auth/callback/redirect route seed logic;
- home/main/landing page routing;
- localization/i18n path/key handling;
- navigation/header/sidebar/menu routing;
- core selector/safety/fallback/scoring/context-composer/task-pack self-routing.

Project/self-specific compatibility heuristics:

- ContextForge self-development terms route to selector, safety, scanner, context composer, Task Pack builder, and replay/smoke files.
- These should eventually move into a cleaner self-project profile, but they were not expanded in this pass.

Compatibility fallbacks:

- Legacy ranked fallback;
- weak manual suggestions;
- model JSON repair/retry;
- exact explicit target guard;
- manual-review downgrade.

Risk:

- Some legacy heuristics can still occupy shortlist slots before the evidence gate. The gate now downgrades weak/model-only candidates, but a later cleanup should move compatibility heuristics behind semantic evidence retrieval where possible.

### Performance review

Real repository inventory/index smoke result from `npm run test:ownership`:

```text
real inventory semantic scan: files=239; scan=529.3ms; query=162.1ms; cached=0.0ms
repository semantic index smoke passed: 18 scenarios; 235-file build+cached-query 3.1ms
```

Interpretation:

- the full repository scan includes real filesystem reads and scanner work;
- the semantic query runs against the produced inventory, not a second full filesystem pass;
- repeated identical semantic queries are served from request/inventory-scoped cache;
- the isolated synthetic 235-file index remains single-digit milliseconds in the smoke run.

Previous observed baseline from the first report remains:

- ranking: approximately 0.15-3.2 seconds;
- shortlist: approximately 0.06-0.36 seconds;
- normalization: usually below 0.1 seconds.

No performance test regressed in this pass, but live Ollama/Gemma latency and large external repositories still require manual validation.

### New or strengthened tests

`server/src/selection/repositorySemanticIndex.smoke.ts` now covers 18 scenarios, including:

1. real scan-to-semantic-index extraction for current repository files;
2. exact symbol evidence from real inventory;
3. unrelated same-property co-occurrence not becoming a chain;
4. positive import relationship chain;
5. candidate-only layer coverage blocked from implementation;
6. partial confirmed coverage blocked from implementation;
7. full confirmed layer coverage allowed;
8. Russian negative constraint handling;
9. neutral Russian frontend/backend protection;
10. weak graph seed omission reason;
11. strong graph seed retention;
12. inspect-only refinement protection;
13. investigation note sanitization;
14. bounded/cached performance behavior.

Existing replay and selector tests were also kept green.

### Remaining limitations after review

- The semantic index remains a lightweight regex/metadata/index heuristic, not a TypeScript compiler or language server.
- Re-exports, aliases, computed keys, generated state, and framework-specific magic can still require investigation.
- Full renderer/API diagnostics export of `targetSource/pathValidity/ownership/actionConfidence` should get a later dedicated UI/API smoke.
- Existing mojibake in older Cyrillic normalization text should be cleaned in a separate encoding-focused pass; this review added a small correct overlay instead of rewriting the file.
- `taskFileSelector.ts` is still too large and still contains legacy routing compatibility logic.
- Live Ollama/Gemma testing was not performed in this pass.

No commit or push was performed.

## Final corrective pass

### Confirmed fixes

1. Large real source files now get bounded semantic analysis.
   `projectInventoryScanner` still avoids storing full large source text in inventory, but it now analyzes bounded head/middle/tail samples plus targeted semantic extraction from the already-read text. This fixed the real `apps/desktop/renderer/src/i18n/index.ts` case: the file is larger than 80 KB and now has semantic facts, including translation entries for `Settings` and `Настройки`.

2. Model-selected existing paths keep their source identity.
   `normalizeModelSelection` now attaches structured model-only evidence instead of letting path existence look like ownership. The end-to-end selector smoke verifies:
   `targetSource=model_inference`, `pathValidity=inventory_exact`, `ownershipEvidence=model_only`, `actionConfidence=inspect_only`.

3. Candidate and confirmed layer coverage are exported separately.
   Task Pack Assisted Notes now show:
   - Candidate layer coverage;
   - Confirmed layer coverage;
   - Missing confirmed layers;
   - Missing required layers as candidate-level only.
   The old ambiguous `Missing required layers: none` line is no longer emitted for these notes.

4. Selector model notes are sanitized for investigation/clarification modes.
   Categorical model phrases such as `implementation requires`, `must modify`, `should be extended`, `must reside`, `edit this component`, and `fix requires changing` are converted into untrusted hypotheses before they enter `selection.notes` for non-implementation contracts.

5. Noisy token expansion was reduced.
   The short `repo` alias was removed from Russian repository token expansion, duplicate expansion output is de-duplicated, and retrieval now applies negative-constraint conflicts as inspect-only evidence. This prevents repository wording from boosting unrelated report pages through substring matches.

6. Storage evidence remains conservative.
   This pass did not invent semantic-confirmed storage ownership from path names. Storage-like files remain candidate/support evidence unless future code evidence proves real storage access. That limitation is intentional and safer than claiming confirmed ownership from `/storage/` alone.

### Real large-file extraction

Current large text/source files observed during this pass include:

- `server/src/ollama/taskFileSelector.ts` (~404 KB);
- `apps/desktop/renderer/src/pages/TaskPackBuilderPage.tsx` (~156 KB);
- `apps/desktop/renderer/src/i18n/index.ts` (~117 KB);
- `server/src/ollama/taskFileSelector.smoke.ts` (~108 KB);
- `apps/desktop/renderer/src/pages/SettingsPage.tsx` (~107 KB);
- `server/src/ollama/taskFileSelector.replay.ts` (~83 KB).

The scanner still does not keep full large-file contents in inventory. The bounded analysis improves semantic coverage without adding repeated filesystem reads per selector stage. Very late symbols can still be missed if they are outside retained samples and not caught by targeted extraction.

### Target source end-to-end

Added an end-to-end mocked selector smoke in `taskFileSelector.smoke.ts`. It verifies that a model-selected existing path without repository ownership evidence stays `model_inference + inventory_exact + model_only + inspect_only`, and is downgraded to inspect-only rather than becoming a confirmed edit owner.

### Exported layer coverage

Added a generation reliability smoke that builds exported ContextForge Assisted Notes and verifies the new candidate/confirmed/missing-confirmed coverage lines. This protects Task Pack text output, not only internal diagnostics.

### Model-note sanitization

The same selector smoke verifies that a categorical model note is converted to an `Untrusted model hypothesis` in investigation mode and no longer contains categorical edit instructions.

### Validation result

The validation script was updated to use the concrete manifest and validation lock by default:

```text
npm run benchmark:selector:validation -w @contextforge/server -- --manifest ../selector-validation.projects.json --validation-lock ../selector-validation.lock.json --gate standard
```

Actual result:

```text
selector benchmark: 40 cases / 40 families
shadow: 37/40 passed; assertion-score=93.4; primary=100.0%; edit-precision=94.9%
shadow candidate recall: 97.3%
shadow failures: {"critical":0,"high":0,"medium":4,"low":0}
validation lock: verified
validation coverage: 40 cases / 40 families / 4 projects
validation gate: standard: passed
```

The command duplicated CLI args because the npm script now also supplies concrete defaults; the runner accepted them and completed successfully.

### Tests run in the final corrective pass

```text
npm run test:ownership
repository semantic index smoke passed: 19 scenarios; real inventory semantic scan files=239; scan=475.4ms; query=129.8ms; cached=0.0ms

npm run test:selector
taskFileSelector smoke tests passed

npm run test:selector:replay -w @contextforge/server
taskFileSelector replay passed: 108 cases

npm run test:handoff
task execution contract smoke passed: 6 scenarios

npm run test:generation:taskpack
task pack generation reliability smoke passed: 42 scenarios

npm run test:performance
performance trace smoke passed: 6 scenarios
task understanding snapshot smoke passed: 9 scenarios
explicit target guard smoke passed: 9 scenarios

npm run test:understanding
task understanding smoke passed: 32 scenarios

npm run test:clarification
task clarification smoke passed: 10 scenarios

npm run test:selector:rollout
selector pipeline rollout smoke passed: 32 scenarios

npm run test:selector:rollout-ui
selector pipeline presentation smoke passed: 7 states

npm run test:selector:benchmark -w @contextforge/server
selector benchmark smoke passed: 54 cases, 24 families

npm run build
renderer Vite build passed with the existing large chunk warning; server TypeScript build passed
```

### Remaining limitations

- The scanner's bounded large-file analysis is still heuristic; it is not a full parser.
- Storage access evidence remains candidate-only unless future indexing adds real read/write/import relationships.
- Live Ollama/Gemma behavior was not exercised here; mocked selector and deterministic tests passed.
- `taskFileSelector.ts` remains large and should be split later, but this corrective pass deliberately avoided a broad refactor.
- Some old Cyrillic regex literals in legacy files still appear mojibake in terminal output; changing encoding globally is a separate risk-focused task.

No project-specific production hardcodes were added. No UI changes were intentional. No commit or push was performed.
