# Patch B0.2 — Role-qualified reference precedence

## Scope

This patch closes the remaining mixed-task safety conflict discovered by the
Patch B0.1 external gate:

- an explicit create target remains `create-and-edit`;
- its explicit render/wiring consumer remains editable;
- a separately named file qualified as `type/API reference`, `API-contract
  reference`, `source of facts`, or `source of truth` remains inspect-only;
- the generic explicit-path/create inference cannot promote that reference
  file into the final authorization set.

## Runtime change

`explicitFileMentions.ts` now recognizes English role-qualified reference
phrases with:

- optional articles (`a`, `an`, `the`);
- slash/dot/plus/hyphen qualifiers such as `type/API`;
- up to four qualifier tokens before `reference`;
- article-qualified `source of facts` / `source of truth` wording.

The final authorization authority already treats `artifact-reference` as a
monotonic protection. The parser correction therefore downgrades the file to
`inspect-only` and removes it from `authorizedTargets` without changing the
valid create and render targets.

## Regression coverage

- safety preconditions smoke: 18 -> 22 scenarios;
- execution authorization authority smoke: 9 -> 11 scenarios;
- exact mixed create/render/reference cases from License Monitor and Metall
  Perm are covered;
- additional generic API-contract and source-of-truth variants are covered.

## Non-goals

- no coverage-contract expansion;
- no ownership/ranking changes;
- no project-name, project-ID, or repository-path checks in runtime logic;
- no new dependencies.
