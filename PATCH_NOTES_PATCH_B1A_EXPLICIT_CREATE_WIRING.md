# Patch B1A — Explicit Create + Wiring Verifier

## Base

- Expected base commit: `a9916b9`
- Intended branch: `fix/patch-b1a-explicit-create-wiring`

## Scope

This patch deliberately implements only the smallest coverage contract:

- an explicit missing create destination named as a real path;
- an explicit existing wiring destination named in the same task;
- final selection must retain the create target as `create-and-edit`;
- final selection must retain the wiring target as `inspect-and-edit`.

If the narrow contract is proven but incomplete, execution is downgraded to
`investigation` and implementation authorization is cleared.

## Non-goals

B1A does not:

- infer full-stack layers;
- infer state owners;
- infer helper consumers;
- change task area;
- change candidate ranking;
- add or replace selected files;
- promote or downgrade individual usages when the contract is complete;
- interpret a filename without a directory as a synthetic create destination;
- treat protected/reference-only files as wiring targets.

## Architecture

The verifier runs after canonical selection has already produced its decision.
It only verifies the final selection and can veto incomplete explicit
create-plus-wiring authorization. A complete or non-applicable result leaves the
existing selector behavior unchanged.

## Added diagnostics

`diagnostics.explicitCreateWiringCoverage` contains:

- `status`: `not-applicable`, `complete`, or `incomplete`;
- proven requirements;
- concrete coverage gaps;
- human-readable reasons.

## Tests

- New isolated smoke: 8 scenarios.
- New real selector integration scenario: explicit create target plus absent
  explicitly named wiring target must remain investigative.
- Existing create-route-plus-registration selector scenario remains the positive
  integration control.

## Runtime static policy

No project names, validation IDs, or project-specific production paths are used
in runtime logic.
