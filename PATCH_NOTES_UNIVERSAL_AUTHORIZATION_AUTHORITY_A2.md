# Patch A.2 — Symbol Conflict Evidence Preservation

Baseline: current `fix/universal-authorization-authority` branch after Patch A.1.

## Scope

This patch completes one remaining focused-gate invariant without expanding into coverage or ownership recovery:

- when parser-backed rename proof finds that the destination symbol already exists, the rename remains blocked/investigative;
- editable authorization stays empty;
- the exact parser-backed source declaration owner is retained as `inspect-only` evidence;
- destination declarations, import-graph consumers and fallback-ranked files are not added to the selected context.

## Resulting contract

For a conflict such as `User -> RunRow`:

- `executionMode = investigation`;
- `authorizedTargets = []`;
- source owner `client/src/api.ts` remains selected as `inspect-only`;
- unrelated candidates cannot replace the owner;
- diagnostics record the destination declaration paths and the preserved source-owner evidence.

## Regression coverage

Updated canonical-core and selector smoke assertions verify that:

1. destination conflict never becomes implementation;
2. source owner remains inspect-only;
3. unrelated fallback candidates are absent;
4. missing source symbols still produce an empty investigation;
5. valid parser-backed renames remain editable and unchanged.
