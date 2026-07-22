# Patch B0.1 — Missing Target / Forbidden Substitution Authority

## Scope

This patch closes one residual Patch B0 safety precondition:

- an explicitly named path is absent from the real inventory;
- the user explicitly forbids creating that path;
- downstream ranking/model output proposes a similar existing file;
- final authorization must revoke the substitute and stop in investigation.

## Runtime changes

- Added an inventory-backed resolver for creation-forbidden missing paths.
- Passed the real project inventory into final execution authorization authority.
- Added a monotonic final guard that clears selected files and edit authorization when the precondition is met.
- Preserved the missing explicit path in rejected-model diagnostics.
- Added a direct manual-review reason explaining why fallback substitution was rejected.

## Required result

```text
executionMode: investigation
selectedFiles: []
authorizedTargets: []
```

A similar existing page/component must not replace the missing named target.

## Regression coverage

- GameHub-shaped missing component / Sidebar substitution fixture.
- License-Monitor-shaped missing page / Dashboard substitution fixture.
- Existing Patch B0 safety and authorization smoke suites remain covered.

## Architecture constraint

No runtime condition refers to a project name, test ID, repository-specific path, or product-specific domain. The guard is based only on explicit path evidence, real inventory state, and the user's negative creation constraint.
