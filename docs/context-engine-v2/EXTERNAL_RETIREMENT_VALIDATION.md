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

## Manifest and expectations

The versioned manifest is closed and fails on accessors, unknown fields,
duplicate project/case IDs, non-absolute private roots, unsupported schema
versions, or malformed relative paths. Cases contain expectations rather than
prescribed verdicts. `PASS`, `ACCEPTABLE`, `SAFE_FAIL`, `CRITICAL_FAIL`, and
`ENGINE_ERROR` are derived from the observed production result and replay.

Default raw cases cannot supply execution-authority overrides. The harness
derives effective task area, structured targets, target provenance, and
protected scopes from the same deterministic production Task Intent fallback
used with the raw task, requested task type, and active project inventory.
`requiredPaths` and `forbiddenPaths` are evaluator expectations only. A path has
`user_confirmed` provenance only when the raw task actually names and grounds it.
Canonicalization passes through `prepareBoundedTaskPackCanaryInput` under the
primary request deadline before primary execution.

Private manifests and generated observations belong under
`.contextforge-validation/`, which is ignored by Git. Project names and paths
are data supplied to the harness; they are never compiled into engine rules.

## Portable report

Each run atomically writes `results.json` and `report.md` per artifact. Reports
contain portable project/case IDs, normalized repository-relative selected
paths, statuses, allowlisted reason codes, counters, and derived verdicts. They
exclude absolute roots, task text, source contents, prompts, exception messages,
environment values, credentials, and secrets.

Metrics include verdict totals; grounded applied and safe-no-selection counts;
clarification/review counts; primary infrastructure rollback-eligible outcomes
and reason-specific rates;
semantic legacy fallback; unsafe adoption; negative-constraint violations;
deterministic replay failures; unsupported grounded roles; and critical
disagreements.

The harness observes the primary decision's closed rollback eligibility and
reason. It does not independently invoke or validate the legacy selector; the
CE2-11 production integration suite covers lazy legacy invocation. Any selected
project/case that is unavailable or cannot be scanned is `not_run`, adds the
`incomplete_execution` blocker, and makes the CLI exit non-zero.

Hard safety readiness requires zero critical failures, engine errors, unsafe
automatic adoption, negative-constraint violations, semantic legacy fallback,
replay mismatch, and unsupported grounded roles. The 85% acceptable-or-better
value from the validation model remains a proposed threshold. The fallback-rate
threshold is manifest-configurable observation metadata and is not enforced
until human approval.
