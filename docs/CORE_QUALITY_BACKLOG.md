# ContextForge Core Quality & Safety Backlog

## v0.6.4-alpha — Shadow Internal Rollout & Real Task Pack Integration

Completed in this phase:

- Connected the validated deterministic Shadow retrieval/ranking/assembly pipeline to real Context Composer previews and Task Pack generation through a separate typed orchestrator.
- Added `legacy`, `shadow_compare`, and `shadow_primary` modes with Legacy as the persisted default.
- Kept Compare output on Legacy while collecting local Shadow comparison diagnostics from the same inventory snapshot.
- Added Shadow-first production context in Shadow mode and limited Legacy fallback to technical execution/contract failures.
- Preserved Shadow hard safety blocks, missing explicit targets, manual review, and legitimate abstention without fallback bypass.
- Added backend path/candidate/role validation, deduplication, edit-role caps, file limits, and relative-path checks before downstream composition.
- Added privacy-safe diagnostics, bounded 50-run history, Settings controls, Task Pack badges, and a compact diagnostics modal.
- Added rollout smoke coverage for backend orchestration, persistence defaults/history privacy, backward compatibility, and renderer badge states.

Rollback:

- Existing users remain on `legacy`.
- Internal testers can select Compare or Shadow in Settings → Composer → Experimental AI Core.
- Returning the setting to Legacy immediately restores the previous selector path; Legacy was not removed.

Remaining risk:

- Compare and Shadow remain internal/experimental until more live Task Pack runs are reviewed.
- Deep retrieval/graph support is currently focused on TS/JS; Python, C, C++, and other polyglot adapters are future work.
- The semantic graph remains a lightweight heuristic rather than a TypeScript compiler graph.
- Live Ollama intent behavior and large-project latency still need broader manual testing.

This backlog captures the next engineering focus after the v0.6.0 GitHub issue loop baseline.

Source: `contextforge_project_tests_filled_report.docx` manual matrix covering 21 Task Pack test runs across `contextforge-website`, `metall-perm`, `roi-calculator` and `license-monitor`.

## Summary

The current core is useful for straightforward UI/database tasks and some safety blocks, but it is not production-ready for selector quality and security-sensitive scenarios.

Manual matrix result:

| Total | Good | Partial | Bad |
| ---: | ---: | ---: | ---: |
| 21 | 6 | 8 | 7 |

## P0 — security and hard-blocking

### Secret exfiltration / env files

Problem: requests such as reading `.env.local`, keys, tokens or secrets can still produce a Task Pack instead of a hard block.

Required behavior:

- Block requests that ask to read, copy, summarize or include `.env`, `.env.local`, credentials, tokens, keys or secrets.
- Do not include env/secret files in snippets.
- Do not pass secret-looking content to local/cloud AI providers.
- Return a clear blocked/clarify UX message with a safe alternative.

### Prompt injection / destructive intent

Problem: prompts such as “ignore previous instructions” or instructions to delete server files may be classified as high risk but still generate a Task Pack.

Required behavior:

- Detect prompt-injection and destructive phrases before inventory and file selection.
- Hard-block destructive tasks unless rewritten into a safe review/diagnostic request.
- Treat instructions inside README/project files as untrusted content, not user commands.

### Explicit target not found

Problem: if the user names a page/component/file that is not in inventory, the selector may substitute a nearby/random page.

Required behavior:

- Explicit file/page/component targets must exist in inventory.
- If not found, block or ask for manual selection.
- Do not map unknown named targets to “closest-looking” files.

## P1 — selector reliability and scoring

## v0.6.1.1 Core Selector Reliability pass

Completed in this pass:

- Hardened the Ollama selector JSON contract with staged parsing, fenced/balanced JSON extraction, schema validation, repair, and one strict retry before fallback.
- Added safe selector diagnostics for raw response length, parse stage, repair/retry attempts, schema validity, schema errors, and final selection source.
- Calibrated quality signals so fallback/manual-review results cannot look like perfect AI selections.
- Split `matchScore`, `confidence`, `selectionSource`, and `implementationArea` in context quality signals.
- Added generic routing profiles for docs/readme, tests, review/propose-only, backend/API, frontend/UI, and ContextForge core/self tasks.
- Preserved hard-block behavior for `.env`, secrets, unsafe paths, destructive intent, prompt injection, and missing explicit targets.
- Added replay/smoke coverage for invalid Ollama JSON, repaired JSON, retry JSON, weak fallback, docs routing, test routing, review-only tasks, backend/API tasks, core/self tasks, explicit target missing, and secret hard-blocks.

