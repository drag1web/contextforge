# ContextForge v0.6.7-alpha — Task Understanding & Clarification

## Summary

This release adds a grounded preflight layer before file selection. ContextForge can now distinguish a ready task, a broad interpretation that should be reviewed, and a genuinely incomplete task that requires one focused answer.

## Completed

- Added a universal Task Understanding contract for goal, action, targets, constraints, exact values, missing information, interpretation risk, change definition, confidence, and readiness.
- Added `/api/task-packs/understand` preflight analysis before Analyze Context and Generate Task Pack.
- Added compact clarification and review UI with separate original task and clarification history.
- Added clean clarification grounding so service labels do not contaminate Shadow ranking.
- Added subjective/open-ended review detection for broad visual or qualitative requests.
- Added three locally stored interaction modes in Settings → Generation:
  - **Automatic** — continues review-level tasks and asks only when required information is missing.
  - **Balanced** — recommended; asks for required information and confirms broad/subjective interpretations.
  - **Confirm every task** — displays the interpreted task before every Analyze or Generate action.
- Added a saved-answer checking state so the clarification modal no longer appears to ask the same question twice.
- Hardened manual-verification wording so visual checks report only what was actually performed and observed.

## Safety behavior

- Required values cannot be bypassed in any interaction mode.
- Automatic mode never invents replacement text, colors, URLs, targets, or other user-owned values.
- Original tasks and clarification answers remain separate in stored/exported Task Packs.
- Shadow receives a clean selection task rather than UI-formatted clarification Markdown.

## Verification completed in the source environment

- Task Understanding smoke: 26 scenarios.
- Clarification smoke: 9 scenarios.
- Task Pack generation reliability smoke: 36 scenarios.
- Selector smoke: passed.
- Selector rollout smoke: 32 scenarios.
- Selector presentation smoke: 6 states.
- Legacy replay: 108/108.
- Synthetic selector benchmark: 54 cases across 24 families.
- Server and renderer builds passed.

The private real-project 28-case regression and sealed 40-case validation are not bundled in safe source archives and must be rerun by the maintainer before the release commit.
