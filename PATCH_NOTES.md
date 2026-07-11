# ContextForge v0.6.6-alpha — Task Pack Generation Reliability

## Summary

This patch hardens final Task Pack generation without changing selector behavior or turning task understanding into project-specific static rules. AI providers return bounded structured refinements; ContextForge validates, filters, compacts, and composes them into the protected Task Pack template.

## Completed

- Replaced full-document AI rewriting with a strict refinement JSON schema.
- Added direct, fenced, balanced, and local-repair parsing plus one controlled retry.
- Added prompt budgeting and response-size limits.
- Added precise provider, parsing, schema, truncation, retry, composition, and semantic-policy fallback reasons.
- Added semantic filtering for unauthorized commit/push/merge/PR/tag/release instructions.
- Rewrites forced verification-success claims into actual-result reporting.
- Rejects references to files outside the selected context.
- Detects generic missing replacement values without rules for specific projects or pages.
- Recognizes explicit replacement values across guillemets, smart/ASCII quotes, assignment syntax, URLs, colors, numbers, versions, and other literal forms.
- Grounds exact user-provided replacement values in the Task Pack without paraphrasing and avoids false clarification when the value is already present.
- Switches blocking ambiguities into a consistent clarification flow across implementation guidance, acceptance criteria, verification, and final response.
- Removes near-duplicate refinement items and applies bounded section limits.
- Adds privacy-safe generation diagnostics with semantic-policy and consistency counters/codes.
- Advances the generation cache contract so older refinement-policy results are not reused.

## Verification completed in the source environment

- Task Pack generation reliability smoke: 35 scenarios.
- Selector rollout smoke: 32 scenarios.
- Selector presentation smoke: 6 states.
- Legacy replay: 108/108.
- Synthetic selector benchmark: 54 cases across 24 families.
- Server and renderer builds passed.

The private real-project 28-case regression and sealed 40-case validation are not bundled in safe source archives and must be rerun by the maintainer before the release commit.