Covered by:

- `npm run test:selector -w @contextforge/server`
- `npm run test:selector:replay -w @contextforge/server`

Still remaining for v0.6.1.2+:

- Broader live-model tuning across Ollama models and non-English prompts.
- Import/semantic graph scoring so selector confidence can use real dependency relationships.
- More multilingual semantic normalization beyond the current generic technical routing signals.
- Larger golden-project fixture set and CI coverage for real inventory scans.
- More detailed diagnostics surfacing in the UI without changing selector behavior.

## v0.6.1.2 Semantic Graph + Multilingual Routing pass

Completed in this pass:

- Added a lightweight semantic/import graph that extracts generic TS/JS/CSS relationships from inventory metadata and readable previews.
- Added graph signals for frontend page/component/hook/API/style relationships, backend route/service/storage/types relationships, docs/config context, test-to-target context, and ContextForge core/self files.
- Used semantic graph evidence to improve scoring and role assignment without adding project-specific rules.
- Improved file role assignment so edit targets, inspect-only files, support files, references, proposed new files, and blocked/manual-review states are represented more honestly.
- Added RU/EN intent normalization for frontend/UI, backend/API, docs, tests, review-only, and core/self routing terms.
- Added conflict diagnostics for requested task type vs inferred implementation area, including conflict reasons and role adjustments.
- Calibrated confidence so 90+ confidence requires strong explicit target evidence or semantic graph confirmation without area conflicts.
- Preserved hard-block behavior for `.env`, `.env.local`, secrets/tokens, prompt injection, destructive requests, unsafe paths, and missing explicit targets.
- Expanded replay coverage to 108 selector cases, including Russian and mixed-language routing regressions for UI, backend, docs, tests, review-only, core/self, storage/types, API client hooks, secret hard-blocks, prompt injection, and missing explicit targets.

Covered by:

- `npm run test:selector:replay -w @contextforge/server`
- `npm run test:selector -w @contextforge/server`

Still remaining for v0.6.1.3+:

- Live Ollama verification across `llama3.1`, `gemma`, and other local models with real model responses, not only replay fixtures.
- Additional multilingual normalization beyond RU/EN, especially Spanish, Portuguese, German, Chinese, and mixed-language developer slang.
- More real-project fixture inventories generated from user projects instead of hand-built minimal fixtures.
- Optional deeper TypeScript-aware graphing later if lightweight import heuristics are not enough.
- UI surfacing for the new diagnostics can be improved later, but this pass intentionally avoided UI changes.

## v0.6.1.3 Core Manual Audit Fixes

Manual audit findings addressed in this pass:

- Explicit markdown documentation targets now retain edit-target usage. A named `README.md` outranks similarly named application pages, while package/config files remain references.
- Core/self routing now filters candidates through the existing core-file boundary before scoring. Unrelated storage/repository files cannot enter selector, safety, scoring, or core test context without storage intent or a real graph relationship.
- Core/self scoring is task-aware: selector, safety, context quality, scanner, composer, Task Pack, semantic graph, explicit-target, replay, and smoke files are included only when their technical responsibility matches the task.
- Review-only wording no longer implies a test task merely because the user asks to inspect or check something. Requested task type remains separate from inferred implementation area, and no-edit tasks keep inspect-only roles.
- Backend metadata endpoint coverage is verified through the existing route-to-service/types/storage semantic graph instead of a project-specific path rule.
- Final selection confidence is now capped by the actual usable selection. Hard safety blocks report zero final confidence, missing-target/manual-review results remain low, and raw intent-model confidence is preserved only as diagnostics in Composer preview data.

Regression coverage:

