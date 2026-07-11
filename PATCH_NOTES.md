# ContextForge v0.6.5-alpha — Shadow Precision & Abstention UX

## Summary

This patch hardens the production Shadow rollout introduced in v0.6.4. It does not replace the selector architecture or enable Shadow by default. It improves precision, makes uncertainty explicit, and keeps exported Task Packs privacy-safe.

## Completed

- Added `selected`, `abstained`, and `blocked` selector outcomes.
- Replaced `success + 0 files` with a target-not-confirmed manual-review flow.
- Added stable abstention reasons and practical next actions.
- Reduced weak supporting context through evidence-based support budgets.
- Kept edit permissions on grounded primary targets and explicit targets.
- Added human-readable selection reasons and evidence-strength labels.
- Removed business/project-specific runtime aliases from deterministic retrieval.
- Removed absolute local project roots from exported Task Pack metadata.
- Kept real local paths internal for scanner and file-reading operations.
- Expanded rollout smoke coverage to 32 scenarios.

## Rollout behavior

- **Legacy**: unchanged compatibility path.
- **Compare**: Legacy remains the actual output; Shadow may now explicitly report an abstention in comparison diagnostics.
- **Shadow**: creates the real Task Pack when a grounded target is selected; technical failure may fall back to Legacy, but abstention and safety decisions do not.

## Checks completed in the source audit

- Selector smoke passed.
- Legacy replay passed 108/108.
- Synthetic benchmark passed 54/54 across 24 families.
- Rollout smoke passed 32 scenarios.
- Server and renderer builds passed.

The private real-project 28-case regression and sealed 40-case validation are not included in safe source archives. They must be rerun locally before the release commit.

## Next planned phase

**v0.6.6-alpha — Ollama Task Pack Generation Reliability**: strict response schema, repair/retry, bounded prompts, detailed fallback causes, and stronger final Task Pack validation.
