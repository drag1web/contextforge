# External Retirement Validation

This CLI runs the existing deterministic production-compatible Context Engine
primary boundary against private local repositories. It is an observation
harness, not a resolver, a rollout switch, or a legacy comparison authority.

## Run

Copy the generic manifest outside tracked source and replace the project roots:

```powershell
Copy-Item docs/context-engine-v2/external-retirement-manifest.example.json `
  .contextforge-validation/private-projects.json

npm run validate:context-engine-v2:external -w @contextforge/server -- `
  --manifest ../.contextforge-validation/private-projects.json `
  --output ../.contextforge-validation/out
```

Optional repeatable filters are `--project <id>` and `--case <id>`. The harness
scans each selected project once, constructs the canonical snapshot through the
production inventory adapter, and runs every case twice through deterministic
primary execution, projection, grounded proof, and production downstream
validation. Missing project directories are reported as `not_run`; they are
never claimed as passing.

Manifest files are decoded as strict UTF-8 JSON. A single optional UTF-8 BOM is
accepted for compatibility with Windows PowerShell 5.1 `Set-Content -Encoding
UTF8`; malformed JSON and unsupported encodings still fail closed.

## Manifest and expectations

The versioned manifest is closed and fails on accessors, unknown fields,
duplicate project/case IDs, non-absolute private roots, unsupported schema
versions, or malformed relative paths. Cases contain expectations rather than
prescribed verdicts. `PASS`, `ACCEPTABLE`, `SAFE_FAIL`, `CRITICAL_FAIL`, and
`ENGINE_ERROR` are derived from the observed production result and replay.

Default raw cases cannot supply execution-authority overrides. The harness
derives effective task area, structured targets, target provenance, and
protected scopes from the same deterministic production Task Intent fallback
used with the raw task, requested task type, and active project inventory. It
then applies the production `groundTaskCurrentState` step before reading those
fields and entering bounded primary preparation.
`requiredPaths` and `forbiddenPaths` are evaluator expectations only. A path has
`user_confirmed` provenance only when the raw task actually names and grounds it.
Canonicalization passes through `prepareBoundedTaskPackCanaryInput` under the
primary request deadline before primary execution.

Private manifests and generated observations belong under
`.contextforge-validation/`, which is ignored by Git. Project names and paths
are data supplied to the harness; they are never compiled into engine rules.

## Portable observation report

Each run atomically writes `results.json` and `report.md` per artifact. Reports
now use observation schema `2`. The previous closed schema `1` validator and
renderer remain available for historical artifacts; schema `2` is additive at
the artifact level and does not reinterpret schema `1` fields.

Schema `2` separates run, engine, manifest, repository, case, determinism,
performance, and fallback identities. Its run ID is derived from the complete
observation identity (timestamp, ContextForge/CE2 identity, normalized manifest
hash, repository snapshot fingerprints, case fingerprints, and configuration),
not from verdict data.

The manifest hash removes one optional UTF-8 BOM and normalizes CRLF or CR
newlines to LF before SHA-256. Repository Git HEAD and clean/dirty state are
reported separately from the CE2 inventory/snapshot fingerprints. The latter
come from the actual canonical input consumed by CE2, so a dirty working tree
cannot be represented as the clean commit alone. The CE2 source fingerprint is
a SHA-256 digest over the current local production CE2 TypeScript/JSON source
tree (test fixtures excluded). A separate fingerprint covers the external
observation harness/report modules. Only the digests are serialized.

Reports contain portable project/case IDs, normalized repository-relative
selected paths, statuses, allowlisted reason codes, counters, hashes, roles,
proof classes, authorization paths, timings, and derived verdicts. They exclude
absolute roots, task text, source contents, prompts, exception messages,
environment values, credentials, and secrets.

Metrics include verdict totals; grounded applied and safe-no-selection counts;
clarification/review counts; primary infrastructure rollback-eligible outcomes
and reason-specific rates;
semantic legacy fallback; unsafe adoption; negative-constraint violations;
deterministic replay failures; unsupported grounded roles; and critical
disagreements.

Per-case observation now also preserves projected and applied file roles/usages,
grounded proof-class counts, exact downstream edit authorization, first/replay
bounded operation counters, preparation/execution/decision timings, and stable
result identities. For each completed case it also serializes the canonical
task, clarification, inventory, snapshot, and configuration fingerprints from
both the first and replay CE2 decisions. The aggregate report calls replay
evidence `same_process_same_snapshot` only when all five first/replay execution
fingerprints are exactly equal and the result identities match. Result equality
alone is insufficient. The validator recomputes these relationships and fails
closed when a serialized boolean disagrees. This establishes neither
cross-process determinism nor a cold/warm performance classification.

ContextForge Git, production CE2 source, and observation-tooling provenance is
sampled once near the beginning of every harness invocation, before target
repository scanning and case execution. It is not cached for the lifetime of
the Node process, so a later invocation resolves a fresh run identity. The CE2
execution identities are taken directly from the two decisions already
produced by each case; observation fingerprinting performs no additional reads
of target-repository source contents. Git HEAD and working-tree cleanliness are
queried separately from the canonical CE2 inventory/snapshot identity.

Contradiction cardinality, search-operation counts, and unique read/parse file
counts are currently `null` with an explicit unavailable reason because those
details are not exposed at the external primary boundary. The report does not
infer them from reason codes or coarse counters.

The harness observes the primary decision's closed rollback eligibility and
reason. It does not independently invoke or validate the legacy selector; the
CE2-11 production integration suite covers lazy legacy invocation. Any selected
project/case that is unavailable or cannot be scanned is `not_run`, adds the
`incomplete_execution` blocker, and makes the CLI exit non-zero.

Fallback terminology is deliberately split: infrastructure rollback, semantic
Legacy fallback, Legacy selector invocation, Legacy selector `usedFallback`,
and Legacy-comparison eligibility are separate fields. Because this harness
does not invoke Legacy, invocation count is `0`, while selector fallback rate
and comparison eligibility are `null`/unavailable rather than a fabricated
`0%`.

Hard safety readiness requires zero critical failures, engine errors, unsafe
automatic adoption, negative-constraint violations, semantic legacy fallback,
replay mismatch, and unsupported grounded roles. The 85% acceptable-or-better
value from the validation model remains a proposed threshold. The fallback-rate
threshold is manifest-configurable observation metadata and is not enforced
until human approval.

The CLI summary reports hard-safety status, execution completeness, the observed
acceptable-or-better rate, and that the quality threshold is not evaluated.
Exit code `0` means only that the currently approved hard safety gates passed;
it does not mean that retirement quality, fallback-rate, observation-window, or
human-approval gates have been accepted.
