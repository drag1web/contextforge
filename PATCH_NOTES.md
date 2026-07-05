# ContextForge Stage 5.3 — Project Memory in AGENTS.md

## Scope

Adds active Project Memory / Decision Log entries to generated AGENTS.md previews and saved AGENTS.md output.

## Changed files

- `server/src/context/agentsBuilder.ts`
  - Adds Project Memory formatting helpers.
  - Adds a `## Project Memory / Decision Log` section when a project has active memories.
  - Adds a safety post-processor to ensure Ollama cannot accidentally omit saved memory from AGENTS.md output.

- `server/src/routes/projects.ts`
  - Loads active project memories during `/api/projects/:id/agents-preview`.
  - Passes memories into AGENTS.md generation.
  - Returns active memories to the renderer for UI hints.

- `server/src/ollama/promptEnhancers.ts`
  - Tells Ollama to preserve the Project Memory section when it exists in the template.

- `apps/desktop/renderer/src/types/index.ts`
  - Extends `AgentsPreview` with optional `projectMemories`.

- `apps/desktop/renderer/src/api/client.ts`
  - Reads `projectMemories` from AGENTS.md preview responses.

- `apps/desktop/renderer/src/components/modals/AgentsPreviewModal.tsx`
  - Shows a compact memory badge/tile when active project memories are included.
  - Adds a small info banner explaining that active memories will be written into AGENTS.md.

## Verification run

- `npm run build -w @contextforge/server` — passed.
- `npx tsc -b apps/desktop/renderer` — passed.
- Full renderer Vite build was not used in the Linux container because the project has Windows node_modules permissions here.

## Manual checks

1. Add at least one enabled Project Memory item.
2. Generate AGENTS.md from Context Builder.
3. Confirm the preview includes `## Project Memory / Decision Log`.
4. Save AGENTS.md.
5. Open the saved file and confirm active memories are included.
6. Disable a memory item and regenerate; disabled items should not appear.
