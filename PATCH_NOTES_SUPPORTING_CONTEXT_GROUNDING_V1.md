# Patch Notes — Supporting Context Grounding v1

## Added

- Deterministic resolver for explicit reuse of existing API/storage/repository/service/client/state/contract context.
- English, Russian, and Ukrainian reuse-clause grounding.
- Entity-aware ranking from inventory roles, imports, exports, symbols, semantic facts, and literal target paths.
- New `test:support-grounding` smoke suite with 6 scenarios.
- Two Canonical Core integration scenarios; suite increased from 7 to 9 cases, covering backend storage reuse and UI API-client reuse.

## Safety

- Supporting files remain `inspect-only`.
- `authorizedTargets` are not expanded.
- Backend-only and UI-only constraints are enforced before ranking.
- Unrelated, generated, test, documentation, style, and asset files cannot serve as provider proof.
- Only one explicit provider reference is retained beside literal edit targets.

## Version markers

- Selector engine: `2026-07-21.supporting-context-grounding-v1`
- Safety profile: `canonical-core-decision-v1`
