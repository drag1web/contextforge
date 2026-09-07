# ContextForge v0.7.1-alpha UI/UX Plan

This document is the canonical implementation roadmap for the `v0.7.1-alpha` development cycle. It defines sequencing and evidence boundaries; it does not mark the planned features as complete.

Context Engine v2 remains frozen at Phase A2 (`8458ffb96b78dd3541207e6ba6ddf6b04cb6a7c8`, tag `checkpoint-ce2-a2-2026-09-06`) and disabled by default. Work in this cycle must not silently change CE2 semantics.

## Phase A — UI Data Contract Audit

- Inventory the Context Engine data that is actually available to the renderer.
- Classify each desired UI datum as `AVAILABLE`, `PARTIAL`, `NOT EXPOSED`, `CE2 ONLY`, `DERIVABLE`, or `DO NOT DERIVE`.
- Read and audit the existing contracts before implementation.
- Make no Context Engine v2 semantic changes.

## Phase B — Navigation Foundation

- Add Back and Forward history with `Alt+Left` and `Alt+Right` shortcuts.
- Add titlebar navigation controls.
- Restore nested navigation state safely.
- Establish Quick Peek and Split View foundations.

## Phase C — Persistent Inspector

- Establish a reusable inspector pattern for file, context, evidence, and Task Pack objects.

## Phase D — Explainability

- Add an Explainability Lens backed by real evidence.
- Add a Task Investigation Timeline.
- Add Context Diff.

## Phase E — Visual Context Map

- Visualize only real, traceable relationships; never invent graph edges.
- Integrate map selections with the persistent Inspector.

## Phase F — Context Workspace

- Add Context Basket, Task Pack Health, and Context Budget surfaces.
- Add Focus Mode, Adaptive Density, and Progressive Disclosure.

## Phase G — Project Awareness

- Add Rescan / What Changed? workflows.
- Indicate stale Task Packs from real repository state.
- Develop Dashboard 2.0 from validated data contracts.

## Phase H — Professional UX

- Add a Command Palette.
- Extend Drag & Drop where authorization and destination behavior are explicit.
- Complete remaining cross-workspace consistency polish.

## Experimental / Later

These items are research backlog, not approved implementation:

- Repository Minimap.
- Relevance Heatmap.
- Workspace Snapshots.

## Core Principles

1. Do not display decorative confidence or relevance scores.
2. Every evidence item, relationship, and status shown by the UI must have a real data source.
3. UI convenience must not bypass safety, grounding, or authorization.
4. Advanced engine details must not overload the default user experience.
5. UI work must not silently change Context Engine v2 semantics.
6. CE2 remains frozen and disabled by default until its work is resumed and approved separately.
