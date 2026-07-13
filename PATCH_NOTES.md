# ContextForge Performance Optimization — Snapshot Reuse, Selector Audit & Explicit Target Guard

## Purpose

This patch performs the first measured optimization pass after the baseline audit. It preserves the existing task-understanding, clarification, selector, validation, and Task Pack flow while removing repeated Understanding work and making selector AI cost visible.

## Implemented

- Added a bounded 20-minute in-memory Understanding snapshot store with project/task/clarification/inventory validation.
- Reused the confirmed snapshot during final Task Pack generation and Context Composer analysis.
- Applied exact replacement-value clarification answers locally when the existing snapshot explicitly requested that missing value.
- Kept semantic re-analysis for changed tasks, changed inventories, changed targets, general answers, and unsafe clarification appends.
- Instrumented `file_selection_initial`, `file_selection_repair`, and `file_selection_retry` as real Ollama calls with provider timings and token counts.
- Split selector timing into fallback ranking, initial selection, repair, retry, and normalization stages.
- Added a generic explicit-target guard for named pages, screens, components, routes, and sections.
- Prevented a model `unknown` action from overwriting a backend-grounded action such as `replace`.
- Added explicit selection-origin and guard diagnostics to exported Task Packs.

## Expected live effect

For a normal preflight → Generate flow, generation should reuse the preflight snapshot and perform zero additional Task Understanding calls. For an exact missing-value clarification, the second preflight should also reuse the original snapshot and resolve the answer locally.

The selector still calls Ollama in this patch, but those calls are now fully visible. Repair reduction, prompt compaction, keep-alive, queueing, and resource profiles remain later performance steps.

## Validation in the patch environment

- Performance trace smoke: 6 scenarios.
- Understanding snapshot smoke: 4 scenarios.
- Explicit target guard smoke: 2 scenarios.
- Task Understanding smoke: 27 scenarios.
- Clarification smoke: 9 scenarios.
- Task Pack generation reliability smoke: 36 scenarios.
- Selector smoke: passed.
- Selector rollout smoke: 32 scenarios.
- Selector presentation smoke: 6 states.
- Selector replay: 108 cases.
- Synthetic selector benchmark: 54 cases across 24 families.
- Renderer and server builds: passed.

The maintainer-only real-project regression and sealed validation were not available in the clean patch environment and must be rerun before commit.

---

# ContextForge Performance Diagnostics & AI Call Audit

## Purpose

This diagnostic patch measures the current pipeline before optimization. It does not change selector ranking, clarification policy, or generation semantics.

## Added

- One performance session shared by Task Understanding preflight and final Task Pack generation.
- A request timeline with stage durations.
- Real AI call counters and purposes.
- Ollama load, prompt evaluation, token generation, and token-count metrics when the provider returns them.
- Cold/warm model estimation.
- Inventory scan count and duration.
- Refinement cache hit/miss/bypass events.
- A local Performance diagnostics modal and copyable JSON.

## Privacy

Raw prompts, raw model responses, source snippets, source code, secrets, and absolute paths are not stored.

## Live audit plan

1. Generate the first Task Pack after starting ContextForge.
2. Repeat the exact same task.
3. Generate an incomplete task that requires one clarification.
4. Compare AI call count, model load time, repeated inventory scans, cache behavior, and total observed time.

---

# ContextForge v0.6.7-alpha — Task Understanding & Clarification

## Summary

This release adds a grounded preflight layer before file selection. ContextForge can now distinguish a ready task, a broad interpretation that should be reviewed, and a genuinely incomplete task that requires one focused answer.

## Completed

- Added a universal Task Understanding contract for goal, action, targets, constraints, exact values, missing information, interpretation risk, change definition, confidence, and readiness.
- Added `/api/task-packs/understand` preflight analysis before Analyze Context and Generate Task Pack.
- Added compact clarification and review UI with separate original task and clarification history.
- Added clean clarification grounding so service labels do not contaminate Shadow ranking.
- Added subjective/open-ended review detection for broad visual or qualitative requests.
- Added three locally stored interaction modes in Settings → Generation:
  - **Automatic** — continues review-level tasks and asks only when required information is missing.
  - **Balanced** — recommended; asks for required information and confirms broad/subjective interpretations.
  - **Confirm every task** — displays the interpreted task before every Analyze or Generate action.
- Added a saved-answer checking state so the clarification modal no longer appears to ask the same question twice.
- Hardened manual-verification wording so visual checks report only what was actually performed and observed.

## Safety behavior

- Required values cannot be bypassed in any interaction mode.
- Automatic mode never invents replacement text, colors, URLs, targets, or other user-owned values.
- Original tasks and clarification answers remain separate in stored/exported Task Packs.
- Shadow receives a clean selection task rather than UI-formatted clarification Markdown.

## Verification completed in the source environment

- Task Understanding smoke: 26 scenarios.
- Clarification smoke: 9 scenarios.
- Task Pack generation reliability smoke: 36 scenarios.
- Selector smoke: passed.
- Selector rollout smoke: 32 scenarios.
- Selector presentation smoke: 6 states.
- Legacy replay: 108/108.
- Synthetic selector benchmark: 54 cases across 24 families.
- Server and renderer builds passed.

The private real-project 28-case regression and sealed 40-case validation are not bundled in safe source archives and must be rerun by the maintainer before the release commit.