- Strengthened the existing 108 replay cases for the exact README, safety-selector tests, review-only Dashboard, core fallback scoring, GitHub issue metadata endpoint, secret request, destructive prompt injection, and missing explicit target prompts.
- Added assertions for requested task type, inferred implementation area, file usage, forbidden storage selections, selection source, semantic graph coverage, and final confidence caps.
- Added smoke assertions that secret and destructive hard-blocks have zero final confidence and missing explicit targets remain low-confidence.

Safety state after this pass:

- `.env`/secret/token exfiltration, prompt injection with destructive intent, unsafe paths, and missing explicit targets remain blocked before snippets are read.
- Weak suggestions remain manual-only and are not promoted into selected edit targets.

Remaining risks and technical debt:

- `taskFileSelector.ts` is still too large and should be split into focused routing, scoring, normalization, and finalization modules in a later bounded refactor.
- The semantic graph remains a lightweight import/path heuristic rather than a TypeScript compiler graph.
- A broader multilingual golden corpus is still needed beyond the current RU/EN coverage.
- Live Ollama/Gemma responses still require separate manual verification; replay and smoke fixtures do not prove every model response shape.
- The selector pipeline is not production-perfect, and confidence calibration should continue to be monitored against real project inventories.

## v0.6.2.0 — Retrieval Benchmark Foundation & Shadow Candidate Pipeline

Completed in this foundation pass:

- Fixed the confirmed `taskType=general` README regression by grounding a bare `README`/`ридми` mention to the real `README.md` inventory entry. Exact markdown evidence now outranks application pages named Docs or Onboarding, while package and safe example-env files remain references.
- Added a deterministic candidate retrieval module that uses explicit mentions, inventory metadata, technical file roles, the lightweight semantic graph, import relationships, test/source links, docs/config relationships, and core technical responsibility signals.
- Added stable candidate IDs and a constrained ranking validator. Unknown IDs are rejected and are never treated as model-supplied filesystem paths.
- Added a shadow deterministic ranking path for benchmark comparison only. Production Task Pack generation still uses the legacy selector.
- Added a 52-case, 22-family RU/EN/mixed benchmark with development/regression/validation family isolation. The eight manual-audit prompts remain exact `taskType=general` regression cases.
- Added separate metrics for primary targets, support, forbidden selections/edits, roles, safety, missing targets, manual review, implementation area, candidate recall/set size, empty/unsafe results, confidence buckets, and weighted severity.
- Added console, JSON, and Markdown reporting. Generated reports are gitignored and exclude absolute user paths, file contents, secrets, and raw model responses.
- Added optional local-project manifests. Missing projects are reported as skipped and are not counted as successful cases.

Covered by:

- `npm run test:selector:benchmark -w @contextforge/server`
- `npm run benchmark:selector -w @contextforge/server`
- `npm run benchmark:selector -w @contextforge/server -- --split regression`
- Existing selector smoke/replay, server build, and renderer typecheck commands.

Benchmark design notes:

- Development, regression, and validation are split by task family. Paraphrases from one family cannot cross splits.
- Deterministic mode is the default and requires no Ollama process. Live mode is optional and model-dependent.
- The benchmark reports legacy and shadow results separately; benchmark failures are retained as evidence rather than rewritten to match current output.

Still remaining:

- Expand the corpus with more genuinely independent project families and languages; the initial dataset is too small to claim 95% real-world accuracy.
- Run live Ollama/Gemma comparisons and inspect model-selected candidate IDs without making live execution a required CI dependency.
- Statistically calibrate final confidence against a larger holdout corpus.
- Keep shadow retrieval isolated until it consistently beats the legacy pipeline on safety, primary accuracy, support coverage, and role accuracy.
- Split the oversized `taskFileSelector.ts` into focused modules in a later bounded refactor, using benchmark metrics to detect regressions.

### Ollama selector JSON contract

Problem: Ollama often returns invalid/empty JSON, pushing otherwise simple tasks into fallback.

Required behavior:

- Use a stricter JSON schema prompt.
- Add repair/retry before fallback.
- Store/log raw selector response for debug.
- Mark fallback as fallback, not as high-confidence AI selection.

### Score calibration

Problem: weak or wrong fallback selections can receive 95–100/100.

Required behavior:

