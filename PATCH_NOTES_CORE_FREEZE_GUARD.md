# Core Freeze Guard

Date: 2026-07-23
Base: post-B1A stable core (`a9916b9` plus the committed B1A branch state supplied by the user)

## Scope

This patch is the final negative safety gate before the core feature freeze. It does not add semantic fullstack coverage, infer missing owners, alter ranking, or promote new edit targets.

The guard can only preserve or reduce existing permissions.

## Invariants

1. A file or semantic scope explicitly named as reference-only or protected in natural language cannot remain editable.
2. If upstream selection proposes editing such a protected scope, the whole implementation is revoked instead of producing a partial plan that contradicts the user.
3. An explicitly named existing mutation target cannot be silently replaced by another editable file. If the exact target is not authorized, execution becomes investigation.
4. A task that removes an entity while requiring every entity-dependent branch or behavior to remain exactly unchanged is treated as contradictory and becomes investigation.
5. Already-correct bounded exact targets remain authorized.
6. Existing explicit file-reference protection, do-not-create protection, hard safety and B1A create+wiring behavior remain authoritative.

## Supported protected-scope wording

The final guard recognizes project-neutral forms such as:

- `Use CommandPalette only as consumer reference`
- `Do not alter RunDetails`
- `Do not change shared UI components or company data`
- `Use the home page only as consumer reference`
- `layout, forms and API не меняй`

Resolution is inventory-backed and applies to generic file roles, basename/symbol aliases and common repository scopes. Runtime code contains no project names, validation IDs or project-specific paths.

## Validation Lab clarification note

A `preview: null` result after `interaction.action = clarify` is not an API error: the runner intentionally skips preview construction until clarification is resolved. Such a case remains a failed expectation when the manifest expected implementation, but `errors: 0` is technically correct. No artificial error conversion was added.

## Tests

New local smoke:

```text
Core Freeze Guard smoke passed (10 scenarios).
```

Also checked autonomously through transpiled execution:

```text
Execution authorization authority smoke passed (11 scenarios).
Safety preconditions smoke passed (22 scenarios).
```

Full repository regression and build must be run in the user's dependency-complete checkout.
