# ContextForge Stage 5.2 — Project Memory UX polish

## Changes

- Replaced the native category `<select>` in the Project Memory modal with the shared `CustomSelect` component.
- Added a visible `Project Memory` action button to the top project readiness/action card in Context Builder.
- Moved the compact Project Memory panel above Project Context History in the right-side rail so users can find it sooner.

## Files changed

- `apps/desktop/renderer/src/components/modals/ProjectMemoryModal.tsx`
- `apps/desktop/renderer/src/pages/ContextBuilderPage.tsx`

## Verification

- `npx tsc -b apps/desktop/renderer --pretty false` passed in the patch workspace.

## Not touched

- Server routes/storage
- Ollama selector
- Context composer core
- Safety policy
