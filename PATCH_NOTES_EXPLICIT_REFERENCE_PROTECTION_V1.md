# ContextForge — Explicit Reference Protection v1

## Purpose

Closes the focused SCG-08 authorization defect where an explicitly named existing file could be promoted to `inspect-and-edit` even though the user said it was reference-only and must not be modified.

## Root cause

Literal-path resolution treated a path following neutral wording such as `demonstrated in <path>` as an edit target before evaluating the following protection clause. In addition, a full path followed by a sentence-ending period could fall back to its basename during mention extraction.

## Changes

- Explicit `reference only`, `only as reference`, `read-only`, Russian reference/example-only wording, and Ukrainian reference/example-only wording are treated as non-editable file mentions.
- A following protection clause now outranks the generic `in <file>` mutation heuristic.
- Protected paths remain eligible for grounded supporting-context selection as `inspect-only`.
- Sentence-ending periods no longer truncate slash-based path extraction.
- Selector cache marker updated to `2026-07-21.explicit-reference-protection-v1`.
- Supporting Context smoke expanded from 6 to 9 scenarios.
- Canonical Core smoke expanded from 9 to 10 scenarios and now asserts that a model-preserved `user_confirmed` path still cannot bypass the raw user reference-only constraint.

## Safety invariant

`reference-only / do not modify` > literal path edit inference > model target provenance > supporting-context ranking.

A protected reference path may be selected for evidence, but it cannot appear in `authorizedTargets`.

## Local verification

Passed:

- Supporting Context Grounding — 9 scenarios
- Canonical Core Decision — 10 scenarios
- Task File Selector
- Selector Pipeline Rollout — 32 scenarios
- Task Execution Contract — 21 scenarios
- Context Quality — 6 scenarios
- Source Symbol Syntax — 8 scenarios
- Task Understanding — 46 scenarios
- Investigation Trace — 25 scenarios
- Repository Semantic Index — 19 scenarios
- Shadow benchmark — 54/54, 100% primary, 97.9% edit precision, 0 Shadow failures

Clarification/generation/build remain to be confirmed in the user's complete dependency environment; the isolated workspace does not contain the full npm dependency tree.
