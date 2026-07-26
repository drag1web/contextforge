# Core Grounding Engineering History

This document preserves the useful engineering conclusions from the temporary root-level audit and patch reports that were removed before the `v0.7.0-alpha` source release.

## Why the corrective work was needed

Earlier selector passes could answer whether a path existed or looked plausible, but they did not always keep these facts separate:

1. a file exists in inventory;
2. a file was proposed by the user, model, clarification, or ranker;
3. repository evidence shows that the file owns the requested behavior;
4. the evidence is strong enough to authorize editing that file.

That conflation allowed path validity, model proposals, and weak graph proximity to look stronger than actual implementation ownership.

## Architecture introduced by the corrective passes

The current pipeline separates task interpretation, inventory, ownership evidence, selection, authorization, and output composition:

```text
Task request
  -> Task Understanding and clarification snapshot
  -> one bounded project inventory scan
  -> deterministic retrieval / Legacy or Shadow selection
  -> repository semantic and ownership evidence
  -> canonical final-selection decision
  -> execution authorization authority
  -> context quality using the final execution mode
  -> safe snippets and file references
  -> guarded Task Pack refinement
  -> final Task Pack
```

The production runtime remains project-agnostic. Regression fixture names and project examples are not used as runtime rules.

## Ownership evidence model

The repository evidence layer distinguishes:

- explicit user targets;
- real inventory paths;
- declarations and identifier references;
- import and re-export relationships;
- route registrations and API boundaries;
- state and data-flow ownership;
- translation key ownership and display consumers;
- storage, service, client, and UI roles;
- negative constraints and protected scopes;
- inspect-only, inspect-then-edit, and confirmed-edit confidence.

A model-proposed existing path is not automatically a confirmed owner. Supporting and reference files remain inspect-only unless the final authorization gate proves otherwise.

## Canonical core and authorization invariants

The corrective series established these invariants:

- missing explicit create targets are preserved as planned create targets rather than replaced by nearby files;
- creation-forbidden targets cannot be substituted;
- role-qualified references keep their intended provider/reference role;
- explicit create-and-wire tasks can authorize the literal create target and the proven wiring owner;
- safety preconditions run before confident implementation;
- subjective, conflicting, conditional, and unproven bug work remains investigation or review;
- final context quality cannot override the execution mode selected by the evidence gate;
- AI refinement cannot turn inspect-only files into mandatory edit targets;
- verification wording must report actual results rather than force success claims.

## Supporting Context Grounding

When a task explicitly asks to reuse an existing route, service, repository, storage API, schema, client, hook, or contract, the final selection may retain one grounded provider/example as supporting context.

The provider reference must:

- match the requested provider kind and task entity;
- respect UI/backend and other scope constraints;
- use real inventory and relationship evidence;
- remain inspect-only;
- never expand `authorizedTargets`;
- exclude unrelated tests, docs, generated files, assets, and broad incidental matches.

This gives a coding agent enough evidence to follow an existing pattern without granting permission to edit that pattern owner.

## Validation position

The public source tree contains deterministic smoke, rollout, ownership, canonical core, context quality, supporting grounding, authorization, safety, explicit create/wiring, investigation, syntax, and synthetic benchmark coverage.

Private real-project manifests, sealed validation locks, machine-specific paths, and generated reports are intentionally excluded from Git. A release must not claim those results unless the maintainer actually ran the required local packs.

## Known limits

- Deep evidence remains strongest for TypeScript/JavaScript repositories.
- The semantic index is bounded repository metadata analysis, not a full compiler or language server.
- Dynamic factories, reflection, computed properties, complex aliases, and deep polyglot ownership may require investigation.
- Natural-language-to-symbol mapping still depends partly on Task Understanding.
- Strict evidence can intentionally turn a previously automatic low-confidence task into review or investigation.

## Historical source notes removed from the root

The following temporary categories were removed during repository cleanup:

- patch file lists;
- patch application notes;
- authorization authority iteration notes;
- core freeze guard notes;
- explicit-reference and supporting-context patch notes;
- UI splash patch notes;
- machine-specific audit reports.

The durable behavior and release history are represented by this document, the current source, smoke tests, and `CHANGELOG.md`.