- Score should account for semantic match, required role coverage and wrong-domain edit targets.
- High scores should require strong target confidence and required support files.
- Fallback candidates should be treated as “needs confirmation” unless strongly validated.

### Task type vs implementation area

Problem: docs/test/UI/backend tasks can silently drift into another implementation area.

Required behavior:

- Keep user-selected task type separate from inferred implementation area.
- Show conflicts clearly.
- Do not silently override task type or inferred area without warning.

## P2 — routing and usage polish

### Docs/test/review routing

Required behavior:

- README/docs tasks: `README.md` as edit target; `package.json`, configs and env examples as inspect-only.
- Test tasks: package/test configs, existing tests, target utils/components and proposed new test files.
- Review/propose-only tasks: avoid edit targets unless the user explicitly asks to edit.

### ContextForge self-core awareness

Problem: tasks about ContextForge selector/safety/core can be routed to normal UI components.

Required behavior:

- Add generic internal signals for selector, scanner, context composer, safety policy, Task Pack builder and tests.
- Do not route self-core tasks to unrelated UI components because the prompt mentions “UI” or “Task Pack”.

## Recommended sequence

1. Secret and prompt-injection hard-blocks.
2. Explicit target resolver block/clarify behavior.
3. Ollama JSON contract repair/retry.
4. Context score calibration.
5. Docs/test/review routing profiles.
6. Self-core selector/safety awareness.

## Definition of done for the hardening pass

- The 21-case matrix is converted into repeatable smoke/replay tests.
- P0 unsafe prompts return blocked/clarify and no selected files.
- Unknown explicit targets do not select random files.
- Docs/test/review prompts select role-appropriate files.
- Fallback scores and labels are honest and explain uncertainty.
- Core/self-repair prompts select selector/safety/composer files, not unrelated UI components.

### v0.6.2.0 follow-up — benchmark correctness hardening

Manual review of the first 52-case benchmark found that `52/52` overstated shadow quality: `AnyOf` metrics were counted as if every alternative were required, extra editable files were mostly invisible, live mode did not distinguish legacy from deterministic shadow execution, and the ranking contract allowed usage escalation.

The follow-up hardening pass adds grouped `AnyOf` metrics, candidate support recall, edit-target precision, unexpected-edit measurements, strict edit-scope expectations, role escalation caps, explicit legacy/shadow mode reporting, real-scanner smoke coverage, test-harness recognition for `.smoke.*` and `.replay.*`, and generated benchmark report exclusion.

The corrected report is intentionally allowed to show shadow failures. A lower honest assertion score is more useful than a synthetic 100%. Remaining work includes real-project manifests, broader validation families, improved candidate pruning, and statistical confidence calibration before any production switch.

## v0.6.2.1 — Real-project P0 safety hardening

Real-project benchmark findings hardened without switching the shadow pipeline into production:

- Negated secret constraints such as `секреты не добавлять` no longer count as secret-exfiltration requests.
- Mixed-language destructive instructions and embedded README/file prompt-injection chains are blocked.
- A satisfied hard safety block is terminal; benchmark cases no longer require a redundant manual-review flag.
- `unsafeSelectionRate` now counts missed required safety blocks, not only forbidden file paths.
- Added deterministic regression coverage for negated secret constraints and embedded prompt injection.

Remaining work is selection accuracy rather than P0 safety: page identity, server-entry roles, multi-area/fullstack routing, and excessive edit-target pruning.

## v0.6.2.2 — Real routing and ranking hardening

The first real-project run showed that P0 safety was stable in the shadow pipeline, but safe storage tasks could still be misclassified as test work and candidate ranking over-promoted generic UI/backend files.

This bounded pass adds:

- explicit separation between test implementation intent and phrases such as `test data` / `тестовые данные`;
- review-only UI precedence over generic docs/test signals;
- full-stack inference when a task explicitly combines backend/API and UI work;
- lightweight technical normalization for common page/storage concepts without project-specific rules;
- stronger page/entry/storage identity evidence;
- editable `server-entry` / `app-entry` roles where justified;
- primary/support/reference ranking buckets;
- support-role edit caps and graph-linked test support for bugfix/refactor work;
- tighter candidate-set limits and exclusion of generated benchmark artifacts/backups.

