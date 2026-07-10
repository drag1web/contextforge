# Selector Benchmark

The selector benchmark is the measurement foundation for a future retrieval-first ContextForge pipeline. It does not replace production Task Pack selection in v0.6.2.0.

## Pipelines

- **Legacy** runs the current `selectTaskFiles` implementation and remains the production default.
- **Shadow** runs deterministic inventory retrieval, assigns stable candidate IDs, and applies a constrained deterministic ranking contract.
- A future model ranker may select only candidate IDs supplied by retrieval. Unknown IDs are rejected and never converted into filesystem paths.

## Dataset

The initial dataset contains synthetic architecture fixtures for React, Express, libraries, build/config projects, review-only UI work, and missing explicit targets. Cases are grouped by task family and split into `development`, `regression`, and `validation`.

All paraphrases in one family must remain in the same split. This prevents a wording variant in validation from leaking a development family into the holdout set.

The initial corpus is intentionally small. It measures known routing and safety behavior but does not prove production-level accuracy across all languages, frameworks, or live models.

## Metrics

Reports keep separate metrics for primary target accuracy, support recall/precision, forbidden selection/edit rates, role accuracy, safety, missing targets, manual review, implementation area, candidate recall, candidate-set size, empty/unsafe selection rates, and confidence buckets. A weighted score is also reported, with safety failures weighted more heavily than optional support misses.

## Commands

```bash
npm run benchmark:selector -w @contextforge/server
npm run benchmark:selector -w @contextforge/server -- --split regression
npm run benchmark:selector -w @contextforge/server -- --family reg-readme-general
npm run benchmark:selector -w @contextforge/server -- --live
npm run test:selector:benchmark -w @contextforge/server
```

Deterministic mode is the default and does not require Ollama. `--live` uses the configured provider through the legacy selector, is model-dependent, and is not a required CI check.

Generated JSON and Markdown reports are written to `reports/selector-benchmark/`, which is gitignored. Reports contain fixture-relative paths and metrics, not local absolute paths, file contents, secrets, or raw model responses.

## Local Projects

Copy `selector-benchmark.projects.example.json` to `selector-benchmark.projects.json` and provide local project entries. The real manifest is gitignored. An enabled project with a missing path is reported as skipped rather than passed or treated as a fatal error. Optional case files use the benchmark case schema and are validated before execution.

## Current Limits

- Shadow retrieval is not the production default.
- Confidence is measured in buckets but is not statistically calibrated.
- The semantic graph is a lightweight import/path heuristic, not a TypeScript compiler graph.
- Live Ollama results vary by model and require manual evaluation.
- The current selector monolith still needs a later bounded split after benchmark baselines are stable.

## Benchmark correctness hardening

The first shadow report exposed an important distinction between **candidate recall** and **selection quality**. A case can retrieve the correct file while still selecting too many editable files. The benchmark therefore now:

- evaluates `AnyOf` expectations as one alternative group instead of counting every alternative as mandatory;
- includes optional-support groups in candidate recall;
- reports edit-target precision, unexpected edit-target rate, and average unexpected edit targets;
- supports strict per-case edit scopes and selected-file budgets;
- labels the weighted number as an **assertion pass score**, not real-world selector accuracy;
- labels legacy and shadow failures separately in Markdown reports.

Constrained ranking also caps role escalation. A model cannot promote an `inspect-only`, `config-reference`, or asset candidate to an editable role without retrieval evidence permitting that role. Unknown candidate IDs remain rejected.

`--live` currently makes only the legacy pipeline live. The shadow pipeline remains deterministic, and reports expose the two pipeline modes separately to avoid implying that Ollama ranked shadow candidates.

Synthetic fixtures are not enough on their own. Benchmark smoke coverage now includes inventory produced by the real scanner, including `.smoke.*` / `.replay.*` test recognition and exclusion of generated selector benchmark reports from retrieval.

## Real-project routing hardening

The v0.6.2.2 shadow pass distinguishes implementation tests from test-data wording, keeps review-only page tasks in the UI area, preserves explicit backend+UI work as full-stack, and ranks candidates by primary identity, graph support, and reference role. Generic role-only files are no longer automatically promoted to edit targets.

The deterministic candidate limit is intentionally tighter, but validated explicit targets remain mandatory. Small multilingual aliases are limited to generic technical concepts such as home/landing, mapping/dictionaries, settings, and storage/database; they are not project-specific routing rules.

A clean synthetic report is not a production accuracy claim. Always compare it with the real-project manifest report, especially primary-target accuracy, edit-target precision, candidate-set maximum, and critical/high failures.
