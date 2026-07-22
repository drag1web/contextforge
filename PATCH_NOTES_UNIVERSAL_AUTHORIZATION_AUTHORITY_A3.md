# Patch A.3 — Qualified Reference Protection Recovery

Baseline: current `fix/universal-authorization-authority` branch after Patch A.2.

## Scope

This patch closes the last focused Authorization Gate regression without expanding into coverage or ownership work.

The deterministic file-mention classifier now recognizes role-qualified reference-only wording directly from the raw user task, including forms such as:

- `only as a consumer reference`;
- `only as an API contract reference`;
- `as a provider reference only`;
- existing `only as reference` / `reference providers only` forms.

A path covered by this wording is classified as protected evidence before literal-target authorization. Therefore upstream model variance cannot promote it to `inspect-and-edit` when `protectedScopes` is missing or incomplete.

## Resulting contract

For a bounded task such as:

- edit `src/lib/translationsExtra.ts`;
- use `src/components/game/GameDetailsPage.tsx` only as a consumer reference;
- do not modify that component;

the final result is:

- translation owner: `inspect-and-edit`;
- consumer: `inspect-only`;
- `authorizedTargets`: translation owner only;
- execution mode remains `implementation`.

Patch A.2 symbol-conflict behavior is preserved:

- parser-backed destination conflict remains `investigation`;
- source owner remains `inspect-only` evidence;
- `authorizedTargets` remains empty.

## Runtime design

The runtime change is generic and phrase/role based. It contains no project names, case IDs, repository-specific branches or hard-coded production paths. Concrete paths appear only in smoke-test fixtures.

## Regression coverage

- direct file-mention classification for role-qualified consumer references;
- canonical pipeline with intentionally incorrect upstream `primaryTargets` and empty `protectedScopes`;
- final authorization authority downgrading a protected consumer even when an earlier contract authorized it;
- all previous authorization, rename, selector, rollout, understanding, generation, investigation, ownership and build suites.