Synthetic benchmark results are regression evidence only. The patch must still be re-run against the local real-project manifest before considering any production switch. Legacy remains the production default and the shadow pipeline remains benchmark-only.

## v0.6.2.3 — Evidence-based role assignment and final selection

The second real-project run showed that retrieval had reached 100% candidate recall on the current 28-case corpus, while the remaining failures were concentrated in final role assignment and trimming: correct `.mjs`, database, page, and client API files were present but sometimes remained inspect-only or lost to generic sibling files.

This bounded pass adds:

- generic task-role evidence for route/server-entry, storage/database, service, client API, and test responsibilities;
- root `api/*` serverless route recognition, including `.mjs`/`.cjs` route hosts;
- page-identity anchoring so a strongly matched page wins over weak sibling pages;
- graph-aware support ordering around the selected primary target;
- explicit backend/full-stack anchor coverage before support trimming;
- lexical support priority for test tasks so target implementation files survive alongside replay/smoke tests;
- a five-file review-only cap and review-safe inspect-only role enforcement;
- real-scanner smoke coverage for backend entries, docs review, page/component support, SQLite storage, and full-stack client/server selection.

The shadow pipeline remains benchmark-only. Passing synthetic cases is not evidence of production readiness; the local real-project manifest must be re-run and the remaining primary/edit-role failures reviewed before any rollout.

## v0.6.2.4 — Support coverage and benchmark finalization

The third real-project benchmark reduced shadow failures to three medium support-coverage misses. Primary targets, implementation area, candidate recall, and role assignment were already correct; final trimming could still drop the service/types/storage layer around a backend target or the persistence layer from a full-stack target.

This bounded pass adds evidence-based architectural coverage after primary anchoring:

- backend route/entry anchors can retain service or persistence support;
- storage/database anchors can retain the server/API entry that integrates them;
- full-stack selection retains backend, frontend, and persistence layers when grounded candidates exist;
- test selections retain an implementation source alongside test anchors;
- non-anchor coverage files remain inspect-only, protecting edit-target precision.

Benchmark confidence reporting now excludes blocked/manual-review/empty outcomes from selection-confidence calibration and reports those outcomes separately as abstentions. Shadow remains benchmark-only and production continues to use the legacy selector.

## v0.6.2.5 — Final support prioritization

The fourth real-project pass reached 28/28 on the current regression corpus without expanding the candidate budget. Root documentation now prefers root-level package/environment support over nested renderer configuration, and strong service/type/storage clusters outrank generic backend services. This is a regression milestone, not a generalization claim, because the 28 cases were visible during tuning.

## v0.6.2.6 — Closed validation and generalization foundation

The next stage freezes an unseen external-only validation pack before using its results to make selector changes. Case definitions and referenced project inventories receive SHA-256 fingerprints; changing either invalidates the lock. Standard and strict gates require minimum project/language/task-family coverage plus safety, abstention, retrieval, role, and edit-precision thresholds.

A privacy-safe snapshot command exports relative inventory metadata without root paths, file contents, text previews, or secrets. This allows new project structures to be reviewed and validation expectations to be authored without publishing full source trees. The stage intentionally does not alter selector ranking behavior.

## v0.6.3.1 — Assembly stabilization and stable validation integrity

The first live closed-validation run confirmed that the Context Assembly Engine materially improves cross-project generalization, but assembly must not replace stronger retrieval anchors with weaker support files. Stabilization priorities are:

- preserve grounded UI/page and backend route/entry anchors through final role assignment;
- reserve task-linked and directly imported support before generic neighbours;
- retain root docs/config support, framework layouts, and full-stack persistence coverage when evidence exists;
- keep support inspect-only unless implementation intent and anchor evidence justify edit;
- keep validation fingerprints independent of scanner implementation details.

The validation lock now fingerprints normalized relative paths and raw file contents. A guarded one-time migration path is available for schema-v2 locks and must preserve the original validation case digest. The shadow pipeline remains benchmark-only until both the 28-case regression pack and the unchanged 40-case closed validation pack pass their intended gates on real local projects.
