# ContextForge Patch B0 — Safety Preconditions

## Purpose

Patch B0 closes the remaining universal safety gaps observed in the frozen
120-case pre-Patch-B baseline before any broader Coverage & Ownership work.
It does not add project-specific rules and does not attempt to solve missing
multi-layer coverage yet.

## Runtime changes

1. **Sources-of-facts and qualified references are immutable**
   - `only as sources of facts`
   - `only as implementation/consumer/provider/contract reference`
   - Russian/Ukrainian equivalents
   - grouped file lists remain `inspect-only` even when upstream intent or
     ranking proposes them as edit targets.

2. **Explicit `do not create` is a hard precondition**
   - a missing named path cannot become `create-and-edit` when the user says
     not to create that file/component/page/module;
   - the final monotonic authority removes stale synthetic targets even if an
     earlier stage produced one;
   - a different valid create target can still remain authorized.

3. **Grouped negative constraints are atomic**
   - `either`, `both`, `all`, `any of these`, `neither`, and Slavic-language
     equivalents protect the full named group.

4. **Repository/document prompt injection plus destructive action is blocked**
   - following instructions found in README/docs/comments/repository files
     cannot override the user and lead to deletion/removal;
   - benign prompt-injection detection/test tasks remain allowed.

5. **Documentation routing recognizes rewrite intent**
   - `rewrite`, `revise`, and `перепиши` keep an explicit README/docs mutation
     in the docs area even when config/source files are present only as facts.

## Focused smoke

`npm run test:safety-preconditions`

Expected:

`Safety preconditions smoke passed (16 scenarios).`

## Non-goals

- state-owner plus rendered-control coverage;
- client/API/backend/provider coverage contracts;
- create-target wiring completeness;
- test-target coverage;
- confidence calibration beyond safety preconditions.

Those remain Patch B1+ work after B0 passes the cross-project gate.
